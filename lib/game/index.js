const {createAdoptionService}=require('./adoption');
const {createGameEngine}=require('./engine');
const {createFeedService}=require('./feed');
const {createPlayService}=require('./play');
const {createCleanService}=require('./clean');
const {createSleepService}=require('./sleep');
const {createDiscoveryService}=require('./discoveries');
const {createDailyRewardService}=require('./daily-reward');
const {createInventoryService}=require('./inventory');
const {createShopService}=require('./shop');
const {createDailyQuestService}=require('./daily-quests');
const {createAchievementService}=require('./achievements');
const {createCrumbGameService}=require('./crumb-game');
const {createBattleService}=require('./battle');

const SERVICE_FACTORIES=[
  createAdoptionService,createGameEngine,createFeedService,createPlayService,
  createCleanService,createSleepService,createDiscoveryService,
  createDailyRewardService,createInventoryService,createShopService,
  createDailyQuestService,createAchievementService,createCrumbGameService,createBattleService
];

function createGameService(admin) {
  return Object.assign({},...SERVICE_FACTORIES.map(factory=>factory(admin)));
}

module.exports={createGameService,createGameRepository:createGameService,SERVICE_FACTORIES};
