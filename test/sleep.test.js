const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {randomUUID} = require("node:crypto");
const {before,after,beforeEach,test} = require("node:test");
const {PGlite} = require("@electric-sql/pglite");
const {fixture} = require("../test-support/auth-fixture");
let db;
before(async () => {
  db = new PGlite();
  await db.exec(`CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;`);
  for (const file of ["migrations/001_tamagotchi.sql","seeds/tamagotchi-starters.sql","migrations/002_adoption.sql","migrations/003_time_engine.sql","migrations/004_feed.sql", "migrations/005_play.sql", "migrations/006_clean.sql", "migrations/007_sleep.sql", "migrations/008_xp_levels.sql", "migrations/009_growth_stages.sql", "migrations/010_coins.sql", "migrations/011_discoveries.sql"]) {
    await db.exec(fs.readFileSync(path.join(__dirname,"..",file),"utf8"));
  }
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
const post = (f,body) => f.request("/api/game/sleep",{body});

test("Sleep applies 48 hours of decay before restoring energy and happiness without rewards",async t => {
  const f = await setup(t);
  await db.exec("UPDATE public.game_pigeons SET xp=27,created_at=now()-interval '49 hours',last_updated=now()-interval '48 hours'");
  const response = await post(f,{...input(),energy:999,xp:999,coins:999,userId:randomUUID(),now:"2099-01-01"});
  assert.equal(response.status,200);
  const result = await response.json();
  for (const [key,value] of Object.entries({hunger:4,happiness:57,energy:82,cleanliness:76,health:100})) assert.ok(Math.abs(Number(result.pigeon[key])-value)<0.01,key);
  assert.equal(result.pigeon.xp,27);
  assert.equal(result.pigeon.level,1);
  assert.equal(result.pigeon.growth_stage,"hatchling");
  assert.equal(result.pigeon.user_id,f.user.id);
  assert.equal(result.pigeon.last_slept_at,result.pigeon.last_updated);
  assert.deepEqual(result.effects,{energy:30,happiness:5});
  assert.match(result.statsHtml,/82 percent — Rested/);
  assert.equal((await db.query("SELECT coins FROM public.game_users")).rows[0].coins,0);
});
test("Sleep caps both stats at 100 and permits an already rested pigeon without XP",async t => {
  const f = await setup(t);
  await db.exec("UPDATE public.game_pigeons SET energy=90,happiness=99,last_updated=now()+interval '1 minute'");
  const result = await (await post(f,input())).json();
  assert.equal(Number(result.pigeon.energy),100);
  assert.equal(Number(result.pigeon.happiness),100);
  assert.deepEqual(result.effects,{energy:10,happiness:1});
  await db.exec("UPDATE public.game_pigeons SET last_slept_at=last_slept_at-interval '11 seconds'");
  const full = await (await post(f,input())).json();
  assert.deepEqual(full.effects,{energy:0,happiness:0});
  assert.equal(full.pigeon.xp,0);
});
test("a pigeon at zero energy can rest and play again",async t => {
  const f = await setup(t);
  await db.exec("UPDATE public.game_pigeons SET energy=0,happiness=0,health=23");
  const tired = await f.request("/api/game/play",{body:input()});
  assert.equal((await tired.json()).code,"TOO_TIRED");
  const rested = await (await post(f,input())).json();
  assert.equal(Number(rested.pigeon.energy),30);
  assert.equal(Number(rested.pigeon.happiness),5);
  assert.equal(Number(rested.pigeon.health),23);
  assert.equal(rested.pigeon.xp,0);
  const response = await f.request("/api/game/play",{body:input()});
  assert.equal(response.status,200);
  const played = await response.json();
  assert.ok(Math.abs(Number(played.pigeon.energy)-20)<0.01);
  assert.equal(played.pigeon.xp,10);
});

test("duplicate and old Sleep retries never restore energy twice",async t => {
  const f = await setup(t), body=input();
  await db.exec("UPDATE public.game_pigeons SET energy=0,happiness=0");
  const responses = await Promise.all([post(f,body),post(f,body)]);
  for (const response of responses) assert.equal(response.status,200);
  const parsed = await Promise.all(responses.map(response=>response.json()));
  assert.equal(parsed.filter(result=>result.replayed).length,1);
  await db.exec("UPDATE public.game_pigeons SET last_slept_at=last_slept_at-interval '11 seconds'");
  assert.equal((await post(f,input())).status,200);
  const retry = await (await post(f,body)).json();
  assert.equal(retry.replayed,true);
  assert.ok(Math.abs(Number(retry.pigeon.energy)-60)<0.01);
  assert.ok(Math.abs(Number(retry.pigeon.happiness)-10)<0.01);
  assert.equal(retry.pigeon.xp,0);
  assert.equal((await db.query("SELECT count(*) FROM public.game_sleep_receipts")).rows[0].count,2);
});

test("different Sleep requests during cooldown cannot multiply recovery",async t => {
  const f = await setup(t);
  await db.exec("UPDATE public.game_pigeons SET energy=0");
  const responses = await Promise.all([post(f,input()),post(f,input())]);
  assert.deepEqual(responses.map(response=>response.status).sort(),[200,429]);
  const blocked = responses.find(response=>response.status===429);
  assert.ok(Number(blocked.headers.get("retry-after"))>0);
  assert.equal((await blocked.json()).code,"SLEEP_COOLDOWN");
  assert.equal(Number((await db.query("SELECT energy FROM public.game_pigeons")).rows[0].energy),30);
});

test("Sleep validates input, method, origin, authentication and ownership",async t => {
  const f = await setup(t);
  for (const body of [{},{requestId:null},{requestId:"bad"}]) assert.equal((await post(f,body)).status,400);
  assert.equal((await f.request("/api/game/sleep")).status,405);
  assert.equal((await f.request("/api/game/sleep",{body:input(),origin:"https://evil.example"})).status,403);
  assert.equal((await f.request("/api/game/sleep",{body:input(),cookie:""})).status,401);
  await f.signup("OtherBird");
  assert.equal((await post(f,{...input(),userId:f.user.id})).status,409);
  assert.equal((await db.query("SELECT last_slept_at FROM public.game_pigeons")).rows[0].last_slept_at,null);
});

test("failed Sleep receipt storage rolls back decay, recovery and cooldown",async t => {
  const f = await setup(t), body=input();
  await db.exec("UPDATE public.game_pigeons SET energy=20,created_at=now()-interval '2 hours',last_updated=now()-interval '1 hour'");
  const before = (await db.query("SELECT * FROM public.game_pigeons")).rows[0];
  await db.exec(`CREATE FUNCTION public.reject_sleep_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Test receipt failure'; END $$;
    CREATE TRIGGER reject_sleep_receipt BEFORE INSERT ON public.game_sleep_receipts FOR EACH ROW EXECUTE FUNCTION public.reject_sleep_receipt()`);
  try {
    assert.equal((await post(f,body)).status,503);
    assert.deepEqual((await db.query("SELECT * FROM public.game_pigeons")).rows[0],before);
  } finally { await db.exec("DROP TRIGGER reject_sleep_receipt ON public.game_sleep_receipts; DROP FUNCTION public.reject_sleep_receipt()"); }
  assert.equal((await post(f,body)).status,200);
  assert.ok(Math.abs(Number((await db.query("SELECT energy FROM public.game_pigeons")).rows[0].energy)-49)<0.01);
});

test("only the server can run Sleep and access its receipts",async t => {
  const f = await setup(t);
  for (const role of ["anon","authenticated"]) {
    for (const sql of ["SELECT public.sleep_game_pigeon($1,gen_random_uuid())", "SELECT result FROM public.game_sleep_receipts WHERE user_id=$1", "INSERT INTO public.game_sleep_receipts(user_id,request_id,pigeon_id,result) VALUES($1,gen_random_uuid(),gen_random_uuid(),'{}')"]) {
      await db.exec(`BEGIN; SET LOCAL ROLE ${role}`);
      await assert.rejects(db.query(sql,[f.user.id]),{code:"42501"});
      await db.exec("ROLLBACK");
    }
  }
  await db.exec("BEGIN; SET LOCAL ROLE service_role");
  assert.equal((await db.query("SELECT public.sleep_game_pigeon($1,gen_random_uuid()) AS result",[f.user.id])).rows[0].result.pigeon.xp,0);
  await db.exec("ROLLBACK");
});

test("all four care actions and refresh share one persisted timeline across login",async t => {
  const f = await setup(t);
  await db.exec("UPDATE public.game_pigeons SET cleanliness=60,created_at=now()-interval '49 hours',last_updated=now()-interval '48 hours'");
  const responses = await Promise.all([post(f,input()),f.request("/api/game/play",{body:input()}),f.request("/api/game/clean",{body:input()}),f.request("/api/game/feed",{body:{food:"crumbs",requestId:randomUUID()}}),f.request("/api/game/pigeon")]);
  for (const response of responses) assert.equal(response.status,200);
  await f.request("/api/auth/sign-out",{body:{}});
  await f.request("/api/auth/sign-in",{body:{email:"BirdFriend@example.test",password:"a good test password"}});
  const result = (await (await f.request("/api/game/pigeon")).json()).pigeon;
  assert.equal(result.xp,20);
  for (const [key,value] of Object.entries({hunger:19,happiness:79,energy:72,cleanliness:66})) assert.ok(Math.abs(Number(result[key])-value)<0.01,key);
});
