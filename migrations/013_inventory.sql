-- Phase 15. Apply once after 012_daily_reward.sql.
BEGIN;

CREATE TABLE public.game_items (
  id text PRIMARY KEY CHECK (id ~ '^[a-z][a-z0-9_]{0,63}$'),
  name text NOT NULL CHECK (name=btrim(name) AND char_length(name) BETWEEN 1 AND 80),
  type text NOT NULL CHECK (type IN ('food','toy','care','decoration')),
  description text NOT NULL CHECK (description=btrim(description) AND char_length(description) BETWEEN 1 AND 240),
  price integer NOT NULL CHECK (price >= 0),
  hunger_effect integer NOT NULL DEFAULT 0 CHECK (hunger_effect BETWEEN -100 AND 100),
  happiness_effect integer NOT NULL DEFAULT 0 CHECK (happiness_effect BETWEEN -100 AND 100),
  energy_effect integer NOT NULL DEFAULT 0 CHECK (energy_effect BETWEEN -100 AND 100),
  cleanliness_effect integer NOT NULL DEFAULT 0 CHECK (cleanliness_effect BETWEEN -100 AND 100),
  image text NOT NULL CHECK (image ~ '^/assets/items/[a-z0-9_-]+\.svg$')
);

CREATE TABLE public.game_user_items (
  user_id uuid NOT NULL REFERENCES public.game_users(id) ON DELETE CASCADE,
  item_id text NOT NULL REFERENCES public.game_items(id) ON DELETE RESTRICT,
  quantity integer NOT NULL CHECK (quantity > 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(updated_at)),
  PRIMARY KEY (user_id,item_id)
);

INSERT INTO public.game_items(id,name,type,description,price,hunger_effect,happiness_effect,energy_effect,cleanliness_effect,image) VALUES
  ('crumbs','Crumbs','food','A few familiar favourites for a hungry city pigeon.',10,15,2,0,0,'/assets/items/crumbs.svg'),
  ('corn','Corn','food','Golden kernels with a little more filling power.',25,22,3,0,0,'/assets/items/corn.svg'),
  ('sunflower_seeds','Sunflower Seeds','food','A special seed mix that makes feeding time extra cheerful.',50,18,8,2,0,'/assets/items/sunflower-seeds.svg'),
  ('peas','Peas','food','Fresh green bites with a balanced boost.',35,20,5,3,0,'/assets/items/peas.svg');

ALTER TABLE public.game_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_user_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.game_items,public.game_user_items FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.game_items TO anon,authenticated;
GRANT SELECT ON public.game_user_items TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.game_items,public.game_user_items TO service_role;
CREATE POLICY game_items_read ON public.game_items FOR SELECT TO anon,authenticated USING (true);
CREATE POLICY user_items_read_own ON public.game_user_items FOR SELECT TO authenticated
  USING ((SELECT auth.uid())=user_id);

CREATE FUNCTION public.get_game_inventory(p_user_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(i) || jsonb_build_object('quantity',COALESCE(ui.quantity,0))
    ORDER BY i.price,i.name),'[]'::jsonb)
  FROM public.game_items i
  LEFT JOIN public.game_user_items ui ON ui.item_id=i.id AND ui.user_id=p_user_id
  WHERE EXISTS (SELECT 1 FROM public.game_users u WHERE u.id=p_user_id);
$$;
REVOKE ALL ON FUNCTION public.get_game_inventory(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_game_inventory(uuid) TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
