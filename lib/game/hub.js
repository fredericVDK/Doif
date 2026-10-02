const {AuthError}=require('../auth/errors');
const {isUuid,requestIdInput,storageError}=require('./service-support');
const ACTIONS=new Set(['feed','play','clean','sleep']),STATS=new Set(['speed','endurance','strength','navigation']);
function pigeonId(value){if(!isUuid(value))throw new AuthError(400,'PIGEON_INPUT','Choose one of your active pigeons.');return value;}
function speciesId(value){if(typeof value!=='string'||!value.trim()||value.length>200)throw new AuthError(400,'SPECIES_INPUT','Choose a discovered pigeon.');return value;}
function teamCareInput(body){const action=String(body?.action||'');if(!ACTIONS.has(action))throw new AuthError(400,'CARE_ACTION','Choose Feed, Play, Clean or Sleep.');const food=action==='feed'?String(body?.food||'crumbs'):'crumbs';if(!['crumbs','corn','peas','sunflower_seeds'].includes(food))throw new AuthError(400,'FOOD','Choose food from your inventory.');return{pigeonId:pigeonId(body?.pigeonId),requestId:requestIdInput(body,'CARE_REQUEST','Choose your pigeon and try again.'),action,food};}
function trainingInput(body){const stat=String(body?.stat||'');if(!STATS.has(stat))throw new AuthError(400,'TRAINING_STAT','Choose a training stat.');return{pigeonId:pigeonId(body?.pigeonId),requestId:requestIdInput(body,'TRAINING_REQUEST','Please try training again.'),stat};}
function teamActionInput(body,code){return{pigeonId:pigeonId(body?.pigeonId),requestId:requestIdInput(body,code,`Choose your pigeon and try again.`)}}
function storyInput(body){const chapter=Number(body?.chapter);if(!Number.isInteger(chapter)||chapter<1||chapter>5)throw new AuthError(400,'STORY_CHAPTER','Choose an available story chapter.');return chapter;}
function deckSpecies(record){
  const rarity=['common','uncommon','rare','epic','legendary'].includes(record?.gameRarity)?record.gameRarity:'common';
  return{id:record.id,name:record.name,kind:record.kind,scientific_name:record.scientificName||record.parentScientificName||'',description:record.history||record.fact||'',image:record.image,rarity,source_url:record.sourceUrl||'',image_attribution:record.imageAttribution||{}};
}
function createHubService(admin){
  const fail=(error,message='Your pigeon hub could not be loaded.')=>storageError(error,'HUB_STORAGE',message);
  async function rpc(name,userId,args={}){const{data,error}=await admin.rpc(name,{p_user_id:userId,...args});if(error)throw fail(error);return data;}
  const known=data=>{const errors={PIGEON_NOT_OWNED:'That pigeon is not in your active team.',UNDISCOVERED_PIGEON:'Discover this pigeon before adding it to your team.',ALREADY_ON_TEAM:'That pigeon is already on your team.',TEAM_FULL:'Your active team already has three pigeons.',TRAINING_MAX:'That training stat is already maxed out.',STORY_INCOMPLETE:'Complete the chapter objective first.',STORY_CLAIMED:'That chapter reward was already claimed.',TOO_TIRED:'This pigeon is too tired for that activity.',BATTLE_TIRED:'This pigeon needs at least 10 Energy to battle.',HEALTH_FULL:'This pigeon already has full Health.',OPPONENT_UNAVAILABLE:'No battle opponent is available right now.'};if(errors[data?.error])throw new AuthError(409,data.error,errors[data.error]);if(data?.error==='NOT_ENOUGH_COINS')throw new AuthError(409,'NOT_ENOUGH_COINS',`You need ${Number(data.missing)||0} more coins.`);if(String(data?.error||'').endsWith('_COOLDOWN')||data?.error==='BATTLE_INJURED'){const error=new AuthError(429,data.error,'This pigeon needs a little more time before doing that again.');error.retryAfter=Number(data.retryAfter)||10;throw error;}return data;};
  async function getDeck(userId,catalog){
    const deck=await rpc('get_game_deck',userId),records=Array.isArray(catalog?.breeds)?catalog.breeds:[];
    const {data,error}=await admin.from('game_pigeon_discoveries').select('species_id,discovered_at').eq('user_id',userId).order('discovered_at',{ascending:false}).range(0,999);
    if(error)throw fail(error);
    const byId=new Map(records.map(record=>[record.id,record])),teamBySpecies=new Map((deck.team||[]).map(p=>[p.species_id,p]));
    deck.cards=(data||[]).map(row=>{const record=byId.get(row.species_id),member=teamBySpecies.get(row.species_id);if(!record)return null;return{speciesId:row.species_id,discoveredAt:row.discovered_at,species:deckSpecies(record),teamPigeonId:member?.id||null,teamSlot:member?.team_slot||null,level:member?.level||1,xp:member?.xp||0,nickname:member?.nickname||null};}).filter(Boolean);
    return deck;
  }
  async function ensureSpecies(record){
    const existing=await admin.from('game_species').select('id').eq('id',record.id).maybeSingle();
    if(existing.error)throw fail(existing.error);
    if(existing.data)return;
    const species=deckSpecies(record),row={...species,parent_species_id:record.kind==='breed'?(record.parentSpeciesId||'birdnet:BN03514'):null,is_starter:false,description_source:record.fieldSources?.description||record.source||'',description_url:record.sourceUrl||''};
    const {error}=await admin.from('game_species').insert(row);if(error)throw fail(error);
  }
  async function addTeamPigeon(userId,id,catalog){
    id=speciesId(id);const record=(catalog?.breeds||[]).find(item=>item.id===id);
    if(!record)throw new AuthError(409,'UNDISCOVERED_PIGEON','This pigeon is no longer available in the catalogue.');
    await ensureSpecies(record);return known(await rpc('add_game_team_pigeon',userId,{p_species_id:id}));
  }
  return{getDeck,getHub:userId=>rpc('get_game_hub',userId),addTeamPigeon,setHomePigeon:async(userId,id)=>known(await rpc('set_game_home_pigeon',userId,{p_pigeon_id:pigeonId(id)})),careTeamPigeon:async(userId,input)=>known(await rpc('perform_game_team_care',userId,{p_pigeon_id:input.pigeonId,p_request_id:input.requestId,p_action:input.action,p_food:input.food})),trainTeamPigeon:async(userId,input)=>known(await rpc('train_game_team_pigeon',userId,{p_pigeon_id:input.pigeonId,p_request_id:input.requestId,p_stat:input.stat})),battleTeamPigeon:async(userId,input)=>known(await rpc('battle_game_team_pigeon',userId,{p_pigeon_id:input.pigeonId,p_request_id:input.requestId})),treatTeamPigeon:async(userId,input)=>known(await rpc('treat_game_team_pigeon',userId,{p_pigeon_id:input.pigeonId,p_request_id:input.requestId})),claimStory:async(userId,chapter)=>known(await rpc('claim_game_story_chapter',userId,{p_chapter:chapter})),readNotifications:userId=>rpc('read_game_notifications',userId)};
}
module.exports={createHubService,teamCareInput,trainingInput,teamActionInput,storyInput,pigeonId,speciesId,deckSpecies};
