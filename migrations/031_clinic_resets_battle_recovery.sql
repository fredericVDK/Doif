-- Phase 39. A successful clinic visit makes the treated pigeon battle-ready.
-- Apply once after 030_five_action_daily_quests.sql.
BEGIN;

CREATE FUNCTION public.reset_game_battle_recovery_after_clinic()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
BEGIN
  UPDATE public.game_pigeons
  SET injured_until=NULL,last_battled_at=NULL
  WHERE id=NEW.pigeon_id AND user_id=NEW.user_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER reset_battle_recovery_after_clinic
AFTER INSERT ON public.game_clinic_receipts
FOR EACH ROW EXECUTE FUNCTION public.reset_game_battle_recovery_after_clinic();

REVOKE ALL ON FUNCTION public.reset_game_battle_recovery_after_clinic() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reset_game_battle_recovery_after_clinic() TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
