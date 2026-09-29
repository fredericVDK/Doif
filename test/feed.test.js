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
  for (const file of ["migrations/001_tamagotchi.sql","seeds/tamagotchi-starters.sql","migrations/002_adoption.sql","migrations/003_time_engine.sql","migrations/004_feed.sql", "migrations/005_play.sql", "migrations/006_clean.sql", "migrations/007_sleep.sql", "migrations/008_xp_levels.sql", "migrations/009_growth_stages.sql", "migrations/010_coins.sql", "migrations/011_discoveries.sql", "migrations/012_daily_reward.sql", "migrations/013_inventory.sql", "migrations/014_shop.sql", "migrations/015_daily_quests.sql", "migrations/016_achievements.sql", "migrations/017_catch_the_crumbs.sql", "migrations/018_inventory_feeding.sql"]) {
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
const input = () => ({food:"crumbs",requestId:randomUUID()});
const post = (f,body) => f.request("/api/game/feed",{body});

test("feeding applies elapsed time first and saves crumbs, 5 XP and receipt atomically",async t => {
  const f = await setup(t);
  await db.exec("UPDATE public.game_pigeons SET created_at=now()-interval '49 hours',last_updated=now()-interval '48 hours'");
  const response = await post(f,{...input(),xp:999,coins:999,hunger:100,userId:randomUUID(),now:"2099-01-01"});
  assert.equal(response.status,200);
  const result = await response.json();
  assert.ok(Math.abs(Number(result.pigeon.hunger)-19)<0.01);
  assert.ok(Math.abs(Number(result.pigeon.happiness)-54)<0.01);
  assert.ok(Math.abs(Number(result.pigeon.energy)-52)<0.01);
  assert.ok(Math.abs(Number(result.pigeon.cleanliness)-76)<0.01);
  assert.equal(Number(result.pigeon.health),100);
  assert.equal(result.pigeon.xp,5);
  assert.equal(result.pigeon.level,1);
  assert.equal(result.pigeon.user_id,f.user.id);
  assert.deepEqual(result.effects,{hunger:15,happiness:2,xp:5,coins:2});
  assert.equal(result.pigeon.last_fed_at,result.pigeon.last_updated);
  assert.match(result.statsHtml,/19 percent — Hungry/);
  assert.equal((await db.query("SELECT coins FROM public.game_users")).rows[0].coins,2);
  assert.equal((await db.query("SELECT count(*) FROM public.game_feed_receipts")).rows[0].count,1);
});

test("crumbs cap both needs at 100 and remain usable on a newly adopted full pigeon",async t => {
  const f = await setup(t);
  const result = await (await post(f,input())).json();
  assert.equal(Number(result.pigeon.hunger),100);
  assert.equal(Number(result.pigeon.happiness),100);
  assert.equal(result.pigeon.xp,5);
  assert.ok(Number(result.effects.hunger)<0.01);
  assert.ok(Number(result.effects.happiness)<0.01);
});

test("owned food applies its catalogue effects and consumes exactly one item",async t => {
  const f = await setup(t);
  await db.query("INSERT INTO public.game_user_items(user_id,item_id,quantity) VALUES($1,'corn',2)",[f.user.id]);
  await db.exec("UPDATE public.game_pigeons SET hunger=20,happiness=20,energy=20,cleanliness=20,last_updated=now(),last_fed_at=NULL");
  const result=await (await post(f,{food:'corn',requestId:randomUUID()})).json();
  assert.ok(Math.abs(Number(result.pigeon.hunger)-42)<0.01);
  assert.ok(Math.abs(Number(result.pigeon.happiness)-23)<0.01);
  assert.equal(result.food,'corn');
  assert.equal(result.item.quantity,1);
  assert.deepEqual(result.effects,{hunger:22,happiness:3,xp:5,coins:2});
  assert.equal((await db.query("SELECT quantity FROM public.game_user_items WHERE user_id=$1 AND item_id='corn'",[f.user.id])).rows[0].quantity,1);
});

test("inventory food cannot be forged, consumed twice by a retry, or lost on cooldown",async t => {
  const f = await setup(t);
  const missing=await post(f,{food:'peas',requestId:randomUUID()});
  assert.equal(missing.status,409);
  assert.equal((await missing.json()).code,'FOOD_NOT_OWNED');
  await db.query("INSERT INTO public.game_user_items(user_id,item_id,quantity) VALUES($1,'sunflower_seeds',2)",[f.user.id]);
  const body={food:'sunflower_seeds',requestId:randomUUID()};
  const first=await (await post(f,body)).json();
  assert.equal(first.item.quantity,1);
  assert.ok(Number(first.effects.energy)<0.01,"energy is capped on a full pigeon");
  const replay=await (await post(f,body)).json();
  assert.equal(replay.replayed,true);
  assert.equal(replay.item.quantity,1);
  const blocked=await post(f,{food:'sunflower_seeds',requestId:randomUUID()});
  assert.equal(blocked.status,429);
  assert.equal((await db.query("SELECT quantity FROM public.game_user_items WHERE user_id=$1 AND item_id='sunflower_seeds'",[f.user.id])).rows[0].quantity,1);
});

test("simultaneous identical requests and old retries never award duplicate XP",async t => {
  const f = await setup(t);
  const body = input();
  const results = await Promise.all([post(f,body),post(f,body)]);
  for (const response of results) assert.equal(response.status,200);
  assert.equal((await db.query("SELECT xp FROM public.game_pigeons")).rows[0].xp,5);
  const parsed = await Promise.all(results.map(response=>response.json()));
  assert.equal(parsed.filter(result=>result.replayed).length,1);
  await db.exec("UPDATE public.game_pigeons SET last_fed_at=last_fed_at-interval '11 seconds'");
  assert.equal((await post(f,input())).status,200);
  const retry = await (await post(f,body)).json();
  assert.equal(retry.replayed,true);
  assert.equal(retry.pigeon.xp,10,"Old receipt returns latest state without granting a third reward");
  assert.equal((await db.query("SELECT count(*) FROM public.game_feed_receipts")).rows[0].count,2);
});

test("different requests during cooldown are rejected without extra rewards",async t => {
  const f = await setup(t);
  const responses = await Promise.all([post(f,input()),post(f,input())]);
  assert.deepEqual(responses.map(response=>response.status).sort(),[200,429]);
  const blocked = responses.find(response=>response.status===429);
  assert.ok(Number(blocked.headers.get("retry-after"))>0);
  assert.equal((await blocked.json()).code,"FEED_COOLDOWN");
  assert.equal((await db.query("SELECT xp FROM public.game_pigeons")).rows[0].xp,5);
  assert.equal((await db.query("SELECT count(*) FROM public.game_feed_receipts")).rows[0].count,1);
});

test("food, identity, origin and HTTP method are validated before feeding",async t => {
  const f = await setup(t);
  for (const change of [{food:"seeds"},{food:null},{requestId:"bad"},{requestId:null}]) {
    assert.equal((await post(f,{...input(),...change})).status,400);
  }
  assert.equal((await f.request("/api/game/feed")).status,405);
  assert.equal((await f.request("/api/game/feed",{body:input(),origin:"https://evil.example"})).status,403);
  assert.equal((await f.request("/api/game/feed",{body:input(),cookie:""})).status,401);
  await f.signup("OtherBird");
  assert.equal((await post(f,{...input(),userId:f.user.id})).status,409);
  assert.equal((await db.query("SELECT xp FROM public.game_pigeons")).rows[0].xp,0);
});

test("failure to store the receipt rolls back the meal, decay, cooldown and XP",async t => {
  const f = await setup(t);
  await db.exec("UPDATE public.game_pigeons SET created_at=now()-interval '2 hours',last_updated=now()-interval '1 hour'");
  const before = (await db.query("SELECT * FROM public.game_pigeons")).rows[0];
  await db.exec(`CREATE FUNCTION public.reject_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Test receipt failure'; END $$;
    CREATE TRIGGER reject_receipt BEFORE INSERT ON public.game_feed_receipts FOR EACH ROW EXECUTE FUNCTION public.reject_receipt()`);
  const body = input();
  try {
    assert.equal((await post(f,body)).status,503);
    assert.deepEqual((await db.query("SELECT * FROM public.game_pigeons")).rows[0],before);
  } finally { await db.exec("DROP TRIGGER reject_receipt ON public.game_feed_receipts; DROP FUNCTION public.reject_receipt()"); }
  assert.equal((await post(f,body)).status,200);
  assert.equal((await db.query("SELECT xp FROM public.game_pigeons")).rows[0].xp,5);
});

test("clients cannot invoke feed, forge receipts or read another account's receipts",async t => {
  const f = await setup(t);
  for (const role of ["anon","authenticated"]) {
    for (const sql of ["SELECT public.feed_game_pigeon($1,gen_random_uuid(),'crumbs')", "SELECT result FROM public.game_feed_receipts WHERE user_id=$1", "INSERT INTO public.game_feed_receipts(user_id,request_id,pigeon_id,result) VALUES($1,gen_random_uuid(),gen_random_uuid(),'{}')"]) {
      await db.exec(`BEGIN; SET LOCAL ROLE ${role}`);
      await assert.rejects(db.query(sql,[f.user.id]),{code:"42501"});
      await db.exec("ROLLBACK");
    }
  }
  await db.exec("BEGIN; SET LOCAL ROLE service_role");
  assert.equal((await db.query("SELECT public.feed_game_pigeon($1,gen_random_uuid(),'crumbs') AS result",[f.user.id])).rows[0].result.pigeon.xp,5);
  await db.exec("ROLLBACK");
});

test("feed and refresh requests share one timeline; progress survives logout/login",async t => {
  const f = await setup(t);
  await db.exec("UPDATE public.game_pigeons SET created_at=now()-interval '49 hours',last_updated=now()-interval '48 hours'");
  const responses = await Promise.all([post(f,input()),f.request("/api/game/pigeon")]);
  for (const response of responses) assert.equal(response.status,200);
  await f.request("/api/auth/sign-out",{body:{}});
  await f.request("/api/auth/sign-in",{body:{username:"BirdFriend",password:"a good test password"}});
  const state = (await (await f.request("/api/game/pigeon")).json()).pigeon;
  assert.equal(state.xp,5);
  assert.ok(Math.abs(Number(state.hunger)-19)<0.01);
  assert.ok(Math.abs(Number(state.happiness)-54)<0.01);
});
