const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {before,after,beforeEach,test}=require('node:test');
const {PGlite}=require('@electric-sql/pglite');
const {fixture}=require('../test-support/auth-fixture');

let db;
before(async()=>{
  db=new PGlite();
  await db.exec(`CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;`);
  const files=['002_adoption.sql','003_time_engine.sql','004_feed.sql','005_play.sql','006_clean.sql','007_sleep.sql','008_xp_levels.sql','009_growth_stages.sql','010_coins.sql','011_discoveries.sql','012_daily_reward.sql','013_inventory.sql','014_shop.sql','015_daily_quests.sql','016_achievements.sql','017_catch_the_crumbs.sql','018_inventory_feeding.sql','019_pigeon_battles.sql','020_automatic_battles.sql','021_battle_health.sql','022_level_scaled_battle_damage.sql','023_pigeon_packs.sql','024_pigeon_clinic.sql','025_more_quests_achievements.sql','026_more_permanent_achievements.sql','027_username_password_accounts.sql','028_account_admin.sql','029_progression_social.sql','030_five_action_daily_quests.sql','031_clinic_resets_battle_recovery.sql','032_pigeon_races.sql','033_race_world_and_test_accounts.sql'];
  await db.exec(fs.readFileSync(path.join(__dirname,'../migrations/001_tamagotchi.sql'),'utf8'));
  await db.exec(fs.readFileSync(path.join(__dirname,'../seeds/tamagotchi-starters.sql'),'utf8'));
  for(const file of files) await db.exec(fs.readFileSync(path.join(__dirname,'../migrations',file),'utf8'));
});
after(async()=>db?.close());
beforeEach(async()=>db.exec('TRUNCATE public.game_pigeons,public.game_users,auth.users CASCADE'));

const action=()=>({requestId:randomUUID(),userId:randomUUID(),coins:999999,xp:999999,health:100,hunger:100,energy:100});
const near=(actual,expected,tolerance=.05)=>assert.ok(Math.abs(Number(actual)-expected)<tolerance,`${actual} ≈ ${expected}`);

test('username login lookup is case-insensitive and server-only',async t=>{const app=await fixture(t,{gameDb:db}),user=(await(await app.signup('CaseBird')).json()).user;assert.deepEqual((await db.query("SELECT * FROM public.find_game_user_by_username('casebird')")).rows,[{id:user.id,username:'CaseBird'}]);for(const role of ['anon','authenticated']){await db.exec(`SET ROLE ${role}`);try{await assert.rejects(db.query("SELECT * FROM public.find_game_user_by_username('CaseBird')"),{code:'42501'});}finally{await db.exec('RESET ROLE');}}});

test('complete MVP flow remains authoritative after a 48-hour absence',async t=>{
  const app=await fixture(t,{gameDb:db});
  const signup=await app.signup('FlowBird');
  const user=(await signup.json()).user;
  assert.equal((await app.request('/api/game/adopt',{body:{speciesId:'jacobin pigeon',nickname:'Milo',coins:999,xp:999}})).status,200);
  await db.exec("UPDATE public.game_pigeons SET level=4,xp=395,created_at=now()-interval '49 hours',last_updated=now()-interval '48 hours'");

  const refreshed=await (await app.request('/api/game/pigeon')).json();
  near(refreshed.pigeon.hunger,4); near(refreshed.pigeon.happiness,52);
  near(refreshed.pigeon.energy,52); near(refreshed.pigeon.cleanliness,76);
  for(const stat of ['health','hunger','happiness','energy','cleanliness']) {
    assert.ok(Number(refreshed.pigeon[stat])>=0&&Number(refreshed.pigeon[stat])<=100,stat);
  }

  const fed=await (await app.request('/api/game/feed',{body:{...action(),food:'crumbs'}})).json();
  assert.deepEqual(fed.effects,{hunger:15,happiness:2,xp:5,coins:2});
  assert.equal(fed.pigeon.level,5); assert.equal(fed.pigeon.xp,0); assert.equal(fed.pigeon.growth_stage,'juvenile');
  const played=await (await app.request('/api/game/play',{body:action()})).json();
  assert.deepEqual(played.effects,{energy:-10,happiness:15,xp:10,coins:5});
  const cleaned=await (await app.request('/api/game/clean',{body:action()})).json();
  assert.equal(cleaned.effects.xp,5); assert.equal(cleaned.effects.coins,2);
  const slept=await (await app.request('/api/game/sleep',{body:action()})).json();
  assert.equal(slept.effects.xp,undefined); assert.ok(Number(slept.pigeon.energy)>Number(cleaned.pigeon.energy));

  const daily=await (await app.request('/api/game/daily-reward',{body:{coins:999,xp:999,date:'2099-01-01',userId:randomUUID()}})).json();
  assert.equal(daily.claimed,true); assert.deepEqual(daily.effects,{coins:50,xp:20});
  assert.equal(daily.wallet.coins,59); assert.equal(daily.pigeon.xp,35);
  const repeated=await (await app.request('/api/game/daily-reward',{body:{}})).json();
  assert.equal(repeated.claimed,false); assert.deepEqual(repeated.effects,{coins:0,xp:0}); assert.equal(repeated.wallet.coins,59);

  const purchase=await (await app.request('/api/game/shop/buy',{body:{...action(),itemId:'corn',price:0,quantity:999}})).json();
  assert.equal(purchase.item.id,'corn'); assert.equal(purchase.item.quantity,1); assert.equal(purchase.wallet.coins,34);
  const inventory=await (await app.request('/api/game/inventory')).json();
  assert.equal(inventory.items.find(item=>item.id==='corn').quantity,1);

  const firstCookie=[...app.jar].map(([key,value])=>`${key}=${value}`).join('; ');
  await app.signup('OtherFlowBird');
  const forged=await app.request('/api/game/play',{body:{...action(),userId:user.id},updateCookies:false});
  assert.equal(forged.status,409); assert.equal((await forged.json()).code,'NO_PIGEON');
  const first=await (await app.request('/api/game/pigeon',{cookie:firstCookie,updateCookies:false})).json();
  assert.equal(first.pigeon.user_id,user.id); assert.equal(first.pigeon.xp,35);
  assert.equal((await db.query('SELECT coins FROM public.game_users WHERE id=$1',[user.id])).rows[0].coins,34);
});
