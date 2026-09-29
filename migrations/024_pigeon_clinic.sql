-- Phase 31. A server-authoritative clinic visit restores a pigeon's Health.
-- Apply once after 023_pigeon_packs.sql.
BEGIN;

CREATE TABLE public.game_clinic_receipts (
  user_id uuid NOT NULL REFERENCES public.game_users(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  pigeon_id uuid NOT NULL REFERENCES public.game_pigeons(id) ON DELETE CASCADE,
  price_paid integer NOT NULL CHECK (price_paid=100),
  treated_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(treated_at)),
  result jsonb NOT NULL CHECK (jsonb_typeof(result)='object'),
  PRIMARY KEY(user_id,request_id)
);
ALTER TABLE public.game_clinic_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.game_clinic_receipts FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.game_clinic_receipts TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.game_clinic_receipts TO service_role;
CREATE POLICY clinic_receipts_read_own ON public.game_clinic_receipts
  FOR SELECT TO authenticated USING ((SELECT auth.uid())=user_id);

CREATE FUNCTION public.treat_game_pigeon(p_user_id uuid,p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE
  saved public.game_pigeons%ROWTYPE;
  current_state public.game_pigeons%ROWTYPE;
  profile public.game_users%ROWTYPE;
  receipt jsonb;
  output jsonb;
  wallet jsonb;
  action_time timestamptz;
  health_gain numeric;
  price integer:=100;
BEGIN
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'Invalid clinic request' USING ERRCODE='22023'; END IF;
  SELECT * INTO saved FROM public.game_pigeons WHERE user_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','NO_PIGEON'); END IF;
  SELECT r.result INTO receipt FROM public.game_clinic_receipts r
    WHERE r.user_id=p_user_id AND r.request_id=p_request_id;
  IF FOUND THEN
    RETURN receipt||jsonb_build_object('replayed',true,'effects',jsonb_build_object('health',0,'coins',0),
      'wallet',public.get_pigeon_wallet(p_user_id),'pigeon',public.refresh_game_pigeon(p_user_id));
  END IF;
  action_time:=greatest(clock_timestamp(),saved.last_updated);
  current_state:=public.calculate_current_pigeon_state(saved,action_time);
  IF current_state.health>=100 THEN
    RETURN jsonb_build_object('error','HEALTH_FULL','pigeon',to_jsonb(current_state)||jsonb_build_object('species',
      (SELECT to_jsonb(s) FROM public.game_species s WHERE s.id=current_state.species_id)));
  END IF;
  SELECT * INTO profile FROM public.game_users WHERE id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','PROFILE_REQUIRED'); END IF;
  IF profile.coins<price THEN
    RETURN jsonb_build_object('error','NOT_ENOUGH_COINS','missing',price-profile.coins,
      'wallet',public.get_pigeon_wallet(p_user_id));
  END IF;
  health_gain:=100-current_state.health;
  UPDATE public.game_users SET coins=coins-price,coins_version=coins_version+1 WHERE id=p_user_id
    RETURNING jsonb_build_object('coins',coins,'version',coins_version) INTO wallet;
  UPDATE public.game_pigeons SET health=100,hunger=current_state.hunger,happiness=current_state.happiness,
    energy=current_state.energy,cleanliness=current_state.cleanliness,last_updated=current_state.last_updated,
    version=saved.version+1 WHERE id=saved.id RETURNING * INTO current_state;
  output:=jsonb_build_object('treated',true,'replayed',false,'price',price,
    'effects',jsonb_build_object('health',health_gain,'coins',-price),'wallet',wallet,
    'pigeon',to_jsonb(current_state)||jsonb_build_object('species',
      (SELECT to_jsonb(s) FROM public.game_species s WHERE s.id=current_state.species_id)));
  INSERT INTO public.game_clinic_receipts(user_id,request_id,pigeon_id,price_paid,result)
    VALUES(p_user_id,p_request_id,saved.id,price,output);
  RETURN output;
END;
$$;
REVOKE ALL ON FUNCTION public.treat_game_pigeon(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.treat_game_pigeon(uuid,uuid) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
