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
  return { auth: client.auth, getProfile, ensureProfile, clearCookies, game: createGameService(admin) };
}

module.exports = { AuthError, readAuthConfig, createSupabaseContext };
