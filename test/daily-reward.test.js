const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {before,after,beforeEach,test}=require('node:test');
const {PGlite}=require('@electric-sql/pglite');
const {fixture}=require('../test-support/auth-fixture');

let db,migrationState;
const files=['migrations/001_tamagotchi.sql','seeds/tamagotchi-starters.sql','migrations/002_adoption.sql','migrations/003_time_engine.sql','migrations/004_feed.sql','migrations/005_play.sql','migrations/006_clean.sql','migrations/007_sleep.sql','migrations/008_xp_levels.sql','migrations/009_growth_stages.sql','migrations/010_coins.sql','migrations/011_discoveries.sql'];
before(async()=>{
  db=new PGlite();
  await db.exec(`CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
    GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;`);
  for(const file of files) await db.exec(fs.readFileSync(path.join(__dirname,'..',file),'utf8'));
  const id=randomUUID();
  await db.query('INSERT INTO auth.users VALUES($1)',[id]);
  await db.query("INSERT INTO public.game_users(id,username,coins,coins_version) VALUES($1,'LegacyReward',73,4)",[id]);
  await db.query("SELECT public.adopt_game_pigeon($1,'jacobin pigeon','Archive')",[id]);
  await db.exec('UPDATE public.game_pigeons SET level=3,xp=71,hunger=66,happiness=77,energy=88,cleanliness=55');
  const before=(await db.query('SELECT * FROM public.game_pigeons WHERE user_id=$1',[id])).rows[0];
  await db.exec(fs.readFileSync(path.join(__dirname,'../migrations/012_daily_reward.sql'),'utf8'));
  migrationState={before,after:(await db.query('SELECT * FROM public.game_pigeons WHERE user_id=$1',[id])).rows[0],wallet:(await db.query('SELECT coins,coins_version FROM public.game_users WHERE id=$1',[id])).rows[0],receipts:(await db.query('SELECT count(*) FROM public.game_daily_rewards')).rows[0].count};
});
after(async()=>db?.close());
beforeEach(async()=>db.exec('TRUNCATE public.game_pigeons,public.game_users,auth.users CASCADE'));

async function account(t,{adopt=true,name='BirdFriend'}={}) {
  const f=await fixture(t,{gameDb:db});
  const user=(await (await f.signup(name)).json()).user;
  if(adopt) assert.equal((await f.request('/api/game/adopt',{body:{speciesId:'jacobin pigeon',nickname:'Gilbert'}})).status,200);
  return {...f,user};
}
const claim=f=>f.request('/api/game/daily-reward',{body:{}});
const state=async id=>(await db.query('SELECT level,xp,growth_stage,hunger,happiness,energy,cleanliness,last_updated,version FROM public.game_pigeons WHERE user_id=$1',[id])).rows[0];
const wallet=async id=>(await db.query('SELECT coins,coins_version FROM public.game_users WHERE id=$1',[id])).rows[0];

test('migration preserves all existing progress and creates no retroactive reward',()=>{
  assert.deepEqual(migrationState.after,migrationState.before);
  assert.deepEqual(migrationState.wallet,{coins:73,coins_version:4});
  assert.equal(migrationState.receipts,0);
});

test('first daily claim grants exactly 50 coins and 20 XP without changing care state',async t=>{
  const f=await account(t);
  const before=await state(f.user.id);
  const response=await claim(f), result=await response.json(), afterState=await state(f.user.id);
  assert.equal(response.status,200);
  assert.equal(result.claimed,true);
  assert.deepEqual(result.effects,{coins:50,xp:20});
  assert.deepEqual(result.wallet,{coins:50,version:1});
  assert.equal(afterState.xp,20);
  assert.equal(afterState.level,1);
  assert.equal(afterState.version,before.version+1);
  for(const key of ['hunger','happiness','energy','cleanliness','last_updated']) assert.deepEqual(afterState[key],before[key]);
  const receipt=(await db.query('SELECT * FROM public.game_daily_rewards WHERE user_id=$1',[f.user.id])).rows[0];
  assert.equal(receipt.coins_awarded,50); assert.equal(receipt.xp_awarded,20);
  assert.match(result.xpHtml,/20 \/ 100/); assert.match(result.statsHtml,/Hunger/);
});

test('simultaneous and repeated claims award once and return current state',async t=>{
  const f=await account(t);
  const responses=await Promise.all([claim(f),claim(f),claim(f)]);
  const results=await Promise.all(responses.map(r=>r.json()));
  assert.deepEqual(results.map(r=>r.claimed).sort(),[false,false,true]);
  assert.deepEqual(await wallet(f.user.id),{coins:50,coins_version:1});
  assert.equal((await state(f.user.id)).xp,20);
  assert.equal((await db.query('SELECT count(*) FROM public.game_daily_rewards WHERE user_id=$1',[f.user.id])).rows[0].count,1);
  for(const result of results.filter(r=>!r.claimed)) assert.deepEqual(result.effects,{coins:0,xp:0});
});

test('a care action and daily reward serialize without losing coins or XP',async t=>{
  const f=await account(t);
  const [reward,feed]=await Promise.all([
    claim(f),
    f.request('/api/game/feed',{body:{requestId:randomUUID(),food:'crumbs'}})
  ]);
  assert.equal(reward.status,200); assert.equal(feed.status,200);
  assert.deepEqual(await wallet(f.user.id),{coins:52,coins_version:2});
  const pigeon=await state(f.user.id);
  assert.equal(pigeon.xp,25); assert.equal(pigeon.version,2);
  assert.equal((await db.query('SELECT count(*) FROM public.game_daily_rewards')).rows[0].count,1);
  assert.equal((await db.query('SELECT count(*) FROM public.game_feed_receipts')).rows[0].count,1);
});

test('XP carries into a new level and updates the growth stage',async t=>{
  const f=await account(t);
  await db.exec("UPDATE public.game_pigeons SET level=4,xp=390,growth_stage='hatchling'");
  const result=await (await claim(f)).json();
  assert.equal(result.pigeon.level,5); assert.equal(result.pigeon.xp,10);
  assert.equal(result.pigeon.growth_stage,'juvenile');
  assert.equal(result.growthLabel,'Juvenile'); assert.match(result.growthHtml,/data-stage="juvenile"/);
});

test('the UTC calendar boundary is explicit and a new UTC day can be rewarded',async t=>{
  const boundary=(await db.query("SELECT public.pigeon_utc_date('2026-09-28 23:59:59+00') AS before, public.pigeon_utc_date('2026-09-29 00:00:00+00') AS after")).rows[0];
  assert.equal(boundary.before.toISOString(),'2026-09-28T00:00:00.000Z');
  assert.equal(boundary.after.toISOString(),'2026-09-29T00:00:00.000Z');
  const f=await account(t);
  assert.equal((await (await claim(f)).json()).claimed,true);
  await db.exec('UPDATE public.game_daily_rewards SET reward_date=reward_date-1');
  assert.equal((await (await claim(f)).json()).claimed,true);
  assert.deepEqual(await wallet(f.user.id),{coins:100,coins_version:2});
  assert.equal((await state(f.user.id)).xp,40);
});

test('client-supplied identity, date and amounts are ignored',async t=>{
  const f=await account(t), forgedUser=randomUUID();
  const result=await (await f.request('/api/game/daily-reward',{body:{userId:forgedUser,rewardDate:'2099-01-01',coins:999999,xp:999999}})).json();
  assert.deepEqual(result.effects,{coins:50,xp:20});
  assert.deepEqual(await wallet(f.user.id),{coins:50,coins_version:1});
  assert.equal((await db.query('SELECT count(*) FROM public.game_daily_rewards WHERE user_id=$1',[forgedUser])).rows[0].count,0);
  assert.notEqual(result.rewardDate,'2099-01-01');
});

test('receipt failure and coin overflow roll the entire reward back',async t=>{
  const f=await account(t);
  await db.exec(`CREATE FUNCTION public.reject_daily_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Test failure'; END $$;
    CREATE TRIGGER reject_daily_receipt BEFORE INSERT ON public.game_daily_rewards FOR EACH ROW EXECUTE FUNCTION public.reject_daily_receipt();`);
  const before=await state(f.user.id);
  try {
    assert.equal((await claim(f)).status,503);
    assert.deepEqual(await state(f.user.id),before); assert.deepEqual(await wallet(f.user.id),{coins:0,coins_version:0});
  } finally {await db.exec('DROP TRIGGER reject_daily_receipt ON public.game_daily_rewards; DROP FUNCTION public.reject_daily_receipt()');}
  await db.exec('UPDATE public.game_users SET coins=2147483647');
  assert.equal((await claim(f)).status,503);
  assert.deepEqual(await state(f.user.id),before); assert.deepEqual(await wallet(f.user.id),{coins:2147483647,coins_version:0});
  assert.equal((await db.query('SELECT count(*) FROM public.game_daily_rewards')).rows[0].count,0);
});

test('route requires sign-in, profile, pigeon, POST and a same-origin request',async t=>{
  const f=await fixture(t,{gameDb:db});
  assert.equal((await f.request('/api/game/daily-reward',{body:{}})).status,401);
  await f.signup();
  assert.equal((await f.request('/api/game/daily-reward',{body:{}})).status,409);
  await f.request('/api/auth/profile',{body:{username:'BirdFriend'}});
  assert.equal((await f.request('/api/game/daily-reward',{body:{}})).status,409);
  assert.equal((await f.request('/api/game/daily-reward',{method:'GET'})).status,405);
  assert.equal((await f.request('/api/game/daily-reward',{body:{},origin:'https://evil.example'})).status,403);
});

test('daily reward writes and amount helpers remain server-only',async t=>{
  const f=await account(t);
  for(const role of ['anon','authenticated']) {
    for(const sql of ["SELECT public.claim_game_daily_reward($1)","SELECT public.add_pigeon_coins($1,50)","SELECT public.pigeon_daily_reward('coins')","SELECT public.pigeon_utc_date(now())","INSERT INTO public.game_daily_rewards(user_id,reward_date) VALUES($1,current_date)"]) {
      await db.exec(`BEGIN; SET LOCAL ROLE ${role}`);
      try {await assert.rejects(db.query(sql,sql.includes('$1') ? [f.user.id] : []),{code:'42501'});}
      finally {await db.exec('ROLLBACK');}
    }
  }
  await db.exec('BEGIN; SET LOCAL ROLE service_role');
  assert.equal((await db.query('SELECT public.claim_game_daily_reward($1) AS result',[f.user.id])).rows[0].result.claimed,true);
  await db.exec('ROLLBACK');
  assert.equal((await f.request('/api/game/reward',{body:{coins:999}})).status,404);
});

test('claimed reward persists through logout and sign-in',async t=>{
  const f=await account(t);
  await claim(f); await f.request('/api/auth/sign-out',{body:{}});
  await f.request('/api/auth/sign-in',{body:{email:'BirdFriend@example.test',password:'a good test password'}});
  assert.equal((await (await claim(f)).json()).claimed,false);
  assert.deepEqual(await wallet(f.user.id),{coins:50,coins_version:1});
  assert.match(await (await f.request('/my-pigeon')).text(),/id="coinsValue" aria-label="Pigeon Coins">50<\/dd>/);
});
