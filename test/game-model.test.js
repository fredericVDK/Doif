const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { before, after, beforeEach, test } = require("node:test");
const { PGlite } = require("@electric-sql/pglite");
const { STARTERS, getStarterSpecies } = require("../lib/game/species");
const { buildStarterSeed } = require("../scripts/seed-game");
const snapshot = require("../data/birdnet-pigeons.json");
const checkedSeed = fs.readFileSync(path.join(__dirname, "../seeds/tamagotchi-starters.sql"), "utf8");

const USER_A = "10000000-0000-4000-8000-000000000001";
const USER_B = "10000000-0000-4000-8000-000000000002";
let db;

before(async () => {
  db = new PGlite();
  // Only model the Supabase SQL contract here. This is NOT a replacement Auth implementation.
  await db.exec(`
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    -- Simulate permissive public-schema defaults to verify the migration revokes them.
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
  `);
  await db.exec(fs.readFileSync(path.join(__dirname, "../migrations/001_tamagotchi.sql"), "utf8"));
});

after(async () => { if (db) await db.close(); });

beforeEach(async () => {
  await db.exec("TRUNCATE public.game_pigeons, public.game_users, public.game_species, auth.users CASCADE;");
  await db.exec(checkedSeed);
});

async function createUser(id = USER_A, username = "BirdFriend") {
  await db.query("INSERT INTO auth.users (id, email) VALUES ($1, $2)", [id, `${username}@example.test`]);
  await db.query("INSERT INTO public.game_users (id, username) VALUES ($1, $2)", [id, username]);
}

async function createPigeon(userId = USER_A) {
  const result = await db.query(
    "INSERT INTO public.game_pigeons (user_id, species_id, nickname) VALUES ($1, $2, $3) RETURNING *",
    [userId, STARTERS[0].id, "Gilbert"]
  );
  return result.rows[0];
}

async function asRole(role, userId, action) {
  assert.ok(["anon", "authenticated", "service_role"].includes(role));
  await db.exec("BEGIN");
  try {
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [userId || ""]);
    await db.exec(`SET LOCAL ROLE ${role}`);
    return await action();
  } finally {
    // Also clears the aborted transaction after a deliberately denied statement.
    await db.exec("ROLLBACK");
  }
}

test("starter seed uses the three real species and preserves source credits", async () => {
  assert.equal(checkedSeed.replace(/\r\n/g, "\n"), buildStarterSeed(snapshot.records));
  const { rows } = await db.query("SELECT * FROM public.game_species ORDER BY id");
  assert.equal(rows.length, 3);
  for (const row of rows) {
    const original = snapshot.records.find(record => record.id === row.id);
    assert.equal(row.name, original.name);
    assert.equal(row.scientific_name, original.scientificName);
    assert.equal(row.description, original.history);
    assert.equal(row.image, original.image);
    assert.deepEqual(row.image_attribution, original.imageAttribution);
    assert.equal(row.source_url, original.sourceUrl);
    assert.equal(row.habitat, null);
    assert.equal(row.diet, null);
    assert.equal(row.rarity, "common");
    assert.equal(row.is_starter, true);
  }
});

test("repeated seeds refresh source data without erasing curated fields or player progress", async () => {
  await createUser();
  await createPigeon();
  await db.exec("UPDATE public.game_species SET name = 'Stale name', habitat = 'Reviewed habitat', diet = 'Reviewed diet', rarity = 'rare', is_starter = false");
  await db.exec("UPDATE public.game_pigeons SET xp = 12, hunger = 48.125");
  await db.exec(buildStarterSeed(snapshot.records));
  const { rows } = await db.query("SELECT * FROM public.game_species");
  assert.equal(rows.length, 3);
  assert.ok(rows.every(row => row.name !== "Stale name" && row.rarity === "rare" && !row.is_starter));
  assert.ok(rows.every(row => row.habitat === "Reviewed habitat" && row.diet === "Reviewed diet"));
  const pigeon = (await db.query("SELECT * FROM public.game_pigeons")).rows[0];
  assert.equal(pigeon.xp, 12);
  assert.equal(Number(pigeon.hunger), 48.125);
});

test("catalogue text containing SQL, apostrophes, Unicode and backslashes remains data", async () => {
  const records = structuredClone(snapshot.records);
  const text = "Dove'); DROP TABLE public.game_users; -- \\ 🕊 O'Brien";
  records.find(row => row.id === STARTERS[0].id).history = text;
  await db.exec(buildStarterSeed(records));
  const { rows } = await db.query("SELECT description FROM public.game_species WHERE id = $1", [STARTERS[0].id]);
  assert.equal(rows[0].description, text);
  await createUser();
});

test("changed, missing, duplicate and domestic starter records fail before seeding", () => {
  const starters = STARTERS.map(starter => snapshot.records.find(row => row.id === starter.id));
  assert.throws(() => getStarterSpecies(null), /Expected catalogue/);
  assert.throws(() => getStarterSpecies(starters.slice(1)), /Missing or changed/);
  assert.throws(() => getStarterSpecies([...starters, starters[0]]), /Missing or changed/);
  assert.throws(() => getStarterSpecies(starters.map(row => ({ ...row, kind: "breed" }))), /Missing or changed/);
  assert.throws(() => getStarterSpecies(starters.map(row => ({ ...row, scientificName: "Unknown" }))), /Missing or changed/);
  assert.throws(() => getStarterSpecies(starters.map(row => ({ ...row, sourceUrl: "javascript:alert(1)" }))), /Missing source/);
});

test("starter projection keeps the catalogue unchanged and handles unavailable photos", () => {
  const original = JSON.stringify(snapshot.records);
  const projected = getStarterSpecies(snapshot.records);
  projected[0].imageAttribution.author = "Changed";
  assert.equal(JSON.stringify(snapshot.records), original);
  const rows = snapshot.records.map(row => ({ ...row, image: "javascript:alert(1)" }));
  assert.ok(getStarterSpecies(rows).every(row => row.image === "assets/pigeon-hero-wide.png"));
});

test("a new user and pigeon receive the requested initial values and UTC timestamps", async () => {
  await createUser();
  const pigeon = await createPigeon();
  const user = (await db.query("SELECT * FROM public.game_users")).rows[0];
  assert.equal(user.coins, 0);
  assert.equal(pigeon.level, 1);
  assert.equal(pigeon.xp, 0);
  assert.equal(pigeon.growth_stage, "hatchling");
  assert.equal(pigeon.version, 0);
  for (const stat of ["hunger", "happiness", "energy", "cleanliness", "health"]) {
    assert.equal(Number(pigeon[stat]), 100);
  }
  assert.equal(new Date(pigeon.created_at).getTime(), new Date(pigeon.last_updated).getTime());
  assert.match(pigeon.id, /^[0-9a-f-]{36}$/);
});

test("database constraints enforce the stats range, including NaN and fractional decay", async () => {
  await createUser();
  await createPigeon();
  for (const stat of ["hunger", "happiness", "energy", "cleanliness", "health"]) {
    for (const invalid of [-1, 101, "NaN", "Infinity", null]) {
      await assert.rejects(db.query(`UPDATE public.game_pigeons SET ${stat} = $1`, [invalid]));
    }
    for (const valid of [0, 100, 43.125]) {
      const { rows } = await db.query(`UPDATE public.game_pigeons SET ${stat} = $1 RETURNING ${stat}`, [valid]);
      assert.equal(Number(rows[0][stat]), valid);
    }
  }
  assert.equal((await db.query("SELECT count(*) FROM public.game_pigeons")).rows[0].count, 1);
});

test("one pigeon per account, real species references and Auth identity references are enforced", async () => {
  await assert.rejects(db.query("INSERT INTO public.game_users (id, username) VALUES ($1, 'Ghost')", [USER_A]), { code: "23503" });
  await createUser();
  await assert.rejects(db.query("INSERT INTO public.game_pigeons (user_id, species_id, nickname) VALUES ($1, 'invented', 'Ghost')", [USER_A]), { code: "23503" });
  await createPigeon();
  await assert.rejects(createPigeon(), { code: "23505" });
  await assert.rejects(createPigeon(USER_B), { code: "23503" });
  await assert.rejects(db.query("DELETE FROM public.game_species WHERE id = $1", [STARTERS[0].id]), { code: "23001" });
});

test("profile uniqueness, currency and pigeon state reject invalid values", async () => {
  await createUser();
  await createPigeon();
  await db.query("INSERT INTO auth.users (id) VALUES ($1)", [USER_B]);
  await assert.rejects(db.query("INSERT INTO public.game_users (id, username) VALUES ($1, 'birdfriend')", [USER_B]), { code: "23505" });
  for (const username of ["", "ab", " leading", "<script>", "a".repeat(25)]) {
    await assert.rejects(db.query("UPDATE public.game_users SET username = $1", [username]), { code: "23514" });
  }
  await assert.rejects(db.exec("UPDATE public.game_users SET coins = -1"), { code: "23514" });
  for (const nickname of ["", " ", " Gilbert", "Gilbert ", "a".repeat(33), "line\nbreak"]) {
    await assert.rejects(db.query("UPDATE public.game_pigeons SET nickname = $1", [nickname]), { code: "23514" });
  }
  await db.query("UPDATE public.game_pigeons SET nickname = $1", ["Émile 🕊"]);
  for (const assignment of ["level = 0", "xp = -1", "version = -1", "growth_stage = 'dead'", "last_updated = created_at - interval '1 second'", "last_updated = 'infinity'"]) {
    await assert.rejects(db.exec(`UPDATE public.game_pigeons SET ${assignment}`), { code: "23514" });
  }
  await assert.rejects(db.exec("UPDATE public.game_species SET rarity = 'mythical'"), { code: "23514" });
});

test("authenticated readers only see their own profile and pigeon; anonymous visitors see species", async () => {
  await createUser();
  await createUser(USER_B, "OtherFriend");
  await createPigeon();
  await createPigeon(USER_B);
  for (const userId of [USER_A, USER_B]) {
    await asRole("authenticated", userId, async () => {
      const users = (await db.query("SELECT * FROM public.game_users")).rows;
      const pigeons = (await db.query("SELECT * FROM public.game_pigeons")).rows;
      assert.deepEqual(users.map(row => row.id), [userId]);
      assert.deepEqual(pigeons.map(row => row.user_id), [userId]);
    });
  }
  await asRole("authenticated", null, async () => {
    assert.deepEqual((await db.query("SELECT * FROM public.game_pigeons")).rows, []);
  });
  await asRole("anon", null, async () => {
    assert.equal((await db.query("SELECT * FROM public.game_species")).rows.length, 3);
  });
  for (const table of ["game_users", "game_pigeons"]) {
    await assert.rejects(asRole("anon", null, () => db.query(`SELECT * FROM public.${table}`)), { code: "42501" });
  }
});

test("clients cannot write game state even for themselves or through permissive defaults", async () => {
  await createUser();
  await createPigeon();
  for (const role of ["anon", "authenticated"]) {
    for (const table of ["game_users", "game_species", "game_pigeons"]) {
      for (const sql of [
        `INSERT INTO public.${table} DEFAULT VALUES`,
        `UPDATE public.${table} SET id = id`,
        `DELETE FROM public.${table}`,
        `TRUNCATE public.${table} CASCADE`
      ]) {
        await assert.rejects(asRole(role, USER_A, () => db.exec(sql)), { code: "42501" });
      }
    }
  }
  await asRole("service_role", null, async () => {
    const { rows } = await db.query("UPDATE public.game_users SET coins = coins + 2 WHERE id = $1 RETURNING coins", [USER_A]);
    assert.equal(rows[0].coins, 2);
  });
});

test("a failed multi-table transaction rolls back rewards and stats together", async () => {
  await createUser();
  await createPigeon();
  await assert.rejects(db.transaction(async tx => {
    await tx.query("UPDATE public.game_users SET coins = 10 WHERE id = $1", [USER_A]);
    await tx.query("UPDATE public.game_pigeons SET hunger = 101 WHERE user_id = $1", [USER_A]);
  }), { code: "23514" });
  assert.equal((await db.query("SELECT coins FROM public.game_users")).rows[0].coins, 0);
  assert.equal(Number((await db.query("SELECT hunger FROM public.game_pigeons")).rows[0].hunger), 100);
});

test("account deletion removes its game data and retains the species catalogue", async () => {
  await createUser();
  await createPigeon();
  await db.query("DELETE FROM auth.users WHERE id = $1", [USER_A]);
  assert.deepEqual((await db.query("SELECT * FROM public.game_users")).rows, []);
  assert.deepEqual((await db.query("SELECT * FROM public.game_pigeons")).rows, []);
  assert.equal((await db.query("SELECT * FROM public.game_species")).rows.length, 3);
});
