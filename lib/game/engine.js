const { AuthError } = require("../auth/errors");

function createGameEngine(admin) {
  async function getCurrentPigeon(userId) {
    const selected=await admin.from('game_pigeons').select('id').eq('user_id',userId).eq('is_home',true).limit(1).maybeSingle();
    if(!selected.error&&selected.data?.id){
      const refreshed=await admin.rpc('refresh_team_pigeon',{p_user_id:userId,p_pigeon_id:selected.data.id});
      if(!refreshed.error)return refreshed.data;
    }
    // The database owns time, rates, row locking and persistence. No client clock or stats.
    const { data, error } = await admin.rpc("refresh_game_pigeon", { p_user_id: userId });
    if (error) {
      const failure = new AuthError(503, "GAME_ENGINE", "Your pigeon’s latest stats could not be saved. Please try again shortly.");
      failure.providerCode = error.code;
      throw failure;
    }
    return data;
  }
  return { getCurrentPigeon };
}

module.exports = { createGameEngine };
