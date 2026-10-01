-- Phase 42. Multi-pigeon teams, Deck progression, training, story chapters,
-- notifications, seasonal rankings and Supabase-owned community content.
-- Apply once after 033_race_world_and_test_accounts.sql.
BEGIN;

ALTER TABLE public.game_pigeons DROP CONSTRAINT IF EXISTS game_pigeons_user_id_key;
ALTER TABLE public.game_pigeons
  ADD COLUMN team_slot smallint,
  ADD COLUMN is_home boolean NOT NULL DEFAULT false,
  ADD COLUMN training_speed integer NOT NULL DEFAULT 0 CHECK(training_speed BETWEEN 0 AND 100),
  ADD COLUMN training_endurance integer NOT NULL DEFAULT 0 CHECK(training_endurance BETWEEN 0 AND 100),
  ADD COLUMN training_strength integer NOT NULL DEFAULT 0 CHECK(training_strength BETWEEN 0 AND 100),
  ADD COLUMN training_navigation integer NOT NULL DEFAULT 0 CHECK(training_navigation BETWEEN 0 AND 100);
WITH numbered AS (
  SELECT id,row_number() OVER(PARTITION BY user_id ORDER BY created_at,id)::smallint AS slot
  FROM public.game_pigeons
) UPDATE public.game_pigeons p SET team_slot=n.slot,is_home=(n.slot=1) FROM numbered n WHERE n.id=p.id;
ALTER TABLE public.game_pigeons ALTER COLUMN team_slot SET NOT NULL;
ALTER TABLE public.game_pigeons ALTER COLUMN team_slot SET DEFAULT 1;
ALTER TABLE public.game_pigeons ALTER COLUMN is_home SET DEFAULT true;
ALTER TABLE public.game_pigeons ADD CHECK(team_slot BETWEEN 1 AND 3);
CREATE UNIQUE INDEX game_pigeons_team_slot_unique ON public.game_pigeons(user_id,team_slot);
CREATE UNIQUE INDEX game_pigeons_team_species_unique ON public.game_pigeons(user_id,species_id);
CREATE UNIQUE INDEX game_pigeons_one_home ON public.game_pigeons(user_id) WHERE is_home;

CREATE TABLE public.game_team_action_receipts(
  user_id uuid NOT NULL REFERENCES public.game_users(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  pigeon_id uuid NOT NULL REFERENCES public.game_pigeons(id) ON DELETE CASCADE,
  action text NOT NULL CHECK(action IN ('feed','play','clean','sleep','battle','clinic','train')),
  result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(user_id,request_id)
);
CREATE TABLE public.game_notifications(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.game_users(id) ON DELETE CASCADE,
  type text NOT NULL CHECK(type~'^[a-z_]{2,40}$'),
  title text NOT NULL CHECK(char_length(title) BETWEEN 1 AND 80),
  message text NOT NULL CHECK(char_length(message) BETWEEN 1 AND 240),
  href text NOT NULL DEFAULT '/my-pigeon' CHECK(href LIKE '/%'),
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX game_notifications_user_created ON public.game_notifications(user_id,created_at DESC);
CREATE TABLE public.game_story_claims(
  user_id uuid NOT NULL REFERENCES public.game_users(id) ON DELETE CASCADE,
  chapter smallint NOT NULL CHECK(chapter BETWEEN 1 AND 5),
  claimed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(user_id,chapter)
);

CREATE TABLE public.community_scores(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id text NOT NULL UNIQUE,
  nickname text NOT NULL CHECK(char_length(nickname) BETWEEN 1 AND 24),
  amount integer NOT NULL CHECK(amount BETWEEN 1 AND 100000),
  session_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX community_scores_nickname ON public.community_scores(lower(nickname));
CREATE TABLE public.community_drawings(
  id text PRIMARY KEY,
  artist text NOT NULL CHECK(char_length(artist) BETWEEN 1 AND 32),
  title text NOT NULL CHECK(char_length(title) BETWEEN 1 AND 48),
  image_data_url text NOT NULL CHECK(image_data_url LIKE 'data:image/%'),
  image_bytes integer NOT NULL CHECK(image_bytes BETWEEN 1 AND 650000),
  image_mime_type text NOT NULL CHECK(image_mime_type IN ('image/png','image/jpeg','image/webp')),
  status text NOT NULL DEFAULT 'approved' CHECK(status IN ('approved','needs_review','rejected')),
  ai jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(ai)='object'),
  ai_feedback text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE public.game_team_action_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_story_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_drawings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.game_team_action_receipts,public.game_notifications,public.game_story_claims,
  public.community_scores,public.community_drawings FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.game_team_action_receipts,public.game_notifications,public.game_story_claims TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.game_team_action_receipts,public.game_notifications,public.game_story_claims,
  public.community_scores,public.community_drawings TO service_role;
CREATE POLICY team_receipts_read_own ON public.game_team_action_receipts FOR SELECT TO authenticated USING((SELECT auth.uid())=user_id);
CREATE POLICY notifications_read_own ON public.game_notifications FOR SELECT TO authenticated USING((SELECT auth.uid())=user_id);
CREATE POLICY story_claims_read_own ON public.game_story_claims FOR SELECT TO authenticated USING((SELECT auth.uid())=user_id);

CREATE FUNCTION public.team_pigeon_json(p public.game_pigeons) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT to_jsonb(p)||jsonb_build_object('species',(SELECT to_jsonb(s) FROM public.game_species s WHERE s.id=p.species_id),
    'raceStats',public.pigeon_race_stats(p.level)||jsonb_build_object('speed',(public.pigeon_race_stats(p.level)->>'speed')::integer+p.training_speed,
      'endurance',(public.pigeon_race_stats(p.level)->>'endurance')::integer+p.training_endurance,
      'strength',(public.pigeon_race_stats(p.level)->>'strength')::integer+p.training_strength,
      'navigation',(public.pigeon_race_stats(p.level)->>'navigation')::integer+p.training_navigation));
$$;

CREATE FUNCTION public.get_game_deck(p_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE cards jsonb; team jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(jsonb_build_object('speciesId',d.species_id,'discoveredAt',d.discovered_at,
    'species',to_jsonb(s),'teamPigeonId',p.id,'teamSlot',p.team_slot,'level',coalesce(p.level,1),'xp',coalesce(p.xp,0),
    'nickname',p.nickname) ORDER BY d.discovered_at DESC),'[]'::jsonb) INTO cards
    FROM public.game_pigeon_discoveries d JOIN public.game_species s ON s.id=d.species_id
    LEFT JOIN public.game_pigeons p ON p.user_id=d.user_id AND p.species_id=d.species_id WHERE d.user_id=p_user_id;
  SELECT coalesce(jsonb_agg(public.team_pigeon_json(p) ORDER BY p.team_slot),'[]'::jsonb) INTO team
    FROM public.game_pigeons p WHERE p.user_id=p_user_id;
  RETURN jsonb_build_object('cards',cards,'team',team,'teamLimit',3);
END;
$$;

CREATE FUNCTION public.add_game_team_pigeon(p_user_id uuid,p_species_id text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE slot smallint; created public.game_pigeons%ROWTYPE; species public.game_species%ROWTYPE;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.game_pigeon_discoveries WHERE user_id=p_user_id AND species_id=p_species_id) THEN
    RETURN jsonb_build_object('error','UNDISCOVERED_PIGEON'); END IF;
  IF EXISTS(SELECT 1 FROM public.game_pigeons WHERE user_id=p_user_id AND species_id=p_species_id) THEN
    RETURN jsonb_build_object('error','ALREADY_ON_TEAM'); END IF;
  PERFORM 1 FROM public.game_users WHERE id=p_user_id FOR UPDATE;
  SELECT count(*)+1 INTO slot FROM public.game_pigeons WHERE user_id=p_user_id;
  IF slot>3 THEN RETURN jsonb_build_object('error','TEAM_FULL'); END IF;
  SELECT * INTO species FROM public.game_species WHERE id=p_species_id;
  INSERT INTO public.game_pigeons(user_id,species_id,nickname,team_slot,is_home)
    VALUES(p_user_id,p_species_id,left(species.name,32),slot,false) RETURNING * INTO created;
  INSERT INTO public.game_notifications(user_id,type,title,message,href) VALUES
    (p_user_id,'team','New teammate!',created.nickname||' joined your active team.','/deck');
  RETURN jsonb_build_object('added',true,'pigeon',public.team_pigeon_json(created),'deck',public.get_game_deck(p_user_id));
END;
$$;

CREATE FUNCTION public.set_game_home_pigeon(p_user_id uuid,p_pigeon_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE chosen public.game_pigeons%ROWTYPE;
BEGIN
  SELECT * INTO chosen FROM public.game_pigeons WHERE id=p_pigeon_id AND user_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','PIGEON_NOT_OWNED'); END IF;
  UPDATE public.game_pigeons SET is_home=(id=p_pigeon_id) WHERE user_id=p_user_id;
  chosen.is_home:=true;
  RETURN jsonb_build_object('selected',true,'pigeon',public.team_pigeon_json(chosen));
END;
$$;

CREATE FUNCTION public.refresh_team_pigeon(p_user_id uuid,p_pigeon_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE saved public.game_pigeons%ROWTYPE; current_state public.game_pigeons%ROWTYPE;
BEGIN
  SELECT * INTO saved FROM public.game_pigeons WHERE user_id=p_user_id AND id=p_pigeon_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  current_state:=public.calculate_current_pigeon_state(saved,greatest(clock_timestamp(),saved.last_updated));
  UPDATE public.game_pigeons SET hunger=current_state.hunger,happiness=current_state.happiness,energy=current_state.energy,
    cleanliness=current_state.cleanliness,last_updated=current_state.last_updated,version=saved.version+1 WHERE id=saved.id RETURNING * INTO current_state;
  RETURN public.team_pigeon_json(current_state);
END;
$$;

CREATE FUNCTION public.perform_game_team_care(p_user_id uuid,p_pigeon_id uuid,p_request_id uuid,p_action text,p_food text DEFAULT 'crumbs') RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE saved public.game_pigeons%ROWTYPE; current_state public.game_pigeons%ROWTYPE; product public.game_items%ROWTYPE;
  old_result jsonb; output jsonb; wallet jsonb; action_time timestamptz; cooldown timestamptz;
  hunger_gain numeric:=0; happiness_gain numeric:=0; energy_gain numeric:=0; clean_gain numeric:=0;
  xp_gain integer:=0; coin_gain integer:=0; owned integer;
BEGIN
  IF p_request_id IS NULL OR p_action NOT IN('feed','play','clean','sleep') THEN RAISE EXCEPTION 'Invalid team action' USING ERRCODE='22023'; END IF;
  SELECT * INTO saved FROM public.game_pigeons WHERE user_id=p_user_id AND id=p_pigeon_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','PIGEON_NOT_OWNED'); END IF;
  SELECT result INTO old_result FROM public.game_team_action_receipts WHERE user_id=p_user_id AND request_id=p_request_id;
  IF FOUND THEN RETURN old_result||jsonb_build_object('replayed',true,'pigeon',public.refresh_team_pigeon(p_user_id,p_pigeon_id),'wallet',public.get_pigeon_wallet(p_user_id)); END IF;
  action_time:=greatest(clock_timestamp(),saved.last_updated);
  cooldown:=CASE p_action WHEN 'feed' THEN saved.last_fed_at WHEN 'play' THEN saved.last_played_at WHEN 'clean' THEN saved.last_cleaned_at ELSE saved.last_slept_at END;
  IF cooldown IS NOT NULL AND action_time<cooldown+interval '10 seconds' THEN
    RETURN jsonb_build_object('error',upper(p_action)||'_COOLDOWN','retryAfter',ceil(extract(epoch FROM(cooldown+interval '10 seconds'-action_time)))); END IF;
  current_state:=public.calculate_current_pigeon_state(saved,action_time);
  IF p_action='feed' THEN
    SELECT * INTO product FROM public.game_items WHERE id=p_food AND type='food' FOR SHARE;
    IF NOT FOUND THEN RETURN jsonb_build_object('error','FOOD_UNAVAILABLE'); END IF;
    IF p_food<>'crumbs' THEN SELECT quantity INTO owned FROM public.game_user_items WHERE user_id=p_user_id AND item_id=p_food FOR UPDATE;
      IF NOT FOUND OR owned<1 THEN RETURN jsonb_build_object('error','FOOD_NOT_OWNED'); END IF;
      IF owned=1 THEN DELETE FROM public.game_user_items WHERE user_id=p_user_id AND item_id=p_food; ELSE UPDATE public.game_user_items SET quantity=quantity-1,updated_at=action_time WHERE user_id=p_user_id AND item_id=p_food; END IF;
    END IF;
    hunger_gain:=least(product.hunger_effect,100-current_state.hunger); happiness_gain:=least(product.happiness_effect,100-current_state.happiness);
    energy_gain:=least(product.energy_effect,100-current_state.energy); clean_gain:=least(product.cleanliness_effect,100-current_state.cleanliness); xp_gain:=5;coin_gain:=2;
  ELSIF p_action='play' THEN
    IF current_state.energy<10 THEN RETURN jsonb_build_object('error','TOO_TIRED','pigeon',public.team_pigeon_json(current_state)); END IF;
    energy_gain:=-10;happiness_gain:=least(15,100-current_state.happiness);xp_gain:=10;coin_gain:=5;
  ELSIF p_action='clean' THEN clean_gain:=least(30,100-current_state.cleanliness);happiness_gain:=least(5,100-current_state.happiness);xp_gain:=5;coin_gain:=2;
  ELSE energy_gain:=least(30,100-current_state.energy);happiness_gain:=least(5,100-current_state.happiness); END IF;
  current_state:=public.add_pigeon_xp(current_state,xp_gain);
  UPDATE public.game_pigeons SET hunger=current_state.hunger+hunger_gain,happiness=current_state.happiness+happiness_gain,
    energy=current_state.energy+energy_gain,cleanliness=current_state.cleanliness+clean_gain,xp=current_state.xp,level=current_state.level,
    growth_stage=current_state.growth_stage,last_updated=current_state.last_updated,version=saved.version+1,
    last_fed_at=CASE WHEN p_action='feed' THEN action_time ELSE saved.last_fed_at END,
    last_played_at=CASE WHEN p_action='play' THEN action_time ELSE saved.last_played_at END,
    last_cleaned_at=CASE WHEN p_action='clean' THEN action_time ELSE saved.last_cleaned_at END,
    last_slept_at=CASE WHEN p_action='sleep' THEN action_time ELSE saved.last_slept_at END
    WHERE id=saved.id RETURNING * INTO current_state;
  wallet:=CASE WHEN coin_gain>0 THEN public.add_pigeon_coins(p_user_id,coin_gain) ELSE public.get_pigeon_wallet(p_user_id) END;
  output:=jsonb_build_object('replayed',false,'action',p_action,'food',p_food,'pigeon',public.team_pigeon_json(current_state),'wallet',wallet,
    'effects',jsonb_build_object('hunger',hunger_gain,'happiness',happiness_gain,'energy',energy_gain,'cleanliness',clean_gain,'xp',xp_gain,'coins',coin_gain));
  INSERT INTO public.game_team_action_receipts(user_id,request_id,pigeon_id,action,result) VALUES(p_user_id,p_request_id,p_pigeon_id,p_action,output);
  PERFORM public.record_game_daily_quest(p_user_id,CASE p_action WHEN 'feed' THEN 'feed_3' WHEN 'play' THEN 'play_2' WHEN 'clean' THEN 'clean_1' ELSE 'sleep_1' END);
  RETURN output;
END;
$$;

CREATE FUNCTION public.train_game_team_pigeon(p_user_id uuid,p_pigeon_id uuid,p_request_id uuid,p_stat text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE saved public.game_pigeons%ROWTYPE; profile public.game_users%ROWTYPE; old_result jsonb; output jsonb; cost integer; current_value integer; wallet jsonb;
BEGIN
  IF p_request_id IS NULL OR p_stat NOT IN('speed','endurance','strength','navigation') THEN RAISE EXCEPTION 'Invalid training' USING ERRCODE='22023'; END IF;
  SELECT * INTO saved FROM public.game_pigeons WHERE user_id=p_user_id AND id=p_pigeon_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','PIGEON_NOT_OWNED'); END IF;
  SELECT result INTO old_result FROM public.game_team_action_receipts WHERE user_id=p_user_id AND request_id=p_request_id;
  IF FOUND THEN RETURN old_result||jsonb_build_object('replayed',true,'wallet',public.get_pigeon_wallet(p_user_id)); END IF;
  current_value:=CASE p_stat WHEN 'speed' THEN saved.training_speed WHEN 'endurance' THEN saved.training_endurance WHEN 'strength' THEN saved.training_strength ELSE saved.training_navigation END;
  IF current_value>=100 THEN RETURN jsonb_build_object('error','TRAINING_MAX'); END IF;
  cost:=75+current_value*10+saved.level*5; SELECT * INTO profile FROM public.game_users WHERE id=p_user_id FOR UPDATE;
  IF profile.coins<cost THEN RETURN jsonb_build_object('error','NOT_ENOUGH_COINS','missing',cost-profile.coins); END IF;
  UPDATE public.game_users SET coins=coins-cost,coins_version=coins_version+1 WHERE id=p_user_id RETURNING jsonb_build_object('coins',coins,'version',coins_version) INTO wallet;
  UPDATE public.game_pigeons SET training_speed=training_speed+CASE WHEN p_stat='speed' THEN 1 ELSE 0 END,
    training_endurance=training_endurance+CASE WHEN p_stat='endurance' THEN 1 ELSE 0 END,
    training_strength=training_strength+CASE WHEN p_stat='strength' THEN 1 ELSE 0 END,
    training_navigation=training_navigation+CASE WHEN p_stat='navigation' THEN 1 ELSE 0 END,version=version+1 WHERE id=saved.id RETURNING * INTO saved;
  output:=jsonb_build_object('trained',true,'replayed',false,'stat',p_stat,'cost',cost,'wallet',wallet,'pigeon',public.team_pigeon_json(saved));
  INSERT INTO public.game_team_action_receipts(user_id,request_id,pigeon_id,action,result) VALUES(p_user_id,p_request_id,p_pigeon_id,'train',output);
  INSERT INTO public.game_notifications(user_id,type,title,message,href) VALUES(p_user_id,'training','Training complete',saved.nickname||' improved '||initcap(p_stat)||'.','/deck');
  RETURN output;
END;
$$;

CREATE FUNCTION public.battle_game_team_pigeon(p_user_id uuid,p_pigeon_id uuid,p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE saved public.game_pigeons%ROWTYPE; current_state public.game_pigeons%ROWTYPE; opponent public.game_species%ROWTYPE;
  receipt jsonb; output jsonb; wallet jsonb; action_time timestamptz; injury_until timestamptz;
  roll integer; critical_roll integer; difficulty integer; opponent_level integer; xp_gain integer; coin_gain integer; health_loss numeric;
  won boolean; critical boolean; wins integer; losses integer;
BEGIN
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'Invalid battle' USING ERRCODE='22023'; END IF;
  SELECT * INTO saved FROM public.game_pigeons WHERE user_id=p_user_id AND id=p_pigeon_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','PIGEON_NOT_OWNED'); END IF;
  SELECT result INTO receipt FROM public.game_battle_receipts WHERE user_id=p_user_id AND request_id=p_request_id;
  IF FOUND THEN RETURN receipt||jsonb_build_object('replayed',true,'pigeon',public.refresh_team_pigeon(p_user_id,p_pigeon_id),'wallet',public.get_pigeon_wallet(p_user_id)); END IF;
  action_time:=greatest(clock_timestamp(),saved.last_updated);
  IF saved.injured_until IS NOT NULL AND action_time<saved.injured_until THEN RETURN jsonb_build_object('error','BATTLE_INJURED','retryAfter',ceil(extract(epoch FROM(saved.injured_until-action_time)))); END IF;
  IF saved.last_battled_at IS NOT NULL AND action_time<saved.last_battled_at+interval '30 seconds' THEN RETURN jsonb_build_object('error','BATTLE_COOLDOWN','retryAfter',ceil(extract(epoch FROM(saved.last_battled_at+interval '30 seconds'-action_time)))); END IF;
  current_state:=public.calculate_current_pigeon_state(saved,action_time);
  IF current_state.energy<10 THEN RETURN jsonb_build_object('error','BATTLE_TIRED','pigeon',public.team_pigeon_json(current_state)); END IF;
  SELECT * INTO opponent FROM public.game_species WHERE is_starter=true AND id<>saved.species_id ORDER BY md5(id||p_request_id::text) LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','OPPONENT_UNAVAILABLE'); END IF;
  roll:=mod(abs(hashtext(p_request_id::text||':battle')::bigint),100)::integer;critical_roll:=mod(abs(hashtext(p_request_id::text||':critical')::bigint),100)::integer;critical:=critical_roll<12;
  difficulty:=least(88,42+floor(current_state.level*1.4)::integer);opponent_level:=current_state.level+greatest(1,floor(current_state.level/4.0)::integer);
  won:=roll+(CASE WHEN critical THEN 20 ELSE 0 END)+least(25,(saved.training_strength+saved.training_speed)/4)>=difficulty;xp_gain:=CASE WHEN won THEN 18+current_state.level*4+(CASE WHEN critical THEN 10 ELSE 0 END) ELSE 0 END;
  coin_gain:=CASE WHEN won THEN 6+current_state.level ELSE 0 END;health_loss:=CASE WHEN won THEN 0 ELSE least(30,ceil(5+current_state.level*1.25),current_state.health) END;
  injury_until:=CASE WHEN won THEN NULL ELSE action_time+make_interval(mins=>least(20,2+current_state.level)) END;
  current_state.energy:=current_state.energy-10;current_state.health:=current_state.health-health_loss;current_state:=public.add_pigeon_xp(current_state,xp_gain);
  UPDATE public.game_pigeons SET health=current_state.health,hunger=current_state.hunger,happiness=current_state.happiness,energy=current_state.energy,
    cleanliness=current_state.cleanliness,xp=current_state.xp,level=current_state.level,growth_stage=current_state.growth_stage,last_updated=current_state.last_updated,
    last_battled_at=action_time,injured_until=injury_until,version=saved.version+1 WHERE id=saved.id RETURNING * INTO current_state;
  wallet:=CASE WHEN coin_gain>0 THEN public.add_pigeon_coins(p_user_id,coin_gain) ELSE public.get_pigeon_wallet(p_user_id) END;
  SELECT count(*) FILTER(WHERE (result->>'won')::boolean)::integer,count(*) FILTER(WHERE NOT(result->>'won')::boolean)::integer INTO wins,losses FROM public.game_battle_receipts WHERE user_id=p_user_id;
  wins:=wins+CASE WHEN won THEN 1 ELSE 0 END;losses:=losses+CASE WHEN won THEN 0 ELSE 1 END;
  output:=jsonb_build_object('won',won,'critical',critical,'replayed',false,'opponent',to_jsonb(opponent),'opponentLevel',opponent_level,
    'effects',jsonb_build_object('energy',-10,'health',-health_loss,'xp',xp_gain,'coins',coin_gain),'wallet',wallet,'injuredUntil',injury_until,
    'battleStats',jsonb_build_object('wins',wins,'losses',losses,'total',wins+losses,'rank',public.pigeon_battle_rank(wins),'attack',10+current_state.level*2+saved.training_strength,'defense',8+current_state.level+saved.training_endurance,'speed',9+floor(current_state.level*1.5)::integer+saved.training_speed,'criticalChance',12,'injuredUntil',injury_until),
    'pigeon',public.team_pigeon_json(current_state));
  INSERT INTO public.game_battle_receipts(user_id,request_id,pigeon_id,opponent_species_id,result) VALUES(p_user_id,p_request_id,p_pigeon_id,opponent.id,output);
  PERFORM public.record_game_daily_quest(p_user_id,'battle_1');
  RETURN output;
END;
$$;

CREATE FUNCTION public.treat_game_team_pigeon(p_user_id uuid,p_pigeon_id uuid,p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE saved public.game_pigeons%ROWTYPE; current_state public.game_pigeons%ROWTYPE; profile public.game_users%ROWTYPE; receipt jsonb; output jsonb; wallet jsonb; gain numeric; price integer:=100;
BEGIN
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'Invalid clinic visit' USING ERRCODE='22023'; END IF;
  SELECT * INTO saved FROM public.game_pigeons WHERE user_id=p_user_id AND id=p_pigeon_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','PIGEON_NOT_OWNED'); END IF;
  SELECT result INTO receipt FROM public.game_clinic_receipts WHERE user_id=p_user_id AND request_id=p_request_id;
  IF FOUND THEN RETURN receipt||jsonb_build_object('replayed',true,'effects',jsonb_build_object('health',0,'coins',0),'wallet',public.get_pigeon_wallet(p_user_id),'pigeon',public.refresh_team_pigeon(p_user_id,p_pigeon_id)); END IF;
  current_state:=public.calculate_current_pigeon_state(saved,greatest(clock_timestamp(),saved.last_updated));
  IF current_state.health>=100 THEN RETURN jsonb_build_object('error','HEALTH_FULL','pigeon',public.team_pigeon_json(current_state)); END IF;
  SELECT * INTO profile FROM public.game_users WHERE id=p_user_id FOR UPDATE;IF profile.coins<price THEN RETURN jsonb_build_object('error','NOT_ENOUGH_COINS','missing',price-profile.coins); END IF;
  gain:=100-current_state.health;UPDATE public.game_users SET coins=coins-price,coins_version=coins_version+1 WHERE id=p_user_id RETURNING jsonb_build_object('coins',coins,'version',coins_version) INTO wallet;
  UPDATE public.game_pigeons SET health=100,hunger=current_state.hunger,happiness=current_state.happiness,energy=current_state.energy,cleanliness=current_state.cleanliness,
    last_updated=current_state.last_updated,injured_until=NULL,last_battled_at=NULL,version=saved.version+1 WHERE id=saved.id RETURNING * INTO current_state;
  output:=jsonb_build_object('treated',true,'replayed',false,'price',price,'effects',jsonb_build_object('health',gain,'coins',-price),'wallet',wallet,'pigeon',public.team_pigeon_json(current_state));
  INSERT INTO public.game_clinic_receipts(user_id,request_id,pigeon_id,price_paid,result) VALUES(p_user_id,p_request_id,p_pigeon_id,price,output);RETURN output;
END;
$$;

CREATE FUNCTION public.get_game_hub(p_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE team jsonb; notices jsonb; rankings jsonb; story jsonb; season_start date:=date_trunc('month',timezone('UTC',clock_timestamp()))::date;
BEGIN
  SELECT coalesce(jsonb_agg(public.team_pigeon_json(p) ORDER BY p.team_slot),'[]'::jsonb) INTO team FROM public.game_pigeons p WHERE p.user_id=p_user_id;
  SELECT coalesce(jsonb_agg(to_jsonb(n) ORDER BY n.created_at DESC),'[]'::jsonb) INTO notices FROM (SELECT * FROM public.game_notifications WHERE user_id=p_user_id ORDER BY created_at DESC LIMIT 12)n;
  SELECT coalesce(jsonb_agg(jsonb_build_object('username',r.username,'score',r.score,'level',r.level) ORDER BY r.score DESC,r.username),'[]'::jsonb) INTO rankings
    FROM (SELECT u.username,max(p.level)::integer AS level,
      (coalesce((SELECT count(*)*10 FROM public.game_battle_receipts b WHERE b.user_id=u.id AND (b.result->>'won')::boolean AND b.battled_at>=season_start),0)+
       coalesce((SELECT count(*)*15 FROM public.game_pigeon_races rr WHERE rr.user_id=u.id AND rr.claimed_at>=season_start AND (rr.outcome->>'won')::boolean),0)+
       coalesce((SELECT count(*) FROM public.game_pigeon_discoveries d WHERE d.user_id=u.id AND d.discovered_at>=season_start),0))::integer AS score
      FROM public.game_users u LEFT JOIN public.game_pigeons p ON p.user_id=u.id GROUP BY u.id,u.username ORDER BY score DESC LIMIT 10)r;
  SELECT jsonb_build_array(
    jsonb_build_object('chapter',1,'title','A Feathered Beginning','goal',1,'progress',(SELECT count(*) FROM public.game_pigeons WHERE user_id=p_user_id),'rewardCoins',75,'claimed',EXISTS(SELECT 1 FROM public.game_story_claims WHERE user_id=p_user_id AND chapter=1)),
    jsonb_build_object('chapter',2,'title','The Crumb Trail','goal',10,'progress',(SELECT count(*) FROM public.game_team_action_receipts WHERE user_id=p_user_id AND action IN('feed','play','clean','sleep')),'rewardCoins',150,'claimed',EXISTS(SELECT 1 FROM public.game_story_claims WHERE user_id=p_user_id AND chapter=2)),
    jsonb_build_object('chapter',3,'title','Rumble on the Rooftops','goal',3,'progress',(SELECT count(*) FROM public.game_battle_receipts WHERE user_id=p_user_id AND (result->>'won')::boolean),'rewardCoins',250,'claimed',EXISTS(SELECT 1 FROM public.game_story_claims WHERE user_id=p_user_id AND chapter=3)),
    jsonb_build_object('chapter',4,'title','Wings Across the World','goal',2,'progress',(SELECT count(*) FROM public.game_pigeon_races WHERE user_id=p_user_id AND claimed_at IS NOT NULL),'rewardCoins',400,'claimed',EXISTS(SELECT 1 FROM public.game_story_claims WHERE user_id=p_user_id AND chapter=4)),
    jsonb_build_object('chapter',5,'title','The Great Crumb Heist','goal',25,'progress',(SELECT count(*) FROM public.game_pigeon_discoveries WHERE user_id=p_user_id),'rewardCoins',750,'claimed',EXISTS(SELECT 1 FROM public.game_story_claims WHERE user_id=p_user_id AND chapter=5))) INTO story;
  RETURN jsonb_build_object('team',team,'notifications',notices,'story',story,'leaderboard',rankings,
    'today',jsonb_build_object(
      'dailyRewardClaimed',EXISTS(SELECT 1 FROM public.game_daily_rewards WHERE user_id=p_user_id AND reward_date=timezone('UTC',clock_timestamp())::date),
      'normalPackAvailable',NOT EXISTS(SELECT 1 FROM public.game_pigeon_pack_receipts WHERE user_id=p_user_id AND pack_type='normal' AND period_start=timezone('UTC',clock_timestamp())::date),
      'bigPackAvailable',NOT EXISTS(SELECT 1 FROM public.game_pigeon_pack_receipts WHERE user_id=p_user_id AND pack_type='big' AND period_start=date_trunc('week',timezone('UTC',clock_timestamp()))::date),
      'activeRace',(SELECT public_result||jsonb_build_object('ready',clock_timestamp()>=finishes_at,'finishesAt',finishes_at) FROM public.game_pigeon_races WHERE user_id=p_user_id AND claimed_at IS NULL ORDER BY started_at DESC LIMIT 1),
      'battleReadyAt',(SELECT greatest(coalesce(injured_until,'-infinity'::timestamptz),coalesce(last_battled_at+interval '30 seconds','-infinity'::timestamptz)) FROM public.game_pigeons WHERE user_id=p_user_id AND is_home)),
    'season',jsonb_build_object('startsAt',season_start,'endsAt',(season_start+interval '1 month')::date));
END;
$$;

CREATE OR REPLACE FUNCTION public.get_game_battle_stats(p_user_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  WITH record AS (
    SELECT count(*) FILTER(WHERE (result->>'won')::boolean)::integer wins,
      count(*) FILTER(WHERE NOT(result->>'won')::boolean)::integer losses
    FROM public.game_battle_receipts WHERE user_id=p_user_id
  ), pigeon AS (SELECT level,health,injured_until,training_speed,training_endurance,training_strength FROM public.game_pigeons WHERE user_id=p_user_id AND is_home)
  SELECT jsonb_build_object('wins',r.wins,'losses',r.losses,'total',r.wins+r.losses,'rank',public.pigeon_battle_rank(r.wins),
    'nextRankWins',CASE WHEN r.wins<5 THEN 5 WHEN r.wins<15 THEN 15 WHEN r.wins<30 THEN 30 WHEN r.wins<60 THEN 60 ELSE NULL END,
    'attack',10+p.level*2+p.training_strength,'defense',8+p.level+p.training_endurance,'speed',9+floor(p.level*1.5)::integer+p.training_speed,'criticalChance',12,'injuredUntil',p.injured_until)
  FROM record r CROSS JOIN pigeon p;
$$;

CREATE FUNCTION public.claim_game_story_chapter(p_user_id uuid,p_chapter integer) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE hub jsonb; item jsonb; reward integer; wallet jsonb;
BEGIN
  IF p_chapter NOT BETWEEN 1 AND 5 THEN RAISE EXCEPTION 'Invalid chapter' USING ERRCODE='22023'; END IF;
  hub:=public.get_game_hub(p_user_id); item:=hub->'story'->(p_chapter-1);
  IF (item->>'claimed')::boolean THEN RETURN jsonb_build_object('error','STORY_CLAIMED'); END IF;
  IF (item->>'progress')::integer<(item->>'goal')::integer THEN RETURN jsonb_build_object('error','STORY_INCOMPLETE'); END IF;
  reward:=(item->>'rewardCoins')::integer; INSERT INTO public.game_story_claims(user_id,chapter) VALUES(p_user_id,p_chapter);
  wallet:=public.add_pigeon_coins(p_user_id,reward);
  INSERT INTO public.game_notifications(user_id,type,title,message,href) VALUES(p_user_id,'story','Chapter complete!',item->>'title'||' is complete. Your reward is ready.','/my-pigeon');
  RETURN jsonb_build_object('claimed',true,'chapter',p_chapter,'effects',jsonb_build_object('coins',reward),'wallet',wallet,'hub',public.get_game_hub(p_user_id));
END;
$$;

CREATE FUNCTION public.read_game_notifications(p_user_id uuid) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE changed integer; BEGIN UPDATE public.game_notifications SET read_at=coalesce(read_at,clock_timestamp()) WHERE user_id=p_user_id AND read_at IS NULL; GET DIAGNOSTICS changed=ROW_COUNT; RETURN changed; END;
$$;

CREATE OR REPLACE FUNCTION public.get_game_race_lobby(p_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE own public.game_pigeons%ROWTYPE; own_species public.game_species%ROWTYPE; opponents jsonb; locations jsonb;
  active public.game_pigeon_races%ROWTYPE; previous public.game_pigeon_races%ROWTYPE; now_at timestamptz:=clock_timestamp();
BEGIN
  SELECT * INTO own FROM public.game_pigeons WHERE user_id=p_user_id AND is_home;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','NO_PIGEON'); END IF;
  SELECT * INTO own_species FROM public.game_species WHERE id=own.species_id;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',picked.id,'username',picked.username,
    'nickname',picked.nickname,'level',picked.level,'species',picked.species,'image',picked.image,
    'stats',public.pigeon_race_stats(picked.level)||jsonb_build_object(
      'speed',(public.pigeon_race_stats(picked.level)->>'speed')::integer+picked.training_speed,
      'endurance',(public.pigeon_race_stats(picked.level)->>'endurance')::integer+picked.training_endurance,
      'strength',(public.pigeon_race_stats(picked.level)->>'strength')::integer+picked.training_strength,
      'navigation',(public.pigeon_race_stats(picked.level)->>'navigation')::integer+picked.training_navigation)) ORDER BY picked.sort_key),'[]'::jsonb) INTO opponents
  FROM (SELECT p.id,u.username,p.nickname,p.level,p.training_speed,p.training_endurance,p.training_strength,p.training_navigation,s.name AS species,s.image,
      md5(p.id::text||p_user_id::text||current_date::text) AS sort_key
    FROM public.game_pigeons p JOIN public.game_users u ON u.id=p.user_id
    JOIN public.game_species s ON s.id=p.species_id WHERE p.user_id<>p_user_id
    ORDER BY sort_key LIMIT 3) picked;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'city',city,'country',country,
    'latitude',latitude,'longitude',longitude) ORDER BY city),'[]'::jsonb) INTO locations
    FROM public.game_race_locations;
  SELECT * INTO active FROM public.game_pigeon_races WHERE user_id=p_user_id AND claimed_at IS NULL ORDER BY started_at DESC LIMIT 1;
  SELECT * INTO previous FROM public.game_pigeon_races WHERE user_id=p_user_id AND claimed_at IS NOT NULL ORDER BY claimed_at DESC LIMIT 1;
  RETURN jsonb_build_object('entryCost',100,'wallet',public.get_pigeon_wallet(p_user_id),
    'pigeon',public.team_pigeon_json(own),
    'locations',locations,'opponents',opponents,
    'activeRace',CASE WHEN active.request_id IS NULL THEN NULL ELSE active.public_result||jsonb_build_object(
      'ready',now_at>=active.finishes_at,'retryAfter',greatest(0,ceil(extract(epoch FROM (active.finishes_at-now_at))))) END,
    'lastRace',CASE WHEN previous.request_id IS NULL THEN NULL ELSE previous.claimed_result END);
END;
$$;


CREATE OR REPLACE FUNCTION public.start_game_pigeon_race(p_user_id uuid,p_request_id uuid,p_origin text,p_destination text,p_opponent_pigeon_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE own public.game_pigeons%ROWTYPE; rival public.game_pigeons%ROWTYPE; own_species public.game_species%ROWTYPE;
  rival_species public.game_species%ROWTYPE; profile public.game_users%ROWTYPE; rival_username text;
  existing public.game_pigeon_races%ROWTYPE; quote jsonb; player_stats jsonb; opponent_stats jsonb;
  player_base numeric; rival_base numeric; player_roll integer; rival_roll integer; upset_roll integer; won boolean; upset boolean:=false;
  started timestamptz:=clock_timestamp(); finish_at timestamptz; wallet jsonb; output jsonb; outcome_data jsonb;
BEGIN
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'Invalid race request' USING ERRCODE='22023'; END IF;
  SELECT * INTO existing FROM public.game_pigeon_races WHERE user_id=p_user_id AND request_id=p_request_id;
  IF FOUND THEN RETURN existing.public_result||jsonb_build_object('replayed',true,'wallet',public.get_pigeon_wallet(p_user_id)); END IF;
  SELECT * INTO own FROM public.game_pigeons WHERE user_id=p_user_id AND is_home FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','NO_PIGEON'); END IF;
  IF EXISTS(SELECT 1 FROM public.game_pigeon_races WHERE user_id=p_user_id AND claimed_at IS NULL) THEN
    RETURN jsonb_build_object('error','RACE_ACTIVE');
  END IF;
  SELECT * INTO profile FROM public.game_users WHERE id=p_user_id FOR UPDATE;
  IF profile.coins<100 THEN RETURN jsonb_build_object('error','NOT_ENOUGH_COINS','missing',100-profile.coins); END IF;
  SELECT p.* INTO rival FROM public.game_pigeons p WHERE p.id=p_opponent_pigeon_id AND p.user_id<>p_user_id
    AND p.id IN (SELECT choice.id FROM public.game_pigeons choice WHERE choice.user_id<>p_user_id
      ORDER BY md5(choice.id::text||p_user_id::text||current_date::text) LIMIT 3);
  IF NOT FOUND THEN RETURN jsonb_build_object('error','OPPONENT_UNAVAILABLE'); END IF;
  quote:=public.pigeon_race_quote(p_origin,p_destination,rival.level);
  IF quote->>'error'='LOCATION_INVALID' THEN RETURN quote; END IF;
  SELECT * INTO own_species FROM public.game_species WHERE id=own.species_id;
  SELECT * INTO rival_species FROM public.game_species WHERE id=rival.species_id;
  SELECT username INTO rival_username FROM public.game_users WHERE id=rival.user_id;
  player_stats:=public.team_pigeon_json(own)->'raceStats'; opponent_stats:=public.team_pigeon_json(rival)->'raceStats';
  player_base:=(player_stats->>'speed')::numeric*.28+(player_stats->>'endurance')::numeric*.30+
    (player_stats->>'strength')::numeric*.12+(player_stats->>'navigation')::numeric*.20+(player_stats->>'focus')::numeric*.10;
  rival_base:=(opponent_stats->>'speed')::numeric*.28+(opponent_stats->>'endurance')::numeric*.30+
    (opponent_stats->>'strength')::numeric*.12+(opponent_stats->>'navigation')::numeric*.20+(opponent_stats->>'focus')::numeric*.10;
  IF (quote->>'distanceKm')::integer<350 THEN player_base:=player_base+(player_stats->>'speed')::numeric*.10; rival_base:=rival_base+(opponent_stats->>'speed')::numeric*.10; END IF;
  IF (quote->>'distanceKm')::integer>1000 THEN player_base:=player_base+(player_stats->>'endurance')::numeric*.10; rival_base:=rival_base+(opponent_stats->>'endurance')::numeric*.10; END IF;
  player_roll:=mod(abs(hashtext(p_request_id::text||':player')::bigint),41)::integer;
  rival_roll:=mod(abs(hashtext(p_request_id::text||':opponent')::bigint),41)::integer;
  upset_roll:=mod(abs(hashtext(p_request_id::text||':upset')::bigint),100)::integer;
  IF player_base<rival_base AND upset_roll<20 THEN won:=true; upset:=true;
  ELSIF rival_base<player_base AND upset_roll<20 THEN won:=false; upset:=true;
  ELSE won:=player_base+player_roll>=rival_base+rival_roll; END IF;
  finish_at:=started+make_interval(secs=>(quote->>'durationSeconds')::integer);
  UPDATE public.game_users SET coins=coins-100,coins_version=coins_version+1 WHERE id=p_user_id
    RETURNING jsonb_build_object('coins',coins,'version',coins_version) INTO wallet;
  output:=jsonb_build_object('started',true,'replayed',false,'raceId',p_request_id,'startedAt',started,'finishesAt',finish_at,
    'route',jsonb_build_object('origin',quote->'origin','destination',quote->'destination','distanceKm',(quote->>'distanceKm')::integer),
    'durationSeconds',(quote->>'durationSeconds')::integer,'entryCost',100,
    'potentialRewards',jsonb_build_object('coins',(quote->>'potentialCoins')::integer,'xp',(quote->>'potentialXp')::integer),
    'player',jsonb_build_object('nickname',own.nickname,'level',own.level,'species',own_species.name,'stats',player_stats),
    'opponent',jsonb_build_object('id',rival.id,'username',rival_username,'nickname',rival.nickname,'level',rival.level,'species',rival_species.name,'image',rival_species.image,'stats',opponent_stats),
    'wallet',wallet,'ready',false);
  outcome_data:=jsonb_build_object('won',won,'upset',upset,'upsetRoll',upset_roll,
    'playerScore',round(player_base+player_roll,1),'opponentScore',round(rival_base+rival_roll,1),
    'playerRoll',player_roll,'opponentRoll',rival_roll);
  INSERT INTO public.game_pigeon_races(user_id,request_id,pigeon_id,opponent_user_id,opponent_pigeon_id,
    origin_id,destination_id,opponent_username,opponent_nickname,opponent_species,distance_km,duration_seconds,
    entry_cost,potential_coins,potential_xp,started_at,finishes_at,player_stats,opponent_stats,outcome,public_result)
  VALUES(p_user_id,p_request_id,own.id,rival.user_id,rival.id,p_origin,p_destination,rival_username,rival.nickname,
    rival_species.name,(quote->>'distanceKm')::integer,(quote->>'durationSeconds')::integer,100,
    (quote->>'potentialCoins')::integer,(quote->>'potentialXp')::integer,started,finish_at,
    player_stats,opponent_stats,outcome_data,output);
  RETURN output;
END;
$$;


CREATE OR REPLACE FUNCTION public.collect_game_pigeon_race(p_user_id uuid,p_race_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE race public.game_pigeon_races%ROWTYPE; saved public.game_pigeons%ROWTYPE; current_state public.game_pigeons%ROWTYPE;
  now_at timestamptz:=clock_timestamp(); won boolean; coin_gain integer; xp_gain integer; wallet jsonb; result jsonb;
BEGIN
  SELECT * INTO race FROM public.game_pigeon_races WHERE user_id=p_user_id AND request_id=p_race_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','RACE_NOT_FOUND'); END IF;
  IF race.claimed_at IS NOT NULL THEN RETURN race.claimed_result||jsonb_build_object('replayed',true,
    'wallet',public.get_pigeon_wallet(p_user_id),'pigeon',public.refresh_team_pigeon(p_user_id,race.pigeon_id)); END IF;
  IF now_at<race.finishes_at THEN RETURN jsonb_build_object('error','RACE_RUNNING','retryAfter',ceil(extract(epoch FROM (race.finishes_at-now_at)))); END IF;
  won:=(race.outcome->>'won')::boolean; coin_gain:=CASE WHEN won THEN race.potential_coins ELSE 0 END;
  xp_gain:=CASE WHEN won THEN race.potential_xp ELSE 0 END;
  SELECT * INTO saved FROM public.game_pigeons WHERE user_id=p_user_id AND id=race.pigeon_id FOR UPDATE;
  current_state:=public.calculate_current_pigeon_state(saved,greatest(now_at,saved.last_updated));
  current_state:=public.add_pigeon_xp(current_state,xp_gain);
  UPDATE public.game_pigeons SET health=current_state.health,hunger=current_state.hunger,happiness=current_state.happiness,
    energy=current_state.energy,cleanliness=current_state.cleanliness,xp=current_state.xp,level=current_state.level,
    growth_stage=current_state.growth_stage,last_updated=current_state.last_updated,version=saved.version+1
    WHERE id=saved.id RETURNING * INTO current_state;
  wallet:=CASE WHEN coin_gain>0 THEN public.add_pigeon_coins(p_user_id,coin_gain) ELSE public.get_pigeon_wallet(p_user_id) END;
  result:=race.public_result||jsonb_build_object('completed',true,'ready',true,'won',won,
    'upset',coalesce((race.outcome->>'upset')::boolean,false),'replayed',false,
    'scores',jsonb_build_object('player',(race.outcome->>'playerScore')::numeric,'opponent',(race.outcome->>'opponentScore')::numeric),
    'effects',jsonb_build_object('coins',coin_gain,'xp',xp_gain),'wallet',wallet,
    'pigeon',to_jsonb(current_state)||jsonb_build_object('species',(SELECT to_jsonb(s) FROM public.game_species s WHERE s.id=current_state.species_id)));
  UPDATE public.game_pigeon_races SET claimed_at=now_at,claimed_result=result WHERE user_id=p_user_id AND request_id=p_race_id;
  RETURN result;
END;
$$;

-- Catch the Crumbs belongs to the pigeon selected as home when the game starts.
-- These replacements keep the legacy API while making the team choice explicit.
CREATE OR REPLACE FUNCTION public.start_crumb_game(p_user_id uuid,p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE run public.game_crumb_runs%ROWTYPE; seed uuid:=gen_random_uuid();
BEGIN
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'Invalid request' USING ERRCODE='22023'; END IF;
  PERFORM 1 FROM public.game_pigeons WHERE user_id=p_user_id
    ORDER BY is_home DESC,team_slot NULLS LAST,created_at LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','NO_PIGEON'); END IF;
  SELECT * INTO run FROM public.game_crumb_runs WHERE user_id=p_user_id AND request_id=p_request_id;
  IF NOT FOUND THEN
    SELECT * INTO run FROM public.game_crumb_runs WHERE user_id=p_user_id AND completed_at IS NULL FOR UPDATE;
    IF FOUND AND clock_timestamp()>run.started_at+interval '2 minutes' THEN
      DELETE FROM public.game_crumb_runs WHERE id=run.id; run:=NULL;
    END IF;
  END IF;
  IF run.id IS NULL THEN
    INSERT INTO public.game_crumb_runs(user_id,request_id,schedule)
      VALUES(p_user_id,p_request_id,public.crumb_game_schedule(seed)) RETURNING * INTO run;
  END IF;
  RETURN jsonb_build_object('runId',run.id,'startedAt',run.started_at,'serverNow',clock_timestamp(),
    'durationSeconds',run.duration_seconds,'schedule',run.schedule,'completed',run.completed_at IS NOT NULL);
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_crumb_game(p_user_id uuid,p_run_id uuid,p_caught integer[]) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE
  run public.game_crumb_runs%ROWTYPE;
  saved public.game_pigeons%ROWTYPE;
  rewarded public.game_pigeons%ROWTYPE;
  crumb jsonb;
  caught_id integer;
  caught_count integer;
  previous_x numeric:=50;
  previous_time integer:=0;
  current_x numeric;
  current_catch_time integer;
  coin_gain integer;
  xp_gain integer;
  wallet jsonb;
  output jsonb;
BEGIN
  IF p_run_id IS NULL OR p_caught IS NULL OR cardinality(p_caught)>40 THEN
    RAISE EXCEPTION 'Invalid finish request' USING ERRCODE='22023';
  END IF;
  SELECT * INTO saved FROM public.game_pigeons WHERE user_id=p_user_id
    ORDER BY is_home DESC,team_slot NULLS LAST,created_at LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','NO_PIGEON'); END IF;
  SELECT * INTO run FROM public.game_crumb_runs WHERE id=p_run_id AND user_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','RUN_NOT_FOUND'); END IF;
  IF run.completed_at IS NOT NULL THEN
    RETURN run.result||jsonb_build_object('replayed',true,'wallet',public.get_pigeon_wallet(p_user_id),
      'pigeon',to_jsonb(saved)||jsonb_build_object('species',
        (SELECT to_jsonb(s) FROM public.game_species s WHERE s.id=saved.species_id)));
  END IF;
  IF clock_timestamp()<run.started_at+(run.duration_seconds-1)*interval '1 second' THEN
    RETURN jsonb_build_object('error','RUN_IN_PROGRESS','retryAfter',ceil(extract(epoch FROM
      (run.started_at+(run.duration_seconds-1)*interval '1 second'-clock_timestamp()))));
  END IF;
  IF clock_timestamp()>run.started_at+interval '2 minutes' THEN
    RETURN jsonb_build_object('error','RUN_EXPIRED');
  END IF;
  IF cardinality(p_caught)<>(SELECT count(DISTINCT value) FROM unnest(p_caught) AS value) THEN
    RETURN jsonb_build_object('error','INVALID_SCORE');
  END IF;
  FOREACH caught_id IN ARRAY p_caught LOOP
    SELECT value INTO crumb FROM jsonb_array_elements(run.schedule) value WHERE (value->>'id')::integer=caught_id;
    IF crumb IS NULL THEN RETURN jsonb_build_object('error','INVALID_SCORE'); END IF;
    current_x:=(crumb->>'x')::numeric; current_catch_time:=(crumb->>'catchAtMs')::integer;
    IF current_catch_time<=previous_time OR abs(current_x-previous_x)>(current_catch_time-previous_time)*0.09+12 THEN
      RETURN jsonb_build_object('error','INVALID_SCORE');
    END IF;
    previous_x:=current_x; previous_time:=current_catch_time; crumb:=NULL;
  END LOOP;
  caught_count:=cardinality(p_caught);
  coin_gain:=public.crumb_game_coins(caught_count);
  xp_gain:=public.crumb_game_xp(caught_count);
  IF xp_gain>0 THEN
    rewarded:=public.add_pigeon_xp(saved,xp_gain);
    UPDATE public.game_pigeons SET xp=rewarded.xp,level=rewarded.level,version=saved.version+1
      WHERE id=saved.id RETURNING * INTO rewarded;
  ELSE rewarded:=saved; END IF;
  IF coin_gain>0 THEN wallet:=public.add_pigeon_coins(p_user_id,coin_gain);
  ELSE wallet:=public.get_pigeon_wallet(p_user_id); END IF;
  output:=jsonb_build_object('runId',run.id,'score',caught_count,'replayed',false,
    'effects',jsonb_build_object('coins',coin_gain,'xp',xp_gain),'wallet',wallet,
    'pigeon',to_jsonb(rewarded)||jsonb_build_object('species',
      (SELECT to_jsonb(s) FROM public.game_species s WHERE s.id=rewarded.species_id)));
  UPDATE public.game_crumb_runs SET completed_at=clock_timestamp(),score=caught_count,
    coins_awarded=coin_gain,xp_awarded=xp_gain,result=output WHERE id=run.id;
  RETURN output;
END;
$$;


REVOKE ALL ON FUNCTION public.team_pigeon_json(public.game_pigeons),public.get_game_deck(uuid),public.add_game_team_pigeon(uuid,text),
  public.set_game_home_pigeon(uuid,uuid),public.refresh_team_pigeon(uuid,uuid),public.perform_game_team_care(uuid,uuid,uuid,text,text),
  public.train_game_team_pigeon(uuid,uuid,uuid,text),public.battle_game_team_pigeon(uuid,uuid,uuid),public.treat_game_team_pigeon(uuid,uuid,uuid),public.get_game_hub(uuid),public.get_game_battle_stats(uuid),public.claim_game_story_chapter(uuid,integer),public.read_game_notifications(uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.team_pigeon_json(public.game_pigeons),public.get_game_deck(uuid),public.add_game_team_pigeon(uuid,text),
  public.set_game_home_pigeon(uuid,uuid),public.refresh_team_pigeon(uuid,uuid),public.perform_game_team_care(uuid,uuid,uuid,text,text),
  public.train_game_team_pigeon(uuid,uuid,uuid,text),public.battle_game_team_pigeon(uuid,uuid,uuid),public.treat_game_team_pigeon(uuid,uuid,uuid),public.get_game_hub(uuid),public.get_game_battle_stats(uuid),public.claim_game_story_chapter(uuid,integer),public.read_game_notifications(uuid)
  TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;

