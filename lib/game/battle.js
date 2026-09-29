const {AuthError}=require('../auth/errors');
const {requestIdInput,storageError,cooldownError}=require('./service-support');

function battleInput(body){
  if(typeof body?.opponentSpeciesId!=='string'||body.opponentSpeciesId.length>100) throw new AuthError(400,'BATTLE_OPPONENT','Choose one of the available opponents.');
  return {opponentSpeciesId:body.opponentSpeciesId,requestId:requestIdInput(body,'BATTLE_REQUEST','Please choose your opponent again.')};
}
function createBattleService(admin){
  async function battle(userId,input){
    const {data,error}=await admin.rpc('battle_game_pigeon',{p_user_id:userId,p_request_id:input.requestId,p_opponent_species_id:input.opponentSpeciesId});
    if(error) throw storageError(error,'BATTLE_STORAGE','The battle result could not be saved. Please try again; the same battle will only count once.');
    if(data?.error==='NO_PIGEON') throw new AuthError(409,'NO_PIGEON','Adopt a pigeon before entering the arena.');
    if(data?.error==='OPPONENT_UNAVAILABLE') throw new AuthError(409,'OPPONENT_UNAVAILABLE','Choose another opponent.');
    if(data?.error==='BATTLE_TIRED') {const failure=new AuthError(409,'BATTLE_TIRED','Your pigeon needs at least 10 Energy to battle.');failure.pigeon=data.pigeon;throw failure;}
    if(data?.error==='BATTLE_COOLDOWN') throw cooldownError(data,'BATTLE_COOLDOWN','The arena needs a moment before the next battle.',30);
    if(!data?.pigeon||!data?.opponent||!data?.effects) throw new AuthError(503,'BATTLE_STORAGE','The battle result could not be confirmed.');
    return data;
  }
  return {battle};
}
module.exports={battleInput,createBattleService};
