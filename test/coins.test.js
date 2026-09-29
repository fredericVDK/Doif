const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {randomUUID} = require("node:crypto");
const {before,after,beforeEach,test} = require("node:test");
const {PGlite} = require("@electric-sql/pglite");
const {fixture} = require("../test-support/auth-fixture");
let db, migration;
const wallet = async id => (await db.query("SELECT coins,coins_version FROM public.game_users WHERE id=$1",[id])).rows[0];
before(async () => {
  db = new PGlite();
  await db.exec(`CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;`);
  for (const file of ["migrations/001_tamagotchi.sql","seeds/tamagotchi-starters.sql","migrations/002_adoption.sql","migrations/003_time_engine.sql","migrations/004_feed.sql","migrations/005_play.sql","migrations/006_clean.sql","migrations/007_sleep.sql","migrations/008_xp_levels.sql","migrations/009_growth_stages.sql"]) {
    await db.exec(fs.readFileSync(path.join(__dirname,"..",file),"utf8"));
  }
  const user=randomUUID(), requests={};
  await db.query("INSERT INTO auth.users VALUES($1)",[user]);
  await db.query("INSERT INTO public.game_users(id,username,coins) VALUES($1,'LegacyBird',42)",[user]);
  await db.query("SELECT public.adopt_game_pigeon($1,'jacobin pigeon','Gilbert')",[user]);
  for (const action of ["feed","play","clean"]) {
    requests[action]=randomUUID();
    await db.query(`SELECT public.${action}_game_pigeon($1,$2${action==="feed" ? ",'crumbs'" : ""})`,[user,requests[action]]);
  }
  const oldPigeon=(await db.query("SELECT * FROM public.game_pigeons")).rows[0];
  await db.exec(fs.readFileSync(path.join(__dirname,"../migrations/010_coins.sql"),"utf8"));
  await db.exec(fs.readFileSync(path.join(__dirname,"../migrations/011_discoveries.sql"),"utf8"));
  migration={oldPigeon,newPigeon:(await db.query("SELECT * FROM public.game_pigeons")).rows[0],wallet:await wallet(user),retries:[]};
  for (const action of ["feed","play","clean"]) {
    migration.retries.push((await db.query(`SELECT public.${action}_game_pigeon($1,$2${action==="feed" ? ",'crumbs'" : ""}) AS result`,[user,requests[action]])).rows[0].result);
  }
});
after(async () => {await db?.close();});
beforeEach(async () => {await db.exec("TRUNCATE public.game_pigeons,public.game_users,auth.users CASCADE");});
async function setup(t) {
  const f=await fixture(t,{gameDb:db});
  const user=(await (await f.signup()).json()).user;
  await f.request("/api/game/adopt",{body:{speciesId:"jacobin pigeon",nickname:"Gilbert"}});
  return {...f,user};
}
const post=(f,action,body={})=>f.request(`/api/game/${action}`,{body:{requestId:randomUUID(),food:"crumbs",...body}});

test("coin migration preserves existing progress and old receipts never award retroactive coins", () => {
  assert.deepEqual(migration.oldPigeon,migration.newPigeon);
  assert.deepEqual(migration.wallet,{coins:42,coins_version:0});
  for (const result of migration.retries) {
    assert.equal(result.replayed,true);
    assert.equal(result.effects.coins,0);
    assert.deepEqual(result.wallet,{coins:42,version:0});
  }
});

test("central coin rewards reject unknown actions and clients cannot choose amounts or recipients", async t => {
  const f=await setup(t);
  for (const [action,reward,total,version] of [["feed",2,2,1],["play",5,7,2],["clean",2,9,3]]) {
    assert.equal((await db.query("SELECT public.pigeon_coin_reward($1) AS reward",[action])).rows[0].reward,reward);
    const response=await post(f,action,{coins:999,amount:999,userId:randomUUID(),wallet:{coins:999}});
    assert.equal(response.status,200);
    const result=await response.json();
    assert.equal(result.effects.coins,reward);
    assert.deepEqual(result.wallet,{coins:total,version});
    assert.deepEqual(await wallet(f.user.id),{coins:total,coins_version:version});
  }
  for (const action of [null,"sleep","login","level_up","unknown"]) {
    await assert.rejects(db.query("SELECT public.pigeon_coin_reward($1)",[action]),{code:"22023"});
  }
});

test("duplicate and interleaved care requests award once and replays return the latest balance", async t => {
  const f=await setup(t), ids={feed:randomUUID(),play:randomUUID(),clean:randomUUID()};
  const actions=["feed","play","clean","feed","play","clean"];
  const results=await Promise.all(actions.map(action=>post(f,action,{requestId:ids[action]})));
  for (const response of results) assert.equal(response.status,200);
  assert.deepEqual(await wallet(f.user.id),{coins:9,coins_version:3});
  for(const action of ["feed","play","clean"]) {
    const retry=await (await post(f,action,{requestId:ids[action]})).json();
    assert.equal(retry.replayed,true);
    assert.deepEqual(retry.wallet,{coins:9,version:3});
    assert.equal((await db.query(`SELECT count(*) FROM public.game_${action}_receipts`)).rows[0].count,1);
  }
});

test("cooldowns, tired Play, Sleep, refresh and level-ups give no extra coins", async t => {
  const f=await setup(t);
  await db.exec("UPDATE public.game_pigeons SET level=4,xp=395");
  assert.equal((await (await post(f,"feed")).json()).pigeon.growth_stage,"juvenile");
  assert.equal((await post(f,"feed")).status,429);
  await db.exec("UPDATE public.game_pigeons SET energy=0");
  assert.equal((await post(f,"play")).status,409);
  assert.equal((await post(f,"sleep")).status,200);
  assert.equal((await f.request("/api/game/pigeon")).status,200);
  assert.equal((await f.request("/my-pigeon")).status,200);
  assert.deepEqual(await wallet(f.user.id),{coins:2,coins_version:1});
  assert.equal((await db.query("SELECT count(*) FROM public.game_play_receipts")).rows[0].count,0);
});

test("receipt failure rolls coins, growth, XP, cooldown and stats back for all rewarded actions", async t => {
  const f=await setup(t);
  await db.exec("UPDATE public.game_pigeons SET level=4,xp=395");
  await db.exec(`CREATE FUNCTION public.reject_coin_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Test failure'; END $$`);
  try {
    for(const action of ["feed","play","clean"]) {
      const before=(await db.query("SELECT * FROM public.game_pigeons")).rows[0];
      await db.exec(`CREATE TRIGGER reject_coin_receipt BEFORE INSERT ON public.game_${action}_receipts FOR EACH ROW EXECUTE FUNCTION public.reject_coin_receipt()`);
      try {
        assert.equal((await post(f,action)).status,503);
        assert.deepEqual((await db.query("SELECT * FROM public.game_pigeons")).rows[0],before);
        assert.deepEqual(await wallet(f.user.id),{coins:0,coins_version:0});
      } finally {await db.exec(`DROP TRIGGER reject_coin_receipt ON public.game_${action}_receipts`);}
    }
  } finally {await db.exec("DROP FUNCTION public.reject_coin_receipt()");}
  assert.equal((await post(f,"feed")).status,200);
  assert.deepEqual(await wallet(f.user.id),{coins:2,coins_version:1});
});

test("a coin balance overflow fails the whole action without a partial reward", async t => {
  const f=await setup(t);
  await db.exec("UPDATE public.game_users SET coins=2147483647");
  const before=(await db.query("SELECT * FROM public.game_pigeons")).rows[0];
  assert.equal((await post(f,"feed")).status,503);
  assert.deepEqual(await wallet(f.user.id),{coins:2147483647,coins_version:0});
  assert.deepEqual((await db.query("SELECT * FROM public.game_pigeons")).rows[0],before);
  assert.equal((await db.query("SELECT count(*) FROM public.game_feed_receipts")).rows[0].count,0);
});

test("coin balance survives logout/login and remains isolated to each account", async t => {
  const f=await setup(t);
  await post(f,"play");
  await f.request("/api/auth/sign-out",{body:{}});
  const signedIn=await (await f.request("/api/auth/sign-in",{body:{email:"BirdFriend@example.test",password:"a good test password"}})).json();
  assert.equal(signedIn.user.coins,5);
  assert.match(await (await f.request("/my-pigeon")).text(),/id="coinsValue" aria-label="Pigeon Coins">5<\/dd>/);
  const other=(await (await f.signup("OtherBird")).json()).user;
  await f.request("/api/game/adopt",{body:{speciesId:"indian fantail",nickname:"Pearl"}});
  const result=await (await post(f,"clean",{userId:f.user.id})).json();
  assert.equal(result.wallet.coins,2);
  assert.equal((await wallet(f.user.id)).coins,5);
  assert.equal((await wallet(other.id)).coins,2);
});

test("coin helpers and balance writes are server-only, with no public award endpoint", async t => {
  const f=await setup(t);
  for(const role of ["anon","authenticated"]) {
    for(const sql of ["SELECT public.award_pigeon_coins($1,'feed')","SELECT public.get_pigeon_wallet($1)","UPDATE public.game_users SET coins=999,coins_version=999 WHERE id=$1"]) {
      await db.exec(`BEGIN; SET LOCAL ROLE ${role}`);
      await assert.rejects(db.query(sql,[f.user.id]),{code:"42501"});
      await db.exec("ROLLBACK");
    }
  }
  assert.equal((await f.request("/api/game/coins",{body:{amount:999}})).status,404);
  await db.exec("BEGIN; SET LOCAL ROLE service_role");
  assert.equal((await db.query("SELECT public.feed_game_pigeon($1,$2,'crumbs') AS result",[f.user.id,randomUUID()])).rows[0].result.wallet.coins,2);
  await db.exec("ROLLBACK");
});
