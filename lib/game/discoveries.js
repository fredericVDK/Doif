const {AuthError} = require("../auth/errors");
const {mergeRecords,hasRealPhoto} = require("../catalog");
const {STARTERS} = require("./species");
const {STARTER_BREEDS} = require("./starter-breeds");
const photoCredits = require("../../data/starter-photo-credits.json");
const bundled = mergeRecords(require("../../data/birdnet-pigeons.json").records,
  require("../../data/domestic-pigeons.json").records).filter(hasRealPhoto);
// Stable, versioned pool: live catalogue ordering or photo refreshes cannot change today's pick.
const dailyPool = bundled.map(p => p.id).sort();
function dailyDiscoveryId(now = new Date()) {
  const day = Math.floor(now.getTime() / 86400000);
  return dailyPool[((day % dailyPool.length) + dailyPool.length) % dailyPool.length];
}
function bundledCatalog() {return {breeds:bundled,sources:{}};}
function gameRarity(record) {
  return STARTERS.find(p => p.id === record.id)?.rarity || (STARTER_BREEDS.includes(record.id) ? "common" : "Not assigned");
}
function discoveryInput(body) {
  if (typeof body.speciesId !== "string" || !body.speciesId.trim() || body.speciesId.length > 200) {
    throw new AuthError(400,"DISCOVERY_INPUT","Choose a pigeon from your PigeonDex.");
  }
  return body.speciesId;
}
function createDiscoveryService(admin) {
  function failure(error) {
    const result = new AuthError(503,"DISCOVERY_STORAGE","Your discoveries could not be loaded or saved. Please try again.");
    result.providerCode=error?.code;
    return result;
  }
  async function rows(userId) {
    const result=[];
    for(let offset=0;;offset+=500) {
      const {data,error}=await admin.from("game_pigeon_discoveries")
        .select("species_id,discovered_at,seen_at").eq("user_id",userId).order("species_id").range(offset,offset+499);
      if(error) throw failure(error);
      result.push(...data);
      if(data.length<500) return result;
    }
  }
  async function favoriteRows(userId){
    const {data,error}=await admin.from('game_pigeon_favorites').select('species_id').eq('user_id',userId).range(0,999);
    if(error){if(['PGRST205','42P01'].includes(error.code))return [];throw failure(error);}
    return data.map(row=>row.species_id);
  }
  async function discoveries(userId,catalog,now) {
    const [saved,favorites]=await Promise.all([rows(userId),favoriteRows(userId)]), known=new Map(saved.map(row=>[row.species_id,row]));
    const breeds=catalog.breeds.map(record => {
      const found=known.get(record.id);
      const credit=photoCredits[record.id];
      const imageAttribution=record.imageAttribution || (credit ? {author:credit.artist,url:credit.sourceUrl,license:credit.license,licenseUrl:credit.licenseUrl} : undefined);
      return found ? {...record,scientificName:record.scientificName || record.parentScientificName,imageAttribution,
        discovered:true,discoveredAt:found.discovered_at,gameRarity:gameRarity(record)}
        : {id:record.id,kind:record.kind,name:"Undiscovered pigeon",discovered:false,hasRealImage:false};
    });
    const totalSpecies=breeds.filter(p=>p.kind==="species").length;
    const totalBreeds=breeds.length-totalSpecies;
    return {breeds,sources:catalog.sources || {},favorites,
      counts:{species:totalSpecies,breeds:totalBreeds,
        discoveredSpecies:breeds.filter(p=>p.kind==="species" && p.discovered).length,
        discoveredBreeds:breeds.filter(p=>p.kind==="breed" && p.discovered).length},
      dailyId:catalog.breeds.some(p=>p.id===dailyDiscoveryId(now)) ? dailyDiscoveryId(now) : null,
      pending:saved.filter(row=>!row.seen_at).map(row=>breeds.find(p=>p.id===row.species_id)).filter(Boolean)};
  }
  async function discoverDaily(userId,speciesId,catalog,now) {
    // Identity, date and eligibility come from the server, never the browser clock.
    if(speciesId!==dailyDiscoveryId(now) || !catalog.breeds.some(p=>p.id===speciesId)) {
      throw new AuthError(409,"DAILY_CHANGED","Today's pigeon has changed. Refresh your PigeonDex and try again.");
    }
    const {data,error}=await admin.rpc("record_pigeon_discovery",{p_user_id:userId,p_species_id:speciesId});
    if(error) throw failure(error);
    return {isNew:data,...await discoveries(userId,catalog,now)};
  }
  async function acknowledgeDiscovery(userId,speciesId) {
    const {error}=await admin.rpc("acknowledge_pigeon_discovery",{p_user_id:userId,p_species_id:speciesId});
    if(error) throw failure(error);
    return {saved:true};
  }
  async function toggleFavorite(userId,speciesId){
    const {data,error}=await admin.rpc('toggle_game_pigeon_favorite',{p_user_id:userId,p_species_id:speciesId});
    if(error)throw failure(error);
    if(data?.error==='UNDISCOVERED_PIGEON')throw new AuthError(409,'UNDISCOVERED_PIGEON','Discover this pigeon before adding it to favourites.');
    return data;
  }
  return {discoveries,discoverDaily,acknowledgeDiscovery,toggleFavorite};
}
module.exports={createDiscoveryService,discoveryInput,bundledCatalog,dailyDiscoveryId};
