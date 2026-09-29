-- Phase 14. Apply once after 011_discoveries.sql.
BEGIN;

CREATE TABLE public.game_daily_rewards (
  user_id uuid NOT NULL REFERENCES public.game_users(id) ON DELETE CASCADE,
  reward_date date NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(claimed_at)),
  coins_awarded integer NOT NULL DEFAULT 50 CHECK (coins_awarded = 50),
  xp_awarded integer NOT NULL DEFAULT 20 CHECK (xp_awarded = 20),
  PRIMARY KEY (user_id, reward_date)
);
ALTER TABLE public.game_daily_rewards ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.game_daily_rewards FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.game_daily_rewards TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.game_daily_rewards TO service_role;
CREATE POLICY daily_rewards_read_own ON public.game_daily_rewards
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

CREATE FUNCTION public.pigeon_utc_date(p_moment timestamptz) RETURNS date
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT (p_moment AT TIME ZONE 'UTC')::date;
$$;

CREATE FUNCTION public.pigeon_daily_reward(p_reward text) RETURNS integer
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  CASE p_reward
    WHEN 'coins' THEN RETURN 50;
    WHEN 'xp' THEN RETURN 20;
    ELSE RAISE EXCEPTION 'Unknown daily reward' USING ERRCODE='22023';
  END CASE;
END;
$$;

-- All coin grants share one checked, atomic balance update.
CREATE FUNCTION public.add_pigeon_coins(p_user_id uuid, p_amount integer) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
DECLARE wallet jsonb;
BEGIN
  IF p_amount IS NULL OR p_amount < 0 THEN
    RAISE EXCEPTION 'Invalid coin amount' USING ERRCODE='22023';
  END IF;
  UPDATE public.game_users SET coins=coins+p_amount, coins_version=coins_version+1
    WHERE id=p_user_id
    RETURNING jsonb_build_object('coins', coins, 'version', coins_version) INTO wallet;
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing game profile' USING ERRCODE='23503'; END IF;
  RETURN wallet;
END;
$$;

CREATE OR REPLACE FUNCTION public.award_pigeon_coins(p_user_id uuid, p_action text) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
  SELECT public.add_pigeon_coins(p_user_id, public.pigeon_coin_reward(p_action));
$$;

CREATE FUNCTION public.claim_game_daily_reward(p_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  saved public.game_pigeons%ROWTYPE;
  rewarded public.game_pigeons%ROWTYPE;
  wallet jsonb;
  today date := public.pigeon_utc_date(clock_timestamp());
  coin_gain integer := public.pigeon_daily_reward('coins');
  xp_gain integer := public.pigeon_daily_reward('xp');
BEGIN
  -- Keep lock order consistent with care actions: pigeon, then profile.
  SELECT * INTO saved FROM public.game_pigeons WHERE user_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','NO_PIGEON'); END IF;

  IF EXISTS (SELECT 1 FROM public.game_daily_rewards
    WHERE user_id=p_user_id AND reward_date=today) THEN
    RETURN jsonb_build_object(
      'claimed', false, 'rewardDate', today,
      'effects', jsonb_build_object('coins',0,'xp',0),
      'wallet', public.get_pigeon_wallet(p_user_id),
      'pigeon', to_jsonb(saved) || jsonb_build_object('species',
        (SELECT to_jsonb(s) FROM public.game_species s WHERE s.id=saved.species_id)));
  END IF;

  rewarded := public.add_pigeon_xp(saved, xp_gain);
  UPDATE public.game_pigeons SET xp=rewarded.xp, level=rewarded.level,
    version=saved.version+1 WHERE id=saved.id RETURNING * INTO rewarded;
  wallet := public.add_pigeon_coins(p_user_id, coin_gain);
  INSERT INTO public.game_daily_rewards(user_id,reward_date,coins_awarded,xp_awarded)
    VALUES(p_user_id,today,coin_gain,xp_gain);

  RETURN jsonb_build_object(
    'claimed', true, 'rewardDate', today,
    'effects', jsonb_build_object('coins',coin_gain,'xp',xp_gain),
    'wallet', wallet,
    'pigeon', to_jsonb(rewarded) || jsonb_build_object('species',
      (SELECT to_jsonb(s) FROM public.game_species s WHERE s.id=rewarded.species_id)));
END;
$$;

REVOKE ALL ON FUNCTION public.pigeon_utc_date(timestamptz), public.pigeon_daily_reward(text),
  public.add_pigeon_coins(uuid,integer), public.claim_game_daily_reward(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pigeon_utc_date(timestamptz), public.pigeon_daily_reward(text),
  public.add_pigeon_coins(uuid,integer), public.claim_game_daily_reward(uuid)
  TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
