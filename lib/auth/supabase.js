const { createClient } = require("@supabase/supabase-js");
const { createServerClient, parseCookieHeader, serializeCookieHeader } = require("@supabase/ssr");
const { AuthError } = require("./errors");
const { createGameService } = require("../game");

function readAuthConfig(env) {
  const { SUPABASE_URL: url, SUPABASE_PUBLISHABLE_KEY: key,
    SUPABASE_SECRET_KEY: secret } = env;
  const origin = env.APP_ORIGIN || (env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : "");
  if (!url || !key || !secret || !origin) return null;
  try {
    for (const value of [url, origin]) {
      const parsed = new URL(value);
      const local = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
      if ((parsed.protocol !== "https:" && !(local && parsed.protocol === "http:"))
        || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/") throw new Error();
    }
    return { url: new URL(url).origin, key, secret, origin: new URL(origin).origin,
      secure: new URL(origin).protocol === "https:" };
  } catch {
    throw new AuthError(503, "AUTH_CONFIG", "Accounts are temporarily unavailable. Please try again later.");
  }
}

function createSupabaseContext(config, request, response, fetchImpl = fetch) {
  const cookieName = config.secure ? "__Host-pigeon_account" : "pigeon_account";
  const jar = new Map(parseCookieHeader(request.headers.cookie || "").map(({ name, value }) => [name, value]));
  const outgoing = new Map();
  const cookieOptions = { path: "/", httpOnly: true, secure: config.secure, sameSite: "lax" };
  function setCookies(cookies) {
    for (const { name, value, options = {} } of cookies) {
      if (options.maxAge === 0) jar.delete(name);
      else jar.set(name, value);
      outgoing.set(name, serializeCookieHeader(name, value, {
        ...options, ...cookieOptions, maxAge: options.maxAge === 0 ? 0 : 60 * 60 * 24 * 30
      }));
    }
    response.setHeader("set-cookie", [...outgoing.values()]);
  }
  // A new client per request prevents sharing one user's session with another.
  const client = createServerClient(config.url, config.key, {
    cookieOptions: { name: cookieName, ...cookieOptions },
    cookies: {
      encode: "tokens-only",
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: setCookies
    },
    global: { fetch: (url, options = {}) => fetchImpl(url, { ...options, signal: AbortSignal.timeout(10000) }) }
  });
  const admin = createClient(config.url, config.secret, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (url, options = {}) => fetchImpl(url, { ...options, signal: AbortSignal.timeout(10000) }) }
  });

  function databaseError(error) {
    const failure = new AuthError(503, "PROFILE_STORAGE", "Your account could not be loaded. Please try again.");
    failure.providerCode = error?.code;
    return failure;
  }
  async function getProfile(userId) {
    const { data, error } = await admin.from("game_users")
      .select("id,username,coins,coins_version,created_at").eq("id", userId).maybeSingle();
    if (error) throw databaseError(error);
    return data;
  }
  async function findProfileByUsername(username) {
    const {data,error}=await admin.rpc('find_game_user_by_username',{p_username:username});
    if(!error) return Array.isArray(data)?data[0]||null:data||null;
    // Exact-case fallback keeps sign-in available while migration 027 is being deployed.
    if(!['PGRST202','42883'].includes(error.code)) throw databaseError(error);
    const fallback=await admin.from('game_users').select('id,username').eq('username',username).maybeSingle();
    if(fallback.error) throw databaseError(fallback.error);
    return fallback.data;
  }
  async function loginEmailForUsername(username) {
    const profile=await findProfileByUsername(username);
    if(!profile?.id)return null;
    const {data,error}=await admin.auth.admin.getUserById(profile.id);
    if(error){
      if([400,404].includes(error.status))return null;
      throw databaseError(error);
    }
    return data?.user?.email||null;
  }
  function createPasswordUser({email,password,username}) {
    return admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{username}});
  }
  async function ensureGameAdmin(userId) {
    const {data,error}=await admin.rpc('claim_initial_game_admin',{p_user_id:userId});
    if(!error)return data===true;
    if(['PGRST202','42883'].includes(error.code))return false;
    throw databaseError(error);
  }
  async function getAdminAccounts(userId) {
    const {data,error}=await admin.rpc('get_game_admin_accounts',{p_admin_user_id:userId});
    if(error)throw databaseError(error);
    return data;
  }
  async function getAdminEconomy(userId) {
    const {data,error}=await admin.rpc('get_game_admin_economy',{p_admin_user_id:userId});
    if(error)throw databaseError(error);
    return data;
  }
  async function grantAdminCoins(userId,username,amount) {
    const {data,error}=await admin.rpc('grant_game_admin_coins',{p_admin_user_id:userId,p_target_username:username,p_amount:amount});
    if(error)throw databaseError(error);
    if(data?.error==='ACCOUNT_NOT_FOUND')throw new AuthError(404,'ACCOUNT_NOT_FOUND','That account no longer exists.');
    return data;
  }
  async function deleteGameAccount(userId,username) {
    const target=await findProfileByUsername(username);
    if(!target)throw new AuthError(404,'ACCOUNT_NOT_FOUND','That account no longer exists.');
    if(target.id===userId)throw new AuthError(400,'ADMIN_SELF_DELETE','The active administrator account cannot delete itself.');
    const {error}=await admin.auth.admin.deleteUser(target.id,false);
    if(error){
      if([400,404].includes(error.status))throw new AuthError(404,'ACCOUNT_NOT_FOUND','That account no longer exists.');
      const failure=new AuthError(503,'ACCOUNT_DELETE','The account could not be deleted. Please try again.');
      failure.providerCode=error.code;
      throw failure;
    }
    return {deleted:true,username:target.username};
  }
  async function ensureProfile(user, username) {
    const existing = await getProfile(user.id);
    if (existing) return existing;
    if (typeof username !== "string" || !/^[A-Za-z0-9_]{3,24}$/.test(username)) return null;
    const { data, error } = await admin.from("game_users")
      .insert({ id: user.id, username }).select("id,username,coins,coins_version,created_at").single();
    if (!error) return data;
    if (error.code === "23505") {
      // Concurrent sign-ins may already have created this user's profile.
      const created = await getProfile(user.id);
      if (created) return created;
      throw new AuthError(409, "USERNAME_TAKEN", "That username is taken. Please choose another.");
    }
    throw databaseError(error);
  }
  function clearCookies() {
    const names = new Set([...jar.keys(), ...outgoing.keys()]);
    setCookies([...names].filter(name => name === cookieName || name.startsWith(`${cookieName}.`)
      || name.startsWith(`${cookieName}-`)).map(name => ({ name, value: "", options: { maxAge: 0 } })));
  }
  return { auth: client.auth, getProfile, findProfileByUsername, loginEmailForUsername,
    createPasswordUser, ensureGameAdmin, getAdminAccounts, getAdminEconomy, grantAdminCoins, deleteGameAccount,
    ensureProfile, clearCookies, game: createGameService(admin) };
}

module.exports = { AuthError, readAuthConfig, createSupabaseContext };
