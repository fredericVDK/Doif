const {AuthError}=require('../auth/errors');

const QUEST_IDS=new Set(['feed_3','play_2','clean_1','visit_pigeondex','sleep_1','battle_1','crumb_game_1']);
function questInput(body) {
  if(typeof body.questId!=='string'||!QUEST_IDS.has(body.questId)) {
    throw new AuthError(400,'QUEST_INPUT','Choose an available daily quest.');
  }
  return body.questId;
}
function failure(error) {
  const result=new AuthError(503,'QUEST_STORAGE','Your daily quests could not be updated. Please try again.');
  result.providerCode=error?.code;
  return result;
}
function createDailyQuestService(admin) {
  async function rpc(name,userId,extra={}) {
    const {data,error}=await admin.rpc(name,{p_user_id:userId,...extra});
    if(error) throw failure(error);
    if(data?.error==='NO_PIGEON') throw new AuthError(409,'NO_PIGEON','Adopt a pigeon before completing daily quests.');
    return data;
  }
  return {
    getDailyQuests:userId=>rpc('get_game_daily_quests',userId),
    visitPigeonDex:userId=>rpc('record_game_daily_quest',userId,{p_quest_id:'visit_pigeondex'}),
    async claimDailyQuest(userId,questId) {
      const data=await rpc('claim_game_daily_quest',userId,{p_quest_id:questId});
      if(data?.error==='QUEST_INCOMPLETE') throw new AuthError(409,'QUEST_INCOMPLETE','Complete this quest before claiming its reward.');
      if(data?.error==='QUEST_CLAIMED') throw new AuthError(409,'QUEST_CLAIMED','This quest reward was already claimed.');
      if(!data?.claimed||!data.pigeon||!data.wallet||!data.dailyQuests) throw failure();
      return data;
    }
  };
}
module.exports={QUEST_IDS,questInput,createDailyQuestService};
