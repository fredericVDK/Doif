-- Phase 13. Apply once after 010_coins.sql.
BEGIN;
-- Catalogue IDs belong to the existing BirdNET/Wikimedia API, not only the six
-- adoptable records in game_species. The server validates each discovery ID.
CREATE TABLE public.game_pigeon_discoveries (
  user_id uuid NOT NULL REFERENCES public.game_users(id) ON DELETE CASCADE,
  species_id text NOT NULL CHECK (length(btrim(species_id)) BETWEEN 1 AND 200),
  discovered_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(discovered_at)),
  seen_at timestamptz CHECK (seen_at IS NULL OR (isfinite(seen_at) AND seen_at >= discovered_at)),
  PRIMARY KEY (user_id, species_id)
);
ALTER TABLE public.game_pigeon_discoveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.game_pigeon_discoveries FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.game_pigeon_discoveries TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.game_pigeon_discoveries TO service_role;
CREATE POLICY discoveries_read_own ON public.game_pigeon_discoveries
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

CREATE FUNCTION public.record_pigeon_discovery(p_user_id uuid, p_species_id text) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
DECLARE inserted integer;
BEGIN
  INSERT INTO public.game_pigeon_discoveries(user_id, species_id)
    VALUES(p_user_id, p_species_id) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS inserted = ROW_COUNT;
  RETURN inserted = 1;
END;
$$;

CREATE FUNCTION public.discover_adopted_pigeon() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  PERFORM public.record_pigeon_discovery(NEW.user_id, NEW.species_id);
  RETURN NEW;
END;
$$;
CREATE TRIGGER discover_adopted_pigeon AFTER INSERT ON public.game_pigeons
  FOR EACH ROW EXECUTE FUNCTION public.discover_adopted_pigeon();

-- Preserve historical adoption time and all pigeon/coin progress.
INSERT INTO public.game_pigeon_discoveries(user_id, species_id, discovered_at)
  SELECT user_id, species_id, created_at FROM public.game_pigeons;

CREATE FUNCTION public.acknowledge_pigeon_discovery(p_user_id uuid, p_species_id text) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  UPDATE public.game_pigeon_discoveries SET seen_at=greatest(clock_timestamp(), discovered_at)
    WHERE user_id=p_user_id AND species_id=p_species_id AND seen_at IS NULL;
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.record_pigeon_discovery(uuid,text), public.discover_adopted_pigeon(),
  public.acknowledge_pigeon_discovery(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_pigeon_discovery(uuid,text), public.discover_adopted_pigeon(),
  public.acknowledge_pigeon_discovery(uuid,text) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
