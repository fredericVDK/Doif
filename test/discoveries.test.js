const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {randomUUID}=require("node:crypto");
const {test,before,beforeEach,after}=require("node:test");
const {PGlite}=require("@electric-sql/pglite");
const {fixture}=require("../test-support/auth-fixture");
const {dailyDiscoveryId,bundledCatalog}=require("../lib/game/discoveries");
let db,migration;
const date=new Date("2026-09-28T12:00:00Z");
const read=file=>fs.readFileSync(path.join(__dirname,"..",file),"utf8");
before(async()=>{
  db=new PGlite();
  await db.exec(`CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
    GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;`);
  for(const file of ["migrations/001_tamagotchi.sql","seeds/tamagotchi-starters.sql","migrations/002_adoption.sql","migrations/003_time_engine.sql","migrations/004_feed.sql","migrations/005_play.sql","migrations/006_clean.sql","migrations/007_sleep.sql","migrations/008_xp_levels.sql","migrations/009_growth_stages.sql","migrations/010_coins.sql"]) await db.exec(read(file));
  const user=randomUUID();
  await db.query("INSERT INTO auth.users VALUES($1)",[user]);
  await db.query("INSERT INTO public.game_users(id,username,coins) VALUES($1,'LegacyBird',42)",[user]);
  await db.query("SELECT public.adopt_game_pigeon($1,'jacobin pigeon','Gilbert')",[user]);
  const before=(await db.query("SELECT * FROM public.game_pigeons")).rows[0];
  await db.exec(read("migrations/011_discoveries.sql"));
  migration={before,after:(await db.query("SELECT * FROM public.game_pigeons")).rows[0],
    discovery:(await db.query("SELECT * FROM public.game_pigeon_discoveries")).rows[0],coins:(await db.query("SELECT coins FROM public.game_users")).rows[0].coins};
});
after(async()=>{await db?.close();});
beforeEach(async()=>{await db.exec("TRUNCATE public.game_users,auth.users CASCADE");});
async function setup(t,options={}) {
  const f=await fixture(t,{gameDb:db,now:()=>date,...options});
  const user=(await (await f.signup()).json()).user;
  const body={speciesId:"jacobin pigeon",nickname:"Gilbert"};
  await f.request("/api/game/adopt",{body});
  return {...f,user,adoption:body};
}
const dex=async f=>(await (await f.request("/api/game/discoveries")).json());
const discover=(f,id=dailyDiscoveryId(date),extra={})=>f.request("/api/game/discoveries/daily",{body:{speciesId:id,...extra}});

test("migration backfills the adopted pigeon without changing progress or coins",()=>{
  assert.deepEqual(migration.before,migration.after);
  assert.equal(migration.coins,42);
  assert.equal(migration.discovery.species_id,"jacobin pigeon");
  assert.equal(migration.discovery.user_id,migration.before.user_id);
  assert.deepEqual(migration.discovery.discovered_at,migration.before.created_at);
  assert.equal(migration.discovery.seen_at,null);
});

test("adoption unlocks only its catalogue entry; totals distinguish species and breeds",async t=>{
  const f=await setup(t),result=await dex(f),catalog=bundledCatalog().breeds;
  assert.equal(result.counts.discoveredBreeds,1);
  assert.equal(result.counts.discoveredSpecies,0);
  assert.equal(result.counts.species+result.counts.breeds,catalog.length);
  const starter=result.breeds.find(p=>p.id==="jacobin pigeon");
  assert.equal(starter.discovered,true);assert.equal(starter.name,"Jacobin pigeon");
  assert.equal(starter.gameRarity,"common");
  assert.equal(result.pending.length,1);
  const locked=result.breeds.find(p=>!p.discovered);
  assert.equal(locked.name,"Undiscovered pigeon");
  for(const field of ["image","fact","scientificName","sourceUrl"]) assert.equal(locked[field],undefined);
  await f.request("/api/game/adopt",{body:f.adoption});
  assert.equal((await db.query("SELECT count(*) FROM public.game_pigeon_discoveries")).rows[0].count,1);
  const response=await f.request("/api/game/discoveries");
  assert.match(response.headers.get("cache-control"),/no-store/);
});

test("daily discovery uses server date, ignores forged rewards and saves exactly once",async t=>{
  const f=await setup(t);
  const responses=await Promise.all([discover(f),discover(f)]);
  const results=await Promise.all(responses.map(r=>r.json()));
  assert.equal(results.filter(r=>r.isNew).length,1);
  assert.equal(results[1].counts.discoveredSpecies+results[1].counts.discoveredBreeds,2);
  const bird=results[1].breeds.find(p=>p.id===dailyDiscoveryId(date));
  const source=bundledCatalog().breeds.find(p=>p.id===bird.id);
  assert.equal(bird.name,source.name);assert.equal(bird.scientificName,source.scientificName || source.parentScientificName);
  const retry=await (await discover(f,undefined,{coins:999,xp:999,now:"2099-01-01",userId:randomUUID()})).json();
  assert.equal(retry.isNew,false);
  assert.equal((await db.query("SELECT coins FROM public.game_users")).rows[0].coins,0);
  assert.equal((await db.query("SELECT xp FROM public.game_pigeons")).rows[0].xp,0);
  assert.equal((await db.query("SELECT count(*) FROM public.game_pigeon_discoveries")).rows[0].count,2);
});

test("UTC rollover permits the next daily pigeon and rejects yesterday's stale button",async t=>{
  let clock=new Date("2026-09-28T23:59:59Z");
  const f=await setup(t,{now:()=>clock});
  const oldId=dailyDiscoveryId(clock);
  assert.equal((await discover(f,oldId)).status,200);
  clock=new Date("2026-09-29T00:00:00Z");
  assert.notEqual(dailyDiscoveryId(clock),oldId);
  assert.equal((await discover(f,oldId)).status,409);
  assert.equal((await discover(f,dailyDiscoveryId(clock))).status,200);
  const counts=(await dex(f)).counts;
  assert.equal(counts.discoveredSpecies+counts.discoveredBreeds,3);
});

test("discovery acknowledgement survives login and cannot change another player's collection",async t=>{
  const f=await setup(t);
  await discover(f);
  await f.request("/api/game/discoveries/seen",{body:{speciesId:"jacobin pigeon"}});
  await f.request("/api/game/discoveries/seen",{body:{speciesId:dailyDiscoveryId(date)}});
  assert.equal((await dex(f)).pending.length,0);
  await f.request("/api/auth/sign-out",{body:{}});
  await f.request("/api/auth/sign-in",{body:{email:"BirdFriend@example.test",password:"a good test password"}});
  assert.equal((await dex(f)).pending.length,0);
  const counts=(await dex(f)).counts;
  assert.equal(counts.discoveredSpecies+counts.discoveredBreeds,2);
  await f.signup("SecondBird");
  const second=await dex(f);
  assert.equal(second.counts.discoveredBreeds,0);assert.equal(second.counts.discoveredSpecies,0);
  await f.request("/api/game/discoveries/seen",{body:{speciesId:"jacobin pigeon",userId:f.user.id}});
  assert.equal((await db.query("SELECT count(*) FROM public.game_pigeon_discoveries")).rows[0].count,2);
});

test("discovery routes validate session, origin, method, ID and daily eligibility",async t=>{
  const f=await setup(t);
  assert.equal((await f.request("/api/game/discoveries",{cookie:""})).status,401);
  assert.equal((await f.request("/api/game/discoveries/daily",{body:{speciesId:dailyDiscoveryId(date)},cookie:""})).status,401);
  assert.equal((await f.request("/api/game/discoveries/daily",{body:{speciesId:dailyDiscoveryId(date)},origin:"https://evil.example"})).status,403);
  assert.equal((await f.request("/api/game/discoveries/daily")).status,405);
  for(const value of [null,42,"", "a".repeat(201)]) assert.equal((await discover(f,value)).status,400);
  assert.equal((await discover(f,"not-in-catalogue")).status,409);
  assert.equal((await discover(f,"indian fantail")).status,409);
});

test("missing daily catalogue entries and storage failures do not fabricate progress",async t=>{
  const f=await setup(t,{getCatalog:()=>({breeds:bundledCatalog().breeds.filter(p=>p.id!==dailyDiscoveryId(date))})});
  assert.equal((await dex(f)).dailyId,null);
  assert.equal((await discover(f)).status,409);
  f.provider.state.gameDown=true;
  assert.equal((await f.request("/api/game/discoveries")).status,503);
  assert.equal((await db.query("SELECT count(*) FROM public.game_pigeon_discoveries")).rows[0].count,1);
});

test("failed discovery storage rolls back adoption and a retry succeeds once",async t=>{
  const f=await fixture(t,{gameDb:db});await f.signup();
  await db.exec(`CREATE FUNCTION public.reject_discovery() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Test failure'; END $$;
    CREATE TRIGGER reject_discovery BEFORE INSERT ON public.game_pigeon_discoveries FOR EACH ROW EXECUTE FUNCTION public.reject_discovery()`);
  const body={speciesId:"jacobin pigeon",nickname:"Gilbert"};
  try {
    assert.equal((await f.request("/api/game/adopt",{body})).status,503);
    assert.equal((await db.query("SELECT count(*) FROM public.game_pigeons")).rows[0].count,0);
  } finally {await db.exec("DROP TRIGGER reject_discovery ON public.game_pigeon_discoveries; DROP FUNCTION public.reject_discovery()");}
  assert.equal((await f.request("/api/game/adopt",{body})).status,200);
  assert.equal((await db.query("SELECT count(*) FROM public.game_pigeon_discoveries")).rows[0].count,1);
});

test("RLS isolates reads and only the server can write discoveries or call discovery helpers",async t=>{
  const f=await setup(t);await f.signup("OtherBird");
  const other=(await db.query("SELECT id FROM public.game_users WHERE username='OtherBird'")).rows[0].id;
  for(const user of [f.user.id,other]) {
    await db.exec("BEGIN; SET LOCAL ROLE authenticated");
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[user]);
    assert.equal((await db.query("SELECT * FROM public.game_pigeon_discoveries")).rows.length,user===f.user.id ? 1 : 0);
    await db.exec("ROLLBACK");
  }
  for(const role of ["anon","authenticated"]) for(const sql of ["SELECT public.record_pigeon_discovery($1,'fake')","SELECT public.acknowledge_pigeon_discovery($1,'jacobin pigeon')","INSERT INTO public.game_pigeon_discoveries(user_id,species_id) VALUES($1,'fake')","UPDATE public.game_pigeon_discoveries SET seen_at=now() WHERE user_id=$1"]) {
    await db.exec(`BEGIN; SET LOCAL ROLE ${role}`);
    await assert.rejects(db.query(sql,[f.user.id]),{code:"42501"});
    await db.exec("ROLLBACK");
  }
  await db.exec("BEGIN; SET LOCAL ROLE service_role");
  assert.equal((await db.query("SELECT public.record_pigeon_discovery($1,$2) AS result",[f.user.id,dailyDiscoveryId(date)])).rows[0].result,true);
  await db.exec("ROLLBACK");
  await db.query("DELETE FROM public.game_users WHERE id=$1",[f.user.id]);
  assert.equal((await db.query("SELECT count(*) FROM public.game_pigeon_discoveries")).rows[0].count,0);
});

test("collections larger than the PostgREST page limit retain all discoveries",async t=>{
  const f=await setup(t),catalog=bundledCatalog().breeds;
  assert.ok(catalog.length>1000);
  await db.query(`INSERT INTO public.game_pigeon_discoveries(user_id,species_id)
    SELECT $1,value FROM jsonb_array_elements_text($2::jsonb) ON CONFLICT DO NOTHING`,[f.user.id,JSON.stringify(catalog.map(p=>p.id))]);
  const result=await dex(f);
  assert.equal(result.breeds.filter(p=>p.discovered).length,catalog.length);
  assert.equal(result.counts.discoveredSpecies,result.counts.species);
  assert.equal(result.counts.discoveredBreeds,result.counts.breeds);
});
