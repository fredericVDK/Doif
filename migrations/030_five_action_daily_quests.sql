-- Phase 38. Require five actions for every daily quest.
-- Apply once after 029_progression_social.sql.
BEGIN;

CREATE OR REPLACE FUNCTION public.pigeon_quest_goal(p_quest_id text) RETURNS integer
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT CASE WHEN p_quest_id IN
    ('feed_3','play_2','clean_1','visit_pigeondex','sleep_1','battle_1','crumb_game_1')
    THEN 5 END;
$$;

CREATE OR REPLACE FUNCTION public.get_game_daily_quests(p_user_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  WITH definitions(quest_id,title,goal,coins,xp,position) AS (VALUES
    ('feed_3','Feed your pigeon 5 times',5,20,15,1),
    ('play_2','Play 5 times',5,20,15,2),
    ('clean_1','Clean your pigeon 5 times',5,15,10,3),
    ('sleep_1','Let your pigeon sleep 5 times',5,10,5,4),
    ('battle_1','Complete 5 pigeon battles',5,25,15,5),
    ('crumb_game_1','Play Catch the Crumbs 5 times',5,20,10,6),
    ('visit_pigeondex','Visit the PigeonDex 5 times',5,10,5,7)
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

-- Keep rewards that were already claimed before this migration internally
-- consistent. Unclaimed progress must reach the new five-action target.
UPDATE public.game_daily_quest_progress SET progress=5
  WHERE claimed_at IS NOT NULL AND progress<5;
UPDATE public.game_daily_quest_progress SET completed_at=NULL
  WHERE claimed_at IS NULL AND progress<5;

REVOKE ALL ON FUNCTION public.pigeon_quest_goal(text),public.get_game_daily_quests(uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pigeon_quest_goal(text),public.get_game_daily_quests(uuid)
  TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
