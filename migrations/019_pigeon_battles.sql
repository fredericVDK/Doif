-- Phase 29. Server-authoritative pigeon battles with XP rewards.
-- Apply once after 018_inventory_feeding.sql.
BEGIN;

ALTER TABLE public.game_pigeons ADD COLUMN last_battled_at timestamptz
  CHECK (last_battled_at IS NULL OR isfinite(last_battled_at));

CREATE TABLE public.game_battle_receipts (
  user_id uuid NOT NULL REFERENCES public.game_users(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  pigeon_id uuid NOT NULL REFERENCES public.game_pigeons(id) ON DELETE CASCADE,
  opponent_species_id text NOT NULL REFERENCES public.game_species(id) ON DELETE RESTRICT,
  result jsonb NOT NULL CHECK (jsonb_typeof(result)='object'),
  battled_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(battled_at)),
  PRIMARY KEY(user_id,request_id)
);
ALTER TABLE public.game_battle_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.game_battle_receipts FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.game_battle_receipts TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.game_battle_receipts TO service_role;
CREATE POLICY battle_receipts_read_own ON public.game_battle_receipts
  FOR SELECT TO authenticated USING ((SELECT auth.uid())=user_id);

CREATE FUNCTION public.battle_game_pigeon(p_user_id uuid,p_request_id uuid,p_opponent_species_id text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE
  saved public.game_pigeons%ROWTYPE;
  current_state public.game_pigeons%ROWTYPE;
  opponent public.game_species%ROWTYPE;
  receipt jsonb;
  result jsonb;
  action_time timestamptz;
  player_roll integer;
  opponent_roll integer;
  opponent_level integer;
  player_power numeric;
  opponent_power numeric;
  xp_gain integer;
  won boolean;
BEGIN
  IF p_request_id IS NULL OR p_opponent_species_id IS NULL THEN
    RAISE EXCEPTION 'Invalid battle request' USING ERRCODE='22023';
  END IF;
  SELECT * INTO saved FROM public.game_pigeons WHERE user_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','NO_PIGEON'); END IF;
  SELECT r.result INTO receipt FROM public.game_battle_receipts r
    WHERE r.user_id=p_user_id AND r.request_id=p_request_id;
  IF FOUND THEN
    RETURN receipt || jsonb_build_object('pigeon',public.refresh_game_pigeon(p_user_id),'replayed',true);
  END IF;
  SELECT * INTO opponent FROM public.game_species
    WHERE id=p_opponent_species_id AND is_starter=true AND id<>saved.species_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','OPPONENT_UNAVAILABLE'); END IF;
  action_time:=greatest(clock_timestamp(),saved.last_updated);
  IF saved.last_battled_at IS NOT NULL AND action_time<saved.last_battled_at+interval '30 seconds' THEN
    RETURN jsonb_build_object('error','BATTLE_COOLDOWN','retryAfter',
      ceil(extract(epoch FROM (saved.last_battled_at+interval '30 seconds'-action_time))));
  END IF;
  current_state:=public.calculate_current_pigeon_state(saved,action_time);
  IF current_state.energy<10 THEN
    UPDATE public.game_pigeons SET hunger=current_state.hunger,happiness=current_state.happiness,
      energy=current_state.energy,cleanliness=current_state.cleanliness,last_updated=current_state.last_updated,
      version=saved.version+1 WHERE id=saved.id;
    RETURN jsonb_build_object('error','BATTLE_TIRED','pigeon',to_jsonb(current_state));
  END IF;
  player_roll:=mod(abs(hashtext(p_request_id::text||':player')::bigint),21)::integer;
  opponent_roll:=mod(abs(hashtext(p_request_id::text||':opponent')::bigint),21)::integer;
  opponent_level:=greatest(1,current_state.level+(mod(abs(hashtext(opponent.id)::bigint),3)::integer-1));
  player_power:=current_state.level*8+current_state.health/10+current_state.happiness/20+current_state.energy/20+player_roll;
  opponent_power:=opponent_level*8+(CASE opponent.rarity WHEN 'legendary' THEN 18 WHEN 'epic' THEN 14 WHEN 'rare' THEN 10 WHEN 'uncommon' THEN 6 ELSE 3 END)+opponent_roll;
  won:=player_power>=opponent_power;
  xp_gain:=CASE WHEN won THEN 18 ELSE 8 END;
  current_state.energy:=current_state.energy-10;
  current_state:=public.add_pigeon_xp(current_state,xp_gain);
  UPDATE public.game_pigeons SET hunger=current_state.hunger,happiness=current_state.happiness,
    energy=current_state.energy,cleanliness=current_state.cleanliness,xp=current_state.xp,
    level=current_state.level,growth_stage=current_state.growth_stage,last_updated=current_state.last_updated,
    last_battled_at=action_time,version=saved.version+1 WHERE id=saved.id RETURNING * INTO current_state;
  result:=jsonb_build_object('won',won,'replayed',false,'opponent',to_jsonb(opponent),
    'opponentLevel',opponent_level,'playerPower',round(player_power,1),'opponentPower',round(opponent_power,1),
    'effects',jsonb_build_object('energy',-10,'xp',xp_gain),
    'pigeon',to_jsonb(current_state)||jsonb_build_object('species',(SELECT to_jsonb(s) FROM public.game_species s WHERE s.id=current_state.species_id)));
  INSERT INTO public.game_battle_receipts(user_id,request_id,pigeon_id,opponent_species_id,result)
    VALUES(p_user_id,p_request_id,saved.id,opponent.id,result);
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.battle_game_pigeon(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.battle_game_pigeon(uuid,uuid,text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
