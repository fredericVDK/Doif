const { AuthError, readAuthConfig, createSupabaseContext } = require("./supabase");
const { renderAuthPage } = require("./pages");
const {renderAdminPage}=require('./admin-page');
const { renderAdoptionPage, renderPigeonPage, renderInventoryPage, renderShopPage, renderMinigamePage } = require("../game/pages");
const {pigeonPresentation}=require('../game/presentation');
const {bundledCatalog}=require("../game/discoveries");
const {GAME_API_METHODS,dispatchGameApi}=require('../game/api');
const {requestReference,publicApiError,technicalError}=require('../http/api-errors');
const {createHash}=require('node:crypto');

const PAGE_MODES = new Map([
  ["/sign-up", "sign-up"], ["/sign-in", "sign-in"], ["/logout", "logout"],
  ["/complete-profile", "profile"], ["/adopt", "adopt"], ["/my-pigeon", "home"], ["/inventory", "inventory"], ["/shop", "shop"], ["/catch-the-crumbs", "game"], ["/admin.html", "admin"]
]);
const API_METHODS = new Map([
  ...GAME_API_METHODS,
  ["/api/auth/session", "GET"], ["/api/auth/sign-up", "POST"],
  ["/api/auth/sign-in", "POST"], ["/api/auth/sign-out", "POST"], ["/api/auth/profile", "POST"]
  ,["/api/admin/accounts","GET"],["/api/admin/coins","POST"]
]);

function json(response, status, value) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}
function redirect(response, destination) {
  response.writeHead(303, { location: destination });
  response.end();
}
function securityHeaders(response) {
  response.setHeader("cache-control", "private, no-store, max-age=0");
  response.setHeader("pragma", "no-cache");
  response.setHeader("vary", "Cookie");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("content-security-policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https://upload.wikimedia.org https://thumb.wikimedia.org https://commons.wikimedia.org https://birdnet.cornell.edu https://inaturalist-open-data.s3.amazonaws.com; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
}

async function bodyJson(request) {
  if ((request.headers["content-type"] || "").split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new AuthError(415, "CONTENT_TYPE", "Please submit the account form as JSON.");
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 8192) throw new AuthError(413, "BODY_SIZE", "The submitted form is too large.");
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || Array.isArray(value) || typeof value !== "object") throw new Error();
    return value;
  } catch {
    throw new AuthError(400, "INVALID_FORM", "Please check the submitted form.");
  }
}
function usernameInput(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_]{3,24}$/.test(value)) {
    throw new AuthError(400, "USERNAME", "Use 3–24 letters, numbers or underscores for your username.");
  }
  return value;
}
function credentials(body, signingUp) {
  const username=usernameInput(body.username);
  const password = body.password;
  if (typeof password !== "string" || password.length > 128 || password.length < (signingUp ? 8 : 1)) {
    throw new AuthError(400, "PASSWORD", signingUp ? "Use a password of 8–128 characters." : "Enter your password.");
  }
  return { username, password };
}
function accountEmail(username) {
  const key=createHash('sha256').update(username.toLowerCase(),'utf8').digest('hex');
  return `u-${key}@accounts.pigeoncrumbs.invalid`;
}
function publicUser(user, profile) {
  return { id: user.id, username: profile?.username || null,
    coins: profile?.coins ?? null, createdAt: profile?.created_at || null };
}
function providerFailure(error, action) {
  if (error.status === 429) return new AuthError(429, "AUTH_RATE_LIMIT", "Too many attempts. Please wait before trying again.");
  if (!error.status || error.status >= 500) return new AuthError(503, "AUTH_UNAVAILABLE", "Accounts are temporarily unavailable. Please try again later.");
  if (action === "sign-in") return new AuthError(401, "SIGN_IN_FAILED", "Could not sign in. Check your username and password.");
  if (action === "sign-up") return new AuthError(400, "SIGN_UP_FAILED", "Could not create the account. Check your details or try signing in.");
  return new AuthError(401, "SESSION_EXPIRED", "Your session has expired. Please sign in again.");
}

function createAuthHandler({ env = process.env, fetchImpl = fetch, logger = console, getCatalog = bundledCatalog, now = () => new Date() } = {}) {
  const buckets = new Map();
  function limit(request, response, path) {
    const mutation = request.method === "POST";
    const now = Date.now();
    for (const [key, bucket] of buckets) if (bucket.until <= now) buckets.delete(key);
    // Deliberately don't trust user-controlled forwarding headers or anonymous cookies.
    const key = `${request.socket.remoteAddress}:${mutation ? path : "read"}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      if (buckets.size >= 10000) throw new AuthError(429, "BUSY", "Please try again shortly.");
      bucket = { count: 0, until: now + (mutation ? 600000 : 60000) };
      buckets.set(key, bucket);
    }
    if (++bucket.count > (mutation ? (["/api/game/feed", "/api/game/play", "/api/game/clean", "/api/game/sleep"].includes(path) ? 60 : 20) : 180)) {
      response.setHeader("retry-after", String(Math.ceil((bucket.until - now) / 1000)));
      throw new AuthError(429, "AUTH_RATE_LIMIT", "Too many attempts. Please wait before trying again.");
    }
  }
  async function verifiedUser(context) {
    // Never authorize with cookie claims, getSession(), request userId or user_metadata.
    const { data, error } = await context.auth.getUser();
    if (error) {
      if (error.name === "AuthSessionMissingError" || [400, 401, 403].includes(error.status)) {
        context.clearCookies();
        return null;
      }
      throw providerFailure(error, "session");
    }
    const user = data.user;
    if (!user?.id || !user.email || user.is_anonymous || !user.email_confirmed_at) {
      context.clearCookies();
      return null;
    }
    return user;
  }
  async function finishSignIn(context, destination) {
    const user = await verifiedUser(context);
    if (!user) throw new AuthError(401, "SIGN_IN_FAILED", "Could not sign in. Check your username and password.");
    let profile;
    try { profile = await context.ensureProfile(user, user.user_metadata?.username); }
    catch (error) { if (error.code !== "USERNAME_TAKEN") throw error; }
    const admin=profile?await context.ensureGameAdmin(user.id):false;
    return { user: publicUser(user, profile), redirect: profile?(admin?'/admin.html':destination):"/complete-profile" };
  }
  async function dispatch(request, response, url, requestId) {
    securityHeaders(response);
    const path = url.pathname;
    const allowed = API_METHODS.get(path) || "GET";
    if (request.method !== allowed) {
      response.setHeader("allow", allowed);
      return json(response, 405, { error: "Method not allowed." });
    }
    limit(request, response, path);
    const config = readAuthConfig(env);
    const mode = PAGE_MODES.get(path);
    if (!config) {
      if (path === "/api/auth/session") return json(response, 200, { configured: false, user: null });
      if (["sign-up", "sign-in", "logout"].includes(mode)) {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        return response.end(renderAuthPage(mode, { configured: false }));
      }
      throw new AuthError(503, "AUTH_NOT_CONFIGURED", "Accounts are not available yet. Please try again later.");
    }
    if (request.method === "POST" && (request.headers.origin !== config.origin
      || request.headers["sec-fetch-site"] === "cross-site")) {
      throw new AuthError(403, "ORIGIN", "Please submit this form from Pigeon Crumbs.");
    }
    const context = createSupabaseContext(config, request, response, fetchImpl);
    if (path === "/auth/callback") {
      const code = url.searchParams.get("code");
      const flowId = url.searchParams.get("sb_flow_id");
      if (!code || code.length > 2048 || (flowId && flowId.length > 128) || url.searchParams.has("error")) return redirect(response, "/sign-in?notice=confirmation-failed");
      const { error } = await context.auth.exchangeCodeForSession(code, flowId ? { flowId } : undefined);
      if (error) return redirect(response, "/sign-in?notice=confirmation-failed");
      const result = await finishSignIn(context, "/adopt");
      return redirect(response, result.redirect);
    }
    if (path === "/api/auth/sign-up" || path === "/api/auth/sign-in") {
      const body = await bodyJson(request);
      const signingUp = path.endsWith("sign-up");
      const input = credentials(body, signingUp);
      let result;
      if (signingUp) {
        if(await context.findProfileByUsername(input.username)) throw new AuthError(409,'USERNAME_TAKEN','That username is taken. Please choose another.');
        const login={email:accountEmail(input.username),password:input.password};
        const created=await context.createPasswordUser({email:login.email,password:login.password,username:input.username});
        if(created.error) {
          if(!created.error.status||created.error.status>=500) throw providerFailure(created.error,'sign-up');
          result=await context.auth.signInWithPassword(login);
          if(result.error) throw new AuthError(409,'USERNAME_TAKEN','That username is taken. Please choose another.');
        } else result=await context.auth.signInWithPassword(login);
      } else {
        const email=await context.loginEmailForUsername(input.username)||accountEmail(input.username);
        result=await context.auth.signInWithPassword({email,password:input.password});
      }
      if (result.error) throw providerFailure(result.error, signingUp ? "sign-up" : "sign-in");
      const finished = await finishSignIn(context, signingUp ? "/adopt" : "/my-pigeon");
      return json(response, 200, finished);
    }
    if (path === "/api/auth/sign-out") {
      await bodyJson(request);
      // The SDK revokes the current refresh session; GET /logout only shows a button.
      const { error } = await context.auth.signOut({ scope: "local" });
      const expired = error?.name === "AuthSessionMissingError"
        || ["refresh_token_not_found", "refresh_token_already_used", "session_not_found"].includes(error?.code);
      if (error && !expired && ![401, 403, 404].includes(error.status)) throw providerFailure(error, "sign-out");
      context.clearCookies();
      return json(response, 200, { redirect: "/sign-in?notice=signed-out" });
    }
    const user = await verifiedUser(context);
    if (path === "/api/auth/session") {
      const profile = user ? await context.getProfile(user.id) : null;
      return json(response, 200, { configured: true, user: user ? publicUser(user, profile) : null,
        needsProfile: Boolean(user && !profile) });
    }
    if (path === "/api/auth/profile") {
      if (!user) throw new AuthError(401, "SIGN_IN_REQUIRED", "Please sign in first.");
      const body = await bodyJson(request);
      const profile = await context.ensureProfile(user, usernameInput(body.username));
      return json(response, 200, { user: publicUser(user, profile), redirect: "/adopt" });
    }
    if(path==='/api/admin/accounts'||path==='/api/admin/coins') {
      if(!user)throw new AuthError(401,'SIGN_IN_REQUIRED','Please sign in first.');
      const profile=await context.getProfile(user.id);
      if(!profile||!await context.ensureGameAdmin(user.id))throw new AuthError(403,'ADMIN_REQUIRED','Administrator access is required.');
      if(path==='/api/admin/accounts')return json(response,200,await context.getAdminAccounts(user.id));
      const input=await bodyJson(request),username=usernameInput(input.username),amount=Number(input.amount);
      if(!Number.isInteger(amount)||amount<1||amount>100000)throw new AuthError(400,'COIN_AMOUNT','Choose a whole coin amount between 1 and 100,000.');
      return json(response,200,await context.grantAdminCoins(user.id,username,amount));
    }
    if (path.startsWith("/api/game/")) {
      if (!user) throw new AuthError(401, "SIGN_IN_REQUIRED", "Please sign in first.");
      const profile = await context.getProfile(user.id);
      if (!profile) throw new AuthError(409, "PROFILE_REQUIRED", "Choose a username before adopting a pigeon.");
      const result=await dispatchGameApi({path,request,game:context.game,userId:user.id,bodyJson,getCatalog:async()=>getCatalog(),now});
      if(result.handled) return json(response,200,result.data);
      throw new AuthError(404,"GAME_ENDPOINT","Game endpoint not found.");
    }
    if (["sign-up", "sign-in"].includes(mode) && user) return redirect(response, "/my-pigeon");
    if (["profile", "adopt", "home", "inventory", "shop", "game", "admin", "logout"].includes(mode) && !user) return redirect(response, "/sign-in");
    const profile = user && mode !== "logout" ? await context.getProfile(user.id) : null;
    if (["adopt", "home", "inventory", "shop", "game"].includes(mode) && !profile) return redirect(response, "/complete-profile");
    if (mode === "profile" && profile) return redirect(response, "/adopt");
    if(mode==='admin') {
      if(!profile||!await context.ensureGameAdmin(user.id))return redirect(response,'/my-pigeon');
      response.writeHead(200,{"content-type":"text/html; charset=utf-8"});
      return response.end(renderAdminPage(profile,await context.getAdminAccounts(user.id)));
    }
    if (mode === "inventory") {
      response.writeHead(200,{"content-type":"text/html; charset=utf-8"});
      return response.end(renderInventoryPage(await context.game.getInventory(user.id),profile));
    }
    if (mode === "shop") {
      response.writeHead(200,{"content-type":"text/html; charset=utf-8"});
      return response.end(renderShopPage(await context.game.getInventory(user.id),profile));
    }
    if(mode==="game") {
      const pigeon=await context.game.getCurrentPigeon(user.id);
      if(!pigeon) return redirect(response,"/adopt");
      response.writeHead(200,{"content-type":"text/html; charset=utf-8"});
      return response.end(renderMinigamePage(pigeon,profile));
    }
    if (mode === "adopt" || mode === "home") {
      const pigeon = mode === "home" ? await context.game.getCurrentPigeon(user.id) : await context.game.getPigeon(user.id);
      if (mode === "adopt" && pigeon) return redirect(response, "/my-pigeon");
      if (mode === "home" && !pigeon) return redirect(response, "/adopt");
      let dailyQuests={quests:[],resetAt:""};
      let achievements={achievements:[],unlockedCount:0,total:20};
      let inventory={items:[],summary:{distinctOwned:0,totalQuantity:0}};
      if(pigeon) {
        // The roost stays usable during a temporary quest-service outage or while
        // a deployment is between its application and migration steps.
        try {dailyQuests=await context.game.getDailyQuests(user.id);} catch(error) {
          logger.warn?.('Optional game panel unavailable',{feature:'daily-quests',...technicalError(error,{requestId,method:request.method,path})});
        }
        try {achievements=await context.game.getAchievements(user.id);} catch(error) {
          logger.warn?.('Optional game panel unavailable',{feature:'achievements',...technicalError(error,{requestId,method:request.method,path})});
        }
        try {inventory=await context.game.getInventory(user.id);} catch(error) {
          logger.warn?.('Optional game panel unavailable',{feature:'inventory',...technicalError(error,{requestId,method:request.method,path})});
        }
      }
      const html = pigeon ? renderPigeonPage(pigeon, profile, dailyQuests, achievements, inventory) : renderAdoptionPage(await context.game.getStarters());
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return response.end(html);
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(renderAuthPage(mode, { configured: true, user, profile, notice: url.searchParams.get("notice") }));
  }
  return function handleAuth(request, response) {
    // This handler owns only these explicit paths; the legacy server handles everything else.
    const url = new URL(request.url, "http://local.invalid");
    if (!PAGE_MODES.has(url.pathname) && !API_METHODS.has(url.pathname) && url.pathname !== "/auth/callback") return false;
    const requestId=requestReference();
    response.setHeader('x-request-id',requestId);
    dispatch(request, response, url, requestId).catch(error => {
      if (response.writableEnded) return;
      const known = error instanceof AuthError;
      const problem=publicApiError(error,{requestId,presentPigeon:pigeonPresentation});
      const status=problem.status;
      // Never log passwords, tokens, request bodies, email links or provider error messages.
      if (status >= 500) logger.error('Request failed',technicalError(error,{requestId,method:request.method,path:url.pathname}));
      const message=problem.body.error;
      if (known && error.retryAfter) response.setHeader("retry-after", String(error.retryAfter));
      if (url.pathname.startsWith("/api/")) return json(response,status,problem.body);
      securityHeaders(response);
      response.writeHead(status, { "content-type": "text/html; charset=utf-8" });
      response.end(renderAuthPage("error", { message }));
    });
    return true;
  };
}

module.exports = { createAuthHandler };
