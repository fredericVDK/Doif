const {AuthError}=require('../auth/errors');
const {requestIdInput,storageError}=require('./service-support');
const ITEM=/^[a-z][a-z0-9_]{0,63}$/;

function purchaseInput(body) {
  if(typeof body.itemId!=='string' || !ITEM.test(body.itemId)) {
    throw new AuthError(400,'SHOP_INPUT','Choose an available item and try again.');
  }
  return {requestId:requestIdInput(body,'SHOP_INPUT','Choose an available item and try again.'),itemId:body.itemId};
}
function createShopService(admin) {
  async function buyItem(userId,input) {
    const {data,error}=await admin.rpc('buy_game_item',{p_user_id:userId,p_request_id:input.requestId,p_item_id:input.itemId});
    if(error) {
      throw storageError(error,'SHOP_STORAGE','We could not confirm your purchase. Try again; the same purchase will only be charged once.');
    }
    if(data?.error==='ITEM_UNAVAILABLE') throw new AuthError(400,'ITEM_UNAVAILABLE','That item is no longer available. Refresh the shop.');
    if(data?.error==='NOT_ENOUGH_COINS') {
      throw new AuthError(409,'NOT_ENOUGH_COINS',`You need ${Number(data.missing).toLocaleString('en')} more Pigeon Coins for this item.`);
    }
    if(data?.error==='PROFILE_REQUIRED') throw new AuthError(409,'PROFILE_REQUIRED','Finish setting up your account before visiting the shop.');
    if(!data?.purchased || !data?.wallet || !data?.item) throw new AuthError(503,'SHOP_STORAGE','Your purchase could not be confirmed. Please try again.');
    return data;
  }
  return {buyItem};
}

module.exports={purchaseInput,createShopService};
