-- Phase 43. Make switching the active team pigeon atomic.
-- Apply once after 034_game_hub_deck_and_community.sql.
BEGIN;

CREATE OR REPLACE FUNCTION public.set_game_home_pigeon(p_user_id uuid,p_pigeon_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE chosen public.game_pigeons%ROWTYPE;
BEGIN
  -- Serialize team selection per account, then clear the old partial-unique row
  -- before enabling the new one.
  PERFORM 1 FROM public.game_users WHERE id=p_user_id FOR UPDATE;
  SELECT * INTO chosen FROM public.game_pigeons WHERE id=p_pigeon_id AND user_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','PIGEON_NOT_OWNED'); END IF;
  UPDATE public.game_pigeons SET is_home=false WHERE user_id=p_user_id AND is_home AND id<>p_pigeon_id;
  UPDATE public.game_pigeons SET is_home=true WHERE id=p_pigeon_id RETURNING * INTO chosen;
  RETURN jsonb_build_object('selected',true,'pigeon',public.team_pigeon_json(chosen));
END;
$$;

REVOKE ALL ON FUNCTION public.set_game_home_pigeon(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_game_home_pigeon(uuid,uuid) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
