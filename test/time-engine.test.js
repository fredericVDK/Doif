const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { before, after, beforeEach, test } = require("node:test");
const { PGlite } = require("@electric-sql/pglite");
const { fixture } = require("../test-support/auth-fixture");
const USER = "10000000-0000-4000-8000-000000000001";
let db;
before(async () => {
  db = new PGlite();
  await db.exec(`CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;`);
  for (const file of ["migrations/001_tamagotchi.sql", "seeds/tamagotchi-starters.sql", "migrations/002_adoption.sql", "migrations/003_time_engine.sql"]) {
    await db.exec(fs.readFileSync(path.join(__dirname, "..", file), "utf8"));
  }
});
after(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec("TRUNCATE public.game_pigeons, public.game_users, auth.users CASCADE");
});
async function pigeon() {
  await db.query("INSERT INTO auth.users VALUES ($1)", [USER]);
  await db.query("INSERT INTO public.game_users(id,username,coins) VALUES ($1,'TimeBird',42)", [USER]);
  await db.query(`INSERT INTO public.game_pigeons(user_id,species_id,nickname,created_at,last_updated,xp)
    VALUES ($1,'jacobin pigeon','Gilbert','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z',27)`, [USER]);
  return (await db.query("SELECT * FROM public.game_pigeons")).rows[0];
}
async function calculate(now) {
  return (await db.query("SELECT (public.calculate_current_pigeon_state(p,$1::timestamptz)).* FROM public.game_pigeons p", [now])).rows[0];
}
function stats(row) { return ["hunger", "happiness", "energy", "cleanliness"].map(key => Number(row[key])); }

test("central calculation handles an hour, fractional hours and a 48-hour absence", async () => {
  const original = await pigeon();
  assert.deepEqual(stats(await calculate("2026-01-01T01:00:00Z")), [98,99,99,99.5]);
  assert.deepEqual(stats(await calculate("2026-01-01T00:30:00Z")), [99,99.5,99.5,99.75]);
  const twoDays = await calculate("2026-01-03T00:00:00Z");
  assert.deepEqual(stats(twoDays), [4,52,52,76]);
  for (const key of ["health", "xp", "level", "growth_stage", "created_at", "id", "nickname"]) assert.deepEqual(twoDays[key], original[key]);
  assert.equal(twoDays.version, original.version + 1);
  assert.equal(twoDays.last_updated.toISOString(), "2026-01-03T00:00:00.000Z");
  assert.deepEqual((await db.query("SELECT * FROM public.game_pigeons")).rows[0], original, "Pure calculation never writes");
});

test("very long absence reaches zero without death, deletion or negative stats", async () => {
  await pigeon();
  const result = await calculate("2126-01-01T00:00:00Z");
  assert.deepEqual(stats(result), [0,0,0,0]);
  assert.equal(Number(result.health), 100);
  assert.equal(result.nickname, "Gilbert");
  assert.equal(result.growth_stage, "hatchling");
  assert.equal((await db.query("SELECT count(*) FROM public.game_pigeons")).rows[0].count, 1);
});

test("same instant, backward clocks and timezone offsets never double decay or rewind", async () => {
  const original = await pigeon();
  for (const now of ["2026-01-01T00:00:00Z", "2026-01-01T01:00:00+01:00", "2025-12-31T23:00:00Z"]) {
    assert.deepEqual(await calculate(now), original);
  }
  for (const now of [null, "infinity", "-infinity"]) await assert.rejects(calculate(now), { code: "22023" });
});

test("many tiny updates retain fractional decay instead of rounding it away", async () => {
  await pigeon();
  await db.exec(`DO $$ DECLARE p public.game_pigeons; next_state public.game_pigeons;
    BEGIN FOR i IN 1..1000 LOOP
      SELECT * INTO p FROM public.game_pigeons;
      next_state := public.calculate_current_pigeon_state(p, p.last_updated + interval '0.01 seconds');
      UPDATE public.game_pigeons SET hunger=next_state.hunger, happiness=next_state.happiness,
        energy=next_state.energy, cleanliness=next_state.cleanliness,
        last_updated=next_state.last_updated, version=next_state.version;
    END LOOP; END $$;`);
  const result = (await db.query("SELECT * FROM public.game_pigeons")).rows[0];
  for (const [index, rate] of [2,1,1,0.5].entries()) assert.ok(Math.abs(stats(result)[index] - (100 - rate * 10 / 3600)) < 1e-9);
  assert.equal(result.version, 1000);
  assert.equal(result.last_updated.toISOString(), "2026-01-01T00:00:10.000Z");
});

test("refresh persists the exact returned state and repeated requests only charge new elapsed time", async () => {
  await pigeon();
  await db.exec("UPDATE public.game_pigeons SET created_at=now()-interval '49 hours', last_updated=now()-interval '48 hours'");
  const results = await Promise.all(Array.from({length:5}, () => db.query("SELECT public.refresh_game_pigeon($1) AS pigeon", [USER])));
  const first = results[0].rows[0].pigeon;
  assert.ok(Math.abs(Number(first.hunger) - 4) < 0.01);
  const saved = (await db.query("SELECT to_jsonb(p) AS pigeon FROM public.game_pigeons p")).rows[0].pigeon;
  const last = results.at(-1).rows[0].pigeon;
  const { species, ...lastState } = last;
  assert.deepEqual(lastState, saved);
  assert.equal(species.name, "Jacobin pigeon");
  const elapsed = (Date.parse(last.last_updated) - Date.parse(first.last_updated)) / 3600000;
  assert.ok(Math.abs(Number(last.hunger) - (Number(first.hunger) - elapsed * 2)) < 0.00001);
  assert.equal(Number(last.health), 100);
  assert.equal((await db.query("SELECT coins FROM public.game_users")).rows[0].coins, 42);
});

test("a failed save rolls back stats and timestamp together", async () => {
  const original = await pigeon();
  await db.exec(`CREATE FUNCTION public.reject_test_save() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'Test save failure'; END $$;
    CREATE TRIGGER reject_test_save BEFORE UPDATE ON public.game_pigeons FOR EACH ROW EXECUTE FUNCTION public.reject_test_save();`);
  try {
    await assert.rejects(db.query("SELECT public.refresh_game_pigeon($1)", [USER]));
    assert.deepEqual((await db.query("SELECT * FROM public.game_pigeons")).rows[0], original);
  } finally { await db.exec("DROP TRIGGER reject_test_save ON public.game_pigeons; DROP FUNCTION public.reject_test_save()"); }
});

test("engine functions are server-only and missing pigeons return null", async () => {
  await pigeon();
  for (const role of ["anon", "authenticated"]) {
    for (const query of ["SELECT public.refresh_game_pigeon($1)", "SELECT public.calculate_current_pigeon_state(p,now()) FROM public.game_pigeons p WHERE user_id=$1"]) {
      await db.exec(`BEGIN; SET LOCAL ROLE ${role}`);
      await assert.rejects(db.query(query, [USER]), { code: "42501" });
      await db.exec("ROLLBACK");
    }
  }
  await db.exec("BEGIN; SET LOCAL ROLE service_role");
  assert.ok((await db.query("SELECT public.refresh_game_pigeon($1) AS pigeon", [USER])).rows[0].pigeon);
  assert.equal((await db.query("SELECT public.refresh_game_pigeon(gen_random_uuid()) AS pigeon")).rows[0].pigeon, null);
  await db.exec("ROLLBACK");
});

test("dashboard and API apply 48-hour decay using verified identity and ignore client time/stats", async t => {
  const f = await fixture(t, { gameDb: db });
  const user = (await (await f.signup()).json()).user;
  await f.request("/api/game/adopt", { body: { speciesId: "jacobin pigeon", nickname: "Gilbert" } });
  await db.exec("UPDATE public.game_pigeons SET created_at=now()-interval '49 hours', last_updated=now()-interval '48 hours'");
  const response = await f.request(`/api/game/pigeon?userId=${USER}&now=2126-01-01&hunger=100`);
  assert.equal(response.status, 200);
  const current = (await response.json()).pigeon;
  assert.equal(current.user_id, user.id);
  assert.ok(Math.abs(Number(current.hunger) - 4) < 0.01);
  const page = await f.request("/my-pigeon");
  assert.equal(page.status, 200);
  assert.match(await page.text(), /4 percent — Hungry/);
  await f.signup("OtherBird");
  assert.equal((await (await f.request(`/api/game/pigeon?userId=${user.id}`)).json()).pigeon, null);
  assert.equal((await f.request("/api/game/pigeon", {cookie:""})).status, 401);
  f.provider.state.gameDown = true;
  const failed = await f.request("/api/game/pigeon");
  assert.equal(failed.status, 503);
  assert.equal((await failed.json()).code, "GAME_ENGINE");
});
