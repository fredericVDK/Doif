const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {before,after,beforeEach,test}=require('node:test');
const {PGlite}=require('@electric-sql/pglite');
const {fixture}=require('../test-support/auth-fixture');

const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const migrations=['migrations/001_tamagotchi.sql','seeds/tamagotchi-starters.sql','migrations/002_adoption.sql','migrations/003_time_engine.sql','migrations/004_feed.sql','migrations/005_play.sql','migrations/006_clean.sql','migrations/007_sleep.sql','migrations/008_xp_levels.sql','migrations/009_growth_stages.sql','migrations/010_coins.sql','migrations/011_discoveries.sql','migrations/012_daily_reward.sql'];
let db,migrationState;
before(async()=>{
  db=new PGlite();
  await db.exec(`CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;`);
  for(const file of migrations) await db.exec(read(file));
  const id=randomUUID();
  await db.query('INSERT INTO auth.users VALUES($1)',[id]);
  await db.query("INSERT INTO public.game_users(id,username,coins,coins_version) VALUES($1,'InventoryLegacy',88,3)",[id]);
  await db.query("SELECT public.adopt_game_pigeon($1,'indian fantail','Pearl')",[id]);
  await db.exec('UPDATE public.game_pigeons SET level=6,xp=44,hunger=73,version=9');
  await db.query("INSERT INTO public.game_daily_rewards(user_id,reward_date) VALUES($1,current_date)",[id]);
  const beforePigeon=(await db.query('SELECT * FROM public.game_pigeons')).rows[0];
  const beforeProfile=(await db.query('SELECT * FROM public.game_users')).rows[0];
  await db.exec(read('migrations/013_inventory.sql'));
  migrationState={beforePigeon,beforeProfile,afterPigeon:(await db.query('SELECT * FROM public.game_pigeons')).rows[0],afterProfile:(await db.query('SELECT * FROM public.game_users')).rows[0],userItems:(await db.query('SELECT count(*) FROM public.game_user_items')).rows[0].count,rewards:(await db.query('SELECT count(*) FROM public.game_daily_rewards')).rows[0].count};
});
after(async()=>db?.close());
beforeEach(async()=>db.exec('TRUNCATE public.game_pigeons,public.game_users,auth.users CASCADE'));

async function account(t,{adopt=true}={}) {
  const f=await fixture(t,{gameDb:db});
  const user=(await (await f.signup()).json()).user;
  if(adopt) await f.request('/api/game/adopt',{body:{speciesId:'jacobin pigeon',nickname:'Gilbert'}});
  return {...f,user};
}

test('inventory migration preserves progress and creates no retroactive possessions',()=>{
  assert.deepEqual(migrationState.afterPigeon,migrationState.beforePigeon);
  assert.deepEqual(migrationState.afterProfile,migrationState.beforeProfile);
  assert.equal(migrationState.userItems,0); assert.equal(migrationState.rewards,1);
});

test('catalog seeds the four food items with server-owned prices and effects',async()=>{
  const items=(await db.query('SELECT * FROM public.game_items ORDER BY price,name')).rows;
  assert.deepEqual(items.map(item=>item.id),['crumbs','corn','peas','sunflower_seeds']);
  assert.deepEqual(items.map(item=>[item.name,item.price]),[['Crumbs',10],['Corn',25],['Peas',35],['Sunflower Seeds',50]]);
  assert.deepEqual(items.find(item=>item.id==='crumbs'),{
    id:'crumbs',name:'Crumbs',type:'food',description:'A few familiar favourites for a hungry city pigeon.',price:10,
    hunger_effect:15,happiness_effect:2,energy_effect:0,cleanliness_effect:0,image:'/assets/items/crumbs.svg'
  });
  for(const item of items) {assert.equal(item.type,'food');assert.match(item.image,/^\/assets\/items\/.+\.svg$/);}
});

test('inventory API returns all catalog items and only the verified account quantities',async t=>{
  const f=await account(t), other=randomUUID();
  await db.query('INSERT INTO auth.users VALUES($1)',[other]);
  await db.query("INSERT INTO public.game_users(id,username) VALUES($1,'OtherInventory')",[other]);
  await db.query("INSERT INTO public.game_user_items(user_id,item_id,quantity) VALUES($1,'corn',2),($1,'peas',4)",[f.user.id]);
  await db.query("INSERT INTO public.game_user_items(user_id,item_id,quantity) VALUES($1,'crumbs',99)",[other]);
  const response=await f.request(`/api/game/inventory?userId=${other}`), result=await response.json();
  assert.equal(response.status,200); assert.equal(result.items.length,4);
  assert.deepEqual(result.summary,{distinctOwned:2,totalQuantity:6});
  assert.equal(result.items.find(item=>item.id==='corn').quantity,2);
  assert.equal(result.items.find(item=>item.id==='peas').quantity,4);
  assert.equal(result.items.find(item=>item.id==='crumbs').quantity,0);
});

test('protected inventory page is responsive markup with escaped server data',async t=>{
  const f=await account(t);
  await db.query("INSERT INTO public.game_user_items(user_id,item_id,quantity) VALUES($1,'sunflower_seeds',3)",[f.user.id]);
  await db.exec("UPDATE public.game_items SET description='<script>bad()</script>' WHERE id='peas'");
  try {
    const response=await f.request('/inventory'),html=await response.text();
    assert.equal(response.status,200); assert.match(response.headers.get('cache-control'),/no-store/);
    assert.match(html,/Your inventory/); assert.match(html,/Sunflower Seeds/); assert.match(html,/aria-label="Quantity 3"/);
    assert.match(html,/Different items[\s\S]*<strong>1<\/strong>/); assert.match(html,/Total items[\s\S]*<strong>3<\/strong>/);
    assert.match(html,/&lt;script&gt;bad\(\)&lt;\/script&gt;/); assert.doesNotMatch(html,/<script>bad\(\)<\/script>/);
    assert.match(html,/href="\/inventory" aria-current="page"/); assert.match(html,/inventory\.css/);
  } finally {await db.exec("UPDATE public.game_items SET description='Fresh green bites with a balanced boost.' WHERE id='peas'");}
});

test('the production server declares SVG item assets with the correct MIME type',()=>{
  const source=read('server.js');
  assert.match(source,/"\.svg": "image\/svg\+xml; charset=utf-8"/);
  for(const name of ['crumbs','corn','sunflower-seeds','peas']) {
    const svg=read(`public/assets/items/${name}.svg`);
    assert.match(svg,/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  }
});

test('empty inventory links to the shop while free care remains available',async t=>{
  const f=await account(t);
  const inventory=await (await f.request('/inventory')).text();
  assert.match(inventory,/Your pockets are empty for now/); assert.match(inventory,/href="\/shop">Pigeon Shop/); assert.match(inventory,/Free Crumbs on the care screen remain available/);
  const dashboard=await (await f.request('/my-pigeon')).text();
  assert.match(dashboard,/A few familiar favourites\. Free\./); assert.match(dashboard,/href="\/inventory"/);
});

test('inventory requires a session and profile but not an adopted pigeon',async t=>{
  const f=await fixture(t,{gameDb:db});
  assert.equal((await f.request('/inventory')).headers.get('location'),'/sign-in');
  assert.equal((await f.request('/api/game/inventory')).status,401);
  const signup=await f.signup('PocketBird',{username:undefined});
  assert.equal(signup.status,400);
  await f.signup('PocketBird');
  assert.equal((await f.request('/inventory')).status,200);
  assert.equal((await f.request('/api/game/inventory')).status,200);
  assert.equal((await f.request('/api/game/inventory',{body:{}})).status,405);
});

test('quantity, item identity and foreign keys are enforced and account removal cascades',async t=>{
  const f=await account(t,{adopt:false});
  for(const [sql,code] of [
    ["INSERT INTO public.game_user_items(user_id,item_id,quantity) VALUES($1,'crumbs',0)",'23514'],
    ["INSERT INTO public.game_user_items(user_id,item_id,quantity) VALUES($1,'missing',1)",'23503'],
    ["INSERT INTO public.game_items(id,name,type,description,price,image) VALUES('Bad ID','Bad','food','Bad item',1,'/assets/items/bad.svg')",'23514']
  ]) await assert.rejects(db.query(sql,sql.includes('$1')?[f.user.id]:[]),{code});
  await db.query("INSERT INTO public.game_user_items(user_id,item_id,quantity) VALUES($1,'crumbs',7)",[f.user.id]);
  await assert.rejects(db.exec("DELETE FROM public.game_items WHERE id='crumbs'"),error=>['23001','23503'].includes(error.code));
  await db.query('DELETE FROM public.game_users WHERE id=$1',[f.user.id]);
  assert.equal((await db.query('SELECT count(*) FROM public.game_user_items')).rows[0].count,0);
  assert.equal((await db.query('SELECT count(*) FROM public.game_items')).rows[0].count,4);
});

test('user item writes and inventory function remain server-only while RLS isolates reads',async t=>{
  const f=await account(t),other=randomUUID();
  await db.query('INSERT INTO auth.users VALUES($1)',[other]); await db.query("INSERT INTO public.game_users(id,username) VALUES($1,'OtherRls')",[other]);
  await db.query("INSERT INTO public.game_user_items(user_id,item_id,quantity) VALUES($1,'corn',2),($2,'peas',5)",[f.user.id,other]);
  for(const role of ['anon','authenticated']) {
    await db.exec(`BEGIN; SET LOCAL ROLE ${role}`);
    try {await assert.rejects(db.query('SELECT public.get_game_inventory($1)',[f.user.id]),{code:'42501'});}
    finally {await db.exec('ROLLBACK');}
  }
  await db.exec(`BEGIN; SET LOCAL ROLE authenticated; SET LOCAL "request.jwt.claim.sub"='${f.user.id}'`);
  try {
    assert.deepEqual((await db.query('SELECT item_id,quantity FROM public.game_user_items')).rows,[{item_id:'corn',quantity:2}]);
    await assert.rejects(db.query("UPDATE public.game_user_items SET quantity=99 WHERE user_id=$1",[f.user.id]),{code:'42501'});
  } finally {await db.exec('ROLLBACK');}
  await db.exec('BEGIN; SET LOCAL ROLE service_role');
  try {assert.equal((await db.query('SELECT public.get_game_inventory($1) AS result',[f.user.id])).rows[0].result.find(item=>item.id==='corn').quantity,2);}
  finally {await db.exec('ROLLBACK');}
});

test('storage failures are friendly and quantities persist through a new session',async t=>{
  const f=await account(t);
  await db.query("INSERT INTO public.game_user_items(user_id,item_id,quantity) VALUES($1,'peas',6)",[f.user.id]);
  f.provider.state.gameDown=true;
  const failed=await f.request('/api/game/inventory'); assert.equal(failed.status,503); assert.equal((await failed.json()).code,'INVENTORY_STORAGE');
  f.provider.state.gameDown=false;
  await f.request('/api/auth/sign-out',{body:{}});
  await f.request('/api/auth/sign-in',{body:{username:'BirdFriend',password:'a good test password'}});
  const saved=await (await f.request('/api/game/inventory')).json();
  assert.equal(saved.items.find(item=>item.id==='peas').quantity,6);
});
