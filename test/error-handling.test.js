const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {AuthError}=require('../lib/auth/errors');
const {FALLBACK_MESSAGE,requestReference,publicApiError,technicalError}=require('../lib/http/api-errors');
const {dispatchGameApi}=require('../lib/game/api');

test('known failures keep friendly recovery data and a request reference',()=>{
  const error=new AuthError(429,'PLAY_COOLDOWN','Give your pigeon a moment before playing again.');
  error.retryAfter=7;
  const result=publicApiError(error,{requestId:'request-1'});
  assert.deepEqual(result,{status:429,body:{error:error.message,code:'PLAY_COOLDOWN',requestId:'request-1',retryable:true,retryAfter:7}});
});

test('unexpected failures hide technical messages while logs omit secrets',()=>{
  const error=Object.assign(new Error('password=secret token=private'),{providerCode:'PGRST001'});
  const problem=publicApiError(error,{requestId:'request-2'});
  assert.equal(problem.status,503);
  assert.equal(problem.body.error,FALLBACK_MESSAGE);
  assert.equal(problem.body.code,'API_UNAVAILABLE');
  assert.equal(problem.body.retryable,true);
  const diagnostic=technicalError(error,{requestId:'request-2',method:'POST',path:'/api/game/feed'});
  assert.deepEqual(diagnostic,{requestId:'request-2',method:'POST',path:'/api/game/feed',status:503,code:'UNEXPECTED',providerCode:'PGRST001',type:'Error'});
  assert.doesNotMatch(JSON.stringify(diagnostic),/secret|private|password|token/i);
});

test('request references are opaque UUIDs',()=>{
  assert.match(requestReference(),/^[0-9a-f-]{36}$/i);
  assert.notEqual(requestReference(),requestReference());
});

test('an already claimed daily reward is an idempotent friendly success',async()=>{
  const pigeon={nickname:'Pip',health:100,hunger:100,happiness:100,energy:100,cleanliness:100,level:1,xp:20,xp_to_next_level:100,growth_stage:'hatchling'};
  const game={claimDailyReward:async()=>({claimed:false,pigeon,wallet:{coins:50},effects:{coins:0,xp:0}})};
  const result=await dispatchGameApi({path:'/api/game/daily-reward',request:{},game,userId:'user',bodyJson:async()=>({}),getCatalog:async()=>({}),now:()=>new Date()});
  assert.equal(result.data.claimed,false);
  assert.match(result.data.message,/already claimed/i);
  assert.equal(result.data.effects.coins,0);
});

test('routes centralize safe API failures and separately log optional services',()=>{
  const routes=fs.readFileSync(path.join(__dirname,'../lib/auth/routes.js'),'utf8');
  assert.match(routes,/publicApiError\(/);
  assert.match(routes,/x-request-id/);
  assert.match(routes,/logger\.error\('Request failed',technicalError\(/);
  assert.match(routes,/logger\.warn\?\.\('Optional game panel unavailable'/);
  assert.doesNotMatch(routes,/logger\.error\([^\n]*error\.message/);
});
