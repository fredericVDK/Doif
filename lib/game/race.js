const {AuthError}=require('../auth/errors');
const {isUuid,requestIdInput,storageError,cooldownError}=require('./service-support');

const LOCATION=/^[a-z0-9_]{2,40}$/;
function raceStartInput(body){
  const requestId=requestIdInput(body,'RACE_INPUT','Choose a route and opponent, then try again.');
  if(typeof body.origin!=='string'||!LOCATION.test(body.origin)||typeof body.destination!=='string'||!LOCATION.test(body.destination)||body.origin===body.destination)
    throw new AuthError(400,'RACE_LOCATION','Choose two different race locations.');
  if(!isUuid(body.opponentPigeonId))throw new AuthError(400,'RACE_OPPONENT','Choose one of the available opponents.');
  return{requestId,origin:body.origin,destination:body.destination,opponentPigeonId:body.opponentPigeonId};
}
function raceCollectInput(body){
  if(!isUuid(body?.raceId))throw new AuthError(400,'RACE_RESULT','The race result could not be identified.');
  return{raceId:body.raceId};
}
function createRaceService(admin){
  const failure=(error,message='Race information could not be loaded.')=>storageError(error,'RACE_STORAGE',message);
  function known(data){
    if(data?.error==='NO_PIGEON')throw new AuthError(409,'NO_PIGEON','Adopt a pigeon before entering a race.');
    if(data?.error==='RACE_ACTIVE')throw new AuthError(409,'RACE_ACTIVE','Finish your current race before starting another one.');
    if(data?.error==='NOT_ENOUGH_COINS')throw new AuthError(409,'NOT_ENOUGH_COINS',`You need ${Number(data.missing).toLocaleString('en')} more Pigeon Coins to enter.`);
    if(data?.error==='LOCATION_INVALID')throw new AuthError(400,'RACE_LOCATION','Choose two different race locations.');
    if(data?.error==='OPPONENT_UNAVAILABLE')throw new AuthError(409,'RACE_OPPONENT','That opponent is no longer available. Refresh the race lobby.');
    if(data?.error==='RACE_NOT_FOUND')throw new AuthError(404,'RACE_NOT_FOUND','That race could not be found.');
    if(data?.error==='RACE_RUNNING')throw cooldownError(data,'RACE_RUNNING','The pigeons are still flying toward the finish.',60);
  }
  async function getRaceLobby(userId){
    const {data,error}=await admin.rpc('get_game_race_lobby',{p_user_id:userId});
    if(error)throw failure(error);
    known(data);
    if(!data?.pigeon||!Array.isArray(data.locations)||!Array.isArray(data.opponents))throw new AuthError(503,'RACE_STORAGE','The race lobby is temporarily unavailable.');
    return data;
  }
  async function startRace(userId,input){
    const {data,error}=await admin.rpc('start_game_pigeon_race',{p_user_id:userId,p_request_id:input.requestId,
      p_origin:input.origin,p_destination:input.destination,p_opponent_pigeon_id:input.opponentPigeonId});
    if(error)throw failure(error,'The race could not be started. Try again; the same entry will only be charged once.');
    known(data);
    if(!data?.started||!data?.raceId||!data?.wallet)throw new AuthError(503,'RACE_STORAGE','The race start could not be confirmed.');
    return data;
  }
  async function collectRace(userId,input){
    const {data,error}=await admin.rpc('collect_game_pigeon_race',{p_user_id:userId,p_race_id:input.raceId});
    if(error)throw failure(error,'The race result could not be confirmed. Please try again.');
    known(data);
    if(!data?.completed||typeof data?.won!=='boolean'||!data?.wallet||!data?.pigeon)throw new AuthError(503,'RACE_STORAGE','The race result could not be confirmed.');
    return data;
  }
  return{getRaceLobby,startRace,collectRace};
}

module.exports={raceStartInput,raceCollectInput,createRaceService};
