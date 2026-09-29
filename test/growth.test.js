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
  for (const file of ["migrations/001_tamagotchi.sql","seeds/tamagotchi-starters.sql","migrations/002_adoption.sql","migrations/003_time_engine.sql","migrations/004_feed.sql", "migrations/005_play.sql", "migrations/006_clean.sql", "migrations/007_sleep.sql", "migrations/008_xp_levels.sql"]) {
    await db.exec(fs.readFileSync(path.join(__dirname,"..",file),"utf8"));
  }
  const userId="30000000-0000-4000-8000-000000000001", requestId=randomUUID();
  await db.query("INSERT INTO auth.users VALUES($1)",[userId]);
  await db.query("INSERT INTO public.game_users(id,username) VALUES($1,'LegacyBird')",[userId]);
  await db.query("SELECT public.adopt_game_pigeon($1,'jacobin pigeon','Gilbert')",[userId]);
  await db.exec("UPDATE public.game_pigeons SET level=4,xp=395");
  await db.query("SELECT public.feed_game_pigeon($1,$2,'crumbs')",[userId,requestId]);
  const before=(await db.query("SELECT * FROM public.game_pigeons")).rows[0];
  await db.exec(fs.readFileSync(path.join(__dirname,"../migrations/009_growth_stages.sql"),"utf8"));
  migrated={before,after:(await db.query("SELECT * FROM public.game_pigeons")).rows[0]};
  oldRetry=(await db.query("SELECT public.feed_game_pigeon($1,$2,'crumbs') AS result",[userId,requestId])).rows[0].result;
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

test("growth migration repairs existing stages and keeps old action receipts valid", () => {
  assert.equal(migrated.before.level,5);
  assert.equal(migrated.before.growth_stage,"hatchling");
  assert.equal(migrated.after.growth_stage,"juvenile");
  for (const key of ["xp","level","last_updated","last_fed_at","hunger","happiness","energy","cleanliness","health"]) assert.deepEqual(migrated.after[key],migrated.before[key],key);
  assert.equal(migrated.after.version,migrated.before.version+1);
  assert.equal(oldRetry.replayed,true);
  assert.equal(oldRetry.pigeon.growth_stage,"juvenile");
  assert.equal(oldRetry.pigeon.xp,0);
});
test("growth rule covers every boundary and rejects invalid levels",async () => {
  for (const [level,stage] of [[1,"hatchling"],[4,"hatchling"],[5,"juvenile"],[9,"juvenile"],[10,"adult"],[24,"adult"],[25,"best_friend"],[26,"best_friend"],[2147483647,"best_friend"]]) {
    assert.equal((await db.query("SELECT public.get_pigeon_growth_stage($1) AS stage",[level])).rows[0].stage,stage);
  }
  for (const level of [0,-1,null]) await assert.rejects(db.query("SELECT public.get_pigeon_growth_stage($1)",[level]),{code:"22023"});
});
test("each rewarded action saves the new growth stage with level and XP",async t => {
  const f=await setup(t);
  for (const [action,level,xp,stage,label] of [["feed",4,395,"juvenile","Juvenile"],["play",9,895,"adult","Adult"],["clean",24,2395,"best_friend","Best Friend"]]) {
    await db.query("UPDATE public.game_pigeons SET level=$1,xp=$2",[level,xp]);
    const response=await f.request(`/api/game/${action}`,{body:{...input(),food:"crumbs",growth_stage:"best_friend",level:999}});
    assert.equal(response.status,200);
    const result=await response.json();
    assert.equal(result.pigeon.level,level+1);
    assert.equal(result.pigeon.growth_stage,stage);
    assert.equal(result.growthLabel,label);
    assert.match(result.growthHtml,new RegExp(`data-stage="${stage}"`));
    assert.equal((await db.query("SELECT growth_stage FROM public.game_pigeons")).rows[0].growth_stage,stage);
  }
});

test("multi-level XP jumps return and persist the final stage, never an intermediate one",async t => {
  await setup(t);
  const result=(await db.query("SELECT (public.add_pigeon_xp(p,30050)).* FROM public.game_pigeons p")).rows[0];
  assert.equal(result.level,25); assert.equal(result.xp,50); assert.equal(result.growth_stage,"best_friend");
  await db.query("UPDATE public.game_pigeons SET level=$1,xp=$2",[result.level,result.xp]);
  assert.equal((await db.query("SELECT growth_stage FROM public.game_pigeons")).rows[0].growth_stage,"best_friend");
});

test("new adoption starts as hatchling and stale manual stage writes are corrected",async t => {
  await setup(t);
  assert.equal((await db.query("SELECT growth_stage FROM public.game_pigeons")).rows[0].growth_stage,"hatchling");
  await db.exec("UPDATE public.game_pigeons SET growth_stage='best_friend'");
  assert.equal((await db.query("SELECT growth_stage FROM public.game_pigeons")).rows[0].growth_stage,"hatchling");
  await db.exec("UPDATE public.game_pigeons SET level=10,growth_stage='hatchling'");
  assert.equal((await db.query("SELECT growth_stage FROM public.game_pigeons")).rows[0].growth_stage,"adult");
});

test("duplicate growth-boundary actions do not double rewards and progress survives login",async t => {
  const f=await setup(t), body=input();
  await db.exec("UPDATE public.game_pigeons SET level=4,xp=395");
  const responses=await Promise.all([post(f,body),post(f,body)]);
  for (const response of responses) assert.equal(response.status,200);
  await f.request("/api/auth/sign-out",{body:{}});
  await f.request("/api/auth/sign-in",{body:{email:"BirdFriend@example.test",password:"a good test password"}});
  const state=(await (await f.request("/api/game/pigeon")).json()).pigeon;
  assert.equal(state.level,5); assert.equal(state.xp,0); assert.equal(state.growth_stage,"juvenile");
  const html=await (await f.request("/my-pigeon")).text();
  assert.match(html,/data-stage="juvenile">Juvenile/);
  await f.request("/api/game/sleep",{body:input()});
  assert.equal((await db.query("SELECT growth_stage FROM public.game_pigeons")).rows[0].growth_stage,"juvenile");
});

test("failed receipt storage rolls growth back with level, XP and care effects",async t => {
  const f=await setup(t);
  await db.exec("UPDATE public.game_pigeons SET level=9,xp=895");
  const before=(await db.query("SELECT * FROM public.game_pigeons")).rows[0];
  await db.exec(`CREATE FUNCTION public.reject_growth_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Test failure'; END $$;
    CREATE TRIGGER reject_growth_receipt BEFORE INSERT ON public.game_feed_receipts FOR EACH ROW EXECUTE FUNCTION public.reject_growth_receipt()`);
  try {
    assert.equal((await post(f,input())).status,503);
    assert.deepEqual((await db.query("SELECT * FROM public.game_pigeons")).rows[0],before);
  } finally {await db.exec("DROP TRIGGER reject_growth_receipt ON public.game_feed_receipts; DROP FUNCTION public.reject_growth_receipt()");}
});

test("growth helpers remain server-only",async t => {
  await setup(t);
  for (const role of ["anon","authenticated"]) {
    await db.exec(`BEGIN; SET LOCAL ROLE ${role}`);
    await assert.rejects(db.query("SELECT public.get_pigeon_growth_stage(25)"),{code:"42501"});
    await db.exec("ROLLBACK");
  }
  await db.exec("BEGIN; SET LOCAL ROLE service_role");
  await db.exec("UPDATE public.game_pigeons SET level=25");
  assert.equal((await db.query("SELECT growth_stage FROM public.game_pigeons")).rows[0].growth_stage,"best_friend");
  await db.exec("ROLLBACK");
});
