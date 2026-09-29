-- Phase 12. Apply once after 009_growth_stages.sql. Existing balances are preserved.
BEGIN;
ALTER TABLE public.game_users ADD COLUMN coins_version integer NOT NULL DEFAULT 0 CHECK (coins_version >= 0);

CREATE FUNCTION public.pigeon_coin_reward(p_action text) RETURNS integer
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  CASE p_action
    WHEN 'feed' THEN RETURN 2;
    WHEN 'play' THEN RETURN 5;
    WHEN 'clean' THEN RETURN 2;
    ELSE RAISE EXCEPTION 'Unknown coin action' USING ERRCODE='22023';
  END CASE;
END;
$$;

CREATE FUNCTION public.get_pigeon_wallet(p_user_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT jsonb_build_object('coins', coins, 'version', coins_version)
  FROM public.game_users WHERE id = p_user_id;
$$;

-- Called only for a new, successful care action while its pigeon row is locked.
-- The UPDATE locks the profile too, and adds to its stored balance atomically.
CREATE FUNCTION public.award_pigeon_coins(p_user_id uuid, p_action text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  reward integer := public.pigeon_coin_reward(p_action);
  wallet jsonb;
BEGIN
  UPDATE public.game_users SET coins=coins+reward, coins_version=coins_version+1
    WHERE id=p_user_id
    RETURNING jsonb_build_object('coins', coins, 'version', coins_version) INTO wallet;
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing game profile' USING ERRCODE='23503'; END IF;
  RETURN wallet;
END;
$$;

REVOKE ALL ON FUNCTION public.pigeon_coin_reward(text), public.get_pigeon_wallet(uuid),
  public.award_pigeon_coins(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pigeon_coin_reward(text), public.get_pigeon_wallet(uuid),
  public.award_pigeon_coins(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.feed_game_pigeon(p_user_id uuid, p_request_id uuid, p_food text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  saved public.game_pigeons%ROWTYPE;
  current_state public.game_pigeons%ROWTYPE;
  receipt jsonb;
  result jsonb;
  action_time timestamptz;
  hunger_gain numeric;
  happiness_gain numeric;
  xp_gain integer;
  coin_gain integer;
  wallet jsonb;
BEGIN
  IF p_request_id IS NULL OR p_food IS DISTINCT FROM 'crumbs' THEN
    RAISE EXCEPTION 'Invalid food or request' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO saved FROM public.game_pigeons WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NO_PIGEON'); END IF;
  SELECT r.result INTO receipt FROM public.game_feed_receipts r
    WHERE r.user_id = p_user_id AND r.request_id = p_request_id;
  IF FOUND THEN
    -- Return the original reward alongside the current state, never award it again.
    RETURN receipt || jsonb_build_object('pigeon', public.refresh_game_pigeon(p_user_id),
      'wallet', public.get_pigeon_wallet(p_user_id),
      'effects', jsonb_build_object('coins', 0) || (receipt->'effects'), 'replayed', true);
  END IF;
  action_time := greatest(clock_timestamp(), saved.last_updated);
  IF saved.last_fed_at IS NOT NULL AND action_time < saved.last_fed_at + interval '10 seconds' THEN
    RETURN jsonb_build_object('error', 'FEED_COOLDOWN', 'retryAfter',
      ceil(extract(epoch FROM (saved.last_fed_at + interval '10 seconds' - action_time))));
  END IF;
  current_state := public.calculate_current_pigeon_state(saved, action_time);
  hunger_gain := least(15, 100 - current_state.hunger);
  happiness_gain := least(2, 100 - current_state.happiness);
  xp_gain := public.pigeon_xp_reward('feed');
  coin_gain := public.pigeon_coin_reward('feed');
  wallet := public.award_pigeon_coins(p_user_id, 'feed');
  current_state := public.add_pigeon_xp(current_state, xp_gain);
  UPDATE public.game_pigeons SET
    hunger = current_state.hunger + hunger_gain,
    happiness = current_state.happiness + happiness_gain,
    energy = current_state.energy, cleanliness = current_state.cleanliness,
    xp = current_state.xp, level = current_state.level, last_updated = current_state.last_updated,
    version = saved.version + 1, last_fed_at = action_time
  WHERE id = saved.id RETURNING * INTO current_state;
  result := jsonb_build_object(
    'wallet', wallet,
    'pigeon', to_jsonb(current_state) || jsonb_build_object('species',
      (SELECT to_jsonb(s) FROM public.game_species s WHERE s.id = current_state.species_id)),
    'food', 'crumbs', 'effects', jsonb_build_object('hunger', hunger_gain, 'happiness', happiness_gain, 'xp', xp_gain, 'coins', coin_gain),
    'replayed', false);
  INSERT INTO public.game_feed_receipts(user_id, request_id, pigeon_id, result)
    VALUES (p_user_id, p_request_id, saved.id, result);
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.feed_game_pigeon(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.feed_game_pigeon(uuid, uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.play_game_pigeon(p_user_id uuid, p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  saved public.game_pigeons%ROWTYPE;
  current_state public.game_pigeons%ROWTYPE;
  receipt jsonb;
  result jsonb;
  action_time timestamptz;
  happiness_gain numeric;
  xp_gain integer;
  coin_gain integer;
  wallet jsonb;
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'Invalid request' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO saved FROM public.game_pigeons WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NO_PIGEON'); END IF;
  SELECT r.result INTO receipt FROM public.game_play_receipts r
    WHERE r.user_id = p_user_id AND r.request_id = p_request_id;
  IF FOUND THEN
    RETURN receipt || jsonb_build_object('pigeon', public.refresh_game_pigeon(p_user_id),
      'wallet', public.get_pigeon_wallet(p_user_id),
      'effects', jsonb_build_object('coins', 0) || (receipt->'effects'), 'replayed', true);
  END IF;
  action_time := greatest(clock_timestamp(), saved.last_updated);
  IF saved.last_played_at IS NOT NULL AND action_time < saved.last_played_at + interval '10 seconds' THEN
    RETURN jsonb_build_object('error', 'PLAY_COOLDOWN', 'retryAfter',
      ceil(extract(epoch FROM (saved.last_played_at + interval '10 seconds' - action_time))));
  END IF;
  current_state := public.calculate_current_pigeon_state(saved, action_time);
  IF current_state.energy < 10 THEN
    -- Save time decay and show current needs, without spending energy or awarding XP.
    RETURN jsonb_build_object('error', 'TOO_TIRED', 'pigeon', public.refresh_game_pigeon(p_user_id));
  END IF;
  happiness_gain := least(15, 100 - current_state.happiness);
  xp_gain := public.pigeon_xp_reward('play');
  coin_gain := public.pigeon_coin_reward('play');
  wallet := public.award_pigeon_coins(p_user_id, 'play');
  current_state := public.add_pigeon_xp(current_state, xp_gain);
  UPDATE public.game_pigeons SET
    hunger = current_state.hunger, happiness = current_state.happiness + happiness_gain,
    energy = current_state.energy - 10, cleanliness = current_state.cleanliness,
    xp = current_state.xp, level = current_state.level, last_updated = current_state.last_updated,
    version = saved.version + 1, last_played_at = action_time
  WHERE id = saved.id RETURNING * INTO current_state;
  result := jsonb_build_object(
    'wallet', wallet,
    'pigeon', to_jsonb(current_state) || jsonb_build_object('species',
      (SELECT to_jsonb(s) FROM public.game_species s WHERE s.id = current_state.species_id)),
    'effects', jsonb_build_object('energy', -10, 'happiness', happiness_gain, 'xp', xp_gain, 'coins', coin_gain),
    'replayed', false);
  INSERT INTO public.game_play_receipts(user_id, request_id, pigeon_id, result)
    VALUES (p_user_id, p_request_id, saved.id, result);
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.play_game_pigeon(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.play_game_pigeon(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.clean_game_pigeon(p_user_id uuid, p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  saved public.game_pigeons%ROWTYPE;
  current_state public.game_pigeons%ROWTYPE;
  receipt jsonb;
  result jsonb;
  action_time timestamptz;
  happiness_gain numeric;
  xp_gain integer;
  coin_gain integer;
  wallet jsonb;
  cleanliness_gain numeric;
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'Invalid request' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO saved FROM public.game_pigeons WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NO_PIGEON'); END IF;
  SELECT r.result INTO receipt FROM public.game_clean_receipts r
    WHERE r.user_id = p_user_id AND r.request_id = p_request_id;
  IF FOUND THEN
    RETURN receipt || jsonb_build_object('pigeon', public.refresh_game_pigeon(p_user_id),
      'wallet', public.get_pigeon_wallet(p_user_id),
      'effects', jsonb_build_object('coins', 0) || (receipt->'effects'), 'replayed', true);
  END IF;
  action_time := greatest(clock_timestamp(), saved.last_updated);
  IF saved.last_cleaned_at IS NOT NULL AND action_time < saved.last_cleaned_at + interval '10 seconds' THEN
    RETURN jsonb_build_object('error', 'CLEAN_COOLDOWN', 'retryAfter',
      ceil(extract(epoch FROM (saved.last_cleaned_at + interval '10 seconds' - action_time))));
  END IF;
  current_state := public.calculate_current_pigeon_state(saved, action_time);
  happiness_gain := least(5, 100 - current_state.happiness);
  cleanliness_gain := least(30, 100 - current_state.cleanliness);
  xp_gain := public.pigeon_xp_reward('clean');
  coin_gain := public.pigeon_coin_reward('clean');
  wallet := public.award_pigeon_coins(p_user_id, 'clean');
  current_state := public.add_pigeon_xp(current_state, xp_gain);
  UPDATE public.game_pigeons SET
    hunger = current_state.hunger, happiness = current_state.happiness + happiness_gain,
    energy = current_state.energy, cleanliness = current_state.cleanliness + cleanliness_gain,
    xp = current_state.xp, level = current_state.level, last_updated = current_state.last_updated,
    version = saved.version + 1, last_cleaned_at = action_time
  WHERE id = saved.id RETURNING * INTO current_state;
  result := jsonb_build_object(
    'wallet', wallet,
    'pigeon', to_jsonb(current_state) || jsonb_build_object('species',
      (SELECT to_jsonb(s) FROM public.game_species s WHERE s.id = current_state.species_id)),
    'effects', jsonb_build_object('cleanliness', cleanliness_gain, 'happiness', happiness_gain, 'xp', xp_gain, 'coins', coin_gain),
    'replayed', false);
  INSERT INTO public.game_clean_receipts(user_id, request_id, pigeon_id, result)
    VALUES (p_user_id, p_request_id, saved.id, result);
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.clean_game_pigeon(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clean_game_pigeon(uuid, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
