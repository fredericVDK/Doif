const {adoptionInput}=require('./adoption');
const {feedInput}=require('./feed');
const {playInput}=require('./play');
const {cleanInput}=require('./clean');
const {sleepInput}=require('./sleep');
const {discoveryInput}=require('./discoveries');
const {purchaseInput}=require('./shop');
const {questInput}=require('./daily-quests');
const {achievementInput}=require('./achievements');
const {startInput,finishInput}=require('./crumb-game');
const {battleInput}=require('./battle');
const {packInput}=require('./packs');
const {clinicInput}=require('./clinic');
const {profileVisibilityInput}=require('./profile');
const {presentPigeonResult}=require('./presentation');

const definitions=[
  ['GET','/api/game/starters','List the three server-approved starter pigeons.'],
  ['GET','/api/game/pigeon','Refresh and return the signed-in player’s current pigeon.'],
  ['POST','/api/game/adopt','Adopt one starter pigeon. Identity and starting stats come from the server.',{speciesId:'starter id',nickname:'string'}],
  ['POST','/api/game/feed','Feed free Crumbs or consume one owned food item through the authoritative care engine.',{food:'crumbs | corn | peas | sunflower_seeds',requestId:'UUID'}],
  ['POST','/api/game/play','Play with the current pigeon.',{requestId:'UUID'}],
  ['POST','/api/game/clean','Clean the current pigeon.',{requestId:'UUID'}],
  ['POST','/api/game/sleep','Let the current pigeon rest.',{requestId:'UUID'}],
  ['POST','/api/game/daily-reward','Claim today’s server-calculated login reward.',{}],
  ['GET','/api/game/inventory','Return the item catalogue and signed-in player’s quantities.'],
  ['POST','/api/game/shop/buy','Buy one available item at its database price.',{itemId:'item id',requestId:'UUID'}],
  ['GET','/api/game/pigeondex','Return personal PigeonDex discoveries, counts and today’s eligible pigeon.'],
  ['GET','/api/game/discoveries','Compatibility path for personal PigeonDex progress.'],
  ['POST','/api/game/discoveries/daily','Record today’s server-selected pigeon discovery.',{speciesId:'species id'}],
  ['POST','/api/game/discoveries/seen','Acknowledge a discovery notification.',{speciesId:'species id'}],
  ['POST','/api/game/discoveries/favorite','Toggle a discovered pigeon as a persistent favourite.',{speciesId:'species id'}],
  ['GET','/api/game/quests','Return today’s quest progress and rewards.'],
  ['POST','/api/game/quests/pigeondex','Record a PigeonDex visit for today’s quests.',{}],
  ['POST','/api/game/quests/claim','Claim one completed daily quest.',{questId:'quest id'}],
  ['GET','/api/game/achievements','Return permanent achievement progress.'],
  ['POST','/api/game/achievements/claim','Claim one unlocked achievement.',{achievementId:'achievement id'}],
  ['POST','/api/game/crumbs/start','Start or resume one server-scheduled Catch the Crumbs round.',{requestId:'UUID'}],
  ['POST','/api/game/crumbs/finish','Validate catches and finish a Catch the Crumbs round.',{runId:'UUID',caught:['integer id']}]
  ,['POST','/api/game/battle','Battle an automatically selected opponent for level-scaled XP.',{requestId:'UUID'}]
  ,['GET','/api/game/battle/stats','Return battle attributes, record and current arena rank.']
  ,['GET','/api/game/packs','Return daily and weekly pigeon pack prices and availability.']
  ,['POST','/api/game/packs/buy','Buy and open a server-selected pigeon pack.',{packType:'normal | big',requestId:'UUID'}]
  ,['POST','/api/game/clinic','Restore the current pigeon to full Health for the server-owned clinic price.',{requestId:'UUID'}]
  ,['POST','/api/game/profile/privacy','Choose whether the player profile is public.',{public:'boolean'}]
];

const GAME_API_DOCS=definitions.map(([method,path,description,body])=>({method,path,description,...(body?{body}:{})}));
const GAME_API_METHODS=new Map(definitions.map(([method,path])=>[path,method]));

async function dispatchGameApi({path,request,game,userId,bodyJson,getCatalog,now}) {
  const body=()=>bodyJson(request);
  const discoveries=async()=>game.discoveries(userId,await getCatalog(),now());
  const handlers=new Map([
    ['/api/game/starters',async()=>({starters:await game.getStarters()})],
    ['/api/game/pigeon',async()=>({pigeon:await game.getCurrentPigeon(userId)})],
    ['/api/game/adopt',async()=>({pigeon:await game.adopt(userId,adoptionInput(await body())),redirect:'/my-pigeon'})],
    ['/api/game/feed',async()=>presentPigeonResult(await game.feed(userId,feedInput(await body())))],
    ['/api/game/play',async()=>presentPigeonResult(await game.play(userId,playInput(await body())))],
    ['/api/game/clean',async()=>presentPigeonResult(await game.clean(userId,cleanInput(await body())))],
    ['/api/game/sleep',async()=>presentPigeonResult(await game.sleep(userId,sleepInput(await body())))],
    ['/api/game/daily-reward',async()=>{
      const result=await game.claimDailyReward(userId);
      return presentPigeonResult({...result,message:result.claimed
        ? 'Today’s daily reward was added to your account.'
        : 'Today’s daily reward was already claimed. Come back after 00:00 UTC.'});
    }],
    ['/api/game/inventory',async()=>game.getInventory(userId)],
    ['/api/game/shop/buy',async()=>game.buyItem(userId,purchaseInput(await body()))],
    ['/api/game/pigeondex',discoveries],
    ['/api/game/discoveries',discoveries],
    ['/api/game/discoveries/daily',async()=>game.discoverDaily(userId,discoveryInput(await body()),await getCatalog(),now())],
    ['/api/game/discoveries/seen',async()=>game.acknowledgeDiscovery(userId,discoveryInput(await body()))],
    ['/api/game/discoveries/favorite',async()=>game.toggleFavorite(userId,discoveryInput(await body()))],
    ['/api/game/quests',async()=>game.getDailyQuests(userId)],
    ['/api/game/quests/pigeondex',async()=>{await body();return game.visitPigeonDex(userId);}],
    ['/api/game/quests/claim',async()=>presentPigeonResult(await game.claimDailyQuest(userId,questInput(await body())))],
    ['/api/game/achievements',async()=>game.getAchievements(userId)],
    ['/api/game/achievements/claim',async()=>presentPigeonResult(await game.claimAchievement(userId,achievementInput(await body())))],
    ['/api/game/crumbs/start',async()=>game.startCrumbGame(userId,startInput(await body()))],
    ['/api/game/crumbs/finish',async()=>presentPigeonResult(await game.finishCrumbGame(userId,finishInput(await body())))],
    ['/api/game/battle',async()=>presentPigeonResult(await game.battle(userId,battleInput(await body())))],
    ['/api/game/battle/stats',async()=>game.getBattleStats(userId)],
    ['/api/game/packs',async()=>game.getPacks(userId)],
    ['/api/game/packs/buy',async()=>game.buyPack(userId,packInput(await body()),await getCatalog())],
    ['/api/game/clinic',async()=>presentPigeonResult(await game.treatPigeon(userId,clinicInput(await body())))],
    ['/api/game/profile/privacy',async()=>game.setProfilePublic(userId,profileVisibilityInput(await body()))]
  ]);
  const handler=handlers.get(path);
  return handler?{handled:true,data:await handler()}:{handled:false};
}

module.exports={GAME_API_DOCS,GAME_API_METHODS,dispatchGameApi};
