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

CREATE FUNCTION public.battle_game_pigeon(p_user_id uuid,p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE
  saved public.game_pigeons%ROWTYPE;
  current_state public.game_pigeons%ROWTYPE;
  opponent public.game_species%ROWTYPE;
  receipt jsonb;
  result jsonb;
  action_time timestamptz;
  battle_roll integer;
  difficulty integer;
  opponent_level integer;
  player_power numeric;
  opponent_power numeric;
  xp_gain integer;
  won boolean;
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'Invalid battle request' USING ERRCODE='22023';
  END IF;
  SELECT * INTO saved FROM public.game_pigeons WHERE user_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','NO_PIGEON'); END IF;
  SELECT r.result INTO receipt FROM public.game_battle_receipts r
    WHERE r.user_id=p_user_id AND r.request_id=p_request_id;
  IF FOUND THEN
    RETURN receipt || jsonb_build_object('pigeon',public.refresh_game_pigeon(p_user_id),'replayed',true);
  END IF;
  -- Pick one of the other starter breeds from the request ID. The client cannot
  -- choose an easier opponent or submit its own outcome.
  SELECT * INTO opponent FROM public.game_species
    WHERE is_starter=true AND id<>saved.species_id
    ORDER BY md5(id||p_request_id::text) LIMIT 1;
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
  battle_roll:=mod(abs(hashtext(p_request_id::text||':battle')::bigint),100)::integer;
  difficulty:=least(85,45+floor(current_state.level*1.5)::integer);
  opponent_level:=current_state.level+greatest(1,floor(current_state.level/5.0)::integer);
  won:=battle_roll>=difficulty;
  xp_gain:=CASE WHEN won THEN 15+current_state.level*3 ELSE 0 END;
  player_power:=battle_roll;
  opponent_power:=difficulty;
  current_state.energy:=current_state.energy-10;
  current_state:=public.add_pigeon_xp(current_state,xp_gain);
  UPDATE public.game_pigeons SET hunger=current_state.hunger,happiness=current_state.happiness,
    energy=current_state.energy,cleanliness=current_state.cleanliness,xp=current_state.xp,
    level=current_state.level,growth_stage=current_state.growth_stage,last_updated=current_state.last_updated,
    last_battled_at=action_time,version=saved.version+1 WHERE id=saved.id RETURNING * INTO current_state;
  result:=jsonb_build_object('won',won,'replayed',false,'opponent',to_jsonb(opponent),
    'opponentLevel',opponent_level,'playerPower',player_power,'opponentPower',opponent_power,
    'winChance',100-difficulty,
    'effects',jsonb_build_object('energy',-10,'xp',xp_gain),
    'pigeon',to_jsonb(current_state)||jsonb_build_object('species',(SELECT to_jsonb(s) FROM public.game_species s WHERE s.id=current_state.species_id)));
  INSERT INTO public.game_battle_receipts(user_id,request_id,pigeon_id,opponent_species_id,result)
    VALUES(p_user_id,p_request_id,saved.id,opponent.id,result);
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.battle_game_pigeon(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.battle_game_pigeon(uuid,uuid) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
