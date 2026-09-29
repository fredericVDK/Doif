const {AuthError}=require('../auth/errors');
const {requestIdInput,storageError}=require('./service-support');
function clinicInput(body){return {requestId:requestIdInput(body,'CLINIC_INPUT','Please try the clinic visit again.')}}
function createClinicService(admin){
  async function treatPigeon(userId,input){
    const {data,error}=await admin.rpc('treat_game_pigeon',{p_user_id:userId,p_request_id:input.requestId});
    if(error)throw storageError(error,'CLINIC_STORAGE','We could not confirm the clinic visit. Try again; the same visit will only be charged once.');
    if(data?.error==='NO_PIGEON')throw new AuthError(409,'NO_PIGEON','Adopt a pigeon before visiting the clinic.');
    if(data?.error==='HEALTH_FULL'){const result=new AuthError(409,'HEALTH_FULL','Your pigeon already has full Health. No coins were charged.');result.pigeon=data.pigeon;throw result;}
    if(data?.error==='NOT_ENOUGH_COINS')throw new AuthError(409,'NOT_ENOUGH_COINS',`You need ${Number(data.missing).toLocaleString('en')} more Pigeon Coins for a clinic visit.`);
    if(data?.error==='PROFILE_REQUIRED')throw new AuthError(409,'PROFILE_REQUIRED','Finish setting up your account first.');
    if(!data?.treated||!data?.pigeon||!data?.wallet||!data?.effects)throw new AuthError(503,'CLINIC_STORAGE','The clinic visit could not be confirmed.');
    return data;
  }
  return {treatPigeon};
}
module.exports={clinicInput,createClinicService};
