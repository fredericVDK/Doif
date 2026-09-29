-- Phase 18. Apply once after 014_shop.sql.
BEGIN;

CREATE TABLE public.game_daily_quest_progress (
  user_id uuid NOT NULL REFERENCES public.game_users(id) ON DELETE CASCADE,
  quest_date date NOT NULL,
  quest_id text NOT NULL CHECK (quest_id IN ('feed_3','play_2','clean_1','visit_pigeondex')),
  progress integer NOT NULL DEFAULT 0 CHECK (progress >= 0),
  completed_at timestamptz CHECK (completed_at IS NULL OR isfinite(completed_at)),
  claimed_at timestamptz CHECK (claimed_at IS NULL OR isfinite(claimed_at)),
  PRIMARY KEY (user_id,quest_date,quest_id),
  CHECK (claimed_at IS NULL OR completed_at IS NOT NULL)
);
ALTER TABLE public.game_daily_quest_progress ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.game_daily_quest_progress FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.game_daily_quest_progress TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.game_daily_quest_progress TO service_role;
CREATE POLICY daily_quests_read_own ON public.game_daily_quest_progress
  FOR SELECT TO authenticated USING ((SELECT auth.uid())=user_id);

CREATE FUNCTION public.pigeon_quest_goal(p_quest_id text) RETURNS integer
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
BEGIN
  RETURN CASE p_quest_id
    WHEN 'feed_3' THEN 3 WHEN 'play_2' THEN 2
    WHEN 'clean_1' THEN 1 WHEN 'visit_pigeondex' THEN 1
    ELSE NULL END;
END;
$$;

CREATE FUNCTION public.pigeon_quest_coins(p_quest_id text) RETURNS integer
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
BEGIN
  RETURN CASE p_quest_id
    WHEN 'feed_3' THEN 20 WHEN 'play_2' THEN 20
    WHEN 'clean_1' THEN 15 WHEN 'visit_pigeondex' THEN 10
    ELSE NULL END;
END;
$$;

CREATE FUNCTION public.pigeon_quest_xp(p_quest_id text) RETURNS integer
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
BEGIN
  RETURN CASE p_quest_id
    WHEN 'feed_3' THEN 15 WHEN 'play_2' THEN 15
    WHEN 'clean_1' THEN 10 WHEN 'visit_pigeondex' THEN 5
    ELSE NULL END;
END;
$$;

CREATE FUNCTION public.get_game_daily_quests(p_user_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  WITH definitions(quest_id,title,goal,coins,xp,position) AS (VALUES
    ('feed_3','Feed your pigeon 3 times',3,20,15,1),
    ('play_2','Play 2 times',2,20,15,2),
    ('clean_1','Clean your pigeon',1,15,10,3),
    ('visit_pigeondex','Visit the PigeonDex',1,10,5,4)
  ), today AS (SELECT public.pigeon_utc_date(clock_timestamp()) AS value)
  SELECT jsonb_build_object(
    'date',today.value,
    'resetAt',((today.value+1)::timestamp AT TIME ZONE 'UTC'),
    'quests',jsonb_agg(jsonb_build_object(
      'id',d.quest_id,'title',d.title,'goal',d.goal,
      'progress',least(d.goal,coalesce(p.progress,0)),
      'completed',coalesce(p.progress,0)>=d.goal,
      'claimed',p.claimed_at IS NOT NULL,
      'reward',jsonb_build_object('coins',d.coins,'xp',d.xp)
    ) ORDER BY d.position)
  )
  FROM definitions d CROSS JOIN today
  LEFT JOIN public.game_daily_quest_progress p ON p.user_id=p_user_id
    AND p.quest_date=today.value AND p.quest_id=d.quest_id
  GROUP BY today.value;
$$;

CREATE FUNCTION public.record_game_daily_quest(p_user_id uuid,p_quest_id text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE goal integer:=public.pigeon_quest_goal(p_quest_id); today date:=public.pigeon_utc_date(clock_timestamp());
BEGIN
  IF goal IS NULL THEN RAISE EXCEPTION 'Unknown quest' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.game_pigeons WHERE user_id=p_user_id) THEN
    RETURN jsonb_build_object('error','NO_PIGEON');
  END IF;
  INSERT INTO public.game_daily_quest_progress(user_id,quest_date,quest_id,progress,completed_at)
    VALUES(p_user_id,today,p_quest_id,1,CASE WHEN goal=1 THEN clock_timestamp() END)
  ON CONFLICT(user_id,quest_date,quest_id) DO UPDATE SET
    progress=least(goal,public.game_daily_quest_progress.progress+1),
    completed_at=CASE WHEN public.game_daily_quest_progress.completed_at IS NOT NULL
      THEN public.game_daily_quest_progress.completed_at
      WHEN public.game_daily_quest_progress.progress+1>=goal THEN clock_timestamp() END;
  RETURN public.get_game_daily_quests(p_user_id);
END;
$$;

CREATE FUNCTION public.claim_game_daily_quest(p_user_id uuid,p_quest_id text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE
  goal integer:=public.pigeon_quest_goal(p_quest_id);
  coin_gain integer:=public.pigeon_quest_coins(p_quest_id);
  xp_gain integer:=public.pigeon_quest_xp(p_quest_id);
  today date:=public.pigeon_utc_date(clock_timestamp());
  entry public.game_daily_quest_progress%ROWTYPE;
  saved public.game_pigeons%ROWTYPE;
  rewarded public.game_pigeons%ROWTYPE;
  wallet jsonb;
BEGIN
  IF goal IS NULL THEN RAISE EXCEPTION 'Unknown quest' USING ERRCODE='22023'; END IF;
  SELECT * INTO saved FROM public.game_pigeons WHERE user_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','NO_PIGEON'); END IF;
  SELECT * INTO entry FROM public.game_daily_quest_progress
    WHERE user_id=p_user_id AND quest_date=today AND quest_id=p_quest_id FOR UPDATE;
  IF NOT FOUND OR entry.progress<goal THEN RETURN jsonb_build_object('error','QUEST_INCOMPLETE'); END IF;
  IF entry.claimed_at IS NOT NULL THEN RETURN jsonb_build_object('error','QUEST_CLAIMED'); END IF;

  rewarded:=public.add_pigeon_xp(saved,xp_gain);
  UPDATE public.game_pigeons SET xp=rewarded.xp,level=rewarded.level,version=saved.version+1
    WHERE id=saved.id RETURNING * INTO rewarded;
  wallet:=public.add_pigeon_coins(p_user_id,coin_gain);
  UPDATE public.game_daily_quest_progress SET claimed_at=clock_timestamp()
    WHERE user_id=p_user_id AND quest_date=today AND quest_id=p_quest_id;
  RETURN jsonb_build_object(
    'claimed',true,'questId',p_quest_id,
    'effects',jsonb_build_object('coins',coin_gain,'xp',xp_gain),
    'wallet',wallet,
    'pigeon',to_jsonb(rewarded)||jsonb_build_object('species',
      (SELECT to_jsonb(s) FROM public.game_species s WHERE s.id=rewarded.species_id)),
    'dailyQuests',public.get_game_daily_quests(p_user_id));
END;
$$;

CREATE FUNCTION public.track_game_daily_quest() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
BEGIN
  PERFORM public.record_game_daily_quest(NEW.user_id,TG_ARGV[0]);
  RETURN NEW;
END;
$$;
CREATE TRIGGER track_feed_daily_quest AFTER INSERT ON public.game_feed_receipts
  FOR EACH ROW EXECUTE FUNCTION public.track_game_daily_quest('feed_3');
CREATE TRIGGER track_play_daily_quest AFTER INSERT ON public.game_play_receipts
  FOR EACH ROW EXECUTE FUNCTION public.track_game_daily_quest('play_2');
CREATE TRIGGER track_clean_daily_quest AFTER INSERT ON public.game_clean_receipts
  FOR EACH ROW EXECUTE FUNCTION public.track_game_daily_quest('clean_1');

REVOKE ALL ON FUNCTION public.pigeon_quest_goal(text),public.pigeon_quest_coins(text),
  public.pigeon_quest_xp(text),public.get_game_daily_quests(uuid),
  public.record_game_daily_quest(uuid,text),public.claim_game_daily_quest(uuid,text),
  public.track_game_daily_quest() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pigeon_quest_goal(text),public.pigeon_quest_coins(text),
  public.pigeon_quest_xp(text),public.get_game_daily_quests(uuid),
  public.record_game_daily_quest(uuid,text),public.claim_game_daily_quest(uuid,text),
  public.track_game_daily_quest() TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
