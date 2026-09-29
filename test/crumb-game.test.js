const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {before,after,beforeEach,test}=require('node:test');
const {PGlite}=require('@electric-sql/pglite');
const {fixture}=require('../test-support/auth-fixture');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const migrations=['migrations/001_tamagotchi.sql','seeds/tamagotchi-starters.sql','migrations/002_adoption.sql','migrations/003_time_engine.sql','migrations/004_feed.sql','migrations/005_play.sql','migrations/006_clean.sql','migrations/007_sleep.sql','migrations/008_xp_levels.sql','migrations/009_growth_stages.sql','migrations/010_coins.sql','migrations/011_discoveries.sql','migrations/012_daily_reward.sql','migrations/013_inventory.sql','migrations/014_shop.sql','migrations/015_daily_quests.sql','migrations/016_achievements.sql'];
let db,migrationState;
before(async()=>{
  db=new PGlite();
  await db.exec(`CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;`);
  for(const file of migrations) await db.exec(read(file));
  const id=randomUUID(); await db.query('INSERT INTO auth.users VALUES($1)',[id]);
  await db.query("INSERT INTO public.game_users(id,username,coins) VALUES($1,'GameLegacy',29)",[id]);
  await db.query("SELECT public.adopt_game_pigeon($1,'jacobin pigeon','Archive')",[id]);
  const beforeProfile=(await db.query('SELECT * FROM public.game_users')).rows[0];
  const beforePigeon=(await db.query('SELECT * FROM public.game_pigeons')).rows[0];
  await db.exec(read('migrations/017_catch_the_crumbs.sql'));
  migrationState={beforeProfile,beforePigeon,afterProfile:(await db.query('SELECT * FROM public.game_users')).rows[0],afterPigeon:(await db.query('SELECT * FROM public.game_pigeons')).rows[0],runs:(await db.query('SELECT count(*) FROM public.game_crumb_runs')).rows[0].count};
});
after(async()=>db?.close());
beforeEach(async()=>db.exec('TRUNCATE public.game_pigeons,public.game_users,auth.users CASCADE'));

async function account(t,name='GameBird') {
  const f=await fixture(t,{gameDb:db}); const user=(await (await f.signup(name)).json()).user;
  await f.request('/api/game/adopt',{body:{speciesId:'jacobin pigeon',nickname:'Gilbert'}}); return {...f,user};
}
const start=(f,requestId=randomUUID(),extra={})=>f.request('/api/game/crumbs/start',{body:{requestId,...extra}});
const finish=(f,runId,caught,extra={})=>f.request('/api/game/crumbs/finish',{body:{runId,caught,...extra}});
async function mature(runId,seconds=30){await db.query("UPDATE public.game_crumb_runs SET started_at=clock_timestamp()-$2*interval '1 second' WHERE id=$1",[runId,seconds]);}

test('migration preserves existing accounts and pigeons without retroactive runs',()=>{
  assert.deepEqual(migrationState.afterProfile,migrationState.beforeProfile);assert.deepEqual(migrationState.afterPigeon,migrationState.beforePigeon);assert.equal(migrationState.runs,0);
});

test('start creates one server schedule and retries or parallel tabs reuse the active run',async t=>{
  const f=await account(t),requestId=randomUUID();
  const first=await (await start(f,requestId,{durationSeconds:1,schedule:[{id:0,x:50}]})).json();
  const [retryResponse,otherResponse,parallelResponse]=await Promise.all([start(f,requestId),start(f),start(f)]);
  const retry=await retryResponse.json(),other=await otherResponse.json(),parallel=await parallelResponse.json();
  assert.equal(first.runId,retry.runId);assert.equal(first.runId,other.runId);assert.equal(first.runId,parallel.runId);assert.equal(first.durationSeconds,30);assert.equal(first.schedule.length,40);
  assert.deepEqual(first.schedule.map((c,i)=>[c.id,c.catchAtMs>=1500,c.x>=5&&c.x<=95]),Array.from({length:40},(_,i)=>[i,true,true]));
  assert.equal((await db.query('SELECT count(*) FROM public.game_crumb_runs')).rows[0].count,1);
});

test('a valid completed round receives rewards calculated only from verified catches',async t=>{
  const f=await account(t),game=await (await start(f)).json();await mature(game.runId);
  const response=await finish(f,game.runId,[0,5,10],{score:40,coins:999,xp:999,userId:randomUUID()}),result=await response.json();
  assert.equal(response.status,200);assert.equal(result.score,3);assert.deepEqual(result.effects,{coins:3,xp:6});
  assert.deepEqual(result.wallet,{coins:3,version:1});assert.equal(result.pigeon.xp,6);
  const run=(await db.query('SELECT score,coins_awarded,xp_awarded FROM public.game_crumb_runs WHERE id=$1',[game.runId])).rows[0];
  assert.deepEqual(run,{score:3,coins_awarded:3,xp_awarded:6});
});

test('early, expired, duplicate, unknown and impossible catches pay nothing',async t=>{
  const f=await account(t),early=await (await start(f)).json();
  let response=await finish(f,early.runId,[0]);assert.equal(response.status,409);assert.equal((await response.json()).code,'RUN_IN_PROGRESS');
  await db.query("UPDATE public.game_crumb_runs SET schedule=jsonb_set(jsonb_set(schedule,'{0,x}','5'),'{1,x}','95'),started_at=clock_timestamp()-interval '30 seconds' WHERE id=$1",[early.runId]);
  for(const [caught,code] of [[[0,0],'INVALID_SCORE'],[[40],'GAME_RESULT'],[[0,1],'INVALID_SCORE']]){response=await finish(f,early.runId,caught);assert.equal(response.status,400);assert.equal((await response.json()).code,code);}
  await mature(early.runId,180);response=await finish(f,early.runId,[]);assert.equal(response.status,409);assert.equal((await response.json()).code,'RUN_EXPIRED');
  assert.deepEqual((await db.query('SELECT coins FROM public.game_users WHERE id=$1',[f.user.id])).rows[0],{coins:0});
});

test('concurrent and repeated finishes save and reward one result',async t=>{
  const f=await account(t),game=await (await start(f)).json();await mature(game.runId);
  const responses=await Promise.all([finish(f,game.runId,[0,5]),finish(f,game.runId,[0,5]),finish(f,game.runId,[0,5])]);
  assert.ok(responses.every(r=>r.status===200));const results=await Promise.all(responses.map(r=>r.json()));
  assert.equal(results.filter(r=>!r.replayed).length,1);assert.deepEqual((await db.query('SELECT coins FROM public.game_users WHERE id=$1',[f.user.id])).rows[0],{coins:2});
  assert.deepEqual((await db.query('SELECT xp FROM public.game_pigeons WHERE user_id=$1',[f.user.id])).rows[0],{xp:4});
});

test('a zero score completes without changing XP or wallet revisions',async t=>{
  const f=await account(t),game=await (await start(f)).json();await mature(game.runId);
  const result=await (await finish(f,game.runId,[])).json();assert.equal(result.score,0);assert.deepEqual(result.effects,{coins:0,xp:0});
  assert.deepEqual((await db.query('SELECT coins,coins_version FROM public.game_users WHERE id=$1',[f.user.id])).rows[0],{coins:0,coins_version:0});
  assert.deepEqual((await db.query('SELECT xp,version FROM public.game_pigeons WHERE user_id=$1',[f.user.id])).rows[0],{xp:0,version:0});
});

test('a failed run receipt update rolls back coins, XP and completion',async t=>{
  const f=await account(t),game=await (await start(f)).json();await mature(game.runId);
  await db.exec(`CREATE FUNCTION public.reject_crumb_completion() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.completed_at IS NOT NULL THEN RAISE EXCEPTION 'Test failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER reject_crumb_completion BEFORE UPDATE ON public.game_crumb_runs FOR EACH ROW EXECUTE FUNCTION public.reject_crumb_completion();`);
  try{assert.equal((await finish(f,game.runId,[0])).status,503);}finally{await db.exec('DROP TRIGGER reject_crumb_completion ON public.game_crumb_runs; DROP FUNCTION public.reject_crumb_completion()');}
  assert.deepEqual((await db.query('SELECT coins FROM public.game_users WHERE id=$1',[f.user.id])).rows[0],{coins:0});assert.deepEqual((await db.query('SELECT xp FROM public.game_pigeons WHERE user_id=$1',[f.user.id])).rows[0],{xp:0});
  assert.equal((await db.query('SELECT completed_at FROM public.game_crumb_runs WHERE id=$1',[game.runId])).rows[0].completed_at,null);
  assert.equal((await finish(f,game.runId,[0])).status,200);
});

test('runs are account-scoped and a different player cannot finish them',async t=>{
  const f=await fixture(t,{gameDb:db});await f.signup('FirstGamer');await f.request('/api/game/adopt',{body:{speciesId:'jacobin pigeon',nickname:'First'}});
  const firstCookie=[...f.jar].map(([key,value])=>`${key}=${value}`).join('; ');
  const game=await (await f.request('/api/game/crumbs/start',{body:{requestId:randomUUID()},cookie:firstCookie,updateCookies:false})).json();await mature(game.runId);
  await f.request('/api/auth/sign-out',{body:{}});await f.signup('SecondGamer');await f.request('/api/game/adopt',{body:{speciesId:'jacobin pigeon',nickname:'Second'}});
  const response=await finish(f,game.runId,[0]);assert.equal(response.status,404);assert.equal((await response.json()).code,'RUN_NOT_FOUND');
  assert.equal((await f.request('/api/game/crumbs/finish',{body:{runId:game.runId,caught:[0]},cookie:firstCookie,updateCookies:false})).status,200);
});

test('minigame endpoints validate session, method, origin and payload bounds',async t=>{
  const f=await fixture(t,{gameDb:db});assert.equal((await start(f)).status,401);await f.signup();
  assert.equal((await f.request('/api/game/crumbs/start',{method:'GET'})).status,405);
  assert.equal((await start(f,randomUUID(),{origin:'ignored'})).status,409);
  assert.equal((await f.request('/api/game/crumbs/start',{body:{requestId:randomUUID()},origin:'https://evil.example'})).status,403);
  for(const body of [{},{runId:'bad',caught:[]},{runId:randomUUID(),caught:[-1]},{runId:randomUUID(),caught:Array(41).fill(0)}]){
    const response=await f.request('/api/game/crumbs/finish',{body});assert.equal(response.status,400);
  }
});

test('protected game page links from the roost and renders accessible controls',async t=>{
  const anon=await fixture(t,{gameDb:db});assert.equal((await anon.request('/catch-the-crumbs')).headers.get('location'),'/sign-in');
  const f=await account(t),roost=await (await f.request('/my-pigeon')).text(),response=await f.request('/catch-the-crumbs'),html=await response.text();
  assert.match(roost,/href="\/catch-the-crumbs"/);assert.equal(response.status,200);assert.match(html,/Catch the Crumbs/);assert.match(html,/id="crumbBoard"/);assert.match(html,/aria-label="Move pigeon left"/);assert.match(html,/crumb-game\.js/);
  assert.match(read('public/crumb-game.css'),/\.crumb-game-page \{[^}]*border:1px solid #c8ac65/);assert.match(read('public/pigeon-dashboard.css'),/\.minigame-invite \{[^}]*border:1px solid #c8ac65/);
});

test('run storage and score functions remain server-only with own-read RLS',async t=>{
  const f=await account(t),game=await (await start(f)).json();
  for(const role of ['anon','authenticated'])for(const sql of ["SELECT public.start_crumb_game($1,gen_random_uuid())","SELECT public.finish_crumb_game($1,$2,ARRAY[]::integer[])","UPDATE public.game_crumb_runs SET score=40 WHERE id=$1"]){
    const params=sql.includes('finish_crumb_game')?[f.user.id,game.runId]:sql.startsWith('UPDATE')?[game.runId]:[f.user.id];
    await db.exec(`BEGIN; SET LOCAL ROLE ${role}`);try{await assert.rejects(db.query(sql,params),{code:'42501'});}finally{await db.exec('ROLLBACK');}
  }
  await db.exec(`BEGIN; SET LOCAL ROLE authenticated; SET LOCAL "request.jwt.claim.sub"='${f.user.id}'`);try{assert.equal((await db.query('SELECT count(*) FROM public.game_crumb_runs')).rows[0].count,1);}finally{await db.exec('ROLLBACK');}
});
