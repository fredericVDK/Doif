-- Phase 37. Battle depth, streaks, persistent PigeonDex favourites,
-- player profiles and admin economy reporting. Apply once after 028.
BEGIN;

ALTER TABLE public.game_pigeons ADD COLUMN injured_until timestamptz
  CHECK (injured_until IS NULL OR isfinite(injured_until));
ALTER TABLE public.game_users ADD COLUMN profile_public boolean NOT NULL DEFAULT true;

CREATE TABLE public.game_pigeon_favorites (
  user_id uuid NOT NULL REFERENCES public.game_users(id) ON DELETE CASCADE,
  species_id text NOT NULL CHECK (length(btrim(species_id)) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(created_at)),
  PRIMARY KEY(user_id,species_id),
  FOREIGN KEY(user_id,species_id) REFERENCES public.game_pigeon_discoveries(user_id,species_id) ON DELETE CASCADE
);
ALTER TABLE public.game_pigeon_favorites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.game_pigeon_favorites FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.game_pigeon_favorites TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.game_pigeon_favorites TO service_role;
CREATE POLICY pigeon_favorites_read_own ON public.game_pigeon_favorites
  FOR SELECT TO authenticated USING ((SELECT auth.uid())=user_id);

CREATE FUNCTION public.toggle_game_pigeon_favorite(p_user_id uuid,p_species_id text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE removed integer;
BEGIN
  IF p_species_id IS NULL OR length(btrim(p_species_id)) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'Invalid pigeon favourite' USING ERRCODE='22023';
  END IF;
  DELETE FROM public.game_pigeon_favorites WHERE user_id=p_user_id AND species_id=p_species_id;
  GET DIAGNOSTICS removed=ROW_COUNT;
  IF removed=0 THEN
    IF NOT EXISTS(SELECT 1 FROM public.game_pigeon_discoveries WHERE user_id=p_user_id AND species_id=p_species_id) THEN
      RETURN jsonb_build_object('error','UNDISCOVERED_PIGEON');
    END IF;
    INSERT INTO public.game_pigeon_favorites(user_id,species_id) VALUES(p_user_id,p_species_id);
    RETURN jsonb_build_object('speciesId',p_species_id,'favorite',true);
  END IF;
  RETURN jsonb_build_object('speciesId',p_species_id,'favorite',false);
END;
$$;

CREATE FUNCTION public.pigeon_battle_rank(p_wins integer) RETURNS text
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT CASE WHEN p_wins>=60 THEN 'Legend' WHEN p_wins>=30 THEN 'Champion'
    WHEN p_wins>=15 THEN 'Contender' WHEN p_wins>=5 THEN 'Scrapper' ELSE 'Rookie' END;
$$;

CREATE FUNCTION public.get_game_battle_stats(p_user_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  WITH record AS (
    SELECT count(*) FILTER(WHERE (result->>'won')::boolean)::integer wins,
      count(*) FILTER(WHERE NOT (result->>'won')::boolean)::integer losses
    FROM public.game_battle_receipts WHERE user_id=p_user_id
  ), pigeon AS (SELECT level,health,injured_until FROM public.game_pigeons WHERE user_id=p_user_id)
  SELECT jsonb_build_object('wins',r.wins,'losses',r.losses,'total',r.wins+r.losses,
    'rank',public.pigeon_battle_rank(r.wins),
    'nextRankWins',CASE WHEN r.wins<5 THEN 5 WHEN r.wins<15 THEN 15 WHEN r.wins<30 THEN 30 WHEN r.wins<60 THEN 60 ELSE NULL END,
    'attack',10+p.level*2,'defense',8+p.level,'speed',9+floor(p.level*1.5)::integer,
    'criticalChance',12,'injuredUntil',p.injured_until)
  FROM record r CROSS JOIN pigeon p;
$$;

CREATE OR REPLACE FUNCTION public.battle_game_pigeon(p_user_id uuid,p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE
  saved public.game_pigeons%ROWTYPE; current_state public.game_pigeons%ROWTYPE;
  opponent public.game_species%ROWTYPE; receipt jsonb; result jsonb; wallet jsonb;
  action_time timestamptz; injury_until timestamptz; battle_roll integer; critical_roll integer;
  difficulty integer; opponent_level integer; xp_gain integer; coin_gain integer; health_loss numeric;
  won boolean; critical boolean; wins integer; losses integer;
BEGIN
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'Invalid battle request' USING ERRCODE='22023'; END IF;
  SELECT * INTO saved FROM public.game_pigeons WHERE user_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','NO_PIGEON'); END IF;
  SELECT r.result INTO receipt FROM public.game_battle_receipts r WHERE r.user_id=p_user_id AND r.request_id=p_request_id;
  IF FOUND THEN RETURN receipt||jsonb_build_object('pigeon',public.refresh_game_pigeon(p_user_id),
    'wallet',public.get_pigeon_wallet(p_user_id),'battleStats',public.get_game_battle_stats(p_user_id),'replayed',true); END IF;
  SELECT * INTO opponent FROM public.game_species WHERE is_starter=true AND id<>saved.species_id
    ORDER BY md5(id||p_request_id::text) LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','OPPONENT_UNAVAILABLE'); END IF;
  action_time:=greatest(clock_timestamp(),saved.last_updated);
  IF saved.injured_until IS NOT NULL AND action_time<saved.injured_until THEN
    RETURN jsonb_build_object('error','BATTLE_INJURED','retryAfter',ceil(extract(epoch FROM (saved.injured_until-action_time))),
      'injuredUntil',saved.injured_until);
  END IF;
  IF saved.last_battled_at IS NOT NULL AND action_time<saved.last_battled_at+interval '30 seconds' THEN
    RETURN jsonb_build_object('error','BATTLE_COOLDOWN','retryAfter',ceil(extract(epoch FROM (saved.last_battled_at+interval '30 seconds'-action_time))));
  END IF;
  current_state:=public.calculate_current_pigeon_state(saved,action_time);
  IF current_state.energy<10 THEN
    UPDATE public.game_pigeons SET hunger=current_state.hunger,happiness=current_state.happiness,
      energy=current_state.energy,cleanliness=current_state.cleanliness,last_updated=current_state.last_updated,
      version=saved.version+1 WHERE id=saved.id;
    RETURN jsonb_build_object('error','BATTLE_TIRED','pigeon',to_jsonb(current_state));
  END IF;
  battle_roll:=mod(abs(hashtext(p_request_id::text||':battle')::bigint),100)::integer;
  critical_roll:=mod(abs(hashtext(p_request_id::text||':critical')::bigint),100)::integer;
  critical:=critical_roll<12;
  difficulty:=least(88,42+floor(current_state.level*1.4)::integer);
  opponent_level:=current_state.level+greatest(1,floor(current_state.level/4.0)::integer);
  won:=battle_roll+(CASE WHEN critical THEN 20 ELSE 0 END)>=difficulty;
  xp_gain:=CASE WHEN won THEN 18+current_state.level*4+(CASE WHEN critical THEN 10 ELSE 0 END) ELSE 0 END;
  coin_gain:=CASE WHEN won THEN 6+current_state.level ELSE 0 END;
  health_loss:=CASE WHEN won THEN 0 ELSE least(30,ceil(5+current_state.level*1.25),current_state.health) END;
  injury_until:=CASE WHEN won THEN NULL ELSE action_time+make_interval(mins=>least(20,2+current_state.level)) END;
  current_state.energy:=current_state.energy-10; current_state.health:=current_state.health-health_loss;
  current_state:=public.add_pigeon_xp(current_state,xp_gain);
  UPDATE public.game_pigeons SET health=current_state.health,hunger=current_state.hunger,happiness=current_state.happiness,
    energy=current_state.energy,cleanliness=current_state.cleanliness,xp=current_state.xp,level=current_state.level,
    growth_stage=current_state.growth_stage,last_updated=current_state.last_updated,last_battled_at=action_time,
    injured_until=injury_until,version=saved.version+1 WHERE id=saved.id RETURNING * INTO current_state;
  wallet:=CASE WHEN coin_gain>0 THEN public.add_pigeon_coins(p_user_id,coin_gain) ELSE public.get_pigeon_wallet(p_user_id) END;
  SELECT count(*) FILTER(WHERE (r.result->>'won')::boolean)::integer,
    count(*) FILTER(WHERE NOT (r.result->>'won')::boolean)::integer INTO wins,losses
    FROM public.game_battle_receipts r WHERE r.user_id=p_user_id;
  wins:=wins+CASE WHEN won THEN 1 ELSE 0 END; losses:=losses+CASE WHEN won THEN 0 ELSE 1 END;
  result:=jsonb_build_object('won',won,'critical',critical,'replayed',false,'opponent',to_jsonb(opponent),
    'opponentLevel',opponent_level,'playerPower',battle_roll+(CASE WHEN critical THEN 20 ELSE 0 END),'opponentPower',difficulty,
    'winChance',100-difficulty,'injuredUntil',injury_until,
    'effects',jsonb_build_object('energy',-10,'health',-health_loss,'xp',xp_gain,'coins',coin_gain),'wallet',wallet,
    'battleStats',jsonb_build_object('wins',wins,'losses',losses,'total',wins+losses,'rank',public.pigeon_battle_rank(wins),
      'nextRankWins',CASE WHEN wins<5 THEN 5 WHEN wins<15 THEN 15 WHEN wins<30 THEN 30 WHEN wins<60 THEN 60 ELSE NULL END,
      'attack',10+current_state.level*2,'defense',8+current_state.level,'speed',9+floor(current_state.level*1.5)::integer,'criticalChance',12,'injuredUntil',injury_until),
    'pigeon',to_jsonb(current_state)||jsonb_build_object('species',(SELECT to_jsonb(s) FROM public.game_species s WHERE s.id=current_state.species_id)));
  INSERT INTO public.game_battle_receipts(user_id,request_id,pigeon_id,opponent_species_id,result)
    VALUES(p_user_id,p_request_id,saved.id,opponent.id,result);
  RETURN result;
END;
$$;

ALTER TABLE public.game_daily_rewards DROP CONSTRAINT game_daily_rewards_coins_awarded_check;
ALTER TABLE public.game_daily_rewards DROP CONSTRAINT game_daily_rewards_xp_awarded_check;
ALTER TABLE public.game_daily_rewards ADD COLUMN streak_day integer NOT NULL DEFAULT 1 CHECK(streak_day>=1);
ALTER TABLE public.game_daily_rewards ADD CHECK(coins_awarded BETWEEN 0 AND 1000);
ALTER TABLE public.game_daily_rewards ADD CHECK(xp_awarded BETWEEN 0 AND 1000);

CREATE OR REPLACE FUNCTION public.claim_game_daily_reward(p_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE
  saved public.game_pigeons%ROWTYPE; rewarded public.game_pigeons%ROWTYPE; previous public.game_daily_rewards%ROWTYPE;
  wallet jsonb; today date:=public.pigeon_utc_date(clock_timestamp()); streak integer; cycle_day integer;
  coin_gain integer; xp_gain integer;
BEGIN
  SELECT * INTO saved FROM public.game_pigeons WHERE user_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','NO_PIGEON'); END IF;
  SELECT * INTO previous FROM public.game_daily_rewards WHERE user_id=p_user_id ORDER BY reward_date DESC LIMIT 1;
  IF FOUND AND previous.reward_date=today THEN
    RETURN jsonb_build_object('claimed',false,'rewardDate',today,'effects',jsonb_build_object('coins',0,'xp',0),
      'streak',jsonb_build_object('days',previous.streak_day,'cycleDay',((previous.streak_day-1)%7)+1),
      'wallet',public.get_pigeon_wallet(p_user_id),'pigeon',to_jsonb(saved)||jsonb_build_object('species',(SELECT to_jsonb(s) FROM public.game_species s WHERE s.id=saved.species_id)));
  END IF;
  streak:=CASE WHEN FOUND AND previous.reward_date=today-1 THEN previous.streak_day+1 ELSE 1 END;
  cycle_day:=((streak-1)%7)+1; coin_gain:=50+(cycle_day-1)*10+CASE WHEN cycle_day=7 THEN 90 ELSE 0 END;
  xp_gain:=20+(cycle_day-1)*5;
  rewarded:=public.add_pigeon_xp(saved,xp_gain);
  UPDATE public.game_pigeons SET xp=rewarded.xp,level=rewarded.level,growth_stage=rewarded.growth_stage,
    version=saved.version+1 WHERE id=saved.id RETURNING * INTO rewarded;
  wallet:=public.add_pigeon_coins(p_user_id,coin_gain);
  INSERT INTO public.game_daily_rewards(user_id,reward_date,coins_awarded,xp_awarded,streak_day)
    VALUES(p_user_id,today,coin_gain,xp_gain,streak);
  RETURN jsonb_build_object('claimed',true,'rewardDate',today,'effects',jsonb_build_object('coins',coin_gain,'xp',xp_gain),
    'streak',jsonb_build_object('days',streak,'cycleDay',cycle_day,'nextCycleDay',(cycle_day%7)+1),
    'wallet',wallet,'pigeon',to_jsonb(rewarded)||jsonb_build_object('species',(SELECT to_jsonb(s) FROM public.game_species s WHERE s.id=rewarded.species_id)));
END;
$$;

CREATE FUNCTION public.set_game_profile_public(p_user_id uuid,p_public boolean) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE saved public.game_users%ROWTYPE;
BEGIN
  IF p_public IS NULL THEN RAISE EXCEPTION 'Invalid profile setting' USING ERRCODE='22023'; END IF;
  UPDATE public.game_users SET profile_public=p_public WHERE id=p_user_id RETURNING * INTO saved;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','PROFILE_REQUIRED'); END IF;
  RETURN jsonb_build_object('username',saved.username,'public',saved.profile_public);
END;
$$;

CREATE FUNCTION public.get_game_player_profile(p_username text,p_viewer_user_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE u public.game_users%ROWTYPE; p public.game_pigeons%ROWTYPE; s public.game_species%ROWTYPE;
  discoveries integer; achievements integer; wins integer; losses integer; streak integer;
BEGIN
  SELECT * INTO u FROM public.game_users WHERE lower(username)=lower(p_username);
  IF NOT FOUND THEN RETURN jsonb_build_object('error','PROFILE_NOT_FOUND'); END IF;
  IF NOT u.profile_public AND p_viewer_user_id IS DISTINCT FROM u.id THEN
    RETURN jsonb_build_object('username',u.username,'private',true);
  END IF;
  SELECT * INTO p FROM public.game_pigeons WHERE user_id=u.id;
  IF FOUND THEN SELECT * INTO s FROM public.game_species WHERE id=p.species_id; END IF;
  SELECT count(*)::integer INTO discoveries FROM public.game_pigeon_discoveries WHERE user_id=u.id;
  SELECT count(*)::integer INTO achievements FROM public.game_user_achievements WHERE user_id=u.id;
  SELECT count(*) FILTER(WHERE (result->>'won')::boolean)::integer,
    count(*) FILTER(WHERE NOT (result->>'won')::boolean)::integer INTO wins,losses FROM public.game_battle_receipts WHERE user_id=u.id;
  SELECT coalesce(max(streak_day),0)::integer INTO streak FROM public.game_daily_rewards WHERE user_id=u.id;
  RETURN jsonb_build_object('username',u.username,'private',false,'public',u.profile_public,'joinedAt',u.created_at,
    'discoveries',discoveries,'achievements',achievements,'streak',streak,
    'battle',jsonb_build_object('wins',wins,'losses',losses,'rank',public.pigeon_battle_rank(wins)),
    'pigeon',CASE WHEN p.id IS NULL THEN NULL ELSE jsonb_build_object('nickname',p.nickname,'level',p.level,
      'growthStage',p.growth_stage,'breed',s.name,'image',s.image) END);
END;
$$;

CREATE FUNCTION public.get_game_admin_economy(p_admin_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE output jsonb;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.game_admins WHERE user_id=p_admin_user_id) THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE='42501';
  END IF;
  SELECT jsonb_build_object(
    'accounts',(SELECT count(*)::integer FROM public.game_users),
    'totalCoins',(SELECT coalesce(sum(coins),0)::bigint FROM public.game_users),
    'averageCoins',(SELECT coalesce(round(avg(coins)),0)::integer FROM public.game_users),
    'highestBalance',(SELECT coalesce(max(coins),0)::integer FROM public.game_users),
    'minted',jsonb_build_object(
      'daily',(SELECT coalesce(sum(coins_awarded),0)::bigint FROM public.game_daily_rewards),
      'minigames',(SELECT coalesce(sum(coins_awarded),0)::bigint FROM public.game_crumb_runs),
      'battles',(SELECT coalesce(sum((result->'effects'->>'coins')::integer),0)::bigint FROM public.game_battle_receipts),
      'adminGrants',(SELECT coalesce(sum(amount),0)::bigint FROM public.game_admin_coin_grants)),
    'spent',jsonb_build_object(
      'shop',(SELECT coalesce(sum(price_paid),0)::bigint FROM public.game_shop_purchase_receipts),
      'clinic',(SELECT coalesce(sum(price_paid),0)::bigint FROM public.game_clinic_receipts),
      'packs',(SELECT coalesce(sum((result->>'price')::integer-(result->>'duplicateRefund')::integer),0)::bigint FROM public.game_pigeon_pack_receipts))
  ) INTO output;
  RETURN output;
END;
$$;

-- A clinic visit also clears the temporary battle injury. An injured pigeon may
-- therefore be treated even when its Health is already full.
CREATE OR REPLACE FUNCTION public.treat_game_pigeon(p_user_id uuid,p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE
  saved public.game_pigeons%ROWTYPE; current_state public.game_pigeons%ROWTYPE;
  profile public.game_users%ROWTYPE; receipt jsonb; output jsonb; wallet jsonb;
  action_time timestamptz; health_gain numeric; price integer:=100;
BEGIN
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'Invalid clinic request' USING ERRCODE='22023'; END IF;
  SELECT * INTO saved FROM public.game_pigeons WHERE user_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','NO_PIGEON'); END IF;
  SELECT r.result INTO receipt FROM public.game_clinic_receipts r WHERE r.user_id=p_user_id AND r.request_id=p_request_id;
  IF FOUND THEN RETURN receipt||jsonb_build_object('replayed',true,'effects',jsonb_build_object('health',0,'coins',0),
    'wallet',public.get_pigeon_wallet(p_user_id),'pigeon',public.refresh_game_pigeon(p_user_id)); END IF;
  action_time:=greatest(clock_timestamp(),saved.last_updated);
  current_state:=public.calculate_current_pigeon_state(saved,action_time);
  IF current_state.health>=100 AND (saved.injured_until IS NULL OR saved.injured_until<=action_time) THEN
    RETURN jsonb_build_object('error','HEALTH_FULL','pigeon',to_jsonb(current_state)||jsonb_build_object('species',
      (SELECT to_jsonb(s) FROM public.game_species s WHERE s.id=current_state.species_id)));
  END IF;
  SELECT * INTO profile FROM public.game_users WHERE id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','PROFILE_REQUIRED'); END IF;
  IF profile.coins<price THEN RETURN jsonb_build_object('error','NOT_ENOUGH_COINS','missing',price-profile.coins,
    'wallet',public.get_pigeon_wallet(p_user_id)); END IF;
  health_gain:=100-current_state.health;
  UPDATE public.game_users SET coins=coins-price,coins_version=coins_version+1 WHERE id=p_user_id
    RETURNING jsonb_build_object('coins',coins,'version',coins_version) INTO wallet;
  UPDATE public.game_pigeons SET health=100,hunger=current_state.hunger,happiness=current_state.happiness,
    energy=current_state.energy,cleanliness=current_state.cleanliness,last_updated=current_state.last_updated,
    injured_until=NULL,version=saved.version+1 WHERE id=saved.id RETURNING * INTO current_state;
  output:=jsonb_build_object('treated',true,'replayed',false,'price',price,
    'effects',jsonb_build_object('health',health_gain,'coins',-price),'injuryCleared',saved.injured_until IS NOT NULL,
    'wallet',wallet,'pigeon',to_jsonb(current_state)||jsonb_build_object('species',
      (SELECT to_jsonb(s) FROM public.game_species s WHERE s.id=current_state.species_id)));
  INSERT INTO public.game_clinic_receipts(user_id,request_id,pigeon_id,price_paid,result)
    VALUES(p_user_id,p_request_id,saved.id,price,output);
  RETURN output;
END;
$$;

REVOKE ALL ON FUNCTION public.toggle_game_pigeon_favorite(uuid,text),public.pigeon_battle_rank(integer),
  public.get_game_battle_stats(uuid),public.set_game_profile_public(uuid,boolean),
  public.get_game_player_profile(text,uuid),public.get_game_admin_economy(uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.toggle_game_pigeon_favorite(uuid,text),public.pigeon_battle_rank(integer),
  public.get_game_battle_stats(uuid),public.set_game_profile_public(uuid,boolean),
  public.get_game_player_profile(text,uuid),public.get_game_admin_economy(uuid)
  TO service_role;
REVOKE ALL ON FUNCTION public.battle_game_pigeon(uuid,uuid),public.claim_game_daily_reward(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.battle_game_pigeon(uuid,uuid),public.claim_game_daily_reward(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.treat_game_pigeon(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.treat_game_pigeon(uuid,uuid) TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
