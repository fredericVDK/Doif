const {AuthError}=require('../auth/errors');

function createDailyRewardService(admin) {
  async function claimDailyReward(userId) {
    const {data,error}=await admin.rpc('claim_game_daily_reward',{p_user_id:userId});
    if(error) {
      const failure=new AuthError(503,'DAILY_REWARD_STORAGE','Your daily reward could not be claimed. Please try again.');
      failure.providerCode=error.code;
      throw failure;
    }
    if(data?.error==='NO_PIGEON') throw new AuthError(409,'PIGEON_REQUIRED','Adopt a pigeon before claiming a daily reward.');
    if(!data?.pigeon || !data?.wallet) throw new AuthError(503,'DAILY_REWARD_STORAGE','Your daily reward could not be loaded. Please try again.');
    return data;
  }
  return {claimDailyReward};
}

module.exports={createDailyRewardService};
