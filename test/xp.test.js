const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {randomUUID} = require("node:crypto");
const {before,after,beforeEach,test} = require("node:test");
const {PGlite} = require("@electric-sql/pglite");
const {fixture} = require("../test-support/auth-fixture");
let db, migrated, oldRetry;
before(async () => {
  db = new PGlite();
  await db.exec(`CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;`);
  for (const file of ["migrations/001_tamagotchi.sql","seeds/tamagotchi-starters.sql","migrations/002_adoption.sql","migrations/003_time_engine.sql","migrations/004_feed.sql", "migrations/005_play.sql", "migrations/006_clean.sql", "migrations/007_sleep.sql"]) {
    await db.exec(fs.readFileSync(path.join(__dirname,"..",file),"utf8"));
  }
  const userId = "30000000-0000-4000-8000-000000000001", requestId = randomUUID();
  await db.query("INSERT INTO auth.users VALUES($1)",[userId]);
  await db.query("INSERT INTO public.game_users(id,username) VALUES($1,'LegacyBird')",[userId]);
  await db.query("SELECT public.adopt_game_pigeon($1,'jacobin pigeon','Gilbert')",[userId]);
  await db.exec("UPDATE public.game_pigeons SET xp=95");
  await db.query("SELECT public.feed_game_pigeon($1,$2,'crumbs')",[userId,requestId]);
  const before = (await db.query("SELECT * FROM public.game_pigeons")).rows[0];
  await db.exec(fs.readFileSync(path.join(__dirname,"../migrations/008_xp_levels.sql"),"utf8"));
  await db.exec(fs.readFileSync(path.join(__dirname,"../migrations/009_growth_stages.sql"),"utf8"));
  migrated = {before,after:(await db.query("SELECT * FROM public.game_pigeons")).rows[0]};
  oldRetry = (await db.query("SELECT public.feed_game_pigeon($1,$2,'crumbs') AS result",[userId,requestId])).rows[0].result;
  await db.exec(fs.readFileSync(path.join(__dirname,"../migrations/010_coins.sql"),"utf8"));
  await db.exec(fs.readFileSync(path.join(__dirname,"../migrations/011_discoveries.sql"),"utf8"));
});
after(async () => { await db?.close(); });
beforeEach(async () => { await db.exec("TRUNCATE public.game_pigeons,public.game_users,auth.users CASCADE"); });
async function setup(t) {
  const f = await fixture(t,{gameDb:db});
  const user = (await (await f.signup()).json()).user;
  await f.request("/api/game/adopt",{body:{speciesId:"jacobin pigeon",nickname:"Gilbert"}});
  return {...f,user};
}
const input = () => ({requestId:randomUUID()});
const post = (f,body) => f.request("/api/game/feed",{body:{food:"crumbs",...body}});

test("migration converts earned XP without altering stats or time and preserves old receipts", () => {
  assert.equal(migrated.before.xp,100);
  assert.equal(migrated.after.level,2);
  assert.equal(migrated.after.xp,0);
  assert.equal(Number(migrated.after.xp_to_next_level),200);
  for (const key of ["last_updated","last_fed_at","hunger","energy","happiness","cleanliness","health","growth_stage"]) assert.deepEqual(migrated.after[key],migrated.before[key],key);
  assert.equal(migrated.after.version,migrated.before.version+1);
  assert.equal(oldRetry.replayed,true);
  assert.equal(oldRetry.pigeon.level,2);
  assert.equal(oldRetry.pigeon.xp,0,"Pre-migration receipt must not award 5 XP again");
});
test("central XP helper handles boundaries, carry-over, multiple levels and existing levels",async t => {
  await setup(t);
  for (const [level,xp,amount,expectedLevel,expectedXp] of [[1,94,5,1,99],[1,95,5,2,0],[1,98,5,2,3],[1,0,650,4,50],[3,650,0,4,350],[2,198,10,3,8],[1,0,0,1,0]]) {
    await db.query("UPDATE public.game_pigeons SET level=$1,xp=$2",[level,xp]);
    const state=(await db.query("SELECT (public.add_pigeon_xp(p,$1)).* FROM public.game_pigeons p",[amount])).rows[0];
    assert.equal(state.level,expectedLevel);
    assert.equal(state.xp,expectedXp);
    assert.equal(Number(state.xp_to_next_level),100*expectedLevel);
    assert.equal(state.growth_stage,"hatchling");
  }
  await assert.rejects(db.query("SELECT public.add_pigeon_xp(p,-1) FROM public.game_pigeons p"),{code:"22023"});
  await assert.rejects(db.query("SELECT public.add_pigeon_xp(p,NULL) FROM public.game_pigeons p"),{code:"22023"});
  await assert.rejects(db.query("SELECT public.pigeon_xp_required(0)"),{code:"22023"});
  await assert.rejects(db.query("SELECT public.pigeon_xp_reward('sleep')"),{code:"22023"});
});
test("Feed, Play and Clean use the same XP rules; Sleep and refresh award none",async t => {
  const f=await setup(t);
  for (const [action,amount] of [["feed",5],["play",10],["clean",5]]) {
    await db.exec("UPDATE public.game_pigeons SET level=1,xp=98");
    const response=await f.request(`/api/game/${action}`,{body:{...input(),food:"crumbs",xp:999,level:999}});
    assert.equal(response.status,200);
    const result=await response.json();
    assert.equal(result.pigeon.level,2);
    assert.equal(result.pigeon.xp,98+amount-100);
    assert.equal(result.effects.xp,amount);
    assert.match(result.xpHtml,new RegExp(`${98+amount-100} / 200 XP toward Level 3`));
  }
  const before=(await db.query("SELECT level,xp FROM public.game_pigeons")).rows[0];
  await f.request("/api/game/sleep",{body:input()});
  await f.request("/api/game/pigeon");
  assert.deepEqual((await db.query("SELECT level,xp FROM public.game_pigeons")).rows[0],before);
});

test("duplicate level-up requests and older retries never award XP twice",async t => {
  const f=await setup(t), body=input();
  await db.exec("UPDATE public.game_pigeons SET xp=98");
  const responses=await Promise.all([post(f,body),post(f,body)]);
  for (const response of responses) assert.equal(response.status,200);
  assert.deepEqual((await db.query("SELECT level,xp FROM public.game_pigeons")).rows[0],{level:2,xp:3});
  await f.request("/api/game/clean",{body:input()});
  const retry=await (await post(f,body)).json();
  assert.equal(retry.replayed,true);
  assert.equal(retry.pigeon.level,2);
  assert.equal(retry.pigeon.xp,8);
});

test("concurrent different actions cross the level boundary exactly once and survive login",async t => {
  const f=await setup(t);
  await db.exec("UPDATE public.game_pigeons SET xp=95");
  const results=await Promise.all([post(f,input()),f.request("/api/game/play",{body:input()}),f.request("/api/game/clean",{body:input()})]);
  for (const response of results) assert.equal(response.status,200);
  await f.request("/api/auth/sign-out",{body:{}});
  await f.request("/api/auth/sign-in",{body:{username:"BirdFriend",password:"a good test password"}});
  const state=(await (await f.request("/api/game/pigeon")).json()).pigeon;
  assert.equal(state.level,2); assert.equal(state.xp,15);
  const page=await (await f.request("/my-pigeon")).text();
  assert.match(page,/<dd id="levelValue">2<\/dd>/);
  assert.match(page,/15 \/ 200 XP toward Level 3/);
  assert.equal((await db.query("SELECT coins FROM public.game_users")).rows[0].coins,9);
});

test("receipt failure rolls back level, XP and care effects together",async t => {
  const f=await setup(t);
  await db.exec("UPDATE public.game_pigeons SET xp=98");
  const before=(await db.query("SELECT * FROM public.game_pigeons")).rows[0];
  await db.exec(`CREATE FUNCTION public.reject_xp_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Test failure'; END $$;
    CREATE TRIGGER reject_xp_receipt BEFORE INSERT ON public.game_feed_receipts FOR EACH ROW EXECUTE FUNCTION public.reject_xp_receipt()`);
  try {
    assert.equal((await post(f,input())).status,503);
    assert.deepEqual((await db.query("SELECT * FROM public.game_pigeons")).rows[0],before);
  } finally {await db.exec("DROP TRIGGER reject_xp_receipt ON public.game_feed_receipts; DROP FUNCTION public.reject_xp_receipt()");}
});

test("XP helpers are server-only and no browser XP endpoint exists",async t => {
  const f=await setup(t);
  for (const role of ["anon","authenticated"]) {
    for (const sql of ["SELECT public.pigeon_xp_required(1)","SELECT public.pigeon_xp_reward('feed')","SELECT public.add_pigeon_xp(p,100) FROM public.game_pigeons p"]) {
      await db.exec(`BEGIN; SET LOCAL ROLE ${role}`);
      await assert.rejects(db.query(sql),{code:"42501"});
      await db.exec("ROLLBACK");
    }
  }
  await db.exec("BEGIN; SET LOCAL ROLE service_role");
  const value=(await db.query("SELECT (public.add_pigeon_xp(p,100)).level AS level FROM public.game_pigeons p")).rows[0].level;
  assert.equal(value,2);
  await db.exec("ROLLBACK");
  assert.equal((await f.request("/api/game/xp",{body:{xp:1000}})).status,404);
});
