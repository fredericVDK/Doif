-- Phase 40. Server-authoritative, timed pigeon races between player pigeons.
-- Apply once after 031_clinic_resets_battle_recovery.sql.
BEGIN;

CREATE TABLE public.game_race_locations (
  id text PRIMARY KEY CHECK(id~'^[a-z0-9_]+$'),
  city text NOT NULL,
  country text NOT NULL,
  latitude numeric NOT NULL CHECK(latitude BETWEEN -90 AND 90),
  longitude numeric NOT NULL CHECK(longitude BETWEEN -180 AND 180)
);

INSERT INTO public.game_race_locations(id,city,country,latitude,longitude) VALUES
  ('brussels','Brussels','Belgium',50.8503,4.3517),
  ('amsterdam','Amsterdam','Netherlands',52.3676,4.9041),
  ('copenhagen','Copenhagen','Denmark',55.6761,12.5683),
  ('paris','Paris','France',48.8566,2.3522),
  ('london','London','United Kingdom',51.5072,-0.1276),
  ('rome','Rome','Italy',41.9028,12.4964),
  ('new_york','New York','United States',40.7128,-74.0060),
  ('tokyo','Tokyo','Japan',35.6762,139.6503),
  ('sydney','Sydney','Australia',-33.8688,151.2093);

CREATE TABLE public.game_pigeon_races (
  user_id uuid NOT NULL REFERENCES public.game_users(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  pigeon_id uuid NOT NULL REFERENCES public.game_pigeons(id) ON DELETE CASCADE,
  opponent_user_id uuid REFERENCES public.game_users(id) ON DELETE SET NULL,
  opponent_pigeon_id uuid REFERENCES public.game_pigeons(id) ON DELETE SET NULL,
  origin_id text NOT NULL REFERENCES public.game_race_locations(id),
  destination_id text NOT NULL REFERENCES public.game_race_locations(id),
  opponent_username text NOT NULL,
  opponent_nickname text NOT NULL,
  opponent_species text NOT NULL,
  distance_km integer NOT NULL CHECK(distance_km>0),
  duration_seconds integer NOT NULL CHECK(duration_seconds>=60),
  entry_cost integer NOT NULL CHECK(entry_cost=100),
  potential_coins integer NOT NULL CHECK(potential_coins>=0),
  potential_xp integer NOT NULL CHECK(potential_xp>=0),
  started_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(started_at)),
  finishes_at timestamptz NOT NULL CHECK(isfinite(finishes_at)),
  player_stats jsonb NOT NULL CHECK(jsonb_typeof(player_stats)='object'),
  opponent_stats jsonb NOT NULL CHECK(jsonb_typeof(opponent_stats)='object'),
  outcome jsonb NOT NULL CHECK(jsonb_typeof(outcome)='object'),
  public_result jsonb NOT NULL CHECK(jsonb_typeof(public_result)='object'),
  claimed_at timestamptz CHECK(claimed_at IS NULL OR isfinite(claimed_at)),
  claimed_result jsonb CHECK(claimed_result IS NULL OR jsonb_typeof(claimed_result)='object'),
  PRIMARY KEY(user_id,request_id),
  CHECK(origin_id<>destination_id),
  CHECK(finishes_at>started_at)
);
CREATE UNIQUE INDEX game_pigeon_races_one_active ON public.game_pigeon_races(user_id) WHERE claimed_at IS NULL;

ALTER TABLE public.game_race_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_pigeon_races ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.game_race_locations,public.game_pigeon_races FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.game_race_locations TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.game_race_locations,public.game_pigeon_races TO service_role;
CREATE POLICY race_locations_read ON public.game_race_locations FOR SELECT TO authenticated USING(true);

CREATE FUNCTION public.pigeon_race_stats(p_level integer) RETURNS jsonb
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT jsonb_build_object(
    'level',greatest(1,p_level),
    'speed',18+greatest(1,p_level)*3,
    'endurance',20+greatest(1,p_level)*4,
    'strength',16+greatest(1,p_level)*3,
    'navigation',15+greatest(1,p_level)*2,
    'focus',14+greatest(1,p_level)*2
  );
$$;

CREATE FUNCTION public.pigeon_race_quote(p_origin text,p_destination text,p_opponent_level integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE origin_row public.game_race_locations%ROWTYPE; destination_row public.game_race_locations%ROWTYPE;
  distance integer; minutes integer; coins integer; xp integer;
BEGIN
  SELECT * INTO origin_row FROM public.game_race_locations WHERE id=p_origin;
  SELECT * INTO destination_row FROM public.game_race_locations WHERE id=p_destination;
  IF origin_row.id IS NULL OR destination_row.id IS NULL OR p_origin=p_destination THEN
    RETURN jsonb_build_object('error','LOCATION_INVALID');
  END IF;
  distance:=greatest(1,round(6371*2*asin(sqrt(
    power(sin(radians((destination_row.latitude-origin_row.latitude)::double precision)/2),2)+
    cos(radians(origin_row.latitude::double precision))*cos(radians(destination_row.latitude::double precision))*
    power(sin(radians((destination_row.longitude-origin_row.longitude)::double precision)/2),2)
  )))::integer);
  minutes:=greatest(15,least(720,round(12+distance/16.0)::integer));
  coins:=least(2000,120+ceil(distance/6.0)::integer+greatest(1,p_opponent_level)*6);
  xp:=least(600,20+ceil(distance/30.0)::integer+greatest(1,p_opponent_level)*3);
  RETURN jsonb_build_object('distanceKm',distance,'durationSeconds',minutes*60,
    'entryCost',100,'potentialCoins',coins,'potentialXp',xp,
    'origin',jsonb_build_object('id',origin_row.id,'city',origin_row.city,'country',origin_row.country),
    'destination',jsonb_build_object('id',destination_row.id,'city',destination_row.city,'country',destination_row.country));
END;
$$;

CREATE FUNCTION public.get_game_race_lobby(p_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE own public.game_pigeons%ROWTYPE; own_species public.game_species%ROWTYPE; opponents jsonb; locations jsonb;
  active public.game_pigeon_races%ROWTYPE; previous public.game_pigeon_races%ROWTYPE; now_at timestamptz:=clock_timestamp();
BEGIN
  SELECT * INTO own FROM public.game_pigeons WHERE user_id=p_user_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','NO_PIGEON'); END IF;
  SELECT * INTO own_species FROM public.game_species WHERE id=own.species_id;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',picked.id,'username',picked.username,
    'nickname',picked.nickname,'level',picked.level,'species',picked.species,'image',picked.image,
    'stats',public.pigeon_race_stats(picked.level)) ORDER BY picked.sort_key),'[]'::jsonb) INTO opponents
  FROM (SELECT p.id,u.username,p.nickname,p.level,s.name AS species,s.image,
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
    'pigeon',to_jsonb(own)||jsonb_build_object('species',to_jsonb(own_species),'raceStats',public.pigeon_race_stats(own.level)),
    'locations',locations,'opponents',opponents,
    'activeRace',CASE WHEN active.request_id IS NULL THEN NULL ELSE active.public_result||jsonb_build_object(
      'ready',now_at>=active.finishes_at,'retryAfter',greatest(0,ceil(extract(epoch FROM (active.finishes_at-now_at))))) END,
    'lastRace',CASE WHEN previous.request_id IS NULL THEN NULL ELSE previous.claimed_result END);
END;
$$;

CREATE FUNCTION public.start_game_pigeon_race(p_user_id uuid,p_request_id uuid,p_origin text,p_destination text,p_opponent_pigeon_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE own public.game_pigeons%ROWTYPE; rival public.game_pigeons%ROWTYPE; own_species public.game_species%ROWTYPE;
  rival_species public.game_species%ROWTYPE; profile public.game_users%ROWTYPE; rival_username text;
  existing public.game_pigeon_races%ROWTYPE; quote jsonb; player_stats jsonb; opponent_stats jsonb;
  player_base numeric; rival_base numeric; player_roll integer; rival_roll integer; won boolean;
  started timestamptz:=clock_timestamp(); finish_at timestamptz; wallet jsonb; output jsonb; outcome_data jsonb;
BEGIN
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'Invalid race request' USING ERRCODE='22023'; END IF;
  SELECT * INTO existing FROM public.game_pigeon_races WHERE user_id=p_user_id AND request_id=p_request_id;
  IF FOUND THEN RETURN existing.public_result||jsonb_build_object('replayed',true,'wallet',public.get_pigeon_wallet(p_user_id)); END IF;
  SELECT * INTO own FROM public.game_pigeons WHERE user_id=p_user_id FOR UPDATE;
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
  player_stats:=public.pigeon_race_stats(own.level); opponent_stats:=public.pigeon_race_stats(rival.level);
  player_base:=(player_stats->>'speed')::numeric*.28+(player_stats->>'endurance')::numeric*.30+
    (player_stats->>'strength')::numeric*.12+(player_stats->>'navigation')::numeric*.20+(player_stats->>'focus')::numeric*.10;
  rival_base:=(opponent_stats->>'speed')::numeric*.28+(opponent_stats->>'endurance')::numeric*.30+
    (opponent_stats->>'strength')::numeric*.12+(opponent_stats->>'navigation')::numeric*.20+(opponent_stats->>'focus')::numeric*.10;
  IF (quote->>'distanceKm')::integer<350 THEN player_base:=player_base+(player_stats->>'speed')::numeric*.10; rival_base:=rival_base+(opponent_stats->>'speed')::numeric*.10; END IF;
  IF (quote->>'distanceKm')::integer>1000 THEN player_base:=player_base+(player_stats->>'endurance')::numeric*.10; rival_base:=rival_base+(opponent_stats->>'endurance')::numeric*.10; END IF;
  player_roll:=mod(abs(hashtext(p_request_id::text||':player')::bigint),41)::integer;
  rival_roll:=mod(abs(hashtext(p_request_id::text||':opponent')::bigint),41)::integer;
  won:=player_base+player_roll>=rival_base+rival_roll;
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
  outcome_data:=jsonb_build_object('won',won,'playerScore',round(player_base+player_roll,1),
    'opponentScore',round(rival_base+rival_roll,1),'playerRoll',player_roll,'opponentRoll',rival_roll);
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

CREATE FUNCTION public.collect_game_pigeon_race(p_user_id uuid,p_race_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE race public.game_pigeon_races%ROWTYPE; saved public.game_pigeons%ROWTYPE; current_state public.game_pigeons%ROWTYPE;
  now_at timestamptz:=clock_timestamp(); won boolean; coin_gain integer; xp_gain integer; wallet jsonb; result jsonb;
BEGIN
  SELECT * INTO race FROM public.game_pigeon_races WHERE user_id=p_user_id AND request_id=p_race_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','RACE_NOT_FOUND'); END IF;
  IF race.claimed_at IS NOT NULL THEN RETURN race.claimed_result||jsonb_build_object('replayed',true,
    'wallet',public.get_pigeon_wallet(p_user_id),'pigeon',public.refresh_game_pigeon(p_user_id)); END IF;
  IF now_at<race.finishes_at THEN RETURN jsonb_build_object('error','RACE_RUNNING','retryAfter',ceil(extract(epoch FROM (race.finishes_at-now_at)))); END IF;
  won:=(race.outcome->>'won')::boolean; coin_gain:=CASE WHEN won THEN race.potential_coins ELSE 0 END;
  xp_gain:=CASE WHEN won THEN race.potential_xp ELSE 0 END;
  SELECT * INTO saved FROM public.game_pigeons WHERE user_id=p_user_id FOR UPDATE;
  current_state:=public.calculate_current_pigeon_state(saved,greatest(now_at,saved.last_updated));
  current_state:=public.add_pigeon_xp(current_state,xp_gain);
  UPDATE public.game_pigeons SET health=current_state.health,hunger=current_state.hunger,happiness=current_state.happiness,
    energy=current_state.energy,cleanliness=current_state.cleanliness,xp=current_state.xp,level=current_state.level,
    growth_stage=current_state.growth_stage,last_updated=current_state.last_updated,version=saved.version+1
    WHERE id=saved.id RETURNING * INTO current_state;
  wallet:=CASE WHEN coin_gain>0 THEN public.add_pigeon_coins(p_user_id,coin_gain) ELSE public.get_pigeon_wallet(p_user_id) END;
  result:=race.public_result||jsonb_build_object('completed',true,'ready',true,'won',won,'replayed',false,
    'scores',jsonb_build_object('player',(race.outcome->>'playerScore')::numeric,'opponent',(race.outcome->>'opponentScore')::numeric),
    'effects',jsonb_build_object('coins',coin_gain,'xp',xp_gain),'wallet',wallet,
    'pigeon',to_jsonb(current_state)||jsonb_build_object('species',(SELECT to_jsonb(s) FROM public.game_species s WHERE s.id=current_state.species_id)));
  UPDATE public.game_pigeon_races SET claimed_at=now_at,claimed_result=result WHERE user_id=p_user_id AND request_id=p_race_id;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.pigeon_race_stats(integer),public.pigeon_race_quote(text,text,integer),
  public.get_game_race_lobby(uuid),public.start_game_pigeon_race(uuid,uuid,text,text,uuid),
  public.collect_game_pigeon_race(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pigeon_race_stats(integer),public.pigeon_race_quote(text,text,integer),
  public.get_game_race_lobby(uuid),public.start_game_pigeon_race(uuid,uuid,text,text,uuid),
  public.collect_game_pigeon_race(uuid,uuid) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
