-- Phase 11. Apply once after 008_xp_levels.sql.
BEGIN;
CREATE FUNCTION public.get_pigeon_growth_stage(p_level integer) RETURNS text
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF p_level IS NULL OR p_level < 1 THEN
    RAISE EXCEPTION 'Invalid level' USING ERRCODE='22023';
  END IF;
  RETURN CASE WHEN p_level >= 25 THEN 'best_friend'
    WHEN p_level >= 10 THEN 'adult'
    WHEN p_level >= 5 THEN 'juvenile'
    ELSE 'hatchling' END;
END;
$$;

-- Every persisted level change uses the same rule, including adoption and admin repairs.
CREATE FUNCTION public.sync_pigeon_growth_stage() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  NEW.growth_stage := public.get_pigeon_growth_stage(NEW.level);
  RETURN NEW;
END;
$$;
CREATE TRIGGER sync_pigeon_growth_stage BEFORE INSERT OR UPDATE OF level, growth_stage
  ON public.game_pigeons FOR EACH ROW EXECUTE FUNCTION public.sync_pigeon_growth_stage();

-- Correct existing stages without granting rewards or forgiving elapsed time.
UPDATE public.game_pigeons SET growth_stage=public.get_pigeon_growth_stage(level), version=version+1
WHERE growth_stage IS DISTINCT FROM public.get_pigeon_growth_stage(level);

REVOKE ALL ON FUNCTION public.get_pigeon_growth_stage(integer), public.sync_pigeon_growth_stage()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_pigeon_growth_stage(integer), public.sync_pigeon_growth_stage()
  TO service_role;

CREATE OR REPLACE FUNCTION public.add_pigeon_xp(p_pigeon public.game_pigeons, p_amount integer)
RETURNS public.game_pigeons
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  result public.game_pigeons := p_pigeon;
  remaining bigint;
BEGIN
  IF p_amount IS NULL OR p_amount < 0 OR p_pigeon.xp IS NULL OR p_pigeon.xp < 0
    OR p_pigeon.level IS NULL OR p_pigeon.level < 1 THEN
    RAISE EXCEPTION 'Invalid XP input' USING ERRCODE='22023';
  END IF;
  remaining := p_pigeon.xp::bigint + p_amount;
  WHILE remaining >= public.pigeon_xp_required(result.level) LOOP
    remaining := remaining - public.pigeon_xp_required(result.level);
    result.level := result.level + 1;
  END LOOP;
  result.xp := remaining;
  result.xp_to_next_level := public.pigeon_xp_required(result.level);
  result.growth_stage := public.get_pigeon_growth_stage(result.level);
  RETURN result;
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
