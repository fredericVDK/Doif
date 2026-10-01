const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {GAME_API_DOCS,GAME_API_METHODS,dispatchGameApi}=require('../lib/game/api');

test('game API registry is the single complete method and documentation contract',()=>{
  assert.equal(GAME_API_DOCS.length,41);
  assert.equal(new Set(GAME_API_DOCS.map(item=>item.path)).size,GAME_API_DOCS.length);
  for(const item of GAME_API_DOCS) {
    assert.equal(GAME_API_METHODS.get(item.path),item.method);
    assert.match(item.path,/^\/api\/game\//);
    assert.ok(item.description.length>20);
  }
  const required=[
    ['GET','/api/game/pigeon'],['POST','/api/game/adopt'],['POST','/api/game/feed'],
    ['POST','/api/game/play'],['POST','/api/game/clean'],['POST','/api/game/sleep'],
    ['GET','/api/game/inventory'],['POST','/api/game/shop/buy'],
    ['GET','/api/game/pigeondex'],['POST','/api/game/daily-reward'],['POST','/api/game/battle'],
    ['GET','/api/game/packs'],['POST','/api/game/packs/buy'],['POST','/api/game/clinic'],
    ['GET','/api/game/battle/stats'],['POST','/api/game/discoveries/favorite'],['POST','/api/game/profile/privacy'],
    ['GET','/api/game/deck'],['GET','/api/game/hub'],['POST','/api/game/team/care'],['POST','/api/game/team/train'],
    ['GET','/api/game/races'],['POST','/api/game/races/start'],['POST','/api/game/races/collect']
  ];
  for(const [method,route] of required) assert.equal(GAME_API_METHODS.get(route),method,route);
});

test('dispatcher forwards validated intent and adds one consistent pigeon presentation',async()=>{
  const requestId=randomUUID(),received=[];
  const pigeon={nickname:'Pip',health:90,hunger:80,happiness:70,energy:60,cleanliness:50,level:1,xp:5,xp_to_next_level:100,growth_stage:'hatchling'};
  const game={feed:async(user,input)=>{received.push({user,input});return {pigeon,effects:{xp:5},wallet:{coins:2}};}};
  const body={food:'crumbs',requestId,userId:'forged',xp:999,coins:999,hunger:100};
  const result=await dispatchGameApi({path:'/api/game/feed',request:{},game,userId:'verified-user',bodyJson:async()=>body,getCatalog:async()=>({}),now:()=>new Date()});
  assert.equal(result.handled,true);
  assert.deepEqual(received,[{user:'verified-user',input:{food:'crumbs',requestId}}]);
  assert.equal(result.data.pigeon,pigeon);
  assert.match(result.data.statsHtml,/Hunger/);
  assert.match(result.data.xpHtml,/toward Level 2/);
});

test('PigeonDex progress has a clear endpoint while the compatibility path remains equivalent',async()=>{
  const calls=[];
  const catalog={breeds:[{id:'bird'}]};
  const game={discoveries:async(user,value,now)=>{calls.push({user,value,now});return {counts:{discoveredSpecies:1}};}};
  const options={request:{},game,userId:'verified-user',bodyJson:async()=>({}),getCatalog:async()=>catalog,now:()=>new Date('2026-09-29T00:00:00Z')};
  const clear=await dispatchGameApi({...options,path:'/api/game/pigeondex'});
  const legacy=await dispatchGameApi({...options,path:'/api/game/discoveries'});
  assert.deepEqual(clear.data,legacy.data);
  assert.equal(calls.length,2);assert.equal(calls[0].value,catalog);
});

test('auth router delegates game paths and public docs consume the same registry',()=>{
  const routes=fs.readFileSync(path.join(__dirname,'../lib/auth/routes.js'),'utf8');
  const server=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
  assert.match(routes,/\.\.\.GAME_API_METHODS/);
  assert.match(routes,/dispatchGameApi\(/);
  assert.doesNotMatch(routes,/context\.game\.(feed|play|clean|sleep|adopt|buyItem)/);
  assert.match(server,/\.\.\.GAME_API_DOCS/);
});
