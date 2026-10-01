const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {createGameService,createGameRepository,SERVICE_FACTORIES}=require('../lib/game');
const {createGameRepository:legacyFactory}=require('../lib/game/adoption');
const {requestIdInput,isUuid,storageError,cooldownError}=require('../lib/game/service-support');
const {presentPigeonResult}=require('../lib/game/presentation');

const methods=[
  'acknowledgeDiscovery','addTeamPigeon','adopt','battle','battleTeamPigeon','buyItem','buyPack','careTeamPigeon','claimAchievement','claimDailyQuest','claimDailyReward','claimStory','clean','collectRace',
  'discoverDaily','discoveries','feed','finishCrumbGame','getAchievements','getBattleStats','getCurrentPigeon','getDailyQuests','getDeck','getHub',
  'getInventory','getPacks','getPigeon','getPlayerProfile','getRaceLobby','getStarters','play','readNotifications','setHomePigeon','setProfilePublic','sleep','startCrumbGame','startRace','toggleFavorite','trainTeamPigeon','treatPigeon','treatTeamPigeon','visitPigeonDex'
];

test('one game facade composes every domain service without changing the legacy entry point',()=>{
  const current=Object.keys(createGameService({})).sort();
  assert.deepEqual(current,methods);
  assert.deepEqual(Object.keys(createGameRepository({})).sort(),methods);
  assert.deepEqual(Object.keys(legacyFactory({})).sort(),methods);
  assert.equal(SERVICE_FACTORIES.length,19);
});

test('shared request and service helpers preserve validation and transport metadata',()=>{
  const id=randomUUID();
  assert.equal(isUuid(id),true);
  assert.equal(requestIdInput({requestId:id},'ACTION_REQUEST','Try again.'),id);
  assert.throws(()=>requestIdInput({requestId:'bad'},'ACTION_REQUEST','Try again.'),error=>error.status===400&&error.code==='ACTION_REQUEST');
  const stored=storageError({code:'PGRST001'},'ACTION_STORAGE','Unavailable.');
  assert.equal(stored.status,503);assert.equal(stored.providerCode,'PGRST001');
  const cooldown=cooldownError({retryAfter:2.2},'ACTION_COOLDOWN','Wait.');
  assert.equal(cooldown.status,429);assert.equal(cooldown.retryAfter,3);
});

test('HTTP presentation is assembled once from an authoritative pigeon result',()=>{
  const pigeon={nickname:'Pip',health:80,hunger:70,happiness:60,energy:50,cleanliness:40,level:2,xp:12,xp_to_next_level:200,growth_stage:'hatchling'};
  const source={pigeon,wallet:{coins:10},effects:{xp:5}};
  const result=presentPigeonResult(source);
  assert.equal(result.pigeon,pigeon);assert.equal(result.wallet,source.wallet);
  assert.match(result.statsHtml,/Hunger/);assert.match(result.xpHtml,/toward Level 3/);assert.match(result.growthHtml,/Hatchling/);
  const routes=fs.readFileSync(path.join(__dirname,'../lib/auth/routes.js'),'utf8');
  const api=fs.readFileSync(path.join(__dirname,'../lib/game/api.js'),'utf8');
  assert.doesNotMatch(routes,/renderStats\(result\.pigeon\)/);
  assert.match(routes,/dispatchGameApi\(/);
  assert.match(api,/presentPigeonResult\(/);
});

test('game rules stay in database services while browser scripts send intent only',()=>{
  for(const [script,endpoint] of [['pigeon-feed.js','team/care'],['pigeon-play.js','team/care'],['pigeon-clean.js','team/care'],['pigeon-sleep.js','team/care'],['pigeon-battle.js','team/battle'],['pigeon-packs.js','packs/buy'],['pigeon-clinic.js','team/clinic']]) {
    const source=fs.readFileSync(path.join(__dirname,'../public',script),'utf8');
    assert.match(source,new RegExp(`/api/game/${endpoint}`));
    assert.doesNotMatch(source,/body:\s*JSON\.stringify\([^)]*(coins|xp|hunger|happiness|energy|cleanliness)/s);
  }
  const engine=fs.readFileSync(path.join(__dirname,'../lib/game/engine.js'),'utf8');
  assert.match(engine,/refresh_game_pigeon/);
  assert.match(engine,/database owns time, rates, row locking and persistence/i);
});
