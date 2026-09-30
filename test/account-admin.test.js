const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {before,after,beforeEach,test}=require('node:test');
const {PGlite}=require('@electric-sql/pglite');
const {fixture}=require('../test-support/auth-fixture');

let db;
const migrations=['001_tamagotchi.sql','002_adoption.sql','003_time_engine.sql','004_feed.sql','005_play.sql','006_clean.sql','007_sleep.sql','008_xp_levels.sql','009_growth_stages.sql','010_coins.sql','011_discoveries.sql','012_daily_reward.sql','013_inventory.sql','014_shop.sql','015_daily_quests.sql','016_achievements.sql','017_catch_the_crumbs.sql','018_inventory_feeding.sql','019_pigeon_battles.sql','020_automatic_battles.sql','021_battle_health.sql','022_level_scaled_battle_damage.sql','023_pigeon_packs.sql','024_pigeon_clinic.sql','025_more_quests_achievements.sql','026_more_permanent_achievements.sql','027_username_password_accounts.sql','028_account_admin.sql'];

before(async()=>{
  db=new PGlite();
  await db.exec(`CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;`);
  for(const file of migrations){
    await db.exec(fs.readFileSync(path.join(__dirname,'../migrations',file),'utf8'));
    if(file==='001_tamagotchi.sql')await db.exec(fs.readFileSync(path.join(__dirname,'../seeds/tamagotchi-starters.sql'),'utf8'));
  }
});
after(async()=>db?.close());
beforeEach(async()=>db.exec('TRUNCATE public.game_pigeons,public.game_users,auth.users CASCADE'));

async function createPlayer(app,username){
  const result=await app.signup(username);
  assert.equal(result.status,200);
  return (await result.json()).user;
}

test('FredAdmin is promoted and sent to the protected account dashboard',async t=>{
  const app=await fixture(t,{gameDb:db});
  const signup=await app.signup('FredAdmin');
  assert.equal(signup.status,200);
  assert.equal((await signup.json()).redirect,'/admin.html');

  const player=await createPlayer(app,'FlockMember');
  await app.request('/api/auth/sign-out',{body:{}});
  const login=await app.request('/api/auth/sign-in',{body:{username:'FredAdmin',password:'a good test password'}});
  assert.equal(login.status,200);
  assert.equal((await login.json()).redirect,'/admin.html');

  const page=await app.request('/admin.html');
  assert.equal(page.status,200);
  const html=await page.text();
  assert.match(html,/Account Admin/);
  assert.match(html,/FredAdmin/);
  assert.match(html,/FlockMember/);
  assert.match(html,/account-admin\.js/);
  assert.doesNotMatch(html,new RegExp(player.id));
  assert.doesNotMatch(html,/@accounts\.pigeoncrumbs\.invalid/);
});

test('ordinary and signed-out users cannot view or call account administration',async t=>{
  const app=await fixture(t,{gameDb:db});
  assert.equal((await app.request('/admin.html')).headers.get('location'),'/sign-in');
  assert.equal((await app.request('/api/admin/accounts')).status,401);
  await createPlayer(app,'RegularBird');
  assert.equal((await app.request('/admin.html')).headers.get('location'),'/my-pigeon');
  assert.equal((await app.request('/api/admin/accounts')).status,403);
  assert.equal((await app.request('/api/admin/coins',{body:{username:'RegularBird',amount:100}})).status,403);
});

test('admin can grant validated coins by username and every grant is audited',async t=>{
  const app=await fixture(t,{gameDb:db});
  const admin=await createPlayer(app,'FredAdmin');
  await app.request('/api/auth/sign-out',{body:{}});
  const target=await createPlayer(app,'CoinBird');
  await app.request('/api/auth/sign-out',{body:{}});
  await app.request('/api/auth/sign-in',{body:{username:'FredAdmin',password:'a good test password'}});

  const listing=await (await app.request('/api/admin/accounts')).json();
  assert.equal(listing.count,2);
  assert.deepEqual(listing.accounts.map(account=>account.username),['CoinBird','FredAdmin']);
  assert.deepEqual(Object.keys(listing.accounts[0]).sort(),['coins','createdAt','discoveries','isAdmin','pigeon','username']);

  const grant=await app.request('/api/admin/coins',{body:{username:'coinbird',amount:1250,userId:admin.id,coins:999999}});
  assert.equal(grant.status,200);
  assert.deepEqual(await grant.json(),{coins:1250,granted:1250,username:'CoinBird',version:1});
  assert.deepEqual((await db.query('SELECT coins,coins_version FROM public.game_users WHERE id=$1',[target.id])).rows,[{coins:1250,coins_version:1}]);
  assert.deepEqual((await db.query('SELECT admin_user_id,target_user_id,amount FROM public.game_admin_coin_grants')).rows,
    [{admin_user_id:admin.id,target_user_id:target.id,amount:1250}]);

  for(const amount of [0,-1,1.5,100001]){
    assert.equal((await app.request('/api/admin/coins',{body:{username:'CoinBird',amount}})).status,400);
  }
  assert.equal((await app.request('/api/admin/coins',{body:{username:'MissingBird',amount:1}})).status,404);
  assert.equal((await app.request('/api/admin/coins',{body:{username:'CoinBird',amount:1},origin:'https://evil.example'})).status,403);
});

test('admin tables and functions are unavailable to browser database roles',async()=>{
  const adminId='90000000-0000-4000-8000-000000000001';
  await db.query('INSERT INTO auth.users(id) VALUES($1)',[adminId]);
  await db.query("INSERT INTO public.game_users(id,username) VALUES($1,'FredAdmin')",[adminId]);
  assert.equal((await db.query('SELECT public.claim_initial_game_admin($1) AS allowed',[adminId])).rows[0].allowed,true);
  for(const role of ['anon','authenticated']){
    await db.exec(`SET ROLE ${role}`);
    try{
      await assert.rejects(db.query('SELECT * FROM public.game_admins'),{code:'42501'});
      await assert.rejects(db.query('SELECT public.get_game_admin_accounts($1)',[adminId]),{code:'42501'});
      await assert.rejects(db.query("SELECT public.grant_game_admin_coins($1,'FredAdmin',1)",[adminId]),{code:'42501'});
    }finally{await db.exec('RESET ROLE');}
  }
});
