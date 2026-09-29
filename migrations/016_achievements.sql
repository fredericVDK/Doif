-- Phase 19. Apply once after 015_daily_quests.sql.
BEGIN;

CREATE TABLE public.game_user_achievements (
  user_id uuid NOT NULL REFERENCES public.game_users(id) ON DELETE CASCADE,
  achievement_id text NOT NULL CHECK (achievement_id IN
    ('first_crumb','pigeon_parent','bird_nerd','best_friends','collector')),
  unlocked_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(unlocked_at)),
  claimed_at timestamptz CHECK (claimed_at IS NULL OR isfinite(claimed_at)),
  PRIMARY KEY(user_id,achievement_id)
);
ALTER TABLE public.game_user_achievements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.game_user_achievements FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.game_user_achievements TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.game_user_achievements TO service_role;
CREATE POLICY achievements_read_own ON public.game_user_achievements
  FOR SELECT TO authenticated USING ((SELECT auth.uid())=user_id);

CREATE FUNCTION public.pigeon_achievement_coins(p_id text) RETURNS integer
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
BEGIN
  RETURN CASE p_id WHEN 'first_crumb' THEN 25 WHEN 'pigeon_parent' THEN 100
    WHEN 'bird_nerd' THEN 150 WHEN 'best_friends' THEN 250
    WHEN 'collector' THEN 100 ELSE NULL END;
END;
$$;
CREATE FUNCTION public.pigeon_achievement_xp(p_id text) RETURNS integer
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
BEGIN
  RETURN CASE p_id WHEN 'first_crumb' THEN 10 WHEN 'pigeon_parent' THEN 50
    WHEN 'bird_nerd' THEN 75 WHEN 'best_friends' THEN 100
    WHEN 'collector' THEN 50 ELSE NULL END;
END;
$$;

CREATE FUNCTION public.get_game_achievements(p_user_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  WITH definitions(id,title,description,goal,coins,xp,position) AS (VALUES
    ('first_crumb','First Crumb','Feed your pigeon for the first time.',1,25,10,1),
    ('pigeon_parent','Pigeon Parent','Reach level 10.',10,100,50,2),
    ('bird_nerd','Bird Nerd','Discover 25 species.',25,150,75,3),
    ('best_friends','Best Friends','Reach growth stage Best Friend.',25,250,100,4),
    ('collector','Collector','Own 10 different items.',10,100,50,5)
  ), progress AS (
    SELECT d.*,
      CASE d.id
        WHEN 'first_crumb' THEN (SELECT count(*)::integer FROM public.game_feed_receipts WHERE user_id=p_user_id)
        WHEN 'pigeon_parent' THEN coalesce((SELECT level FROM public.game_pigeons WHERE user_id=p_user_id),0)
        WHEN 'bird_nerd' THEN (SELECT count(*)::integer FROM public.game_pigeon_discoveries WHERE user_id=p_user_id)
        WHEN 'best_friends' THEN CASE WHEN EXISTS(SELECT 1 FROM public.game_pigeons WHERE user_id=p_user_id AND growth_stage='best_friend') THEN 25 ELSE coalesce((SELECT level FROM public.game_pigeons WHERE user_id=p_user_id),0) END
        WHEN 'collector' THEN (SELECT count(*)::integer FROM public.game_user_items WHERE user_id=p_user_id AND quantity>0)
      END AS current
    FROM definitions d
  )
  SELECT jsonb_build_object('unlockedCount',count(a.achievement_id),
    'total',count(*),'achievements',jsonb_agg(jsonb_build_object(
      'id',p.id,'title',p.title,'description',p.description,'goal',p.goal,
      'progress',least(p.goal,p.current),'unlocked',a.achievement_id IS NOT NULL,
      'claimed',a.claimed_at IS NOT NULL,
      'reward',jsonb_build_object('coins',p.coins,'xp',p.xp)
    ) ORDER BY p.position))
  FROM progress p LEFT JOIN public.game_user_achievements a
    ON a.user_id=p_user_id AND a.achievement_id=p.id;
$$;

CREATE FUNCTION public.sync_game_achievements(p_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE pigeon public.game_pigeons%ROWTYPE;
BEGIN
  SELECT * INTO pigeon FROM public.game_pigeons WHERE user_id=p_user_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','NO_PIGEON'); END IF;
  INSERT INTO public.game_user_achievements(user_id,achievement_id)
  SELECT p_user_id,id FROM (VALUES
    ('first_crumb',EXISTS(SELECT 1 FROM public.game_feed_receipts WHERE user_id=p_user_id)),
    ('pigeon_parent',pigeon.level>=10),
    ('bird_nerd',(SELECT count(*) FROM public.game_pigeon_discoveries WHERE user_id=p_user_id)>=25),
    ('best_friends',pigeon.growth_stage='best_friend'),
    ('collector',(SELECT count(*) FROM public.game_user_items WHERE user_id=p_user_id AND quantity>0)>=10)
  ) AS earned(id,ready) WHERE ready
  ON CONFLICT(user_id,achievement_id) DO NOTHING;
  RETURN public.get_game_achievements(p_user_id);
END;
$$;

CREATE FUNCTION public.claim_game_achievement(p_user_id uuid,p_achievement_id text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE
  coin_gain integer:=public.pigeon_achievement_coins(p_achievement_id);
  xp_gain integer:=public.pigeon_achievement_xp(p_achievement_id);
  entry public.game_user_achievements%ROWTYPE;
  saved public.game_pigeons%ROWTYPE;
  rewarded public.game_pigeons%ROWTYPE;
  wallet jsonb;
BEGIN
  IF coin_gain IS NULL OR xp_gain IS NULL THEN RAISE EXCEPTION 'Unknown achievement' USING ERRCODE='22023'; END IF;
  SELECT * INTO saved FROM public.game_pigeons WHERE user_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','NO_PIGEON'); END IF;
  PERFORM public.sync_game_achievements(p_user_id);
  SELECT * INTO entry FROM public.game_user_achievements
    WHERE user_id=p_user_id AND achievement_id=p_achievement_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','ACHIEVEMENT_LOCKED'); END IF;
  IF entry.claimed_at IS NOT NULL THEN RETURN jsonb_build_object('error','ACHIEVEMENT_CLAIMED'); END IF;

  rewarded:=public.add_pigeon_xp(saved,xp_gain);
  UPDATE public.game_pigeons SET xp=rewarded.xp,level=rewarded.level,version=saved.version+1
    WHERE id=saved.id RETURNING * INTO rewarded;
  wallet:=public.add_pigeon_coins(p_user_id,coin_gain);
  UPDATE public.game_user_achievements SET claimed_at=clock_timestamp()
    WHERE user_id=p_user_id AND achievement_id=p_achievement_id;
  -- The reward itself can cross another level-based achievement threshold.
  PERFORM public.sync_game_achievements(p_user_id);
  RETURN jsonb_build_object('claimed',true,'achievementId',p_achievement_id,
    'effects',jsonb_build_object('coins',coin_gain,'xp',xp_gain),'wallet',wallet,
    'pigeon',to_jsonb(rewarded)||jsonb_build_object('species',
      (SELECT to_jsonb(s) FROM public.game_species s WHERE s.id=rewarded.species_id)),
    'achievements',public.get_game_achievements(p_user_id));
END;
$$;

REVOKE ALL ON FUNCTION public.pigeon_achievement_coins(text),public.pigeon_achievement_xp(text),
  public.get_game_achievements(uuid),public.sync_game_achievements(uuid),
  public.claim_game_achievement(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pigeon_achievement_coins(text),public.pigeon_achievement_xp(text),
  public.get_game_achievements(uuid),public.sync_game_achievements(uuid),
  public.claim_game_achievement(uuid,text) TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
