const {AuthError}=require('../auth/errors');

function profileUsername(value){
  if(typeof value!=='string'||!/^[A-Za-z0-9_]{3,24}$/.test(value))throw new AuthError(400,'USERNAME','Choose a valid username.');
  return value;
}
function profileVisibilityInput(body){
  if(typeof body.public!=='boolean')throw new AuthError(400,'PROFILE_VISIBILITY','Choose whether your profile is public or private.');
  return body.public;
}
function createProfileService(admin){
  const failure=error=>{const result=new AuthError(503,'PROFILE_STORAGE','The player profile could not be loaded.');result.providerCode=error?.code;return result;};
  async function getPlayerProfile(username,viewerId=null){
    const {data,error}=await admin.rpc('get_game_player_profile',{p_username:profileUsername(username),p_viewer_user_id:viewerId});
    if(error)throw failure(error);
    if(data?.error==='PROFILE_NOT_FOUND')throw new AuthError(404,'PROFILE_NOT_FOUND','That player profile does not exist.');
    return data;
  }
  async function setProfilePublic(userId,value){
    const {data,error}=await admin.rpc('set_game_profile_public',{p_user_id:userId,p_public:value});
    if(error)throw failure(error);
    return data;
  }
  return {getPlayerProfile,setProfilePublic};
}
module.exports={createProfileService,profileUsername,profileVisibilityInput};
