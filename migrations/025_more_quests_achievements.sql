-- Phase 32. Expand daily quests and permanent achievements for newer game systems.
-- Apply once after 024_pigeon_clinic.sql.
BEGIN;

ALTER TABLE public.game_daily_quest_progress
  DROP CONSTRAINT game_daily_quest_progress_quest_id_check,
  ADD CONSTRAINT game_daily_quest_progress_quest_id_check CHECK (quest_id IN
    ('feed_3','play_2','clean_1','visit_pigeondex','sleep_1','battle_1','crumb_game_1'));

CREATE OR REPLACE FUNCTION public.pigeon_quest_goal(p_quest_id text) RETURNS integer
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT CASE p_quest_id WHEN 'feed_3' THEN 3 WHEN 'play_2' THEN 2
    WHEN 'clean_1' THEN 1 WHEN 'visit_pigeondex' THEN 1 WHEN 'sleep_1' THEN 1
    WHEN 'battle_1' THEN 1 WHEN 'crumb_game_1' THEN 1 END;
$$;
CREATE OR REPLACE FUNCTION public.pigeon_quest_coins(p_quest_id text) RETURNS integer
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT CASE p_quest_id WHEN 'feed_3' THEN 20 WHEN 'play_2' THEN 20
    WHEN 'clean_1' THEN 15 WHEN 'visit_pigeondex' THEN 10 WHEN 'sleep_1' THEN 10
    WHEN 'battle_1' THEN 25 WHEN 'crumb_game_1' THEN 20 END;
$$;
CREATE OR REPLACE FUNCTION public.pigeon_quest_xp(p_quest_id text) RETURNS integer
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT CASE p_quest_id WHEN 'feed_3' THEN 15 WHEN 'play_2' THEN 15
    WHEN 'clean_1' THEN 10 WHEN 'visit_pigeondex' THEN 5 WHEN 'sleep_1' THEN 5
    WHEN 'battle_1' THEN 15 WHEN 'crumb_game_1' THEN 10 END;
$$;
CREATE OR REPLACE FUNCTION public.get_game_daily_quests(p_user_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  WITH definitions(quest_id,title,goal,coins,xp,position) AS (VALUES
    ('feed_3','Feed your pigeon 3 times',3,20,15,1),
    ('play_2','Play 2 times',2,20,15,2),
    ('clean_1','Clean your pigeon',1,15,10,3),
    ('sleep_1','Let your pigeon sleep',1,10,5,4),
    ('battle_1','Complete a pigeon battle',1,25,15,5),
    ('crumb_game_1','Play Catch the Crumbs',1,20,10,6),
    ('visit_pigeondex','Visit the PigeonDex',1,10,5,7)
  ), today AS (SELECT public.pigeon_utc_date(clock_timestamp()) AS value)
  SELECT jsonb_build_object('date',today.value,
    'resetAt',((today.value+1)::timestamp AT TIME ZONE 'UTC'),
    'quests',jsonb_agg(jsonb_build_object('id',d.quest_id,'title',d.title,'goal',d.goal,
      'progress',least(d.goal,coalesce(p.progress,0)),'completed',coalesce(p.progress,0)>=d.goal,
      'claimed',p.claimed_at IS NOT NULL,'reward',jsonb_build_object('coins',d.coins,'xp',d.xp)) ORDER BY d.position))
  FROM definitions d CROSS JOIN today LEFT JOIN public.game_daily_quest_progress p
    ON p.user_id=p_user_id AND p.quest_date=today.value AND p.quest_id=d.quest_id
  GROUP BY today.value;
$$;

CREATE TRIGGER track_sleep_daily_quest AFTER INSERT ON public.game_sleep_receipts
  FOR EACH ROW EXECUTE FUNCTION public.track_game_daily_quest('sleep_1');
CREATE TRIGGER track_battle_daily_quest AFTER INSERT ON public.game_battle_receipts
  FOR EACH ROW EXECUTE FUNCTION public.track_game_daily_quest('battle_1');
CREATE TRIGGER track_crumb_game_daily_quest AFTER UPDATE OF completed_at ON public.game_crumb_runs
  FOR EACH ROW WHEN (OLD.completed_at IS NULL AND NEW.completed_at IS NOT NULL)
  EXECUTE FUNCTION public.track_game_daily_quest('crumb_game_1');

ALTER TABLE public.game_user_achievements
  DROP CONSTRAINT game_user_achievements_achievement_id_check,
  ADD CONSTRAINT game_user_achievements_achievement_id_check CHECK (achievement_id IN
    ('first_crumb','pigeon_parent','bird_nerd','best_friends','collector',
     'arena_regular','pack_opener','clinic_friend','crumb_champion','master_birder'));

CREATE OR REPLACE FUNCTION public.pigeon_achievement_coins(p_id text) RETURNS integer
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT CASE p_id WHEN 'first_crumb' THEN 25 WHEN 'pigeon_parent' THEN 100
    WHEN 'bird_nerd' THEN 150 WHEN 'best_friends' THEN 250 WHEN 'collector' THEN 100
    WHEN 'arena_regular' THEN 150 WHEN 'pack_opener' THEN 200 WHEN 'clinic_friend' THEN 125
    WHEN 'crumb_champion' THEN 150 WHEN 'master_birder' THEN 300 END;
$$;
CREATE OR REPLACE FUNCTION public.pigeon_achievement_xp(p_id text) RETURNS integer
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT CASE p_id WHEN 'first_crumb' THEN 10 WHEN 'pigeon_parent' THEN 50
    WHEN 'bird_nerd' THEN 75 WHEN 'best_friends' THEN 100 WHEN 'collector' THEN 50
    WHEN 'arena_regular' THEN 75 WHEN 'pack_opener' THEN 100 WHEN 'clinic_friend' THEN 60
    WHEN 'crumb_champion' THEN 75 WHEN 'master_birder' THEN 150 END;
$$;
CREATE OR REPLACE FUNCTION public.get_game_achievements(p_user_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  WITH definitions(id,title,description,goal,coins,xp,position) AS (VALUES
    ('first_crumb','First Crumb','Feed your pigeon for the first time.',1,25,10,1),
    ('pigeon_parent','Pigeon Parent','Reach level 10.',10,100,50,2),
    ('bird_nerd','Bird Nerd','Discover 25 pigeons.',25,150,75,3),
    ('best_friends','Best Friends','Reach growth stage Best Friend.',25,250,100,4),
    ('collector','Collector','Own 10 different items.',10,100,50,5),
    ('arena_regular','Arena Regular','Complete 10 pigeon battles.',10,150,75,6),
    ('pack_opener','Pack Opener','Open 10 Pigeon Packs.',10,200,100,7),
    ('clinic_friend','Clinic Friend','Visit the Pigeon Clinic 5 times.',5,125,60,8),
    ('crumb_champion','Crumb Champion','Complete 10 Catch the Crumbs rounds.',10,150,75,9),
    ('master_birder','Master Birder','Discover 100 pigeons.',100,300,150,10)
  ), progress AS (
    SELECT d.*,CASE d.id
      WHEN 'first_crumb' THEN (SELECT count(*)::integer FROM public.game_feed_receipts WHERE user_id=p_user_id)
      WHEN 'pigeon_parent' THEN coalesce((SELECT level FROM public.game_pigeons WHERE user_id=p_user_id),0)
      WHEN 'bird_nerd' THEN (SELECT count(*)::integer FROM public.game_pigeon_discoveries WHERE user_id=p_user_id)
      WHEN 'best_friends' THEN CASE WHEN EXISTS(SELECT 1 FROM public.game_pigeons WHERE user_id=p_user_id AND growth_stage='best_friend') THEN 25 ELSE coalesce((SELECT level FROM public.game_pigeons WHERE user_id=p_user_id),0) END
      WHEN 'collector' THEN (SELECT count(*)::integer FROM public.game_user_items WHERE user_id=p_user_id AND quantity>0)
      WHEN 'arena_regular' THEN (SELECT count(*)::integer FROM public.game_battle_receipts WHERE user_id=p_user_id)
      WHEN 'pack_opener' THEN (SELECT count(*)::integer FROM public.game_pigeon_pack_receipts WHERE user_id=p_user_id)
      WHEN 'clinic_friend' THEN (SELECT count(*)::integer FROM public.game_clinic_receipts WHERE user_id=p_user_id)
      WHEN 'crumb_champion' THEN (SELECT count(*)::integer FROM public.game_crumb_runs WHERE user_id=p_user_id AND completed_at IS NOT NULL)
      WHEN 'master_birder' THEN (SELECT count(*)::integer FROM public.game_pigeon_discoveries WHERE user_id=p_user_id)
    END AS current FROM definitions d
  ) SELECT jsonb_build_object('unlockedCount',count(a.achievement_id),'total',count(*),
    'achievements',jsonb_agg(jsonb_build_object('id',p.id,'title',p.title,'description',p.description,
      'goal',p.goal,'progress',least(p.goal,p.current),'unlocked',a.achievement_id IS NOT NULL,
      'claimed',a.claimed_at IS NOT NULL,'reward',jsonb_build_object('coins',p.coins,'xp',p.xp)) ORDER BY p.position))
  FROM progress p LEFT JOIN public.game_user_achievements a ON a.user_id=p_user_id AND a.achievement_id=p.id;
$$;
CREATE OR REPLACE FUNCTION public.sync_game_achievements(p_user_id uuid) RETURNS jsonb
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
    ('collector',(SELECT count(*) FROM public.game_user_items WHERE user_id=p_user_id AND quantity>0)>=10),
    ('arena_regular',(SELECT count(*) FROM public.game_battle_receipts WHERE user_id=p_user_id)>=10),
    ('pack_opener',(SELECT count(*) FROM public.game_pigeon_pack_receipts WHERE user_id=p_user_id)>=10),
    ('clinic_friend',(SELECT count(*) FROM public.game_clinic_receipts WHERE user_id=p_user_id)>=5),
    ('crumb_champion',(SELECT count(*) FROM public.game_crumb_runs WHERE user_id=p_user_id AND completed_at IS NOT NULL)>=10),
    ('master_birder',(SELECT count(*) FROM public.game_pigeon_discoveries WHERE user_id=p_user_id)>=100)
  ) AS earned(id,ready) WHERE ready ON CONFLICT(user_id,achievement_id) DO NOTHING;
  RETURN public.get_game_achievements(p_user_id);
END;
$$;
NOTIFY pgrst,'reload schema';
COMMIT;
