const { AuthError } = require("../auth/errors");
const {requestIdInput,storageError,cooldownError}=require('./service-support');

function sleepInput(body) {
  return { requestId: requestIdInput(body,"SLEEP_REQUEST","Please try resting again.") };
}
function createSleepService(admin) {
  async function sleep(userId, input) {
    const { data, error } = await admin.rpc("sleep_game_pigeon", {
      p_user_id: userId, p_request_id: input.requestId
    });
    if (error) {
      throw storageError(error,"SLEEP_STORAGE","We could not confirm the rest. Please try again; the same rest will only be saved once.");
    }
    if (data?.error === "NO_PIGEON") throw new AuthError(409, "NO_PIGEON", "Adopt your first pigeon before resting.");
    if (data?.error === "SLEEP_COOLDOWN") {
      throw cooldownError(data,"SLEEP_COOLDOWN","Give your pigeon a moment before resting again.");
    }
    if (!data?.pigeon || !data?.effects) throw new AuthError(503, "SLEEP_STORAGE", "The rest could not be confirmed. Please try again.");
    return data;
  }
  return { sleep };
}
module.exports = { sleepInput, createSleepService };
