-- Allow owned food to be consumed by the authoritative feeding transaction.
-- Apply once after 017_catch_the_crumbs.sql.
BEGIN;

CREATE OR REPLACE FUNCTION public.feed_game_pigeon(p_user_id uuid, p_request_id uuid, p_food text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  saved public.game_pigeons%ROWTYPE;
  current_state public.game_pigeons%ROWTYPE;
  product public.game_items%ROWTYPE;
  receipt jsonb;
  result jsonb;
  action_time timestamptz;
  hunger_gain numeric;
  happiness_gain numeric;
  energy_gain numeric;
  cleanliness_gain numeric;
  xp_gain integer;
  coin_gain integer;
  wallet jsonb;
  owned integer;
  item_result jsonb;
BEGIN
  IF p_request_id IS NULL OR p_food IS NULL OR p_food NOT IN ('crumbs','corn','peas','sunflower_seeds') THEN
    RAISE EXCEPTION 'Invalid food or request' USING ERRCODE = '22023';
  END IF;

  -- The pigeon row serializes feeding, cooldown checks and inventory use per account.
  SELECT * INTO saved FROM public.game_pigeons WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NO_PIGEON'); END IF;

  SELECT r.result INTO receipt FROM public.game_feed_receipts r
    WHERE r.user_id = p_user_id AND r.request_id = p_request_id;
  IF FOUND THEN
    SELECT * INTO product FROM public.game_items WHERE id = receipt->>'food';
    SELECT quantity INTO owned FROM public.game_user_items
      WHERE user_id = p_user_id AND item_id = product.id;
    item_result := to_jsonb(product) || jsonb_build_object('quantity', coalesce(owned, 0));
    RETURN receipt || jsonb_build_object(
      'pigeon', public.refresh_game_pigeon(p_user_id),
      'wallet', public.get_pigeon_wallet(p_user_id),
      'item', item_result,
      'effects', jsonb_build_object('coins', 0) || (receipt->'effects'),
      'replayed', true);
  END IF;

  SELECT * INTO product FROM public.game_items WHERE id = p_food AND type = 'food' FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'FOOD_UNAVAILABLE'); END IF;

  action_time := greatest(clock_timestamp(), saved.last_updated);
  IF saved.last_fed_at IS NOT NULL AND action_time < saved.last_fed_at + interval '10 seconds' THEN
    RETURN jsonb_build_object('error', 'FEED_COOLDOWN', 'retryAfter',
      ceil(extract(epoch FROM (saved.last_fed_at + interval '10 seconds' - action_time))));
  END IF;

  IF product.id <> 'crumbs' THEN
    SELECT quantity INTO owned FROM public.game_user_items
      WHERE user_id = p_user_id AND item_id = product.id FOR UPDATE;
    IF NOT FOUND OR owned < 1 THEN
      RETURN jsonb_build_object('error', 'FOOD_NOT_OWNED', 'food', product.id);
    END IF;
  ELSE
    owned := coalesce((SELECT quantity FROM public.game_user_items
      WHERE user_id = p_user_id AND item_id = product.id), 0);
  END IF;

  current_state := public.calculate_current_pigeon_state(saved, action_time);
  hunger_gain := least(product.hunger_effect, 100 - current_state.hunger);
  happiness_gain := least(product.happiness_effect, 100 - current_state.happiness);
  energy_gain := least(product.energy_effect, 100 - current_state.energy);
  cleanliness_gain := least(product.cleanliness_effect, 100 - current_state.cleanliness);
  xp_gain := public.pigeon_xp_reward('feed');
  coin_gain := public.pigeon_coin_reward('feed');
  wallet := public.award_pigeon_coins(p_user_id, 'feed');
  current_state := public.add_pigeon_xp(current_state, xp_gain);

  UPDATE public.game_pigeons SET
    hunger = current_state.hunger + hunger_gain,
    happiness = current_state.happiness + happiness_gain,
    energy = current_state.energy + energy_gain,
    cleanliness = current_state.cleanliness + cleanliness_gain,
    xp = current_state.xp, level = current_state.level, last_updated = current_state.last_updated,
    version = saved.version + 1, last_fed_at = action_time
  WHERE id = saved.id RETURNING * INTO current_state;

  IF product.id <> 'crumbs' THEN
    IF owned = 1 THEN
      DELETE FROM public.game_user_items WHERE user_id = p_user_id AND item_id = product.id;
      owned := 0;
    ELSE
      UPDATE public.game_user_items SET quantity = quantity - 1, updated_at = clock_timestamp()
        WHERE user_id = p_user_id AND item_id = product.id
        RETURNING quantity INTO owned;
    END IF;
  END IF;
  item_result := to_jsonb(product) || jsonb_build_object('quantity', owned);

  result := jsonb_build_object(
    'wallet', wallet,
    'pigeon', to_jsonb(current_state) || jsonb_build_object('species',
      (SELECT to_jsonb(s) FROM public.game_species s WHERE s.id = current_state.species_id)),
    'food', product.id,
    'item', item_result,
    'effects', jsonb_strip_nulls(jsonb_build_object('hunger', hunger_gain, 'happiness', happiness_gain,
      'energy', CASE WHEN product.energy_effect <> 0 THEN energy_gain END,
      'cleanliness', CASE WHEN product.cleanliness_effect <> 0 THEN cleanliness_gain END,
      'xp', xp_gain, 'coins', coin_gain)),
    'replayed', false);
  INSERT INTO public.game_feed_receipts(user_id, request_id, pigeon_id, result)
    VALUES (p_user_id, p_request_id, saved.id, result);
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.feed_game_pigeon(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.feed_game_pigeon(uuid, uuid, text) TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
