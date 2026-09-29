-- Phase 20. Apply once after 016_achievements.sql.
BEGIN;

CREATE TABLE public.game_crumb_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.game_users(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(started_at)),
  duration_seconds integer NOT NULL DEFAULT 30 CHECK (duration_seconds=30),
  schedule jsonb NOT NULL CHECK (jsonb_typeof(schedule)='array' AND jsonb_array_length(schedule)=40),
  completed_at timestamptz CHECK (completed_at IS NULL OR isfinite(completed_at)),
  score integer CHECK (score BETWEEN 0 AND 40),
  coins_awarded integer CHECK (coins_awarded BETWEEN 0 AND 30),
  xp_awarded integer CHECK (xp_awarded BETWEEN 0 AND 40),
  result jsonb CHECK (result IS NULL OR jsonb_typeof(result)='object'),
  UNIQUE(user_id,request_id),
  CHECK ((completed_at IS NULL AND score IS NULL AND coins_awarded IS NULL AND xp_awarded IS NULL AND result IS NULL)
    OR (completed_at IS NOT NULL AND score IS NOT NULL AND coins_awarded IS NOT NULL AND xp_awarded IS NOT NULL AND result IS NOT NULL))
);
CREATE UNIQUE INDEX one_active_crumb_run_per_user ON public.game_crumb_runs(user_id) WHERE completed_at IS NULL;
ALTER TABLE public.game_crumb_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.game_crumb_runs FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.game_crumb_runs TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.game_crumb_runs TO service_role;
CREATE POLICY crumb_runs_read_own ON public.game_crumb_runs
  FOR SELECT TO authenticated USING ((SELECT auth.uid())=user_id);

CREATE FUNCTION public.crumb_game_schedule(p_seed uuid) RETURNS jsonb
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT jsonb_agg(jsonb_build_object(
    'id',i,
    'x',5+(get_byte(decode(md5(p_seed::text||':'||i::text),'hex'),0)%91),
    'catchAtMs',1500+i*700
  ) ORDER BY i)
  FROM generate_series(0,39) AS i;
$$;

CREATE FUNCTION public.crumb_game_coins(p_score integer) RETURNS integer
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT least(30,greatest(0,p_score));
$$;
CREATE FUNCTION public.crumb_game_xp(p_score integer) RETURNS integer
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT least(40,greatest(0,p_score*2));
$$;

CREATE FUNCTION public.start_crumb_game(p_user_id uuid,p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE run public.game_crumb_runs%ROWTYPE; seed uuid:=gen_random_uuid();
BEGIN
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'Invalid request' USING ERRCODE='22023'; END IF;
  PERFORM 1 FROM public.game_pigeons WHERE user_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','NO_PIGEON'); END IF;
  SELECT * INTO run FROM public.game_crumb_runs WHERE user_id=p_user_id AND request_id=p_request_id;
  IF NOT FOUND THEN
    SELECT * INTO run FROM public.game_crumb_runs WHERE user_id=p_user_id AND completed_at IS NULL FOR UPDATE;
    IF FOUND AND clock_timestamp()>run.started_at+interval '2 minutes' THEN
      DELETE FROM public.game_crumb_runs WHERE id=run.id; run:=NULL;
    END IF;
  END IF;
  IF run.id IS NULL THEN
    INSERT INTO public.game_crumb_runs(user_id,request_id,schedule)
      VALUES(p_user_id,p_request_id,public.crumb_game_schedule(seed)) RETURNING * INTO run;
  END IF;
  RETURN jsonb_build_object('runId',run.id,'startedAt',run.started_at,'serverNow',clock_timestamp(),
    'durationSeconds',run.duration_seconds,'schedule',run.schedule,'completed',run.completed_at IS NOT NULL);
END;
$$;

CREATE FUNCTION public.finish_crumb_game(p_user_id uuid,p_run_id uuid,p_caught integer[]) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE
  run public.game_crumb_runs%ROWTYPE;
  saved public.game_pigeons%ROWTYPE;
  rewarded public.game_pigeons%ROWTYPE;
  crumb jsonb;
  caught_id integer;
  caught_count integer;
  previous_x numeric:=50;
  previous_time integer:=0;
  current_x numeric;
  current_catch_time integer;
  coin_gain integer;
  xp_gain integer;
  wallet jsonb;
  output jsonb;
BEGIN
  IF p_run_id IS NULL OR p_caught IS NULL OR cardinality(p_caught)>40 THEN
    RAISE EXCEPTION 'Invalid finish request' USING ERRCODE='22023';
  END IF;
  SELECT * INTO saved FROM public.game_pigeons WHERE user_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','NO_PIGEON'); END IF;
  SELECT * INTO run FROM public.game_crumb_runs WHERE id=p_run_id AND user_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','RUN_NOT_FOUND'); END IF;
  IF run.completed_at IS NOT NULL THEN
    RETURN run.result||jsonb_build_object('replayed',true,'wallet',public.get_pigeon_wallet(p_user_id),
      'pigeon',to_jsonb(saved)||jsonb_build_object('species',
        (SELECT to_jsonb(s) FROM public.game_species s WHERE s.id=saved.species_id)));
  END IF;
  IF clock_timestamp()<run.started_at+(run.duration_seconds-1)*interval '1 second' THEN
    RETURN jsonb_build_object('error','RUN_IN_PROGRESS','retryAfter',ceil(extract(epoch FROM
      (run.started_at+(run.duration_seconds-1)*interval '1 second'-clock_timestamp()))));
  END IF;
  IF clock_timestamp()>run.started_at+interval '2 minutes' THEN
    RETURN jsonb_build_object('error','RUN_EXPIRED');
  END IF;
  IF cardinality(p_caught)<>(SELECT count(DISTINCT value) FROM unnest(p_caught) AS value) THEN
    RETURN jsonb_build_object('error','INVALID_SCORE');
  END IF;

  FOREACH caught_id IN ARRAY p_caught LOOP
    SELECT value INTO crumb FROM jsonb_array_elements(run.schedule) value WHERE (value->>'id')::integer=caught_id;
    IF crumb IS NULL THEN RETURN jsonb_build_object('error','INVALID_SCORE'); END IF;
    current_x:=(crumb->>'x')::numeric; current_catch_time:=(crumb->>'catchAtMs')::integer;
    IF current_catch_time<=previous_time OR abs(current_x-previous_x)>(current_catch_time-previous_time)*0.09+12 THEN
      RETURN jsonb_build_object('error','INVALID_SCORE');
    END IF;
    previous_x:=current_x; previous_time:=current_catch_time; crumb:=NULL;
  END LOOP;

  caught_count:=cardinality(p_caught);
  coin_gain:=public.crumb_game_coins(caught_count);
  xp_gain:=public.crumb_game_xp(caught_count);
  IF xp_gain>0 THEN
    rewarded:=public.add_pigeon_xp(saved,xp_gain);
    UPDATE public.game_pigeons SET xp=rewarded.xp,level=rewarded.level,version=saved.version+1
      WHERE id=saved.id RETURNING * INTO rewarded;
  ELSE rewarded:=saved; END IF;
  IF coin_gain>0 THEN wallet:=public.add_pigeon_coins(p_user_id,coin_gain);
  ELSE wallet:=public.get_pigeon_wallet(p_user_id); END IF;
  output:=jsonb_build_object('runId',run.id,'score',caught_count,'replayed',false,
    'effects',jsonb_build_object('coins',coin_gain,'xp',xp_gain),'wallet',wallet,
    'pigeon',to_jsonb(rewarded)||jsonb_build_object('species',
      (SELECT to_jsonb(s) FROM public.game_species s WHERE s.id=rewarded.species_id)));
  UPDATE public.game_crumb_runs SET completed_at=clock_timestamp(),score=caught_count,
    coins_awarded=coin_gain,xp_awarded=xp_gain,result=output WHERE id=run.id;
  RETURN output;
END;
$$;

REVOKE ALL ON FUNCTION public.crumb_game_schedule(uuid),public.crumb_game_coins(integer),
  public.crumb_game_xp(integer),public.start_crumb_game(uuid,uuid),
  public.finish_crumb_game(uuid,uuid,integer[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crumb_game_schedule(uuid),public.crumb_game_coins(integer),
  public.crumb_game_xp(integer),public.start_crumb_game(uuid,uuid),
  public.finish_crumb_game(uuid,uuid,integer[]) TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
