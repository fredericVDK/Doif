const { AuthError } = require("../auth/errors");
const {requestIdInput,storageError,cooldownError}=require('./service-support');

function cleanInput(body) {
  return { requestId: requestIdInput(body,"CLEAN_REQUEST","Please try cleaning again.") };
}
function createCleanService(admin) {
  async function clean(userId, input) {
    const { data, error } = await admin.rpc("clean_game_pigeon", {
      p_user_id: userId, p_request_id: input.requestId
    });
    if (error) {
      throw storageError(error,"CLEAN_STORAGE","We could not confirm the wash. Please try again; the same wash will only be saved once.");
    }
    if (data?.error === "NO_PIGEON") throw new AuthError(409, "NO_PIGEON", "Adopt your first pigeon before cleaning.");
    if (data?.error === "CLEAN_COOLDOWN") {
      throw cooldownError(data,"CLEAN_COOLDOWN","Give your pigeon a moment before cleaning again.");
    }
    if (!data?.pigeon || !data?.effects) throw new AuthError(503, "CLEAN_STORAGE", "The wash could not be confirmed. Please try again.");
    return data;
  }
  return { clean };
}
module.exports = { cleanInput, createCleanService };
