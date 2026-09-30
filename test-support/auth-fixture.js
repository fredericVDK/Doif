const assert = require("node:assert/strict");
const http = require("node:http");
const { createHash } = require("node:crypto");
const { createAuthHandler } = require("../lib/auth/routes");
const { getStarterBreeds } = require("../lib/game/starter-breeds");

// Exercise the real Supabase SDK, cookie adapter and HTTP routes. Only upstream
// Auth/PostgREST is simulated; no hosted credentials or real emails are used.
function fakeSupabase({ gameDb } = {}) {
  const users = new Map();
  const access = new Map();
  const refresh = new Map();
  const profiles = new Map();
  const admins = new Set();
  const codes = new Map();
  const calls = [];
  let sequence = 0;
  const state = { confirmation: false, storageDown: false, authDown: false, gameDown: false };
  function response(body, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: {
      "content-type": "application/json", "x-supabase-api-version": "2024-01-01"
    } });
  }
  function mint(user) {
    const now = Math.floor(Date.now() / 1000);
    const encode = data => Buffer.from(JSON.stringify(data)).toString("base64url");
    const token = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: user.id, exp: now + 3600, aud: "authenticated", jti: ++sequence })}.test-signature`;
    const session = { access_token: token, refresh_token: `refresh-${sequence}`, expires_in: 3600,
      expires_at: now + 3600, token_type: "bearer", user };
    access.set(token, session);
    refresh.set(session.refresh_token, session);
    return session;
  }
  async function upstream(input, options) {
    const request = new Request(input, options);
    const url = new URL(request.url);
    const rawBody = request.method === "POST" ? await request.text() : "";
    const body = rawBody ? JSON.parse(rawBody) : null;
    const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
    // Track route/keys only, never the supplied password or tokens in test output.
    calls.push({ path: url.pathname, grant: url.searchParams.get("grant_type"), method: request.method });
    if (url.pathname.startsWith("/auth/") && state.authDown) return response({ msg: "Unavailable" }, 503);
    if(url.pathname==='/auth/v1/admin/users'&&request.method==='POST') {
      assert.equal(request.headers.get('apikey'),'test-server-secret');
      if(users.has(body.email))return response({msg:'User already registered',code:'email_exists'},422);
      const user={id:`20000000-0000-4000-8000-${String(++sequence).padStart(12,'0')}`,
        email:body.email,user_metadata:body.user_metadata||{},aud:'authenticated',role:'authenticated',
        email_confirmed_at:body.email_confirm?new Date().toISOString():null,identities:[{provider:'email'}]};
      users.set(body.email,{user,password:body.password});
      return response(user,201);
    }
    if(url.pathname.startsWith('/auth/v1/admin/users/')&&request.method==='GET') {
      assert.equal(request.headers.get('apikey'),'test-server-secret');
      const id=url.pathname.split('/').pop(),record=[...users.values()].find(item=>item.user.id===id);
      return record?response(record.user):response({msg:'User not found',code:'user_not_found'},404);
    }
    if (url.pathname === "/auth/v1/signup") {
      if (users.has(body.email)) return response({ user: { id: "obfuscated", identities: [] }, session: null });
      const user = { id: `20000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
        email: body.email, user_metadata: body.data || {}, aud: "authenticated", role: "authenticated",
        email_confirmed_at: state.confirmation ? null : new Date().toISOString(), identities: [{ provider: "email" }] };
      users.set(body.email, { user, password: body.password });
      if (state.confirmation) {
        codes.set(`confirmation-${sequence}`, { user, challenge: body.code_challenge,
          flowId: new URL(url.searchParams.get("redirect_to")).searchParams.get("sb_flow_id") });
        return response({ user, session: null });
      }
      return response(mint(user));
    }
    if (url.pathname === "/auth/v1/token") {
      const grant = url.searchParams.get("grant_type");
      if (grant === "password") {
        const record = users.get(body.email);
        if (!record || record.password !== body.password || !record.user.email_confirmed_at) return response({ msg: "Invalid credentials", code: "invalid_credentials" }, 400);
        return response(mint(record.user));
      }
      if (grant === "refresh_token") {
        const session = refresh.get(body.refresh_token);
        if (!session) return response({ msg: "Invalid refresh", code: "refresh_token_not_found" }, 400);
        refresh.delete(body.refresh_token);
        return response(mint(session.user));
      }
      if (grant === "pkce") {
        const pending = codes.get(body.auth_code);
        const challenge = createHash("sha256").update(body.code_verifier || "").digest("base64url");
        if (!pending || pending.challenge !== challenge) return response({ msg: "Invalid verification" }, 400);
        codes.delete(body.auth_code);
        pending.user.email_confirmed_at = new Date().toISOString();
        return response(mint(pending.user));
      }
    }
    if (url.pathname === "/auth/v1/user") {
      const session = access.get(token);
      return session ? response(session.user) : response({ msg: "Invalid token", code: "bad_jwt" }, 401);
    }
    if (url.pathname === "/auth/v1/logout") {
      const session = access.get(token);
      assert.equal(url.searchParams.get("scope"), "local");
      if (session) refresh.delete(session.refresh_token);
      return new Response(null, { status: 204 });
    }
    if(url.pathname === "/rest/v1/game_pigeon_discoveries") {
      assert.equal(request.headers.get("apikey"),"test-server-secret");
      if(state.gameDown) return response({code:"PGRST205"},503);
      const id=url.searchParams.get("user_id")?.replace(/^eq\./,"");
      assert.ok(id,"Discoveries must be scoped to the verified user");
      return response((await gameDb.query("SELECT species_id,discovered_at,seen_at FROM public.game_pigeon_discoveries WHERE user_id=$1 ORDER BY species_id LIMIT $2 OFFSET $3",[id,Number(url.searchParams.get("limit") || 1000),Number(url.searchParams.get("offset") || 0)])).rows);
    }
    if(["/rest/v1/rpc/record_pigeon_discovery","/rest/v1/rpc/acknowledge_pigeon_discovery"].includes(url.pathname)) {
      assert.equal(request.headers.get("apikey"),"test-server-secret");
      assert.deepEqual(Object.keys(body).sort(),["p_species_id","p_user_id"]);
      if(state.gameDown) return response({code:"PGRST205"},503);
      const fn=url.pathname.split("/").pop();
      try {return response((await gameDb.query(`SELECT public.${fn}($1,$2) AS result`,[body.p_user_id,body.p_species_id])).rows[0].result);}
      catch(error) {return response({code:error.code,message:"Test discovery failure"},400);}
    }
    if(url.pathname === "/rest/v1/rpc/claim_game_daily_reward") {
      assert.equal(request.headers.get("apikey"),"test-server-secret");
      assert.deepEqual(Object.keys(body),["p_user_id"]);
      assert.ok(gameDb,"Daily reward tests use actual SQL");
      if(state.gameDown) return response({code:"PGRST205"},503);
      try {return response((await gameDb.query("SELECT public.claim_game_daily_reward($1) AS result",[body.p_user_id])).rows[0].result);}
      catch(error) {return response({code:error.code,message:"Test daily reward failure"},400);}
    }
    if(url.pathname === "/rest/v1/rpc/get_game_inventory") {
      assert.equal(request.headers.get("apikey"),"test-server-secret");
      assert.deepEqual(Object.keys(body),["p_user_id"]);
      assert.ok(gameDb,"Inventory tests use actual SQL");
      if(state.gameDown) return response({code:"PGRST205"},503);
      try {return response((await gameDb.query("SELECT public.get_game_inventory($1) AS result",[body.p_user_id])).rows[0].result);}
      catch(error) {return response({code:error.code,message:"Test inventory failure"},400);}
    }
    if(url.pathname === "/rest/v1/rpc/buy_game_item") {
      assert.equal(request.headers.get("apikey"),"test-server-secret");
      assert.deepEqual(Object.keys(body).sort(),["p_item_id","p_request_id","p_user_id"]);
      assert.ok(gameDb,"Shop tests use actual SQL");
      if(state.gameDown) return response({code:"PGRST205"},503);
      try {return response((await gameDb.query("SELECT public.buy_game_item($1,$2,$3) AS result",[body.p_user_id,body.p_request_id,body.p_item_id])).rows[0].result);}
      catch(error) {return response({code:error.code,message:"Test shop failure"},400);}
    }
    if(["/rest/v1/rpc/get_game_daily_quests","/rest/v1/rpc/record_game_daily_quest","/rest/v1/rpc/claim_game_daily_quest"].includes(url.pathname)) {
      assert.equal(request.headers.get("apikey"),"test-server-secret");
      assert.ok(gameDb,"Daily quest tests use actual SQL");
      if(state.gameDown) return response({code:"PGRST205"},503);
      const fn=url.pathname.split("/").pop();
      const keys=Object.keys(body).sort();
      assert.deepEqual(keys,fn==='get_game_daily_quests'?["p_user_id"]:["p_quest_id","p_user_id"]);
      try {
        const result=fn==='get_game_daily_quests'
          ? await gameDb.query(`SELECT public.${fn}($1) AS result`,[body.p_user_id])
          : await gameDb.query(`SELECT public.${fn}($1,$2) AS result`,[body.p_user_id,body.p_quest_id]);
        return response(result.rows[0].result);
      } catch(error) {return response({code:error.code,message:"Test daily quest failure"},400);}
    }
    if(["/rest/v1/rpc/sync_game_achievements","/rest/v1/rpc/claim_game_achievement"].includes(url.pathname)) {
      assert.equal(request.headers.get("apikey"),"test-server-secret");
      assert.ok(gameDb,"Achievement tests use actual SQL");
      if(state.gameDown) return response({code:"PGRST205"},503);
      const fn=url.pathname.split("/").pop();
      assert.deepEqual(Object.keys(body).sort(),fn==='sync_game_achievements'?["p_user_id"]:["p_achievement_id","p_user_id"]);
      try {
        const result=fn==='sync_game_achievements'
          ? await gameDb.query(`SELECT public.${fn}($1) AS result`,[body.p_user_id])
          : await gameDb.query(`SELECT public.${fn}($1,$2) AS result`,[body.p_user_id,body.p_achievement_id]);
        return response(result.rows[0].result);
      } catch(error) {return response({code:error.code,message:"Test achievement failure"},400);}
    }
    if(["/rest/v1/rpc/start_crumb_game","/rest/v1/rpc/finish_crumb_game"].includes(url.pathname)) {
      assert.equal(request.headers.get("apikey"),"test-server-secret");
      assert.ok(gameDb,"Minigame tests use actual SQL");
      if(state.gameDown) return response({code:"PGRST205"},503);
      const fn=url.pathname.split("/").pop();
      assert.deepEqual(Object.keys(body).sort(),fn==='start_crumb_game'?["p_request_id","p_user_id"]:["p_caught","p_run_id","p_user_id"]);
      try {
        const result=fn==='start_crumb_game'
          ? await gameDb.query('SELECT public.start_crumb_game($1,$2) AS result',[body.p_user_id,body.p_request_id])
          : await gameDb.query('SELECT public.finish_crumb_game($1,$2,$3::integer[]) AS result',[body.p_user_id,body.p_run_id,body.p_caught]);
        return response(result.rows[0].result);
      } catch(error) {return response({code:error.code,message:"Test minigame failure"},400);}
    }
    if(url.pathname==='/rest/v1/rpc/battle_game_pigeon') {
      assert.equal(request.headers.get('apikey'),'test-server-secret');
      assert.deepEqual(Object.keys(body).sort(),['p_request_id','p_user_id']);
      assert.ok(gameDb,'Battle tests use actual SQL');
      if(state.gameDown)return response({code:'PGRST205'},503);
      try{return response((await gameDb.query('SELECT public.battle_game_pigeon($1,$2) AS result',[body.p_user_id,body.p_request_id])).rows[0].result);}
      catch(error){return response({code:error.code,message:'Test battle failure'},400);}
    }
    if(url.pathname==='/rest/v1/rpc/get_pigeon_pack_status') {
      assert.equal(request.headers.get('apikey'),'test-server-secret');
      assert.deepEqual(Object.keys(body),['p_user_id']);
      assert.ok(gameDb,'Pigeon pack tests use actual SQL');
      if(state.gameDown)return response({code:'PGRST205'},503);
      try{return response((await gameDb.query('SELECT public.get_pigeon_pack_status($1) AS result',[body.p_user_id])).rows[0].result);}
      catch(error){return response({code:error.code,message:'Test pack status failure'},400);}
    }
    if(url.pathname==='/rest/v1/rpc/buy_pigeon_pack') {
      assert.equal(request.headers.get('apikey'),'test-server-secret');
      assert.deepEqual(Object.keys(body).sort(),['p_pack_type','p_request_id','p_species_ids','p_user_id']);
      assert.ok(gameDb,'Pigeon pack tests use actual SQL');
      if(state.gameDown)return response({code:'PGRST205'},503);
      try{return response((await gameDb.query('SELECT public.buy_pigeon_pack($1,$2,$3,$4::text[]) AS result',
        [body.p_user_id,body.p_request_id,body.p_pack_type,body.p_species_ids])).rows[0].result);}
      catch(error){return response({code:error.code,message:'Test pigeon pack failure'},400);}
    }
    if(url.pathname==='/rest/v1/rpc/treat_game_pigeon') {
      assert.equal(request.headers.get('apikey'),'test-server-secret');
      assert.deepEqual(Object.keys(body).sort(),['p_request_id','p_user_id']);
      assert.ok(gameDb,'Clinic tests use actual SQL');
      if(state.gameDown)return response({code:'PGRST205'},503);
      try{return response((await gameDb.query('SELECT public.treat_game_pigeon($1,$2) AS result',[body.p_user_id,body.p_request_id])).rows[0].result);}
      catch(error){return response({code:error.code,message:'Test clinic failure'},400);}
    }
    if(url.pathname==='/rest/v1/rpc/find_game_user_by_username') {
      assert.equal(request.headers.get('apikey'),'test-server-secret');
      const username=body.p_username;
      if(gameDb)return response((await gameDb.query('SELECT id,username FROM public.game_users WHERE lower(username)=lower($1) LIMIT 1',[username])).rows);
      const found=[...profiles.values()].find(profile=>profile.username.toLowerCase()===username.toLowerCase());
      return response(found?[{id:found.id,username:found.username}]:[]);
    }
    if(url.pathname==='/rest/v1/rpc/claim_initial_game_admin') {
      assert.equal(request.headers.get('apikey'),'test-server-secret');
      if(gameDb){try{return response((await gameDb.query('SELECT public.claim_initial_game_admin($1) AS result',[body.p_user_id])).rows[0].result);}catch(error){if(error.code==='42883')return response(false);throw error;}}
      if(admins.has(body.p_user_id))return response(true);
      if(admins.size)return response(false);
      const profile=profiles.get(body.p_user_id);if(profile?.username.toLowerCase()==='fredadmin'){admins.add(body.p_user_id);return response(true);}return response(false);
    }
    if(url.pathname==='/rest/v1/rpc/get_game_admin_accounts') {
      assert.equal(request.headers.get('apikey'),'test-server-secret');
      assert.ok(gameDb,'Admin account tests use actual SQL');
      try{return response((await gameDb.query('SELECT public.get_game_admin_accounts($1) AS result',[body.p_admin_user_id])).rows[0].result);}
      catch(error){return response({code:error.code,message:'Test admin failure'},400);}
    }
    if(url.pathname==='/rest/v1/rpc/grant_game_admin_coins') {
      assert.equal(request.headers.get('apikey'),'test-server-secret');
      assert.ok(gameDb,'Admin coin tests use actual SQL');
      try{return response((await gameDb.query('SELECT public.grant_game_admin_coins($1,$2,$3) AS result',[body.p_admin_user_id,body.p_target_username,body.p_amount])).rows[0].result);}
      catch(error){return response({code:error.code,message:'Test admin grant failure'},400);}
    }
    if (["/rest/v1/game_species", "/rest/v1/game_pigeons", "/rest/v1/rpc/adopt_game_pigeon", "/rest/v1/rpc/refresh_game_pigeon", "/rest/v1/rpc/feed_game_pigeon", "/rest/v1/rpc/play_game_pigeon", "/rest/v1/rpc/clean_game_pigeon", "/rest/v1/rpc/sleep_game_pigeon"].includes(url.pathname)) {
      assert.equal(request.headers.get("apikey"), "test-server-secret");
      if (state.gameDown) return response({ code: "PGRST205", message: "Test schema unavailable" }, 503);
      if (url.pathname.endsWith("sleep_game_pigeon")) {
        assert.deepEqual(Object.keys(body).sort(), ["p_request_id", "p_user_id"]);
        assert.ok(gameDb, "Sleep tests use actual SQL");
        try {
          return response((await gameDb.query("SELECT public.sleep_game_pigeon($1,$2) AS result", [body.p_user_id,body.p_request_id])).rows[0].result);
        } catch (error) { return response({code:error.code,message:"Test sleep failure"},400); }
      }
      if (url.pathname.endsWith("clean_game_pigeon")) {
        assert.deepEqual(Object.keys(body).sort(), ["p_request_id", "p_user_id"]);
        assert.ok(gameDb, "Clean tests use actual SQL");
        try {
          return response((await gameDb.query("SELECT public.clean_game_pigeon($1,$2) AS result", [body.p_user_id,body.p_request_id])).rows[0].result);
        } catch (error) { return response({code:error.code,message:"Test clean failure"},400); }
      }
      if (url.pathname.endsWith("play_game_pigeon")) {
        assert.deepEqual(Object.keys(body).sort(), ["p_request_id", "p_user_id"]);
        assert.ok(gameDb, "Play tests use actual SQL");
        try {
          return response((await gameDb.query("SELECT public.play_game_pigeon($1,$2) AS result", [body.p_user_id,body.p_request_id])).rows[0].result);
        } catch (error) { return response({code:error.code,message:"Test play failure"},400); }
      }
      if (url.pathname.endsWith("feed_game_pigeon")) {
        assert.deepEqual(Object.keys(body).sort(), ["p_food", "p_request_id", "p_user_id"]);
        assert.ok(gameDb, "Feed tests use actual SQL");
        try {
          return response((await gameDb.query("SELECT public.feed_game_pigeon($1,$2,$3) AS result", [body.p_user_id,body.p_request_id,body.p_food])).rows[0].result);
        } catch (error) { return response({code:error.code,message:"Test feed failure"},400); }
      }
      if (url.pathname.endsWith("refresh_game_pigeon")) {
        assert.deepEqual(Object.keys(body), ["p_user_id"]);
        if (!gameDb) return response(null);
        try {
          return response((await gameDb.query("SELECT public.refresh_game_pigeon($1) AS pigeon", [body.p_user_id])).rows[0].pigeon);
        } catch (error) { return response({ code: error.code, message: "Test engine failure" }, 400); }
      }
      if (url.pathname.endsWith("game_species")) {
        assert.equal(url.searchParams.get("is_starter"), "eq.true");
        return response(gameDb ? (await gameDb.query("SELECT * FROM public.game_species WHERE is_starter")).rows
          : getStarterBreeds(require("../data/domestic-pigeons.json").records));
      }
      if (url.pathname.endsWith("game_pigeons")) {
        const id = url.searchParams.get("user_id")?.replace(/^eq\./, "");
        assert.ok(id, "Pigeon reads must use the verified user ID");
        return response(gameDb ? (await gameDb.query(`SELECT p.*, row_to_json(s) AS species FROM public.game_pigeons p
          JOIN public.game_species s ON s.id = p.species_id WHERE p.user_id = $1`, [id])).rows : []);
      }
      assert.deepEqual(Object.keys(body).sort(), ["p_nickname", "p_species_id", "p_user_id"]);
      assert.ok(gameDb, "Adoption tests must exercise the actual SQL function");
      try {
        const result = await gameDb.query("SELECT * FROM public.adopt_game_pigeon($1, $2, $3)", [body.p_user_id, body.p_species_id, body.p_nickname]);
        return response(result.rows);
      } catch (error) { return response({ code: error.code, message: "Test database error" }, 400); }
    }
    if (url.pathname === "/rest/v1/game_users") {
      assert.equal(request.headers.get("apikey"), "test-server-secret");
      if (state.storageDown) return response({ code: "PGRST205", message: "Test schema unavailable" }, 503);
      if (request.method === "GET") {
        const id = url.searchParams.get("id")?.replace(/^eq\./, "");
        assert.ok(id, "All profile reads must be scoped to a verified user ID");
        return response(gameDb ? (await gameDb.query("SELECT * FROM public.game_users WHERE id=$1", [id])).rows
          : profiles.has(id) ? [profiles.get(id)] : []);
      }
      if (request.method === "POST") {
        assert.deepEqual(Object.keys(body).sort(), ["id", "username"]);
        if (profiles.has(body.id) || [...profiles.values()].some(profile => profile.username.toLowerCase() === body.username.toLowerCase())) {
          return response({ code: "23505", message: "Unique constraint" }, 409);
        }
        const profile = { ...body, coins: 0, coins_version: 0, created_at: new Date().toISOString() };
        if (gameDb) {
          await gameDb.query("INSERT INTO auth.users (id) VALUES ($1)", [body.id]);
          await gameDb.query("INSERT INTO public.game_users (id, username) VALUES ($1, $2)", [body.id, body.username]);
        }
        profiles.set(body.id, profile);
        return response(profile, 201);
      }
    }
    throw new Error(`Unexpected upstream route: ${request.method} ${url.pathname}`);
  }
  return { fetch: upstream, users, profiles, admins, access, refresh, codes, calls, state, mint };
}

async function fixture(t, { configured = true, secure = false, gameDb, getCatalog, now } = {}) {
  const provider = fakeSupabase({ gameDb });
  const errors = [];
  const env = configured ? { SUPABASE_URL: "https://supabase.example.test", SUPABASE_PUBLISHABLE_KEY: "test-public-key",
    SUPABASE_SECRET_KEY: "test-server-secret", APP_ORIGIN: "http://localhost" } : {};
  const handler = createAuthHandler({ env, fetchImpl: provider.fetch, logger: { error: (...args) => errors.push(args) }, getCatalog, now });
  const server = http.createServer((request, response) => {
    if (!handler(request, response)) { response.writeHead(404); response.end("Not found"); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  if (configured) env.APP_ORIGIN = secure ? "https://pigeon.example.test" : base;
  const jar = new Map();
  async function request(route, { body, cookie, origin, method, updateCookies = true, headers = {} } = {}) {
    const response = await fetch(base + route, {
      method: method || (body ? "POST" : "GET"), redirect: "manual",
      headers: { ...(body ? { "content-type": "application/json", origin: origin ?? env.APP_ORIGIN ?? base } : {}),
        cookie: cookie ?? [...jar].map(([key, value]) => `${key}=${value}`).join("; "), ...headers },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    if (updateCookies) for (const header of response.headers.getSetCookie()) {
      const pair = header.split(";")[0];
      const index = pair.indexOf("=");
      const name = pair.slice(0, index);
      if (/Max-Age=0(?:;|$)/i.test(header)) jar.delete(name);
      else jar.set(name, pair.slice(index + 1));
    }
    return response;
  }
  async function signup(username = "BirdFriend", extra = {}) {
    return request("/api/auth/sign-up", { body: { username, password: "a good test password", ...extra } });
  }
  return { provider, env, request, signup, jar, errors, base };
}


module.exports = { fakeSupabase, fixture };
