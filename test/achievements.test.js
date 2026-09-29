const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {before,after,beforeEach,test}=require('node:test');
const {PGlite}=require('@electric-sql/pglite');
const {fixture}=require('../test-support/auth-fixture');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const migrations=['migrations/001_tamagotchi.sql','seeds/tamagotchi-starters.sql','migrations/002_adoption.sql','migrations/003_time_engine.sql','migrations/004_feed.sql','migrations/005_play.sql','migrations/006_clean.sql','migrations/007_sleep.sql','migrations/008_xp_levels.sql','migrations/009_growth_stages.sql','migrations/010_coins.sql','migrations/011_discoveries.sql','migrations/012_daily_reward.sql','migrations/013_inventory.sql','migrations/014_shop.sql','migrations/015_daily_quests.sql'];
let db,migrationState;
before(async()=>{
  db=new PGlite();
  await db.exec(`CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;`);
  for(const file of migrations) await db.exec(read(file));
  const id=randomUUID(); await db.query('INSERT INTO auth.users VALUES($1)',[id]);
  await db.query("INSERT INTO public.game_users(id,username,coins) VALUES($1,'AchievementLegacy',41)",[id]);
  await db.query("SELECT public.adopt_game_pigeon($1,'jacobin pigeon','Archive')",[id]);
  const beforeProfile=(await db.query('SELECT * FROM public.game_users')).rows[0];
  const beforePigeon=(await db.query('SELECT * FROM public.game_pigeons')).rows[0];
  await db.exec(read('migrations/016_achievements.sql'));
  migrationState={beforeProfile,beforePigeon,afterProfile:(await db.query('SELECT * FROM public.game_users')).rows[0],afterPigeon:(await db.query('SELECT * FROM public.game_pigeons')).rows[0],rows:(await db.query('SELECT count(*) FROM public.game_user_achievements')).rows[0].count};
});
after(async()=>db?.close());
beforeEach(async()=>db.exec('TRUNCATE public.game_pigeons,public.game_users,auth.users CASCADE'));

async function account(t) {
  const f=await fixture(t,{gameDb:db}); const user=(await (await f.signup()).json()).user;
  await f.request('/api/game/adopt',{body:{speciesId:'jacobin pigeon',nickname:'Gilbert'}});
  return {...f,user};
}
const feed=(f,requestId=randomUUID())=>f.request('/api/game/feed',{body:{food:'crumbs',requestId}});

test('migration preserves every existing value and creates no retroactive reward',()=>{
  assert.deepEqual(migrationState.afterProfile,migrationState.beforeProfile);
  assert.deepEqual(migrationState.afterPigeon,migrationState.beforePigeon);
  assert.equal(migrationState.rows,0);
});

test('achievement list exposes five milestones, progress and server-owned rewards',async t=>{
  const f=await account(t),response=await f.request('/api/game/achievements'),data=await response.json();
  assert.equal(response.status,200); assert.equal(data.total,5); assert.equal(data.unlockedCount,0);
  assert.deepEqual(data.achievements.map(a=>[a.id,a.progress,a.goal,a.reward]),[
    ['first_crumb',0,1,{coins:25,xp:10}],['pigeon_parent',1,10,{coins:100,xp:50}],
    ['bird_nerd',1,25,{coins:150,xp:75}],['best_friends',1,25,{coins:250,xp:100}],
    ['collector',0,10,{coins:100,xp:50}]
  ]);
});

test('First Crumb unlocks from a saved feed receipt and retries cannot duplicate it',async t=>{
  const f=await account(t),requestId=randomUUID(); await feed(f,requestId); await feed(f,requestId);
  const data=await (await f.request('/api/game/achievements')).json(),first=data.achievements[0];
  assert.equal(data.unlockedCount,1); assert.equal(first.unlocked,true); assert.equal(first.progress,1);
  assert.equal((await db.query("SELECT count(*) FROM public.game_user_achievements WHERE achievement_id='first_crumb'")).rows[0].count,1);
});

test('level and growth milestones unlock from authoritative pigeon state',async t=>{
  const f=await account(t);
  await db.query('UPDATE public.game_pigeons SET level=25,xp=0 WHERE user_id=$1',[f.user.id]);
  const data=await (await f.request('/api/game/achievements')).json();
  assert.equal(data.achievements.find(a=>a.id==='pigeon_parent').unlocked,true);
  assert.equal(data.achievements.find(a=>a.id==='best_friends').unlocked,true);
  assert.equal((await db.query('SELECT growth_stage FROM public.game_pigeons WHERE user_id=$1',[f.user.id])).rows[0].growth_stage,'best_friend');
});

test('Bird Nerd and Collector use distinct saved discoveries and owned item types',async t=>{
  const f=await account(t);
  for(let index=0;index<24;index++) await db.query(`INSERT INTO public.game_species
    (id,name,scientific_name,description,image,rarity,source_url)
    VALUES($1,$2,$3,'Test species','assets/pigeon-hero-wide.png','common','https://example.test/species')`,
    [`birdnet:BN9${String(index).padStart(5,'0')}`,`Test species ${index}`,`Columba test ${index}`]);
  await db.query(`INSERT INTO public.game_pigeon_discoveries(user_id,species_id)
    SELECT $1,id FROM public.game_species WHERE id LIKE 'birdnet:BN9%' ORDER BY id`,[f.user.id]);
  for(let index=0;index<10;index++) await db.query(`INSERT INTO public.game_items(id,name,type,description,image,price,hunger_effect)
    VALUES($1,$2,'food','Test collectible','/assets/items/crumbs.svg',1,1)`,[`test_item_${index}`,`Test item ${index}`]);
  await db.query(`INSERT INTO public.game_user_items(user_id,item_id,quantity)
    SELECT $1,id,1 FROM public.game_items WHERE id LIKE 'test_item_%'`,[f.user.id]);
  const data=await (await f.request('/api/game/achievements')).json();
  assert.equal(data.achievements.find(a=>a.id==='bird_nerd').unlocked,true);
  assert.equal(data.achievements.find(a=>a.id==='collector').unlocked,true);
});

test('claim awards exact coins and XP once and concurrent claims cannot duplicate it',async t=>{
  const f=await account(t); await feed(f);
  const claims=await Promise.all([f.request('/api/game/achievements/claim',{body:{achievementId:'first_crumb',coins:999,xp:999,userId:randomUUID()}}),f.request('/api/game/achievements/claim',{body:{achievementId:'first_crumb'}})]);
  assert.deepEqual(claims.map(r=>r.status).sort(),[200,409]);
  const winner=await claims.find(r=>r.status===200).json();
  assert.deepEqual(winner.effects,{coins:25,xp:10}); assert.equal(winner.achievements.achievements[0].claimed,true);
  assert.deepEqual((await db.query('SELECT coins FROM public.game_users WHERE id=$1',[f.user.id])).rows[0],{coins:27});
  assert.deepEqual((await db.query('SELECT xp FROM public.game_pigeons WHERE user_id=$1',[f.user.id])).rows[0],{xp:15});
});

test('an achievement reward can unlock a later level milestone without double-awarding',async t=>{
  const f=await account(t); await feed(f);
  await db.query('UPDATE public.game_pigeons SET level=9,xp=895 WHERE user_id=$1',[f.user.id]);
  const result=await (await f.request('/api/game/achievements/claim',{body:{achievementId:'first_crumb'}})).json();
  assert.equal(result.pigeon.level,10); assert.equal(result.pigeon.xp,5);
  assert.equal(result.achievements.achievements.find(a=>a.id==='pigeon_parent').unlocked,true);
});

test('locked, unknown and already claimed achievements never change rewards',async t=>{
  const f=await account(t);
  let response=await f.request('/api/game/achievements/claim',{body:{achievementId:'collector'}});
  assert.equal(response.status,409); assert.equal((await response.json()).code,'ACHIEVEMENT_LOCKED');
  response=await f.request('/api/game/achievements/claim',{body:{achievementId:'made_up'}});
  assert.equal(response.status,400); assert.equal((await response.json()).code,'ACHIEVEMENT_INPUT');
  await feed(f); await f.request('/api/game/achievements/claim',{body:{achievementId:'first_crumb'}});
  response=await f.request('/api/game/achievements/claim',{body:{achievementId:'first_crumb'}});
  assert.equal(response.status,409); assert.equal((await response.json()).code,'ACHIEVEMENT_CLAIMED');
});

test('achievement routes enforce session, profile, method and same origin',async t=>{
  const f=await fixture(t,{gameDb:db}); assert.equal((await f.request('/api/game/achievements')).status,401);
  await f.signup(); assert.equal((await f.request('/api/game/achievements',{method:'POST',body:{}})).status,405);
  assert.equal((await f.request('/api/game/achievements/claim',{body:{achievementId:'first_crumb'},origin:'https://evil.example'})).status,403);
});

test('dashboard renders accessible achievement progress and controls',async t=>{
  const f=await account(t); await feed(f);
  const response=await f.request('/my-pigeon'),html=await response.text();
  assert.equal(response.status,200); assert.match(html,/id="achievements"/); assert.match(html,/1 \/ 5 unlocked/);
  assert.match(html,/First Crumb/); assert.match(html,/data-achievement-claim="first_crumb"[^>]*>Claim reward/);
  assert.match(html,/Bird Nerd/); assert.match(html,/1 \/ 25/); assert.match(html,/pigeon-achievements\.js/);
});

test('achievement storage, synchronization and rewards remain server-only with own-read RLS',async t=>{
  const f=await account(t); await feed(f); await f.request('/api/game/achievements');
  for(const role of ['anon','authenticated']) {
    for(const sql of ["SELECT public.sync_game_achievements($1)","SELECT public.claim_game_achievement($1,'first_crumb')","INSERT INTO public.game_user_achievements(user_id,achievement_id) VALUES($1,'collector')"]) {
      await db.exec(`BEGIN; SET LOCAL ROLE ${role}`);
      try {await assert.rejects(db.query(sql,[f.user.id]),{code:'42501'});} finally {await db.exec('ROLLBACK');}
    }
  }
  await db.exec(`BEGIN; SET LOCAL ROLE authenticated; SET LOCAL "request.jwt.claim.sub"='${f.user.id}'`);
  try {assert.equal((await db.query('SELECT count(*) FROM public.game_user_achievements')).rows[0].count,1);} finally {await db.exec('ROLLBACK');}
});
