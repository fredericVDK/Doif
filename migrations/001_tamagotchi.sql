-- Phase 1. Run once in a Supabase Postgres database, before the starter seed.
-- auth.users, auth.uid(), anon, authenticated and service_role belong to Supabase.
-- This migration does not modify the existing JSON or Airtable storage.
BEGIN;

CREATE TABLE public.game_users (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username text NOT NULL CHECK (username ~ '^[A-Za-z0-9_]{3,24}$'),
  coins integer NOT NULL DEFAULT 0 CHECK (coins >= 0),
  created_at timestamptz NOT NULL DEFAULT now() CHECK (isfinite(created_at))
);

CREATE UNIQUE INDEX game_users_username_unique ON public.game_users (lower(username));
COMMENT ON TABLE public.game_users IS
  'Game profile. User.email and credentials are owned by Supabase Auth, not duplicated here.';

CREATE TABLE public.game_species (
  id text PRIMARY KEY CHECK (id ~ '^birdnet:BN[0-9]+$'),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  scientific_name text NOT NULL CHECK (length(btrim(scientific_name)) > 0),
  description text NOT NULL DEFAULT '',
  image text NOT NULL,
  habitat text,
  diet text,
  rarity text NOT NULL CHECK (rarity IN ('common', 'uncommon', 'rare', 'epic', 'legendary')),
  is_starter boolean NOT NULL DEFAULT false,
  source_url text NOT NULL,
  description_source text NOT NULL DEFAULT '',
  description_url text NOT NULL DEFAULT '',
  image_attribution jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(image_attribution) = 'object')
);

COMMENT ON COLUMN public.game_species.rarity IS
  'Game balancing metadata, not a conservation status or a claim from BirdNET.';
COMMENT ON COLUMN public.game_species.habitat IS 'NULL means no verified structured source yet.';
COMMENT ON COLUMN public.game_species.diet IS 'NULL means no verified structured source yet.';

CREATE TABLE public.game_pigeons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- One pigeon per account for the MVP; a partial active index can replace this later.
  user_id uuid NOT NULL UNIQUE REFERENCES public.game_users(id) ON DELETE CASCADE,
  species_id text NOT NULL REFERENCES public.game_species(id) ON DELETE RESTRICT,
  nickname text NOT NULL CHECK (
    nickname = btrim(nickname)
    AND char_length(nickname) BETWEEN 1 AND 32
    AND nickname !~ '[[:cntrl:]]'
  ),
  level integer NOT NULL DEFAULT 1 CHECK (level >= 1),
  -- XP within the current level; threshold/level-up rules belong to the later game service.
  xp integer NOT NULL DEFAULT 0 CHECK (xp >= 0),
  hunger numeric(7,4) NOT NULL DEFAULT 100 CHECK (hunger BETWEEN 0 AND 100),
  happiness numeric(7,4) NOT NULL DEFAULT 100 CHECK (happiness BETWEEN 0 AND 100),
  energy numeric(7,4) NOT NULL DEFAULT 100 CHECK (energy BETWEEN 0 AND 100),
  cleanliness numeric(7,4) NOT NULL DEFAULT 100 CHECK (cleanliness BETWEEN 0 AND 100),
  health numeric(7,4) NOT NULL DEFAULT 100 CHECK (health BETWEEN 0 AND 100),
  growth_stage text NOT NULL DEFAULT 'hatchling'
    CHECK (growth_stage IN ('hatchling', 'juvenile', 'adult', 'best_friend')),
  created_at timestamptz NOT NULL DEFAULT now() CHECK (isfinite(created_at)),
  last_updated timestamptz NOT NULL DEFAULT now()
    CHECK (isfinite(last_updated) AND last_updated >= created_at),
  -- Future actions can lock the row or compare this revision in one transaction.
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0)
);

COMMENT ON COLUMN public.game_pigeons.last_updated IS
  'UTC instant through which stat decay has been applied. Update atomically with stats.';

ALTER TABLE public.game_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_species ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_pigeons ENABLE ROW LEVEL SECURITY;

-- Explicit privileges override permissive public-schema defaults.
REVOKE ALL ON public.game_users, public.game_species, public.game_pigeons
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.game_species TO anon, authenticated;
GRANT SELECT ON public.game_users, public.game_pigeons TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.game_users, public.game_species, public.game_pigeons
  TO service_role;

CREATE POLICY game_species_read ON public.game_species
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY game_users_read_own ON public.game_users
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = id);
CREATE POLICY game_pigeons_read_own ON public.game_pigeons
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

-- No client write policies: later Node actions validate identity and compute rewards.
-- service_role bypasses RLS in Supabase and must never be exposed to the browser.
COMMIT;
