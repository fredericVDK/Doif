const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {before,after,beforeEach,test}=require('node:test');
const {PGlite}=require('@electric-sql/pglite');
const {fixture}=require('../test-support/auth-fixture');

const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const migrations=['001_tamagotchi.sql','../seeds/tamagotchi-starters.sql','002_adoption.sql','003_time_engine.sql','004_feed.sql','005_play.sql','006_clean.sql','007_sleep.sql','008_xp_levels.sql','009_growth_stages.sql','010_coins.sql','011_discoveries.sql','012_daily_reward.sql','013_inventory.sql','014_shop.sql','015_daily_quests.sql','016_achievements.sql','017_catch_the_crumbs.sql','018_inventory_feeding.sql','019_pigeon_battles.sql','020_automatic_battles.sql','021_battle_health.sql','022_level_scaled_battle_damage.sql','023_pigeon_packs.sql','024_pigeon_clinic.sql','025_more_quests_achievements.sql','026_more_permanent_achievements.sql','027_username_password_accounts.sql','028_account_admin.sql','029_progression_social.sql','030_five_action_daily_quests.sql','031_clinic_resets_battle_recovery.sql','032_pigeon_races.sql','033_race_world_and_test_accounts.sql'];
let db;
before(async()=>{
  db=new PGlite();
  await db.exec(`CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE ROLE anon NOLOGIN;CREATE ROLE authenticated NOLOGIN;CREATE ROLE service_role NOLOGIN BYPASSRLS;CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;`);
  for(const file of migrations)await db.exec(read(file.startsWith('../')?file.slice(3):`migrations/${file}`));
});
after(async()=>db?.close());
beforeEach(async()=>db.exec('TRUNCATE public.game_pigeon_races,public.game_pigeons,public.game_users,auth.users CASCADE'));

async function account(t,name,level=1,coins=1000){
  const f=await fixture(t,{gameDb:db});
  const response=await f.signup(name),user=(await response.json()).user;
  assert.equal(response.status,200);
  await f.request('/api/game/adopt',{body:{speciesId:'jacobin pigeon',nickname:`${name} Bird`}});
  await db.query('UPDATE public.game_users SET coins=$1 WHERE id=$2',[coins,user.id]);
  await db.query('UPDATE public.game_pigeons SET level=$1 WHERE user_id=$2',[level,user.id]);
  return{...f,user};
}
async function field(t){
  const players=[['20000000-0000-4000-8000-000000000002','RivalOne',2],['20000000-0000-4000-8000-000000000003','RivalTwo',6],['20000000-0000-4000-8000-000000000004','RivalThree',10]];
  for(const [id,name,level] of players){
    await db.query('INSERT INTO auth.users(id) VALUES($1)',[id]);
    await db.query('INSERT INTO public.game_users(id,username,coins) VALUES($1,$2,1000)',[id,name]);
    await db.query("INSERT INTO public.game_pigeons(user_id,species_id,nickname,level) SELECT $1,id,$2,$3 FROM public.game_species WHERE is_starter ORDER BY id LIMIT 1",[id,`${name} Bird`,level]);
  }
  return players;
}
const start=(f,lobby,extra={})=>f.request('/api/game/races/start',{body:{requestId:randomUUID(),origin:'brussels',destination:'amsterdam',opponentPigeonId:lobby.opponents[0].id,...extra}});

test('race lobby shows level stats, world routes and exactly three real opponents',async t=>{
  const own=await account(t,'RacePilot',5); await field(t);
  const response=await own.request('/api/game/races'),lobby=await response.json();
  assert.equal(response.status,200); assert.equal(lobby.locations.length,25); assert.equal(lobby.opponents.length,3);
  assert.equal(lobby.entryCost,100); assert.equal(lobby.pigeon.raceStats.level,5);
  assert.deepEqual(Object.keys(lobby.pigeon.raceStats).sort(),['endurance','focus','level','navigation','speed','strength']);
  assert.ok(lobby.pigeon.raceStats.endurance>lobby.opponents.find(value=>value.level===2).stats.endurance);
  assert.ok(lobby.opponents.every(value=>value.username!=='RacePilot'));
});

test('a weaker pigeon has an exact twenty-percent guaranteed upset path',async t=>{
  const own=await account(t,'Underdog',1); await field(t);
  const lobby=await(await own.request('/api/game/races')).json();
  const opponent=lobby.opponents.reduce((strongest,value)=>value.level>strongest.level?value:strongest);
  let requestId;
  for(let attempt=0;attempt<100;attempt++){
    const candidate=randomUUID();
    const roll=(await db.query("SELECT mod(abs(hashtext($1::text||':upset')::bigint),100)::integer value",[candidate])).rows[0].value;
    if(roll<20){requestId=candidate;break;}
  }
  assert.ok(requestId,'found deterministic 20% upset request');
  const response=await own.request('/api/game/races/start',{body:{requestId,origin:'brussels',destination:'amsterdam',opponentPigeonId:opponent.id}});
  assert.equal(response.status,200);
  const outcome=(await db.query('SELECT outcome FROM public.game_pigeon_races WHERE user_id=$1',[own.user.id])).rows[0].outcome;
  assert.equal(outcome.upset,true); assert.equal(outcome.won,true); assert.ok(outcome.upsetRoll<20);
  await db.query("UPDATE public.game_pigeon_races SET started_at=started_at-interval '1 day',finishes_at=clock_timestamp()-interval '1 second' WHERE user_id=$1",[own.user.id]);
  const result=await(await own.request('/api/game/races/collect',{body:{raceId:requestId}})).json();
  assert.equal(result.won,true); assert.equal(result.upset,true);
});

test('supertest receives unlimited test coins and every cooldown resets after an action',async t=>{
  const supertest=await account(t,'supertest',4,1); await field(t);
  let response=await supertest.request('/api/game/battle',{body:{requestId:randomUUID()}}),first=await response.json();
  assert.equal(response.status,200); assert.equal(first.testAccount,true); assert.equal(first.wallet.coins,1000000000);
  assert.equal(Number(first.pigeon.energy),100); assert.equal(first.injuredUntil,null);
  response=await supertest.request('/api/game/battle',{body:{requestId:randomUUID()}});
  assert.equal(response.status,200,'battle is immediately reusable');
  const saved=(await db.query('SELECT last_battled_at,injured_until,energy FROM public.game_pigeons WHERE user_id=$1',[supertest.user.id])).rows[0];
  assert.equal(saved.last_battled_at,null); assert.equal(saved.injured_until,null); assert.equal(Number(saved.energy),100);

  response=await supertest.request('/api/game/daily-reward',{body:{}});
  assert.equal(response.status,200,'daily reward can be claimed');
  response=await supertest.request('/api/game/daily-reward',{body:{}});
  assert.equal(response.status,200,'daily reward limit is reset immediately');

  const lobby=await(await supertest.request('/api/game/races')).json();
  const started=await(await start(supertest,lobby)).json();
  assert.equal(started.testAccount,true); assert.equal(started.wallet.coins,1000000000);
  response=await supertest.request('/api/game/races/collect',{body:{raceId:started.raceId}});
  assert.equal(response.status,200,'race result is immediately available');

  await db.query("INSERT INTO public.game_pigeon_pack_receipts(user_id,request_id,pack_type,period_start,result) VALUES($1,$2,'normal',timezone('UTC',clock_timestamp())::date,'{}')",[supertest.user.id,randomUUID()]);
  await db.query('SELECT public.prepare_game_test_account($1)',[supertest.user.id]);
  const packs=(await db.query('SELECT public.get_pigeon_pack_status($1) result',[supertest.user.id])).rows[0].result;
  assert.equal(packs.packs.find(pack=>pack.id==='normal').available,true);
});

test('supertest dashboard actions remain usable while migration 033 is still being installed',async t=>{
  const supertest=await account(t,'supertest',4,1000);
  supertest.provider.state.missingTestReset=true;
  const response=await supertest.request('/api/game/daily-reward',{body:{}}),data=await response.json();
  assert.equal(response.status,200); assert.equal(data.claimed,true);
  assert.equal(data.testAccountMigrationRequired,true); assert.equal(data.testAccount,undefined);
});

test('route length controls flight time and preview rewards',async t=>{
  const own=await account(t,'RoutePilot'); await field(t);
  const lobby=await(await own.request('/api/game/races')).json();
  let response=await start(own,lobby),race=await response.json();
  assert.equal(response.status,200); assert.equal(race.entryCost,100); assert.equal(race.wallet.coins,900);
  assert.ok(race.route.distanceKm>=165&&race.route.distanceKm<=180); assert.ok(race.durationSeconds>=1200&&race.durationSeconds<=1500);
  assert.ok(race.potentialRewards.coins>100); assert.ok(race.potentialRewards.xp>0);
  await db.query("UPDATE public.game_pigeon_races SET started_at=started_at-interval '1 day',finishes_at=clock_timestamp()-interval '1 second' WHERE user_id=$1",[own.user.id]);
  await own.request('/api/game/races/collect',{body:{raceId:race.raceId}});
  response=await start(own,lobby,{destination:'copenhagen'}); race=await response.json();
  assert.equal(response.status,200); assert.ok(race.route.distanceKm>750); assert.ok(race.durationSeconds>=3300&&race.durationSeconds<=3900);
  assert.ok(race.potentialRewards.coins>100);
});

test('race entry and delayed result are idempotent and never affect the opponent',async t=>{
  const own=await account(t,'SafePilot'); const rivals=await field(t);
  const lobby=await(await own.request('/api/game/races')).json(),id=randomUUID(),opponent=lobby.opponents[0];
  const rivalBefore=(await db.query('SELECT u.coins,p.xp FROM public.game_users u JOIN public.game_pigeons p ON p.user_id=u.id WHERE p.id=$1',[opponent.id])).rows[0];
  let response=await start(own,lobby,{requestId:id}); const race=await response.json(); assert.equal(response.status,200);
  const replay=await(await start(own,lobby,{requestId:id})).json(); assert.equal(replay.replayed,true); assert.equal(replay.wallet.coins,900);
  response=await start(own,lobby); assert.equal(response.status,409); assert.equal((await response.json()).code,'RACE_ACTIVE');
  response=await own.request('/api/game/races/collect',{body:{raceId:id}}); assert.equal(response.status,429); assert.equal((await response.json()).code,'RACE_RUNNING');
  await db.query("UPDATE public.game_pigeon_races SET started_at=started_at-interval '1 day',finishes_at=clock_timestamp()-interval '1 second' WHERE user_id=$1",[own.user.id]);
  response=await own.request('/api/game/races/collect',{body:{raceId:id}}); const result=await response.json(); assert.equal(response.status,200);
  assert.equal(result.effects.coins,result.won?race.potentialRewards.coins:0); assert.equal(result.effects.xp,result.won?race.potentialRewards.xp:0);
  const again=await(await own.request('/api/game/races/collect',{body:{raceId:id}})).json(); assert.equal(again.replayed,true);
  const rivalAfter=(await db.query('SELECT u.coins,p.xp FROM public.game_users u JOIN public.game_pigeons p ON p.user_id=u.id WHERE p.id=$1',[opponent.id])).rows[0];
  assert.deepEqual(rivalAfter,rivalBefore); assert.equal((await db.query('SELECT count(*) FROM public.game_pigeon_races')).rows[0].count,1);
  assert.equal(rivals.length,3);
});

test('race page and endpoints are protected and validate server-owned choices',async t=>{
  const anonymous=await fixture(t,{gameDb:db}); assert.equal((await anonymous.request('/race')).status,303); assert.equal((await anonymous.request('/api/game/races')).status,401);
  const own=await account(t,'PagePilot'); await field(t);
  const html=await(await own.request('/race')).text();
  assert.match(html,/Choose your route/); assert.match(html,/Strength/); assert.match(html,/id="raceOrigin"/); assert.match(html,/pigeon-race\.js/); assert.match(html,/aria-current="page">Race/);
  const lobby=await(await own.request('/api/game/races')).json();
  let response=await start(own,lobby,{origin:'brussels',destination:'brussels'}); assert.equal(response.status,400);
  response=await start(own,lobby,{opponentPigeonId:randomUUID()}); assert.equal(response.status,409); assert.equal((await response.json()).code,'RACE_OPPONENT');
  for(const role of ['anon','authenticated']){
    await db.exec(`SET ROLE ${role}`);
    await assert.rejects(db.query('SELECT public.get_game_race_lobby($1)',[own.user.id]));
    await assert.rejects(db.query('SELECT public.prepare_game_test_account($1)',[own.user.id]));
    await assert.rejects(db.query('SELECT * FROM public.game_pigeon_races'));
    await db.exec('RESET ROLE');
  }
});

test('underdog results use a playful story instead of exposing the probability roll',()=>{
  const script=read('public/pigeon-race.js');
  assert.match(script,/spotted a french fry at the finish line and discovered turbo mode/);
  assert.doesNotMatch(script,/weaker pigeon hit its 20% upset chance/i);
});
