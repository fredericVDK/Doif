-- Phase 16. Apply once after 013_inventory.sql.
BEGIN;

CREATE TABLE public.game_shop_purchase_receipts (
  user_id uuid NOT NULL REFERENCES public.game_users(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  item_id text NOT NULL REFERENCES public.game_items(id) ON DELETE RESTRICT,
  price_paid integer NOT NULL CHECK (price_paid >= 0),
  purchased_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(purchased_at)),
  result jsonb NOT NULL CHECK (jsonb_typeof(result)='object'),
  PRIMARY KEY (user_id,request_id)
);
ALTER TABLE public.game_shop_purchase_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.game_shop_purchase_receipts FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.game_shop_purchase_receipts TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.game_shop_purchase_receipts TO service_role;
CREATE POLICY shop_receipts_read_own ON public.game_shop_purchase_receipts
  FOR SELECT TO authenticated USING ((SELECT auth.uid())=user_id);

CREATE FUNCTION public.buy_game_item(p_user_id uuid,p_request_id uuid,p_item_id text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE
  profile public.game_users%ROWTYPE;
  product public.game_items%ROWTYPE;
  saved jsonb;
  wallet jsonb;
  item_result jsonb;
  owned integer;
BEGIN
  IF p_request_id IS NULL OR p_item_id IS NULL OR p_item_id !~ '^[a-z][a-z0-9_]{0,63}$' THEN
    RAISE EXCEPTION 'Invalid shop request' USING ERRCODE='22023';
  END IF;

  -- Serialize every balance change for this account and make retries idempotent.
  SELECT * INTO profile FROM public.game_users WHERE id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','PROFILE_REQUIRED'); END IF;
  SELECT r.result INTO saved FROM public.game_shop_purchase_receipts r
    WHERE r.user_id=p_user_id AND r.request_id=p_request_id;
  IF FOUND THEN
    SELECT * INTO product FROM public.game_items WHERE id=saved->>'itemId';
    SELECT quantity INTO owned FROM public.game_user_items
      WHERE user_id=p_user_id AND item_id=product.id;
    RETURN saved || jsonb_build_object('replayed',true,'effects',jsonb_build_object('coins',0),
      'wallet',public.get_pigeon_wallet(p_user_id),
      'item',to_jsonb(product)||jsonb_build_object('quantity',owned));
  END IF;

  SELECT * INTO product FROM public.game_items WHERE id=p_item_id FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','ITEM_UNAVAILABLE'); END IF;
  IF profile.coins < product.price THEN
    RETURN jsonb_build_object('error','NOT_ENOUGH_COINS','price',product.price,'balance',profile.coins,
      'missing',product.price-profile.coins);
  END IF;

  UPDATE public.game_users SET coins=coins-product.price,coins_version=coins_version+1
    WHERE id=p_user_id
    RETURNING jsonb_build_object('coins',coins,'version',coins_version) INTO wallet;
  INSERT INTO public.game_user_items(user_id,item_id,quantity)
    VALUES(p_user_id,product.id,1)
    ON CONFLICT(user_id,item_id) DO UPDATE SET quantity=public.game_user_items.quantity+1,
      updated_at=clock_timestamp()
    RETURNING quantity INTO owned;
  item_result:=to_jsonb(product)||jsonb_build_object('quantity',owned);
  saved:=jsonb_build_object('purchased',true,'replayed',false,'itemId',product.id,
    'item',item_result,'wallet',wallet,'effects',jsonb_build_object('coins',-product.price));
  INSERT INTO public.game_shop_purchase_receipts(user_id,request_id,item_id,price_paid,result)
    VALUES(p_user_id,p_request_id,product.id,product.price,saved);
  RETURN saved;
END;
$$;
REVOKE ALL ON FUNCTION public.buy_game_item(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.buy_game_item(uuid,uuid,text) TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
