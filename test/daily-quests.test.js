const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {before,after,beforeEach,test}=require('node:test');
const {PGlite}=require('@electric-sql/pglite');
const {fixture}=require('../test-support/auth-fixture');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const migrations=['migrations/001_tamagotchi.sql','seeds/tamagotchi-starters.sql','migrations/002_adoption.sql','migrations/003_time_engine.sql','migrations/004_feed.sql','migrations/005_play.sql','migrations/006_clean.sql','migrations/007_sleep.sql','migrations/008_xp_levels.sql','migrations/009_growth_stages.sql','migrations/010_coins.sql','migrations/011_discoveries.sql','migrations/012_daily_reward.sql','migrations/013_inventory.sql','migrations/014_shop.sql'];
let db,migrationState;
before(async()=>{
  db=new PGlite();
  await db.exec(`CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;`);
  for(const file of migrations) await db.exec(read(file));
  const id=randomUUID(); await db.query('INSERT INTO auth.users VALUES($1)',[id]);
  await db.query("INSERT INTO public.game_users(id,username,coins) VALUES($1,'QuestLegacy',37)",[id]);
  await db.query("SELECT public.adopt_game_pigeon($1,'jacobin pigeon','Archive')",[id]);
  const beforeProfile=(await db.query('SELECT * FROM public.game_users')).rows[0];
  const beforePigeon=(await db.query('SELECT * FROM public.game_pigeons')).rows[0];
  await db.exec(read('migrations/015_daily_quests.sql'));
  migrationState={beforeProfile,beforePigeon,afterProfile:(await db.query('SELECT * FROM public.game_users')).rows[0],afterPigeon:(await db.query('SELECT * FROM public.game_pigeons')).rows[0],progress:(await db.query('SELECT count(*) FROM public.game_daily_quest_progress')).rows[0].count};
});
after(async()=>db?.close());
beforeEach(async()=>db.exec('TRUNCATE public.game_pigeons,public.game_users,auth.users CASCADE'));

async function account(t) {
  const f=await fixture(t,{gameDb:db}); const user=(await (await f.signup()).json()).user;
  await f.request('/api/game/adopt',{body:{speciesId:'jacobin pigeon',nickname:'Gilbert'}});
  return {...f,user};
}
const action=(f,name,requestId=randomUUID())=>f.request(`/api/game/${name}`,{body:{requestId,...(name==='feed'?{food:'crumbs'}:{})}});

test('migration preserves existing profiles and pigeons without retroactive progress',()=>{
  assert.deepEqual(migrationState.afterProfile,migrationState.beforeProfile);
  assert.deepEqual(migrationState.afterPigeon,migrationState.beforePigeon);
  assert.equal(migrationState.progress,0);
});

test('daily quest list starts at zero with fixed goals and rewards',async t=>{
  const f=await account(t); const response=await f.request('/api/game/quests'); const data=await response.json();
  assert.equal(response.status,200); assert.equal(data.quests.length,4);
  assert.deepEqual(data.quests.map(q=>[q.id,q.progress,q.goal,q.reward]),[
    ['feed_3',0,3,{coins:20,xp:15}],['play_2',0,2,{coins:20,xp:15}],
    ['clean_1',0,1,{coins:15,xp:10}],['visit_pigeondex',0,1,{coins:10,xp:5}]
  ]);
  assert.equal(new Date(data.resetAt).toISOString().slice(11),'00:00:00.000Z');
});

test('successful care receipts advance once while retries and failed actions do not',async t=>{
  const f=await account(t),first=randomUUID();
  assert.equal((await action(f,'feed',first)).status,200);
  assert.equal((await action(f,'feed',first)).status,200);
  let quests=(await (await f.request('/api/game/quests')).json()).quests;
  assert.equal(quests.find(q=>q.id==='feed_3').progress,1);
  await db.query('UPDATE public.game_pigeons SET last_fed_at=NULL WHERE user_id=$1',[f.user.id]);
  await action(f,'feed'); await db.query('UPDATE public.game_pigeons SET last_fed_at=NULL WHERE user_id=$1',[f.user.id]); await action(f,'feed');
  quests=(await (await f.request('/api/game/quests')).json()).quests;
  assert.deepEqual(quests.find(q=>q.id==='feed_3'),{id:'feed_3',title:'Feed your pigeon 3 times',goal:3,progress:3,completed:true,claimed:false,reward:{coins:20,xp:15}});
  assert.equal((await action(f,'feed')).status,429);
  assert.equal((await (await f.request('/api/game/quests')).json()).quests[0].progress,3);
});

test('play, clean and PigeonDex visits update their own capped progress',async t=>{
  const f=await account(t);
  await action(f,'play'); await db.query('UPDATE public.game_pigeons SET last_played_at=NULL,energy=100 WHERE user_id=$1',[f.user.id]); await action(f,'play');
  await action(f,'clean');
  await f.request('/api/game/quests/pigeondex',{body:{}}); await f.request('/api/game/quests/pigeondex',{body:{}});
  const quests=(await (await f.request('/api/game/quests')).json()).quests;
  assert.deepEqual(Object.fromEntries(quests.map(q=>[q.id,q.progress])),{feed_3:0,play_2:2,clean_1:1,visit_pigeondex:1});
  assert.ok(quests.slice(1).every(q=>q.completed));
});

test('claiming a completed quest awards server-owned coins and XP once',async t=>{
  const f=await account(t); await action(f,'clean');
  const before=(await db.query('SELECT coins FROM public.game_users WHERE id=$1',[f.user.id])).rows[0];
  const response=await f.request('/api/game/quests/claim',{body:{questId:'clean_1',coins:999,xp:999,userId:randomUUID()}});
  const result=await response.json();
  assert.equal(response.status,200); assert.deepEqual(result.effects,{coins:15,xp:10}); assert.equal(result.dailyQuests.quests.find(q=>q.id==='clean_1').claimed,true);
  assert.equal(result.wallet.coins,before.coins+15);
  assert.equal((await db.query('SELECT xp FROM public.game_pigeons WHERE user_id=$1',[f.user.id])).rows[0].xp,15);
  const replay=await f.request('/api/game/quests/claim',{body:{questId:'clean_1'}});
  assert.equal(replay.status,409); assert.equal((await replay.json()).code,'QUEST_CLAIMED');
});

test('incomplete and simultaneous claims never duplicate a reward',async t=>{
  const f=await account(t);
  let response=await f.request('/api/game/quests/claim',{body:{questId:'feed_3'}});
  assert.equal(response.status,409); assert.equal((await response.json()).code,'QUEST_INCOMPLETE');
  await action(f,'clean');
  const claims=await Promise.all([f.request('/api/game/quests/claim',{body:{questId:'clean_1'}}),f.request('/api/game/quests/claim',{body:{questId:'clean_1'}})]);
  assert.deepEqual(claims.map(r=>r.status).sort(),[200,409]);
  assert.equal((await db.query('SELECT coins FROM public.game_users WHERE id=$1',[f.user.id])).rows[0].coins,17);
});

test('yesterday progress does not appear in today quests',async t=>{
  const f=await account(t);
  await db.query("INSERT INTO public.game_daily_quest_progress(user_id,quest_date,quest_id,progress,completed_at,claimed_at) VALUES($1,current_date-1,'feed_3',3,now()-interval '1 day',now()-interval '1 day')",[f.user.id]);
  const quests=(await (await f.request('/api/game/quests')).json()).quests;
  assert.equal(quests.find(q=>q.id==='feed_3').progress,0); assert.equal(quests.find(q=>q.id==='feed_3').claimed,false);
});

test('quest endpoints enforce authentication, methods, origin and known IDs',async t=>{
  const f=await fixture(t,{gameDb:db});
  assert.equal((await f.request('/api/game/quests')).status,401);
  await f.signup();
  assert.equal((await f.request('/api/game/quests',{method:'POST',body:{}})).status,405);
  assert.equal((await f.request('/api/game/quests/pigeondex',{body:{},origin:'https://evil.example'})).status,403);
  const invalid=await f.request('/api/game/quests/claim',{body:{questId:'made_up'}});
  assert.equal(invalid.status,400); assert.equal((await invalid.json()).code,'QUEST_INPUT');
});

test('dashboard renders accessible progress and claim controls',async t=>{
  const f=await account(t); await action(f,'clean');
  const response=await f.request('/my-pigeon'),html=await response.text();
  assert.equal(response.status,200); assert.match(html,/id="dailyQuests"/); assert.match(html,/Daily quests/);
  assert.match(html,/Feed your pigeon 3 times/); assert.match(html,/0 \/ 3/);
  assert.match(html,/data-quest-claim="clean_1"[^>]*>Claim reward/);
  assert.match(html,/pigeon-daily-quests\.js/);
});

test('quest tables and reward functions remain server-only with own-read RLS',async t=>{
  const f=await account(t); await action(f,'clean');
  for(const role of ['anon','authenticated']) {
    for(const sql of ["SELECT public.claim_game_daily_quest($1,'clean_1')","INSERT INTO public.game_daily_quest_progress(user_id,quest_date,quest_id,progress) VALUES($1,current_date,'feed_3',1)"]) {
      await db.exec(`BEGIN; SET LOCAL ROLE ${role}`);
      try {await assert.rejects(db.query(sql,[f.user.id]),{code:'42501'});} finally {await db.exec('ROLLBACK');}
    }
  }
  await db.exec(`BEGIN; SET LOCAL ROLE authenticated; SET LOCAL "request.jwt.claim.sub"='${f.user.id}'`);
  try {assert.equal((await db.query('SELECT count(*) FROM public.game_daily_quest_progress')).rows[0].count,1);} finally {await db.exec('ROLLBACK');}
});
