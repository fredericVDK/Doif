const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { before, after, beforeEach, test } = require("node:test");
const { PGlite } = require("@electric-sql/pglite");
const { fixture } = require("../test-support/auth-fixture");
const { getStarterBreeds, STARTER_BREEDS } = require("../lib/game/starter-breeds");
const { buildAdoptionSeed } = require("../scripts/seed-adoption");
const { renderAdoptionPage, renderPigeonPage } = require("../lib/game/pages");
const records = require("../data/domestic-pigeons.json").records;
const read = filename => fs.readFileSync(path.join(__dirname, "..", filename), "utf8");
const migration = read("migrations/002_adoption.sql");
const oldId = "10000000-0000-4000-8000-000000000001";
let db;

before(async () => {
  db = new PGlite();
  await db.exec(`CREATE SCHEMA auth; CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;`);
  await db.exec(read("migrations/001_tamagotchi.sql"));
  await db.exec(read("seeds/tamagotchi-starters.sql"));
  await db.query("INSERT INTO auth.users (id) VALUES ($1)", [oldId]);
  await db.query("INSERT INTO public.game_users (id,username,coins) VALUES ($1, 'OriginalBird', 42)", [oldId]);
  await db.query("INSERT INTO public.game_pigeons (user_id,species_id,nickname,xp) VALUES ($1,'birdnet:BN03520','Old friend',25)", [oldId]);
  const before = (await db.query("SELECT * FROM public.game_pigeons")).rows;
  await db.exec(migration);
  assert.deepEqual((await db.query("SELECT * FROM public.game_pigeons")).rows, before, "Upgrade preserves every saved pigeon field");
  assert.equal((await db.query("SELECT coins FROM public.game_users")).rows[0].coins, 42);
  await db.exec(read("migrations/003_time_engine.sql"));
  await db.exec(read("migrations/004_feed.sql"));
  await db.exec(read("migrations/005_play.sql"));
  await db.exec(read("migrations/006_clean.sql"));
  await db.exec(read("migrations/007_sleep.sql"));
  await db.exec(read("migrations/008_xp_levels.sql"));
  await db.exec(read("migrations/009_growth_stages.sql"));
  await db.exec(read("migrations/010_coins.sql"));
  await db.exec(read("migrations/011_discoveries.sql"));
});
after(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec("TRUNCATE public.game_pigeons, public.game_users, auth.users CASCADE");
});

test("upgrade seeds exactly the requested breeds while retaining the former species", async () => {
  const generated = migration.split("-- BEGIN GENERATED STARTERS\n")[1].split("-- END GENERATED STARTERS")[0];
  assert.equal(generated, buildAdoptionSeed(records));
  const starters = (await db.query("SELECT * FROM public.game_species WHERE is_starter")).rows;
  assert.deepEqual(starters.map(row => row.id).sort(), [...STARTER_BREEDS].sort());
  assert.equal((await db.query("SELECT count(*) FROM public.game_species")).rows[0].count, 6);
  for (const row of starters) {
    assert.equal(row.kind, "breed");
    assert.equal(row.parent_species_id, "birdnet:BN03514");
    assert.equal(row.scientific_name, "Columba livia");
    assert.equal(row.description, records.find(record => record.id === row.id).fact);
  }
  assert.throws(() => getStarterBreeds(records.filter(record => record.id !== STARTER_BREEDS[0])));
  assert.throws(() => getStarterBreeds([...records, records.find(record => record.id === STARTER_BREEDS[0])]));
});

test("adoption uses verified identity and database defaults, persists through login and redirects returning owners", async t => {
  const f = await fixture(t, { gameDb: db });
  const account = await (await f.signup()).json();
  assert.equal((await f.request("/my-pigeon")).headers.get("location"), "/adopt");
  const page = await f.request("/adopt");
  assert.equal(page.status, 200);
  const html = await page.text();
  for (const name of ["Jacobin pigeon", "Indian Fantail", "Australian Saddleback Tumbler"]) assert.ok(html.includes(name));
  const response = await f.request("/api/game/adopt", { body: {
    speciesId: STARTER_BREEDS[0], nickname: "  Gilbert 🕊  ", userId: oldId, coins: 100000, xp: 500, level: 100, health: 0, created_at: "yesterday"
  } });
  assert.equal(response.status, 200);
  const { pigeon, redirect } = await response.json();
  assert.equal(redirect, "/my-pigeon");
  assert.equal(pigeon.user_id, account.user.id);
  assert.equal(pigeon.nickname, "Gilbert 🕊");
  assert.equal(pigeon.level, 1);
  assert.equal(pigeon.xp, 0);
  assert.equal(pigeon.version, 0);
  for (const stat of ["hunger", "happiness", "energy", "cleanliness", "health"]) assert.equal(Number(pigeon[stat]), 100);
  assert.equal(pigeon.growth_stage, "hatchling");
  assert.equal(pigeon.created_at, pigeon.last_updated);
  assert.equal((await f.request("/adopt")).headers.get("location"), "/my-pigeon");
  assert.match(await (await f.request("/my-pigeon")).text(), /Gilbert 🕊/);
  await f.request("/api/auth/sign-out", { body: {} });
  await f.request("/api/auth/sign-in", { body: { email: "BirdFriend@example.test", password: "a good test password" } });
  const saved = await (await f.request("/api/game/pigeon")).json();
  assert.equal(saved.pigeon.id, pigeon.id);
  assert.equal(saved.pigeon.species.name, "Jacobin pigeon");
  assert.equal((await db.query("SELECT coins FROM public.game_users")).rows[0].coins, 0);
});

test("concurrent retries create one pigeon and conflicting adoption cannot reset progress", async t => {
  const f = await fixture(t, { gameDb: db });
  await f.signup();
  const body = { speciesId: STARTER_BREEDS[1], nickname: "Feathers" };
  const responses = await Promise.all([f.request("/api/game/adopt", { body }), f.request("/api/game/adopt", { body })]);
  const pigeons = await Promise.all(responses.map(async response => { assert.equal(response.status, 200); return (await response.json()).pigeon; }));
  assert.equal(pigeons[0].id, pigeons[1].id);
  await db.exec("UPDATE public.game_pigeons SET xp = 15, health = 74, version = 3");
  const retry = await (await f.request("/api/game/adopt", { body })).json();
  assert.equal(retry.pigeon.xp, 15);
  assert.equal(retry.pigeon.version, 3);
  assert.equal(Number(retry.pigeon.health), 74);
  assert.equal(retry.pigeon.created_at, pigeons[0].created_at);
  const different = await f.request("/api/game/adopt", { body: { ...body, speciesId: STARTER_BREEDS[2] } });
  assert.equal(different.status, 409);
  assert.equal((await different.json()).code, "ALREADY_ADOPTED");
  assert.equal((await db.query("SELECT count(*) FROM public.game_pigeons")).rows[0].count, 1);
});

test("dashboard renders the owner's stats and balance while preserving unrelated game state", async t => {
  const f = await fixture(t, { gameDb: db });
  const account = await (await f.signup()).json();
  await f.request("/api/game/adopt", { body: { speciesId: STARTER_BREEDS[1], nickname: "My <little> bird" } });
  await db.query(`UPDATE public.game_pigeons SET health=0, hunger=80.25, happiness=29,
    energy=54, cleanliness=100, level=3, xp=27 WHERE user_id=$1`, [account.user.id]);
  await db.query("UPDATE public.game_users SET coins=1234 WHERE id=$1", [account.user.id]);
  const before = (await db.query("SELECT * FROM public.game_pigeons")).rows;
  const response = await f.request("/my-pigeon?coins=99999&health=100");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /My &lt;little&gt; bird/);
  assert.match(html, /<dt>Level<\/dt><dd id="levelValue">3<\/dd>/);
  assert.match(html, /<dt>XP<\/dt><dd id="xpValue">27<\/dd>/);
  assert.match(html, /Coins<\/dt><dd id="coinsValue" aria-label="Pigeon Coins">1,234<\/dd>/);
  for (const [key, value] of [["health", 0], ["hunger", 80.25], ["happiness", 29], ["energy", 54], ["cleanliness", 100]]) {
    const actual = Number(html.match(new RegExp(`id="${key}Meter" min="0" max="100" value="([^"]+)"`))[1]);
    assert.ok(Math.abs(actual - value) < 0.01, `${key} only changes by elapsed time`);
  }
  assert.match(html, /0 percent — Needs care/);
  assert.match(html, /80\.[23] percent — Full/);
  assert.equal((html.match(/class="care-action" type="button" disabled/g) || []).length, 0);
  assert.match(html, /id="sleepButton"/);
  assert.doesNotMatch(html, /Coins<\/dt><dd id="coinsValue" aria-label="Pigeon Coins">99,999<\/dd>/);
  await f.request("/my-pigeon");
  const after = (await db.query("SELECT * FROM public.game_pigeons")).rows[0];
  for (const key of ["id", "user_id", "nickname", "species_id", "health", "level", "xp", "growth_stage", "created_at"]) {
    assert.deepEqual(after[key], before[0][key]);
  }
  assert.ok(after.last_updated >= before[0].last_updated);
  assert.equal((await db.query("SELECT coins FROM public.game_users")).rows[0].coins, 1234);
  await f.signup("OtherBird");
  assert.equal((await f.request(`/my-pigeon?userId=${account.user.id}`)).headers.get("location"), "/adopt");
});

test("adoption rejects anonymous, cross-origin, invalid inputs, missing profiles and unavailable starters", async t => {
  const f = await fixture(t, { gameDb: db });
  const body = { speciesId: STARTER_BREEDS[2], nickname: "Gilbert" };
  assert.equal((await f.request("/api/game/adopt", { body })).status, 401);
  assert.equal((await f.request("/api/game/pigeon")).status, 401);
  assert.equal((await f.request("/api/game/starters")).status, 401);
  await f.signup();
  assert.equal((await f.request("/api/game/adopt", { body, origin: "https://evil.example" })).status, 403);
  assert.equal((await f.request("/api/game/adopt")).status, 405);
  for (const change of [{ nickname: "   " }, { nickname: "x".repeat(33) }, { nickname: "two\nlines" },
    { nickname: 42 }, { speciesId: "birdnet:BN03514" }, { speciesId: "unknown" }]) {
    assert.equal((await f.request("/api/game/adopt", { body: { ...body, ...change } })).status, 400);
  }
  await db.query("UPDATE public.game_species SET is_starter = false WHERE id = $1", [body.speciesId]);
  assert.equal((await f.request("/api/game/adopt", { body })).status, 400);
  assert.equal((await f.request("/adopt")).status, 503);
  await db.query("UPDATE public.game_species SET is_starter = true WHERE id = $1", [body.speciesId]);
  f.provider.profiles.clear();
  await db.exec("DELETE FROM public.game_users");
  assert.equal((await f.request("/api/game/adopt", { body })).status, 409);
  assert.equal((await db.query("SELECT count(*) FROM public.game_pigeons")).rows[0].count, 0);
});

test("one account cannot read or adopt for another, even with forged query IDs", async t => {
  const f = await fixture(t, { gameDb: db });
  await f.signup("FirstBird");
  const first = await (await f.request("/api/game/adopt", { body: { speciesId: STARTER_BREEDS[0], nickname: "First" } })).json();
  await f.signup("SecondBird");
  assert.equal((await (await f.request(`/api/game/pigeon?userId=${first.pigeon.user_id}`)).json()).pigeon, null);
  const second = await (await f.request("/api/game/adopt", { body: { speciesId: STARTER_BREEDS[2], nickname: "Second", userId: first.pigeon.user_id } })).json();
  assert.notEqual(second.pigeon.user_id, first.pigeon.user_id);
  assert.equal((await db.query("SELECT count(*) FROM public.game_pigeons")).rows[0].count, 2);
});

test("storage failure is honest, retryable, and never presented as a saved adoption", async t => {
  const f = await fixture(t, { gameDb: db });
  await f.signup();
  f.provider.state.gameDown = true;
  const body = { speciesId: STARTER_BREEDS[0], nickname: "Later" };
  const failed = await f.request("/api/game/adopt", { body });
  assert.equal(failed.status, 503);
  assert.equal((await failed.json()).code, "GAME_STORAGE");
  assert.equal((await f.request("/my-pigeon")).status, 503);
  assert.equal((await db.query("SELECT count(*) FROM public.game_pigeons")).rows[0].count, 0);
  f.provider.state.gameDown = false;
  assert.equal((await f.request("/api/game/adopt", { body })).status, 200);
});

test("the SQL adoption function is server-only, validates inputs and preserves RLS", async t => {
  const f = await fixture(t, { gameDb: db });
  const account = await (await f.signup()).json();
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`BEGIN; SET LOCAL ROLE ${role}`);
    await assert.rejects(db.query("SELECT * FROM public.adopt_game_pigeon($1,$2,$3)", [account.user.id, STARTER_BREEDS[0], "Nope"]), { code: "42501" });
    await db.exec("ROLLBACK");
  }
  for (const name of [null, "", " spaced ", "bad\nname", "x".repeat(33)]) {
    await assert.rejects(db.query("SELECT * FROM public.adopt_game_pigeon($1,$2,$3)", [account.user.id, STARTER_BREEDS[0], name]), { code: "22023" });
  }
  await assert.rejects(db.query("SELECT * FROM public.adopt_game_pigeon($1,$2,$3)", [oldId, STARTER_BREEDS[0], "No user"]), { code: "23503" });
  await db.exec("BEGIN; SET LOCAL ROLE service_role");
  const result = await db.query("SELECT * FROM public.adopt_game_pigeon($1,$2,$3)", [account.user.id, STARTER_BREEDS[0], "🕊".repeat(32)]);
  assert.equal([...result.rows[0].nickname].length, 32);
  await db.exec("COMMIT");
  await db.exec("BEGIN; SET LOCAL ROLE authenticated");
  assert.equal((await db.query("SELECT * FROM public.game_pigeons")).rows.length, 0);
  await db.exec("ROLLBACK");
});

test("templates escape names and untrusted URLs rather than executing catalogue markup", () => {
  const starters = getStarterBreeds(records);
  starters[0] = { ...starters[0], name: '<script>alert("bird")</script>', source_url: "javascript:alert(1)", image: "https://untrusted.example/track" };
  const html = renderAdoptionPage(starters);
  assert.doesNotMatch(html, /<script>alert|javascript:|untrusted.example/);
  assert.match(html, /&lt;script&gt;/);
  const home = renderPigeonPage({ nickname: '<img src=x onerror="alert(1)">', species: starters[0] });
  assert.doesNotMatch(home, /<img src=x/);
});
