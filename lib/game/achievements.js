const {AuthError}=require('../auth/errors');
const ACHIEVEMENT_IDS=new Set(['first_crumb','pigeon_parent','bird_nerd','best_friends','collector','arena_regular','pack_opener','clinic_friend','crumb_champion','master_birder','crumb_connoisseur','devoted_caretaker','seasoned_pigeon','arena_veteran','pack_collector','clinic_regular','crumb_legend','pigeon_scholar','nest_egg','legendary_companion']);
function achievementInput(body) {
  if(typeof body.achievementId!=='string'||!ACHIEVEMENT_IDS.has(body.achievementId)) {
    throw new AuthError(400,'ACHIEVEMENT_INPUT','Choose an available achievement.');
  }
  return body.achievementId;
}
function failure(error) {
  const result=new AuthError(503,'ACHIEVEMENT_STORAGE','Your achievements could not be updated. Please try again.');
  result.providerCode=error?.code; return result;
}
function createAchievementService(admin) {
  async function rpc(name,userId,extra={}) {
    const {data,error}=await admin.rpc(name,{p_user_id:userId,...extra});
    if(error) throw failure(error);
    if(data?.error==='NO_PIGEON') throw new AuthError(409,'NO_PIGEON','Adopt a pigeon before earning achievements.');
    return data;
  }
  return {
    getAchievements:userId=>rpc('sync_game_achievements',userId),
    async claimAchievement(userId,achievementId) {
      const data=await rpc('claim_game_achievement',userId,{p_achievement_id:achievementId});
      if(data?.error==='ACHIEVEMENT_LOCKED') throw new AuthError(409,'ACHIEVEMENT_LOCKED','Complete this achievement before claiming its reward.');
      if(data?.error==='ACHIEVEMENT_CLAIMED') throw new AuthError(409,'ACHIEVEMENT_CLAIMED','This achievement reward was already claimed.');
      if(!data?.claimed||!data.pigeon||!data.wallet||!data.achievements) throw failure();
      return data;
    }
  };
}
module.exports={ACHIEVEMENT_IDS,achievementInput,createAchievementService};
