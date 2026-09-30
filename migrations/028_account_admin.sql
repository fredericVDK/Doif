-- Phase 36. Server-authorized account administration and audited coin grants.
-- Apply once after 027_username_password_accounts.sql.
BEGIN;

CREATE TABLE public.game_admins (
  user_id uuid PRIMARY KEY REFERENCES public.game_users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(created_at))
);
ALTER TABLE public.game_admins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.game_admins FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.game_admins TO service_role;

CREATE TABLE public.game_admin_coin_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid NOT NULL REFERENCES public.game_admins(user_id) ON DELETE RESTRICT,
  target_user_id uuid NOT NULL REFERENCES public.game_users(id) ON DELETE CASCADE,
  amount integer NOT NULL CHECK (amount BETWEEN 1 AND 100000),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(created_at))
);
ALTER TABLE public.game_admin_coin_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.game_admin_coin_grants FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.game_admin_coin_grants TO service_role;

-- Promote the requested account when it already exists at migration time.
INSERT INTO public.game_admins(user_id)
SELECT id FROM public.game_users WHERE lower(username)='fredadmin'
ON CONFLICT(user_id) DO NOTHING;

CREATE FUNCTION public.claim_initial_game_admin(p_user_id uuid) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('pigeon-crumbs-initial-admin'));
  IF EXISTS(SELECT 1 FROM public.game_admins WHERE user_id=p_user_id) THEN RETURN true; END IF;
  IF EXISTS(SELECT 1 FROM public.game_admins) THEN RETURN false; END IF;
  INSERT INTO public.game_admins(user_id)
  SELECT id FROM public.game_users WHERE id=p_user_id AND lower(username)='fredadmin'
  ON CONFLICT(user_id) DO NOTHING;
  RETURN EXISTS(SELECT 1 FROM public.game_admins WHERE user_id=p_user_id);
END;
$$;

CREATE FUNCTION public.is_game_admin(p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT EXISTS(SELECT 1 FROM public.game_admins WHERE user_id=p_user_id);
$$;

CREATE FUNCTION public.get_game_admin_accounts(p_admin_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE output jsonb;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.game_admins WHERE user_id=p_admin_user_id) THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE='42501';
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'username',u.username,'coins',u.coins,'createdAt',u.created_at,
    'isAdmin',a.user_id IS NOT NULL,'discoveries',(SELECT count(*) FROM public.game_pigeon_discoveries d WHERE d.user_id=u.id),
    'pigeon',CASE WHEN p.id IS NULL THEN NULL ELSE jsonb_build_object(
      'nickname',p.nickname,'level',p.level,'breed',s.name) END
  ) ORDER BY lower(u.username)),'[]'::jsonb) INTO output
  FROM public.game_users u
  LEFT JOIN public.game_admins a ON a.user_id=u.id
  LEFT JOIN public.game_pigeons p ON p.user_id=u.id
  LEFT JOIN public.game_species s ON s.id=p.species_id;
  RETURN jsonb_build_object('accounts',output,'count',jsonb_array_length(output));
END;
$$;

CREATE FUNCTION public.grant_game_admin_coins(p_admin_user_id uuid,p_target_username text,p_amount integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE target public.game_users%ROWTYPE;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.game_admins WHERE user_id=p_admin_user_id) THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE='42501';
  END IF;
  IF p_amount IS NULL OR p_amount NOT BETWEEN 1 AND 100000 THEN
    RAISE EXCEPTION 'Invalid coin amount' USING ERRCODE='22023';
  END IF;
  SELECT * INTO target FROM public.game_users WHERE lower(username)=lower(p_target_username) FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','ACCOUNT_NOT_FOUND'); END IF;
  IF target.coins>2147483647-p_amount THEN RAISE EXCEPTION 'Coin balance overflow' USING ERRCODE='22003'; END IF;
  UPDATE public.game_users SET coins=coins+p_amount,coins_version=coins_version+1
    WHERE id=target.id RETURNING * INTO target;
  INSERT INTO public.game_admin_coin_grants(admin_user_id,target_user_id,amount)
    VALUES(p_admin_user_id,target.id,p_amount);
  RETURN jsonb_build_object('username',target.username,'coins',target.coins,
    'version',target.coins_version,'granted',p_amount);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_initial_game_admin(uuid),public.is_game_admin(uuid),
  public.get_game_admin_accounts(uuid),public.grant_game_admin_coins(uuid,text,integer)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_initial_game_admin(uuid),public.is_game_admin(uuid),
  public.get_game_admin_accounts(uuid),public.grant_game_admin_coins(uuid,text,integer)
  TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
