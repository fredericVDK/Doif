-- Phase 5. Run once after 002_adoption.sql. Existing pigeons and timestamps remain intact.
BEGIN;

-- Retain fractional decay across frequent reads without rounding to visible percentages.
ALTER TABLE public.game_pigeons
  ALTER COLUMN hunger TYPE numeric(16,12),
  ALTER COLUMN happiness TYPE numeric(16,12),
  ALTER COLUMN energy TYPE numeric(16,12),
  ALTER COLUMN cleanliness TYPE numeric(16,12);

-- One central calculation, reusable inside future transactional care actions.
-- Explicit time makes the calculation deterministic; only server-role callers may execute it.
CREATE FUNCTION public.calculate_current_pigeon_state(
  p_pigeon public.game_pigeons, p_now timestamptz
) RETURNS public.game_pigeons
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  result public.game_pigeons := p_pigeon;
  hours_elapsed numeric;
BEGIN
  IF p_now IS NULL OR NOT isfinite(p_now) OR p_pigeon.last_updated IS NULL
    OR NOT isfinite(p_pigeon.last_updated) THEN
    RAISE EXCEPTION 'Finite timestamps required' USING ERRCODE = '22023';
  END IF;
  -- Clock regressions and identical timestamps never restore stats or rewind the clock.
  IF p_now <= p_pigeon.last_updated THEN RETURN result; END IF;
  hours_elapsed := extract(epoch FROM (p_now - p_pigeon.last_updated))::numeric / 3600;
  result.hunger := greatest(0, least(100, p_pigeon.hunger - 2 * hours_elapsed));
  result.happiness := greatest(0, least(100, p_pigeon.happiness - hours_elapsed));
  result.energy := greatest(0, least(100, p_pigeon.energy - hours_elapsed));
  result.cleanliness := greatest(0, least(100, p_pigeon.cleanliness - 0.5 * hours_elapsed));
  -- Health, XP, level, coins and growth are not affected by absence in this phase.
  result.last_updated := p_now;
  result.version := p_pigeon.version + 1;
  RETURN result;
END;
$$;

CREATE FUNCTION public.refresh_game_pigeon(p_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  saved public.game_pigeons%ROWTYPE;
  current_state public.game_pigeons%ROWTYPE;
BEGIN
  SELECT * INTO saved FROM public.game_pigeons WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  -- Sample database time AFTER acquiring the row lock, including time spent waiting.
  current_state := public.calculate_current_pigeon_state(saved, clock_timestamp());
  IF current_state.last_updated > saved.last_updated THEN
    UPDATE public.game_pigeons SET
      hunger = current_state.hunger, happiness = current_state.happiness,
      energy = current_state.energy, cleanliness = current_state.cleanliness,
      last_updated = current_state.last_updated, version = current_state.version
    WHERE id = saved.id
    RETURNING * INTO current_state;
  END IF;
  -- Return the very state persisted in this transaction, with its catalogue record.
  RETURN to_jsonb(current_state) || jsonb_build_object('species',
    (SELECT to_jsonb(s) FROM public.game_species s WHERE s.id = current_state.species_id));
END;
$$;

REVOKE ALL ON FUNCTION public.calculate_current_pigeon_state(public.game_pigeons, timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refresh_game_pigeon(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_current_pigeon_state(public.game_pigeons, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_game_pigeon(uuid) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
