const {randomInt}=require('node:crypto');
const {AuthError}=require('../auth/errors');
const {requestIdInput,storageError}=require('./service-support');

const PACKS={normal:{size:2},big:{size:5}};
function packInput(body){
  if(typeof body.packType!=='string'||!Object.hasOwn(PACKS,body.packType))
    throw new AuthError(400,'PACK_INPUT','Choose an available pigeon pack.');
  return {packType:body.packType,requestId:requestIdInput(body,'PACK_INPUT','Please try opening the pack again.')};
}
function selectPigeons(records,size){
  if(!Array.isArray(records)||records.length<size) throw new AuthError(503,'PACK_CATALOG','Pigeon packs are temporarily unavailable.');
  const pool=[...records];
  for(let index=0;index<size;index++){
    const selected=index+randomInt(pool.length-index);
    [pool[index],pool[selected]]=[pool[selected],pool[index]];
  }
  return pool.slice(0,size);
}
function createPackService(admin){
  const failure=error=>storageError(error,'PACK_STORAGE','We could not confirm your pack. Try again; the same pack will only be charged once.');
  async function getPacks(userId){
    const {data,error}=await admin.rpc('get_pigeon_pack_status',{p_user_id:userId});
    if(error) throw failure(error);
    if(data?.error==='PROFILE_REQUIRED') throw new AuthError(409,'PROFILE_REQUIRED','Finish setting up your account first.');
    if(!Array.isArray(data?.packs)||!data?.wallet) throw new AuthError(503,'PACK_STORAGE','Pigeon packs are temporarily unavailable.');
    return data;
  }
  async function buyPack(userId,input,catalog){
    const selected=selectPigeons(catalog?.breeds,PACKS[input.packType].size);
    const {data,error}=await admin.rpc('buy_pigeon_pack',{p_user_id:userId,p_request_id:input.requestId,
      p_pack_type:input.packType,p_species_ids:selected.map(record=>record.id)});
    if(error) throw failure(error);
    if(data?.error==='PACK_LIMIT'){
      const message=input.packType==='normal'?'You already opened today’s Normal Pack.':'You already opened this week’s Big Pack.';
      const result=new AuthError(409,'PACK_LIMIT',message);result.nextAvailableAt=data.nextAvailableAt;throw result;
    }
    if(data?.error==='NOT_ENOUGH_COINS') throw new AuthError(409,'NOT_ENOUGH_COINS',
      `You need ${Number(data.missing).toLocaleString('en')} more Pigeon Coins for this pack.`);
    if(data?.error==='PROFILE_REQUIRED') throw new AuthError(409,'PROFILE_REQUIRED','Finish setting up your account first.');
    if(!data?.purchased||!Array.isArray(data.pigeons)||!data.wallet) throw new AuthError(503,'PACK_STORAGE','Your pack could not be confirmed.');
    const byId=new Map(catalog.breeds.map(record=>[record.id,record]));
    return {...data,pigeons:data.pigeons.map(item=>({...item,pigeon:byId.get(item.speciesId)}))};
  }
  return {getPacks,buyPack};
}
module.exports={PACKS,packInput,selectPigeons,createPackService};
