-- Phase 34. Add long-term achievements for every established game system.
-- Apply once after 025_more_quests_achievements.sql.
BEGIN;

ALTER TABLE public.game_user_achievements
  DROP CONSTRAINT game_user_achievements_achievement_id_check,
  ADD CONSTRAINT game_user_achievements_achievement_id_check CHECK (achievement_id IN
    ('first_crumb','pigeon_parent','bird_nerd','best_friends','collector',
     'arena_regular','pack_opener','clinic_friend','crumb_champion','master_birder',
     'crumb_connoisseur','devoted_caretaker','seasoned_pigeon','arena_veteran',
     'pack_collector','clinic_regular','crumb_legend','pigeon_scholar','nest_egg',
     'legendary_companion'));

CREATE OR REPLACE FUNCTION public.pigeon_achievement_coins(p_id text) RETURNS integer
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT CASE p_id
    WHEN 'first_crumb' THEN 25 WHEN 'pigeon_parent' THEN 100
    WHEN 'bird_nerd' THEN 150 WHEN 'best_friends' THEN 250 WHEN 'collector' THEN 100
    WHEN 'arena_regular' THEN 150 WHEN 'pack_opener' THEN 200 WHEN 'clinic_friend' THEN 125
    WHEN 'crumb_champion' THEN 150 WHEN 'master_birder' THEN 300
    WHEN 'crumb_connoisseur' THEN 125 WHEN 'devoted_caretaker' THEN 250
    WHEN 'seasoned_pigeon' THEN 250 WHEN 'arena_veteran' THEN 350
    WHEN 'pack_collector' THEN 400 WHEN 'clinic_regular' THEN 300
    WHEN 'crumb_legend' THEN 350 WHEN 'pigeon_scholar' THEN 600
    WHEN 'nest_egg' THEN 250 WHEN 'legendary_companion' THEN 1000 END;
$$;

CREATE OR REPLACE FUNCTION public.pigeon_achievement_xp(p_id text) RETURNS integer
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT CASE p_id
    WHEN 'first_crumb' THEN 10 WHEN 'pigeon_parent' THEN 50
    WHEN 'bird_nerd' THEN 75 WHEN 'best_friends' THEN 100 WHEN 'collector' THEN 50
    WHEN 'arena_regular' THEN 75 WHEN 'pack_opener' THEN 100 WHEN 'clinic_friend' THEN 60
    WHEN 'crumb_champion' THEN 75 WHEN 'master_birder' THEN 150
    WHEN 'crumb_connoisseur' THEN 60 WHEN 'devoted_caretaker' THEN 125
    WHEN 'seasoned_pigeon' THEN 125 WHEN 'arena_veteran' THEN 175
    WHEN 'pack_collector' THEN 200 WHEN 'clinic_regular' THEN 150
    WHEN 'crumb_legend' THEN 175 WHEN 'pigeon_scholar' THEN 300
    WHEN 'nest_egg' THEN 125 WHEN 'legendary_companion' THEN 500 END;
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
    ('master_birder','Master Birder','Discover 100 pigeons.',100,300,150,10),
    ('crumb_connoisseur','Crumb Connoisseur','Feed your pigeon 50 times.',50,125,60,11),
    ('devoted_caretaker','Devoted Caretaker','Complete 100 care actions.',100,250,125,12),
    ('seasoned_pigeon','Seasoned Pigeon','Reach level 20.',20,250,125,13),
    ('arena_veteran','Arena Veteran','Complete 50 pigeon battles.',50,350,175,14),
    ('pack_collector','Pack Collector','Open 25 Pigeon Packs.',25,400,200,15),
    ('clinic_regular','Clinic Regular','Visit the Pigeon Clinic 15 times.',15,300,150,16),
    ('crumb_legend','Crumb Legend','Complete 50 Catch the Crumbs rounds.',50,350,175,17),
    ('pigeon_scholar','Pigeon Scholar','Discover 250 pigeons.',250,600,300,18),
    ('nest_egg','Nest Egg','Save 2,500 Pigeon Coins.',2500,250,125,19),
    ('legendary_companion','Legendary Companion','Reach level 50.',50,1000,500,20)
  ), counters AS (
    SELECT
      coalesce((SELECT level FROM public.game_pigeons WHERE user_id=p_user_id),0)::integer AS level,
      coalesce((SELECT coins FROM public.game_users WHERE id=p_user_id),0)::integer AS coins,
      (SELECT count(*)::integer FROM public.game_feed_receipts WHERE user_id=p_user_id) AS feeds,
      (SELECT count(*)::integer FROM public.game_play_receipts WHERE user_id=p_user_id) AS plays,
      (SELECT count(*)::integer FROM public.game_clean_receipts WHERE user_id=p_user_id) AS cleans,
      (SELECT count(*)::integer FROM public.game_sleep_receipts WHERE user_id=p_user_id) AS sleeps,
      (SELECT count(*)::integer FROM public.game_pigeon_discoveries WHERE user_id=p_user_id) AS discoveries,
      (SELECT count(*)::integer FROM public.game_user_items WHERE user_id=p_user_id AND quantity>0) AS items,
      (SELECT count(*)::integer FROM public.game_battle_receipts WHERE user_id=p_user_id) AS battles,
      (SELECT count(*)::integer FROM public.game_pigeon_pack_receipts WHERE user_id=p_user_id) AS packs,
      (SELECT count(*)::integer FROM public.game_clinic_receipts WHERE user_id=p_user_id) AS clinic_visits,
      (SELECT count(*)::integer FROM public.game_crumb_runs WHERE user_id=p_user_id AND completed_at IS NOT NULL) AS crumb_rounds,
      EXISTS(SELECT 1 FROM public.game_pigeons WHERE user_id=p_user_id AND growth_stage='best_friend') AS best_friend
  ), progress AS (
    SELECT d.*,CASE d.id
      WHEN 'first_crumb' THEN c.feeds WHEN 'pigeon_parent' THEN c.level
      WHEN 'bird_nerd' THEN c.discoveries
      WHEN 'best_friends' THEN CASE WHEN c.best_friend THEN 25 ELSE c.level END
      WHEN 'collector' THEN c.items WHEN 'arena_regular' THEN c.battles
      WHEN 'pack_opener' THEN c.packs WHEN 'clinic_friend' THEN c.clinic_visits
      WHEN 'crumb_champion' THEN c.crumb_rounds WHEN 'master_birder' THEN c.discoveries
      WHEN 'crumb_connoisseur' THEN c.feeds
      WHEN 'devoted_caretaker' THEN c.feeds+c.plays+c.cleans+c.sleeps
      WHEN 'seasoned_pigeon' THEN c.level WHEN 'arena_veteran' THEN c.battles
      WHEN 'pack_collector' THEN c.packs WHEN 'clinic_regular' THEN c.clinic_visits
      WHEN 'crumb_legend' THEN c.crumb_rounds WHEN 'pigeon_scholar' THEN c.discoveries
      WHEN 'nest_egg' THEN c.coins WHEN 'legendary_companion' THEN c.level
    END AS current FROM definitions d CROSS JOIN counters c
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
    ('master_birder',(SELECT count(*) FROM public.game_pigeon_discoveries WHERE user_id=p_user_id)>=100),
    ('crumb_connoisseur',(SELECT count(*) FROM public.game_feed_receipts WHERE user_id=p_user_id)>=50),
    ('devoted_caretaker',((SELECT count(*) FROM public.game_feed_receipts WHERE user_id=p_user_id)+
      (SELECT count(*) FROM public.game_play_receipts WHERE user_id=p_user_id)+
      (SELECT count(*) FROM public.game_clean_receipts WHERE user_id=p_user_id)+
      (SELECT count(*) FROM public.game_sleep_receipts WHERE user_id=p_user_id))>=100),
    ('seasoned_pigeon',pigeon.level>=20),
    ('arena_veteran',(SELECT count(*) FROM public.game_battle_receipts WHERE user_id=p_user_id)>=50),
    ('pack_collector',(SELECT count(*) FROM public.game_pigeon_pack_receipts WHERE user_id=p_user_id)>=25),
    ('clinic_regular',(SELECT count(*) FROM public.game_clinic_receipts WHERE user_id=p_user_id)>=15),
    ('crumb_legend',(SELECT count(*) FROM public.game_crumb_runs WHERE user_id=p_user_id AND completed_at IS NOT NULL)>=50),
    ('pigeon_scholar',(SELECT count(*) FROM public.game_pigeon_discoveries WHERE user_id=p_user_id)>=250),
    ('nest_egg',(SELECT coins FROM public.game_users WHERE id=p_user_id)>=2500),
    ('legendary_companion',pigeon.level>=50)
  ) AS earned(id,ready) WHERE ready ON CONFLICT(user_id,achievement_id) DO NOTHING;
  RETURN public.get_game_achievements(p_user_id);
END;
$$;

NOTIFY pgrst,'reload schema';
COMMIT;
