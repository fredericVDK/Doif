const {AuthError}=require('../auth/errors');

function createInventoryService(admin) {
  async function getInventory(userId) {
    const {data,error}=await admin.rpc('get_game_inventory',{p_user_id:userId});
    if(error) {
      const failure=new AuthError(503,'INVENTORY_STORAGE','Your inventory could not be loaded. Please try again.');
      failure.providerCode=error.code;
      throw failure;
    }
    if(!Array.isArray(data)) throw new AuthError(503,'INVENTORY_STORAGE','Your inventory could not be loaded. Please try again.');
    const items=data.map(item=>({...item,quantity:Number(item.quantity)}));
    return {items,summary:{distinctOwned:items.filter(item=>item.quantity>0).length,totalQuantity:items.reduce((sum,item)=>sum+item.quantity,0)}};
  }
  return {getInventory};
}

module.exports={createInventoryService};
