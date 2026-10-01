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
const {createPackService}=require('./packs');
const {createClinicService}=require('./clinic');
const {createProfileService}=require('./profile');
const {createRaceService}=require('./race');
const {createHubService}=require('./hub');

const SERVICE_FACTORIES=[
  createAdoptionService,createGameEngine,createFeedService,createPlayService,
  createCleanService,createSleepService,createDiscoveryService,
  createDailyRewardService,createInventoryService,createShopService,
  createDailyQuestService,createAchievementService,createCrumbGameService,createBattleService,createPackService,createClinicService,createProfileService,createRaceService,createHubService
];

function createGameService(admin) {
  return Object.assign({},...SERVICE_FACTORIES.map(factory=>factory(admin)));
}

module.exports={createGameService,createGameRepository:createGameService,SERVICE_FACTORIES};
