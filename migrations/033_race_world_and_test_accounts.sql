-- Phase 41. Expand racing worldwide, guarantee a 20% underdog upset chance,
-- and add server-only reset support for the dedicated supertest account.
-- Apply once after 032_pigeon_races.sql.
BEGIN;

INSERT INTO public.game_race_locations(id,city,country,latitude,longitude) VALUES
  ('brussels','Brussels','Belgium',50.8503,4.3517),
  ('amsterdam','Amsterdam','Netherlands',52.3676,4.9041),
  ('copenhagen','Copenhagen','Denmark',55.6761,12.5683),
  ('paris','Paris','France',48.8566,2.3522),
  ('london','London','United Kingdom',51.5072,-0.1276),
  ('rome','Rome','Italy',41.9028,12.4964),
  ('madrid','Madrid','Spain',40.4168,-3.7038),
  ('lisbon','Lisbon','Portugal',38.7223,-9.1393),
  ('berlin','Berlin','Germany',52.5200,13.4050),
  ('athens','Athens','Greece',37.9838,23.7275),
  ('cairo','Cairo','Egypt',30.0444,31.2357),
  ('cape_town','Cape Town','South Africa',-33.9249,18.4241),
  ('dubai','Dubai','United Arab Emirates',25.2048,55.2708),
  ('mumbai','Mumbai','India',19.0760,72.8777),
  ('singapore','Singapore','Singapore',1.3521,103.8198),
  ('bangkok','Bangkok','Thailand',13.7563,100.5018),
  ('new_york','New York','United States',40.7128,-74.0060),
  ('los_angeles','Los Angeles','United States',34.0522,-118.2437),
  ('mexico_city','Mexico City','Mexico',19.4326,-99.1332),
  ('rio_de_janeiro','Rio de Janeiro','Brazil',-22.9068,-43.1729),
  ('buenos_aires','Buenos Aires','Argentina',-34.6037,-58.3816),
  ('tokyo','Tokyo','Japan',35.6762,139.6503),
  ('seoul','Seoul','South Korea',37.5665,126.9780),
  ('sydney','Sydney','Australia',-33.8688,151.2093),
  ('auckland','Auckland','New Zealand',-36.8509,174.7645)
ON CONFLICT(id) DO UPDATE SET city=excluded.city,country=excluded.country,
  latitude=excluded.latitude,longitude=excluded.longitude;

ALTER TABLE public.game_users ADD COLUMN is_test_account boolean NOT NULL DEFAULT false;
UPDATE public.game_users SET is_test_account=true,coins=1000000000
  WHERE lower(username)='supertest';

CREATE FUNCTION public.prepare_game_test_account(p_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE enabled boolean; current_period date; active_race jsonb; pigeon jsonb; wallet jsonb;
BEGIN
  SELECT is_test_account OR lower(username)='supertest' INTO enabled
    FROM public.game_users WHERE id=p_user_id FOR UPDATE;
  IF NOT coalesce(enabled,false) THEN RETURN jsonb_build_object('testAccount',false); END IF;

  UPDATE public.game_users SET is_test_account=true,coins=1000000000,coins_version=coins_version+1 WHERE id=p_user_id
    RETURNING jsonb_build_object('coins',coins,'version',coins_version) INTO wallet;
  UPDATE public.game_pigeons SET health=100,energy=100,last_fed_at=NULL,last_played_at=NULL,
    last_cleaned_at=NULL,last_slept_at=NULL,last_battled_at=NULL,injured_until=NULL,
    version=version+1 WHERE user_id=p_user_id;

  -- Archive the current test-only limits while retaining receipts for coverage.
  UPDATE public.game_pigeon_pack_receipts current_receipt SET period_start=(
      SELECT coalesce(min(saved.period_start),current_receipt.period_start)-1
      FROM public.game_pigeon_pack_receipts saved
      WHERE saved.user_id=p_user_id AND saved.pack_type=current_receipt.pack_type)
    WHERE current_receipt.user_id=p_user_id AND (
      (current_receipt.pack_type='normal' AND current_receipt.period_start=timezone('UTC',clock_timestamp())::date)
      OR (current_receipt.pack_type='big' AND current_receipt.period_start=date_trunc('week',timezone('UTC',clock_timestamp()))::date));

  UPDATE public.game_daily_rewards current_reward SET reward_date=(
      SELECT coalesce(min(saved.reward_date),current_reward.reward_date)-1
      FROM public.game_daily_rewards saved WHERE saved.user_id=p_user_id)
    WHERE current_reward.user_id=p_user_id
      AND current_reward.reward_date=public.pigeon_utc_date(clock_timestamp());

  UPDATE public.game_pigeon_races SET started_at=least(started_at,clock_timestamp()-interval '1 second'),
      finishes_at=clock_timestamp(),public_result=public_result||jsonb_build_object('finishesAt',clock_timestamp(),'ready',true)
    WHERE user_id=p_user_id AND claimed_at IS NULL;

  SELECT to_jsonb(p)||jsonb_build_object('species',(SELECT to_jsonb(s) FROM public.game_species s WHERE s.id=p.species_id))
    INTO pigeon FROM public.game_pigeons p WHERE p.user_id=p_user_id;
  SELECT r.public_result||jsonb_build_object('ready',true,'retryAfter',0)
    INTO active_race FROM public.game_pigeon_races r WHERE r.user_id=p_user_id AND r.claimed_at IS NULL
    ORDER BY r.started_at DESC LIMIT 1;
  RETURN jsonb_build_object('testAccount',true,'wallet',wallet,'pigeon',pigeon,'activeRace',active_race);
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
  result:=race.public_result||jsonb_build_object('completed',true,'ready',true,'won',won,
    'upset',coalesce((race.outcome->>'upset')::boolean,false),'replayed',false,
    'scores',jsonb_build_object('player',(race.outcome->>'playerScore')::numeric,'opponent',(race.outcome->>'opponentScore')::numeric),
    'effects',jsonb_build_object('coins',coin_gain,'xp',xp_gain),'wallet',wallet,
    'pigeon',to_jsonb(current_state)||jsonb_build_object('species',(SELECT to_jsonb(s) FROM public.game_species s WHERE s.id=current_state.species_id)));
  UPDATE public.game_pigeon_races SET claimed_at=now_at,claimed_result=result WHERE user_id=p_user_id AND request_id=p_race_id;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.prepare_game_test_account(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_game_test_account(uuid) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
