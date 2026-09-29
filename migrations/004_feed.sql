-- Phase 6. Apply once after 003_time_engine.sql.
BEGIN;
ALTER TABLE public.game_pigeons ADD COLUMN last_fed_at timestamptz
  CHECK (last_fed_at IS NULL OR isfinite(last_fed_at));

-- Retain receipts so an old network retry cannot award XP again, even after later meals.
CREATE TABLE public.game_feed_receipts (
  user_id uuid NOT NULL REFERENCES public.game_users(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  pigeon_id uuid NOT NULL REFERENCES public.game_pigeons(id) ON DELETE CASCADE,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, request_id)
);
ALTER TABLE public.game_feed_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.game_feed_receipts FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.game_feed_receipts TO service_role;

CREATE FUNCTION public.feed_game_pigeon(p_user_id uuid, p_request_id uuid, p_food text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  saved public.game_pigeons%ROWTYPE;
  current_state public.game_pigeons%ROWTYPE;
  receipt jsonb;
  result jsonb;
  action_time timestamptz;
  hunger_gain numeric;
  happiness_gain numeric;
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
    RETURN receipt || jsonb_build_object('pigeon', public.refresh_game_pigeon(p_user_id), 'replayed', true);
  END IF;
  action_time := greatest(clock_timestamp(), saved.last_updated);
  IF saved.last_fed_at IS NOT NULL AND action_time < saved.last_fed_at + interval '10 seconds' THEN
    RETURN jsonb_build_object('error', 'FEED_COOLDOWN', 'retryAfter',
      ceil(extract(epoch FROM (saved.last_fed_at + interval '10 seconds' - action_time))));
  END IF;
  current_state := public.calculate_current_pigeon_state(saved, action_time);
  hunger_gain := least(15, 100 - current_state.hunger);
  happiness_gain := least(2, 100 - current_state.happiness);
  UPDATE public.game_pigeons SET
    hunger = current_state.hunger + hunger_gain,
    happiness = current_state.happiness + happiness_gain,
    energy = current_state.energy, cleanliness = current_state.cleanliness,
    xp = current_state.xp + 5, last_updated = current_state.last_updated,
    version = saved.version + 1, last_fed_at = action_time
  WHERE id = saved.id RETURNING * INTO current_state;
  result := jsonb_build_object(
    'pigeon', to_jsonb(current_state) || jsonb_build_object('species',
      (SELECT to_jsonb(s) FROM public.game_species s WHERE s.id = current_state.species_id)),
    'food', 'crumbs', 'effects', jsonb_build_object('hunger', hunger_gain, 'happiness', happiness_gain, 'xp', 5),
    'replayed', false);
  INSERT INTO public.game_feed_receipts(user_id, request_id, pigeon_id, result)
    VALUES (p_user_id, p_request_id, saved.id, result);
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.feed_game_pigeon(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.feed_game_pigeon(uuid, uuid, text) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
