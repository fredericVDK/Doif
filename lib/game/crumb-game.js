const {AuthError}=require('../auth/errors');
const {isUuid,requestIdInput,storageError}=require('./service-support');
function startInput(body) {
  return {requestId:requestIdInput(body,'GAME_REQUEST','Start a new game and try again.')};
}
function finishInput(body) {
  if(!isUuid(body.runId)||!Array.isArray(body.caught)||body.caught.length>40
    ||body.caught.some(id=>!Number.isInteger(id)||id<0||id>39)) {
    throw new AuthError(400,'GAME_RESULT','The game result was invalid. Start a new round.');
  }
  return {runId:body.runId,caught:body.caught};
}
function failure(error) {
  return storageError(error,'MINIGAME_STORAGE','The round could not be saved. Please try again.');
}
function createCrumbGameService(admin) {
  async function rpc(name,userId,args) {
    const {data,error}=await admin.rpc(name,{p_user_id:userId,...args});
    if(error) throw failure(error);
    if(data?.error==='NO_PIGEON') throw new AuthError(409,'NO_PIGEON','Adopt a pigeon before playing Catch the Crumbs.');
    return data;
  }
  return {
    async startCrumbGame(userId,input) {
      const data=await rpc('start_crumb_game',userId,{p_request_id:input.requestId});
      if(!data?.runId||!Array.isArray(data.schedule)||data.durationSeconds!==30) throw failure();
      return data;
    },
    async finishCrumbGame(userId,input) {
      const data=await rpc('finish_crumb_game',userId,{p_run_id:input.runId,p_caught:input.caught});
      if(data?.error==='RUN_NOT_FOUND') throw new AuthError(404,'RUN_NOT_FOUND','This game round was not found. Start a new round.');
      if(data?.error==='RUN_IN_PROGRESS') {const err=new AuthError(409,'RUN_IN_PROGRESS','The 30-second round is still in progress.');err.retryAfter=Math.max(1,Math.ceil(Number(data.retryAfter)||1));throw err;}
      if(data?.error==='RUN_EXPIRED') throw new AuthError(409,'RUN_EXPIRED','This game round expired. Start a new round.');
      if(data?.error==='INVALID_SCORE') throw new AuthError(400,'INVALID_SCORE','The submitted catches did not match this game round.');
      if(!data?.pigeon||!data?.wallet||!data?.effects||!Number.isInteger(data.score)) throw failure();
      return data;
    }
  };
}
module.exports={startInput,finishInput,createCrumbGameService};
