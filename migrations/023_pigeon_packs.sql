-- Phase 30. Daily and weekly PigeonDex packs with atomic spending and duplicate refunds.
-- Apply once after 022_level_scaled_battle_damage.sql.
BEGIN;

CREATE TABLE public.game_pigeon_pack_receipts (
  user_id uuid NOT NULL REFERENCES public.game_users(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  pack_type text NOT NULL CHECK (pack_type IN ('normal','big')),
  period_start date NOT NULL,
  purchased_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(purchased_at)),
  result jsonb NOT NULL,
  PRIMARY KEY (user_id,request_id),
  UNIQUE (user_id,pack_type,period_start)
);
ALTER TABLE public.game_pigeon_pack_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.game_pigeon_pack_receipts FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.game_pigeon_pack_receipts TO service_role;
GRANT SELECT ON public.game_pigeon_pack_receipts TO authenticated;
CREATE POLICY pigeon_pack_receipts_read_own ON public.game_pigeon_pack_receipts
  FOR SELECT TO authenticated USING ((SELECT auth.uid())=user_id);

CREATE FUNCTION public.pigeon_pack_price(p_pack_type text) RETURNS integer
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT CASE p_pack_type WHEN 'normal' THEN 300 WHEN 'big' THEN 900 END;
$$;
CREATE FUNCTION public.pigeon_pack_size(p_pack_type text) RETURNS integer
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT CASE p_pack_type WHEN 'normal' THEN 2 WHEN 'big' THEN 5 END;
$$;
CREATE FUNCTION public.pigeon_pack_duplicate_refund() RETURNS integer
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$ SELECT 50; $$;

CREATE FUNCTION public.get_pigeon_pack_status(p_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE
  utc_now timestamp := timezone('UTC',clock_timestamp());
  daily_start date := utc_now::date;
  weekly_start date := date_trunc('week',utc_now)::date;
  daily_used boolean;
  weekly_used boolean;
  wallet jsonb;
BEGIN
  wallet:=public.get_pigeon_wallet(p_user_id);
  IF wallet IS NULL THEN RETURN jsonb_build_object('error','PROFILE_REQUIRED'); END IF;
  SELECT EXISTS(SELECT 1 FROM public.game_pigeon_pack_receipts
    WHERE user_id=p_user_id AND pack_type='normal' AND period_start=daily_start) INTO daily_used;
  SELECT EXISTS(SELECT 1 FROM public.game_pigeon_pack_receipts
    WHERE user_id=p_user_id AND pack_type='big' AND period_start=weekly_start) INTO weekly_used;
  RETURN jsonb_build_object('wallet',wallet,'packs',jsonb_build_array(
    jsonb_build_object('id','normal','name','Normal Pack','size',2,'price',300,
      'duplicateRefund',50,'available',NOT daily_used,'limit','daily',
      'nextAvailableAt',((daily_start+1)::timestamp AT TIME ZONE 'UTC')),
    jsonb_build_object('id','big','name','Big Pack','size',5,'price',900,
      'duplicateRefund',50,'available',NOT weekly_used,'limit','weekly',
      'nextAvailableAt',((weekly_start+7)::timestamp AT TIME ZONE 'UTC'))));
END;
$$;

CREATE FUNCTION public.buy_pigeon_pack(p_user_id uuid,p_request_id uuid,p_pack_type text,p_species_ids text[])
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE
  profile public.game_users%ROWTYPE;
  receipt jsonb;
  output jsonb;
  items jsonb := '[]'::jsonb;
  species_id text;
  inserted integer;
  new_discovery boolean;
  price integer := public.pigeon_pack_price(p_pack_type);
  expected_size integer := public.pigeon_pack_size(p_pack_type);
  refund_each integer := public.pigeon_pack_duplicate_refund();
  refund_total integer := 0;
  utc_now timestamp := timezone('UTC',clock_timestamp());
  purchase_period date;
  next_available timestamptz;
  wallet jsonb;
BEGIN
  IF p_request_id IS NULL OR price IS NULL OR expected_size IS NULL
    OR cardinality(p_species_ids) IS DISTINCT FROM expected_size
    OR (SELECT count(DISTINCT value) FROM unnest(p_species_ids) value) IS DISTINCT FROM expected_size
    OR EXISTS(SELECT 1 FROM unnest(p_species_ids) value WHERE length(btrim(value)) NOT BETWEEN 1 AND 200) THEN
    RAISE EXCEPTION 'Invalid pigeon pack request' USING ERRCODE='22023';
  END IF;
  IF p_pack_type='normal' THEN
    purchase_period:=utc_now::date;
    next_available:=((purchase_period+1)::timestamp AT TIME ZONE 'UTC');
  ELSE
    purchase_period:=date_trunc('week',utc_now)::date;
    next_available:=((purchase_period+7)::timestamp AT TIME ZONE 'UTC');
  END IF;

  SELECT * INTO profile FROM public.game_users WHERE id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','PROFILE_REQUIRED'); END IF;
  SELECT r.result INTO receipt FROM public.game_pigeon_pack_receipts r
    WHERE r.user_id=p_user_id AND r.request_id=p_request_id;
  IF FOUND THEN
    RETURN receipt||jsonb_build_object('wallet',public.get_pigeon_wallet(p_user_id),'replayed',true);
  END IF;
  IF EXISTS(SELECT 1 FROM public.game_pigeon_pack_receipts
    WHERE user_id=p_user_id AND pack_type=p_pack_type AND period_start=purchase_period) THEN
    RETURN jsonb_build_object('error','PACK_LIMIT','nextAvailableAt',next_available,
      'wallet',public.get_pigeon_wallet(p_user_id));
  END IF;
  IF profile.coins<price THEN
    RETURN jsonb_build_object('error','NOT_ENOUGH_COINS','missing',price-profile.coins,
      'wallet',public.get_pigeon_wallet(p_user_id));
  END IF;

  FOREACH species_id IN ARRAY p_species_ids LOOP
    INSERT INTO public.game_pigeon_discoveries(user_id,species_id)
      VALUES(p_user_id,species_id) ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS inserted=ROW_COUNT;
    new_discovery:=inserted=1;
    IF NOT new_discovery THEN refund_total:=refund_total+refund_each; END IF;
    items:=items||jsonb_build_array(jsonb_build_object('speciesId',species_id,
      'isNew',new_discovery,'refund',CASE WHEN new_discovery THEN 0 ELSE refund_each END));
  END LOOP;
  UPDATE public.game_users SET coins=coins-price+refund_total,coins_version=coins_version+1
    WHERE id=p_user_id
    RETURNING jsonb_build_object('coins',coins,'version',coins_version) INTO wallet;
  output:=jsonb_build_object('purchased',true,'replayed',false,'packType',p_pack_type,
    'price',price,'duplicateRefund',refund_total,'pigeons',items,'wallet',wallet,
    'nextAvailableAt',next_available);
  INSERT INTO public.game_pigeon_pack_receipts(user_id,request_id,pack_type,period_start,result)
    VALUES(p_user_id,p_request_id,p_pack_type,purchase_period,output);
  RETURN output;
END;
$$;

REVOKE ALL ON FUNCTION public.pigeon_pack_price(text),public.pigeon_pack_size(text),
  public.pigeon_pack_duplicate_refund(),public.get_pigeon_pack_status(uuid),
  public.buy_pigeon_pack(uuid,uuid,text,text[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pigeon_pack_price(text),public.pigeon_pack_size(text),
  public.pigeon_pack_duplicate_refund(),public.get_pigeon_pack_status(uuid),
  public.buy_pigeon_pack(uuid,uuid,text,text[]) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
