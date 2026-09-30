const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {before,after,beforeEach,test}=require('node:test');
const {PGlite}=require('@electric-sql/pglite');
const {fixture}=require('../test-support/auth-fixture');

let db;
const files=['001_tamagotchi.sql','../seeds/tamagotchi-starters.sql','002_adoption.sql','003_time_engine.sql','004_feed.sql','005_play.sql','006_clean.sql','007_sleep.sql','008_xp_levels.sql','009_growth_stages.sql','010_coins.sql','011_discoveries.sql','012_daily_reward.sql','013_inventory.sql','014_shop.sql','015_daily_quests.sql','016_achievements.sql','017_catch_the_crumbs.sql','018_inventory_feeding.sql','019_pigeon_battles.sql','020_automatic_battles.sql','021_battle_health.sql','022_level_scaled_battle_damage.sql','023_pigeon_packs.sql','024_pigeon_clinic.sql','025_more_quests_achievements.sql','026_more_permanent_achievements.sql','027_username_password_accounts.sql','028_account_admin.sql','029_progression_social.sql'];
const read=file=>fs.readFileSync(path.join(__dirname,'..',file.startsWith('../')?file.slice(3):`migrations/${file}`),'utf8');
before(async()=>{db=new PGlite();await db.exec(`CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE ROLE anon NOLOGIN;CREATE ROLE authenticated NOLOGIN;CREATE ROLE service_role NOLOGIN BYPASSRLS;CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;`);for(const file of files)await db.exec(read(file));});
after(async()=>db?.close());beforeEach(async()=>db.exec('TRUNCATE public.game_pigeons,public.game_users,auth.users CASCADE'));
async function player(t,username='SocialBird'){const app=await fixture(t,{gameDb:db}),user=(await(await app.signup(username)).json()).user;await app.request('/api/game/adopt',{body:{speciesId:'jacobin pigeon',nickname:'Milo'}});return{...app,user};}

test('daily reward reaches the server-owned seventh-day bonus',async t=>{
  const app=await player(t);let reward=await(await app.request('/api/game/daily-reward',{body:{}})).json();
  assert.deepEqual(reward.streak,{days:1,cycleDay:1,nextCycleDay:2});
  await db.exec("UPDATE public.game_daily_rewards SET reward_date=current_date-1,streak_day=6");
  reward=await(await app.request('/api/game/daily-reward',{body:{}})).json();
  assert.deepEqual(reward.effects,{coins:200,xp:50});assert.equal(reward.streak.days,7);assert.equal(reward.streak.cycleDay,7);
});

test('PigeonDex favourites persist on the account and reject undiscovered entries',async t=>{
  const app=await player(t);let response=await app.request('/api/game/discoveries/favorite',{body:{speciesId:'jacobin pigeon'}});
  assert.equal(response.status,200);assert.equal((await response.json()).favorite,true);
  let dex=await(await app.request('/api/game/discoveries')).json();assert.deepEqual(dex.favorites,['jacobin pigeon']);
  response=await app.request('/api/game/discoveries/favorite',{body:{speciesId:'indian fantail'}});
  assert.equal(response.status,409);assert.equal((await response.json()).code,'UNDISCOVERED_PIGEON');
});

test('battle records, injuries and clinic recovery are authoritative',async t=>{
  const app=await player(t);await db.exec('UPDATE public.game_pigeons SET level=12,energy=100,last_battled_at=NULL;UPDATE public.game_users SET coins=500');
  let requestId;
  for(let attempt=0;attempt<60;attempt++){const candidate=randomUUID();const roll=(await db.query("SELECT mod(abs(hashtext($1::text||':battle')::bigint),100)::integer value",[candidate])).rows[0].value;const crit=(await db.query("SELECT mod(abs(hashtext($1::text||':critical')::bigint),100)::integer value",[candidate])).rows[0].value;if(roll<58&&crit>=12){requestId=candidate;break;}}
  assert.ok(requestId);const battle=await(await app.request('/api/game/battle',{body:{requestId}})).json();
  assert.equal(battle.won,false);assert.ok(Number(battle.effects.health)<0);assert.equal(battle.battleStats.losses,1);assert.ok(battle.injuredUntil);
  let blocked=await app.request('/api/game/battle',{body:{requestId:randomUUID()}});assert.equal(blocked.status,409);assert.equal((await blocked.json()).code,'BATTLE_INJURED');
  const clinic=await(await app.request('/api/game/clinic',{body:{requestId:randomUUID()}})).json();assert.equal(clinic.injuryCleared,true);assert.equal(Number(clinic.pigeon.health),100);
  const stats=await(await app.request('/api/game/battle/stats')).json();assert.equal(stats.rank,'Rookie');assert.equal(stats.losses,1);assert.equal(stats.injuredUntil,null);
});

test('players can expose and hide their progress profile',async t=>{
  const app=await player(t,'ProfileBird');let page=await app.request('/player/ProfileBird');assert.equal(page.status,200);assert.match(await page.text(),/Milo/);
  const own=await app.request('/profile');assert.match(await own.text(),/Public profile/);
  assert.equal((await app.request('/api/game/profile/privacy',{body:{public:false}})).status,200);
  await app.request('/api/auth/sign-out',{body:{}});page=await app.request('/player/ProfileBird');assert.match(await page.text(),/keeps their Pigeon Crumbs profile private/);
});
