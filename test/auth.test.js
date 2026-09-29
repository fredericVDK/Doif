const assert = require("node:assert/strict");
const { test } = require("node:test");
const { readAuthConfig } = require("../lib/auth/supabase");
const { fixture } = require("../test-support/auth-fixture");

test("unconfigured accounts show honest disabled forms while protected routes fail closed", async t => {
  const f = await fixture(t, { configured: false });
  for (const path of ["/sign-in", "/sign-up"]) {
    const response = await f.request(path);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /fieldset disabled/);
  }
  assert.deepEqual(await (await f.request("/api/auth/session")).json(), { configured: false, user: null });
  assert.equal((await f.request("/my-pigeon")).status, 503);
  assert.equal((await f.signup()).status, 503);
  assert.equal(f.provider.calls.length, 0);
});

test("registration, verified session, logout and login preserve the profile", async t => {
  const f = await fixture(t);
  const created = await f.signup("BirdFriend", { coins: 999999, userId: "forged" });
  assert.equal(created.status, 200);
  const payload = await created.json();
  assert.equal(payload.redirect, "/adopt");
  assert.equal(payload.user.coins, 0);
  assert.ok(created.headers.getSetCookie().every(value => /HttpOnly/.test(value) && /SameSite=Lax/.test(value) && !/Domain=/.test(value)));
  assert.doesNotMatch(JSON.stringify(payload), /access_token|refresh_token|test-server-secret|password/);
  const session = await (await f.request("/api/auth/session")).json();
  assert.equal(session.user.id, payload.user.id);
  assert.equal((await f.request("/adopt")).status, 200);
  const beforeLogout = f.provider.refresh.size;
  const logoutPage = await f.request("/logout");
  assert.equal(logoutPage.status, 200);
  assert.equal(f.provider.refresh.size, beforeLogout, "GET must not revoke a session");
  const out = await f.request("/api/auth/sign-out", { body: {} });
  assert.equal(out.status, 200);
  assert.equal(f.jar.size, 0);
  assert.equal(f.provider.refresh.size, beforeLogout - 1);
  assert.equal((await (await f.request("/api/auth/session")).json()).user, null);
  const login = await f.request("/api/auth/sign-in", { body: { email: "BirdFriend@example.test", password: "a good test password" } });
  assert.equal(login.status, 200);
  assert.equal((await login.json()).redirect, "/my-pigeon");
  assert.equal(f.provider.profiles.size, 1);
  assert.equal((await f.request("/my-pigeon")).headers.get("location"), "/adopt");
});

test("email confirmation uses PKCE and creates a profile only after confirmation", async t => {
  const f = await fixture(t);
  f.provider.state.confirmation = true;
  const response = await f.signup();
  assert.equal(response.status, 202);
  assert.equal((await response.json()).confirmationRequired, true);
  assert.equal(f.provider.profiles.size, 0);
  assert.ok([...f.jar.keys()].some(name => name.includes("code-verifier")));
  const code = [...f.provider.codes.keys()][0];
  const flowId = f.provider.codes.get(code).flowId;
  const badBrowser = await f.request(`/auth/callback?code=${code}`, { cookie: "", updateCookies: false });
  assert.equal(badBrowser.headers.get("location"), "/sign-in?notice=confirmation-failed");
  const callback = await f.request(`/auth/callback?code=${code}${flowId ? `&sb_flow_id=${encodeURIComponent(flowId)}` : ""}&next=https://evil.example`);
  assert.equal(callback.headers.get("location"), "/adopt");
  assert.equal(f.provider.profiles.size, 1);
  assert.equal((await (await f.request("/api/auth/session")).json()).user.username, "BirdFriend");
  const reused = await f.request(`/auth/callback?code=${code}`);
  assert.equal(reused.headers.get("location"), "/sign-in?notice=confirmation-failed");
});

test("protected pages reject anonymous and forged sessions, regardless of nickname cookie", async t => {
  const f = await fixture(t);
  for (const path of ["/adopt", "/my-pigeon", "/complete-profile"]) {
    const response = await f.request(path, { cookie: "pigeon_session=ses_admin" });
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), "/sign-in");
  }
  const forged = `pigeon_account=base64-${Buffer.from(JSON.stringify({ access_token: "forged.jwt.token", refresh_token: "fake", expires_at: Date.now() / 1000 + 3600, user: { id: "victim", email: "victim@example.test" } })).toString("base64url")}`;
  assert.equal((await f.request("/my-pigeon", { cookie: forged })).headers.get("location"), "/sign-in");
  assert.equal((await f.request("/api/auth/profile", { body: { username: "Stolen" }, cookie: forged })).status, 401);
});

test("cookie user data and request IDs cannot select another user's profile", async t => {
  const f = await fixture(t);
  await f.signup("FirstBird");
  const firstSession = [...f.provider.access.values()][0];
  await f.signup("SecondBird");
  const secondUser = f.provider.users.get("SecondBird@example.test").user;
  const forged = `pigeon_account=base64-${Buffer.from(JSON.stringify({ ...firstSession, user: secondUser })).toString("base64url")}`;
  const result = await (await f.request(`/api/auth/session?userId=${secondUser.id}`, { cookie: forged })).json();
  assert.equal(result.user.username, "FirstBird");
  assert.equal(result.user.id, firstSession.user.id);
});

test("expired access sessions refresh through the SDK and persist rotated cookies", async t => {
  const f = await fixture(t);
  await f.signup();
  const initial = [...f.provider.access.values()][0];
  const expired = `pigeon_account=base64-${Buffer.from(JSON.stringify({ ...initial, expires_at: 1 })).toString("base64url")}`;
  const response = await f.request("/api/auth/session", { cookie: expired });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).user.username, "BirdFriend");
  assert.ok(response.headers.getSetCookie().length);
  assert.ok(f.provider.calls.some(call => call.grant === "refresh_token"));
  assert.equal((await (await f.request("/api/auth/session")).json()).user.username, "BirdFriend");
});

test("profile conflicts offer setup and recover without trusting client balances or IDs", async t => {
  const f = await fixture(t);
  await f.signup("BirdFriend");
  const second = await f.signup("birdfriend", { email: "another@example.test" });
  assert.equal((await second.json()).redirect, "/complete-profile");
  assert.equal((await f.request("/my-pigeon")).headers.get("location"), "/complete-profile");
  const conflict = await f.request("/api/auth/profile", { body: { username: "BirdFriend" } });
  assert.equal(conflict.status, 409);
  const fixed = await f.request("/api/auth/profile", { body: { username: "OtherBird", coins: 9000, id: "victim" } });
  assert.equal(fixed.status, 200);
  const result = await fixed.json();
  assert.equal(result.user.coins, 0);
  assert.equal(result.user.username, "OtherBird");
  assert.equal(result.redirect, "/adopt");
  await f.request("/api/auth/profile", { body: { username: "ReplaceName" } });
  assert.equal(f.provider.profiles.get(result.user.id).username, "OtherBird");
});

test("logout remains available during a profile outage and clears an already revoked refresh session", async t => {
  const f = await fixture(t);
  await f.signup();
  f.provider.state.storageDown = true;
  assert.equal((await f.request("/logout")).status, 200);
  const initial = [...f.provider.access.values()][0];
  f.provider.refresh.clear();
  const expired = `pigeon_account=base64-${Buffer.from(JSON.stringify({ ...initial, expires_at: 1 })).toString("base64url")}`;
  // Replace the browser's session, rather than retaining unrelated cookies in the test jar.
  f.jar.clear();
  f.jar.set("pigeon_account", expired.slice("pigeon_account=".length));
  const response = await f.request("/api/auth/sign-out", { body: {} });
  assert.equal(response.status, 200);
  assert.equal(f.jar.size, 0);
});

test("cross-origin login/logout, missing origins and unsupported methods are rejected", async t => {
  const f = await fixture(t);
  for (const origin of ["https://evil.example", "null", ""]) {
    const response = await f.request("/api/auth/sign-up", { body: { username: "BirdFriend" }, origin });
    assert.equal(response.status, 403);
  }
  const unsupported = await f.request("/api/auth/sign-out");
  assert.equal(unsupported.status, 405);
  assert.equal(unsupported.headers.get("allow"), "POST");
  assert.equal(f.provider.calls.length, 0);
  await f.signup();
  const response = await f.request("/api/auth/sign-out", { body: {}, origin: "https://evil.example" });
  assert.equal(response.status, 403);
  assert.equal((await (await f.request("/api/auth/session")).json()).user.username, "BirdFriend");
});

test("input validation and login errors never expose credentials or provider details", async t => {
  const f = await fixture(t);
  for (const change of [{ username: "<script>" }, { email: "invalid" }, { password: "short" }, { password: "a".repeat(129) }]) {
    assert.equal((await f.signup("BirdFriend", change)).status, 400);
  }
  assert.equal(f.provider.calls.length, 0);
  assert.equal((await f.request("/api/auth/sign-in", { body: { email: "unknown@example.test", password: "wrong" } })).status, 401);
  const large = await f.signup("BirdFriend", { padding: "x".repeat(9000) });
  assert.equal(large.status, 413);
  assert.equal((await f.request("/api/auth/sign-up", { body: {}, headers: { "content-type": "text/plain" } })).status, 415);
  assert.equal((await f.request("/api/auth/sign-up", { body: [] })).status, 400);
});

test("storage errors fail closed and a retry recovers the partially created account", async t => {
  const f = await fixture(t);
  f.provider.state.storageDown = true;
  const failed = await f.signup();
  assert.equal(failed.status, 503);
  assert.equal((await failed.json()).code, "PROFILE_STORAGE");
  assert.equal(f.provider.profiles.size, 0);
  assert.doesNotMatch(JSON.stringify(f.errors), /password|refresh-|test-server-secret|BirdFriend@example/);
  f.provider.state.storageDown = false;
  const retry = await f.request("/api/auth/sign-in", { body: { email: "BirdFriend@example.test", password: "a good test password" } });
  assert.equal(retry.status, 200);
  assert.equal(f.provider.profiles.size, 1);
});

test("HTTPS cookies are host-scoped, HttpOnly and Secure; account responses cannot be cached", async t => {
  const f = await fixture(t, { secure: true });
  const response = await f.signup();
  assert.equal(response.status, 200);
  for (const cookie of response.headers.getSetCookie()) {
    assert.match(cookie, /^__Host-pigeon_account/);
    assert.match(cookie, /; Secure/);
    assert.match(cookie, /; HttpOnly/);
    assert.match(cookie, /; Path=\//);
    assert.doesNotMatch(cookie, /Domain=/);
  }
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.match(response.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  const page = await f.request("/my-pigeon");
  assert.match(page.headers.get("cache-control"), /no-store/);
  assert.equal(page.headers.get("referrer-policy"), "no-referrer");
});

test("authentication attempts are limited independently from anonymous session cookies", async t => {
  const f = await fixture(t);
  let response;
  for (let i = 0; i < 21; i++) response = await f.request("/api/auth/sign-in", {
    body: { email: "unknown@example.test", password: "incorrect" }, cookie: `pigeon_session=different-${i}`
  });
  assert.equal(response.status, 429);
  assert.ok(Number(response.headers.get("retry-after")) > 0);
  assert.equal(f.provider.calls.length, 20);
});

test("unsafe configured origins and Supabase URLs are rejected", () => {
  const env = { SUPABASE_URL: "https://supabase.example.test", SUPABASE_PUBLISHABLE_KEY: "public", SUPABASE_SECRET_KEY: "secret", APP_ORIGIN: "https://pigeon.example.test" };
  for (const value of ["http://public.example", "https://user:pass@pigeon.example", "https://pigeon.example/path", "https://pigeon.example?x=1"]) {
    assert.throws(() => readAuthConfig({ ...env, APP_ORIGIN: value }), { code: "AUTH_CONFIG" });
  }
  assert.equal(readAuthConfig({}), null);
  assert.equal(readAuthConfig(env).secure, true);
});
