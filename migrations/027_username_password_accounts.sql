-- Phase 35. Resolve Supabase Auth identities by the unique game username.
-- Apply once after 026_more_permanent_achievements.sql.
BEGIN;

CREATE FUNCTION public.find_game_user_by_username(p_username text)
RETURNS TABLE(id uuid,username text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT u.id,u.username FROM public.game_users u
  WHERE lower(u.username)=lower(p_username)
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.find_game_user_by_username(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.find_game_user_by_username(text) TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
