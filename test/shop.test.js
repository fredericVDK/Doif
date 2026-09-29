const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {before,after,beforeEach,test}=require('node:test');
const {PGlite}=require('@electric-sql/pglite');
const {fixture}=require('../test-support/auth-fixture');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const migrations=['migrations/001_tamagotchi.sql','seeds/tamagotchi-starters.sql','migrations/002_adoption.sql','migrations/003_time_engine.sql','migrations/004_feed.sql','migrations/005_play.sql','migrations/006_clean.sql','migrations/007_sleep.sql','migrations/008_xp_levels.sql','migrations/009_growth_stages.sql','migrations/010_coins.sql','migrations/011_discoveries.sql','migrations/012_daily_reward.sql','migrations/013_inventory.sql'];
let db,migrationState;
before(async()=>{
  db=new PGlite();
  await db.exec(`CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;`);
  for(const file of migrations) await db.exec(read(file));
  const id=randomUUID(); await db.query('INSERT INTO auth.users VALUES($1)',[id]);
  await db.query("INSERT INTO public.game_users(id,username,coins,coins_version) VALUES($1,'ShopLegacy',91,7)",[id]);
  await db.query("SELECT public.adopt_game_pigeon($1,'jacobin pigeon','Archive')",[id]);
  await db.query("INSERT INTO public.game_user_items(user_id,item_id,quantity) VALUES($1,'peas',4)",[id]);
  const beforeProfile=(await db.query('SELECT * FROM public.game_users')).rows[0];
  const beforePigeon=(await db.query('SELECT * FROM public.game_pigeons')).rows[0];
  const beforeItems=(await db.query('SELECT * FROM public.game_user_items')).rows;
  await db.exec(read('migrations/014_shop.sql'));
  migrationState={beforeProfile,beforePigeon,beforeItems,afterProfile:(await db.query('SELECT * FROM public.game_users')).rows[0],afterPigeon:(await db.query('SELECT * FROM public.game_pigeons')).rows[0],afterItems:(await db.query('SELECT * FROM public.game_user_items')).rows,receipts:(await db.query('SELECT count(*) FROM public.game_shop_purchase_receipts')).rows[0].count};
});
after(async()=>db?.close());
beforeEach(async()=>db.exec('TRUNCATE public.game_pigeons,public.game_users,auth.users CASCADE'));

async function account(t,coins=100) {
  const f=await fixture(t,{gameDb:db}); const user=(await (await f.signup()).json()).user;
  await f.request('/api/game/adopt',{body:{speciesId:'jacobin pigeon',nickname:'Gilbert'}});
  await db.query('UPDATE public.game_users SET coins=$2 WHERE id=$1',[user.id,coins]);
  return {...f,user};
}
const buy=(f,itemId,requestId=randomUUID(),extra={})=>f.request('/api/game/shop/buy',{body:{itemId,requestId,...extra}});
const wallet=async id=>(await db.query('SELECT coins,coins_version FROM public.game_users WHERE id=$1',[id])).rows[0];
const quantity=async(id,item)=>(await db.query('SELECT quantity FROM public.game_user_items WHERE user_id=$1 AND item_id=$2',[id,item])).rows[0]?.quantity||0;

test('shop migration preserves profiles, pigeons and inventory without retroactive purchases',()=>{
  assert.deepEqual(migrationState.afterProfile,migrationState.beforeProfile);
  assert.deepEqual(migrationState.afterPigeon,migrationState.beforePigeon);
  assert.deepEqual(migrationState.afterItems,migrationState.beforeItems);
  assert.equal(migrationState.receipts,0);
});

test('purchase uses the database price, subtracts coins and increments inventory atomically',async t=>{
  const f=await account(t,100),requestId=randomUUID();
  const response=await buy(f,'corn',requestId,{price:1,quantity:999,coins:999,userId:randomUUID()});
  const result=await response.json();
  assert.equal(response.status,200); assert.equal(result.purchased,true); assert.equal(result.replayed,false);
  assert.deepEqual(result.wallet,{coins:75,version:1}); assert.deepEqual(result.effects,{coins:-25});
  assert.equal(result.item.id,'corn'); assert.equal(result.item.quantity,1); assert.equal(result.item.price,25);
  assert.deepEqual(await wallet(f.user.id),{coins:75,coins_version:1}); assert.equal(await quantity(f.user.id,'corn'),1);
  const receipt=(await db.query('SELECT * FROM public.game_shop_purchase_receipts')).rows[0];
  assert.equal(receipt.request_id,requestId); assert.equal(receipt.price_paid,25); assert.equal(receipt.item_id,'corn');
});

test('simultaneous retries with one request ID charge and add exactly once',async t=>{
  const f=await account(t,100),requestId=randomUUID();
  const responses=await Promise.all([buy(f,'sunflower_seeds',requestId),buy(f,'sunflower_seeds',requestId),buy(f,'sunflower_seeds',requestId)]);
  const results=await Promise.all(responses.map(async response=>{assert.equal(response.status,200);return response.json();}));
  assert.equal(results.filter(result=>!result.replayed).length,1);
  assert.deepEqual(await wallet(f.user.id),{coins:50,coins_version:1}); assert.equal(await quantity(f.user.id,'sunflower_seeds'),1);
  assert.equal((await db.query('SELECT count(*) FROM public.game_shop_purchase_receipts')).rows[0].count,1);
  for(const replay of results.filter(result=>result.replayed)) assert.deepEqual(replay.effects,{coins:0});
});

test('different concurrent purchases cannot overdraw the balance',async t=>{
  const f=await account(t,15);
  const responses=await Promise.all([buy(f,'crumbs'),buy(f,'crumbs')]);
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
  assert.deepEqual(await wallet(f.user.id),{coins:5,coins_version:1}); assert.equal(await quantity(f.user.id,'crumbs'),1);
  assert.equal((await db.query('SELECT count(*) FROM public.game_shop_purchase_receipts')).rows[0].count,1);
});

test('insufficient coins and unavailable items make no partial changes',async t=>{
  const f=await account(t,9);
  let response=await buy(f,'crumbs'); assert.equal(response.status,409); assert.equal((await response.json()).code,'NOT_ENOUGH_COINS');
  response=await buy(f,'does_not_exist'); assert.equal(response.status,400); assert.equal((await response.json()).code,'ITEM_UNAVAILABLE');
  assert.deepEqual(await wallet(f.user.id),{coins:9,coins_version:0}); assert.equal((await db.query('SELECT count(*) FROM public.game_user_items')).rows[0].count,0);
  assert.equal((await db.query('SELECT count(*) FROM public.game_shop_purchase_receipts')).rows[0].count,0);
});

test('receipt failure and quantity overflow roll back both balance and inventory',async t=>{
  const f=await account(t,100);
  await db.exec(`CREATE FUNCTION public.reject_shop_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Test failure'; END $$;
    CREATE TRIGGER reject_shop_receipt BEFORE INSERT ON public.game_shop_purchase_receipts FOR EACH ROW EXECUTE FUNCTION public.reject_shop_receipt();`);
  try {assert.equal((await buy(f,'corn')).status,503);} finally {await db.exec('DROP TRIGGER reject_shop_receipt ON public.game_shop_purchase_receipts; DROP FUNCTION public.reject_shop_receipt()');}
  assert.deepEqual(await wallet(f.user.id),{coins:100,coins_version:0}); assert.equal(await quantity(f.user.id,'corn'),0);
  await db.query("INSERT INTO public.game_user_items(user_id,item_id,quantity) VALUES($1,'crumbs',2147483647)",[f.user.id]);
  assert.equal((await buy(f,'crumbs')).status,503);
  assert.deepEqual(await wallet(f.user.id),{coins:100,coins_version:0}); assert.equal(await quantity(f.user.id,'crumbs'),2147483647);
  assert.equal((await db.query('SELECT count(*) FROM public.game_shop_purchase_receipts')).rows[0].count,0);
});

test('replay returns the latest wallet and quantity after later purchases',async t=>{
  const f=await account(t,100),first=randomUUID();
  await buy(f,'crumbs',first); await buy(f,'crumbs'); await buy(f,'corn');
  const replay=await (await buy(f,'crumbs',first)).json();
  assert.equal(replay.replayed,true); assert.deepEqual(replay.effects,{coins:0});
  assert.deepEqual(replay.wallet,{coins:55,version:3}); assert.equal(replay.item.quantity,2);
});

test('care rewards and shop spending serialize without a lost balance update',async t=>{
  const f=await account(t,100);
  const [purchase,feed]=await Promise.all([buy(f,'corn'),f.request('/api/game/feed',{body:{requestId:randomUUID(),food:'crumbs'}})]);
  assert.equal(purchase.status,200); assert.equal(feed.status,200);
  assert.deepEqual(await wallet(f.user.id),{coins:77,coins_version:2}); assert.equal(await quantity(f.user.id,'corn'),1);
});

test('shop page is protected, escaped and disables unaffordable products',async t=>{
  const anon=await fixture(t,{gameDb:db}); assert.equal((await anon.request('/shop')).headers.get('location'),'/sign-in');
  const f=await account(t,30); await db.exec("UPDATE public.game_items SET description='<script>bad()</script>' WHERE id='peas'");
  try {
    const response=await f.request('/shop'),html=await response.text();
    assert.equal(response.status,200); assert.match(response.headers.get('cache-control'),/no-store/);
    assert.match(html,/Pigeon Shop/); assert.match(html,/id="shopCoins">30<\/span>/); assert.match(html,/Buy Corn/);
    assert.match(html,/data-item-id="sunflower_seeds" disabled/); assert.match(html,/href="\/shop" aria-current="page"/);
    assert.match(html,/&lt;script&gt;bad\(\)&lt;\/script&gt;/); assert.doesNotMatch(html,/<script>bad\(\)<\/script>/);
  } finally {await db.exec("UPDATE public.game_items SET description='Fresh green bites with a balanced boost.' WHERE id='peas'");}
});

test('shop endpoint validates session, method, origin and browser input',async t=>{
  const f=await fixture(t,{gameDb:db});
  assert.equal((await f.request('/api/game/shop/buy',{body:{itemId:'crumbs',requestId:randomUUID()}})).status,401);
  await f.signup();
  assert.equal((await f.request('/api/game/shop/buy',{method:'GET'})).status,405);
  assert.equal((await f.request('/api/game/shop/buy',{body:{itemId:'crumbs',requestId:randomUUID()},origin:'https://evil.example'})).status,403);
  for(const body of [{},{itemId:'Bad ID',requestId:randomUUID()},{itemId:'crumbs',requestId:'not-a-uuid'}]) {
    const response=await f.request('/api/game/shop/buy',{body}); assert.equal(response.status,400); assert.equal((await response.json()).code,'SHOP_INPUT');
  }
});

test('purchase function and receipt writes remain server-only with own-read RLS',async t=>{
  const f=await account(t,100),id=randomUUID(); await buy(f,'peas',id);
  for(const role of ['anon','authenticated']) {
    for(const sql of ["SELECT public.buy_game_item($1,$2,'crumbs')","INSERT INTO public.game_shop_purchase_receipts(user_id,request_id,item_id,price_paid,result) VALUES($1,$2,'crumbs',0,'{}')"]) {
      await db.exec(`BEGIN; SET LOCAL ROLE ${role}`);
      try {await assert.rejects(db.query(sql,[f.user.id,randomUUID()]),{code:'42501'});}
      finally {await db.exec('ROLLBACK');}
    }
  }
  await db.exec(`BEGIN; SET LOCAL ROLE authenticated; SET LOCAL "request.jwt.claim.sub"='${f.user.id}'`);
  try {assert.equal((await db.query('SELECT count(*) FROM public.game_shop_purchase_receipts')).rows[0].count,1);}
  finally {await db.exec('ROLLBACK');}
});

test('purchases persist through logout and storage failures remain retryable',async t=>{
  const f=await account(t,100),requestId=randomUUID();
  f.provider.state.gameDown=true; assert.equal((await buy(f,'peas',requestId)).status,503);
  f.provider.state.gameDown=false; assert.equal((await buy(f,'peas',requestId)).status,200);
  await f.request('/api/auth/sign-out',{body:{}}); await f.request('/api/auth/sign-in',{body:{username:'BirdFriend',password:'a good test password'}});
  const inventory=await (await f.request('/api/game/inventory')).json();
  assert.equal(inventory.items.find(item=>item.id==='peas').quantity,1); assert.deepEqual(await wallet(f.user.id),{coins:65,coins_version:1});
});
