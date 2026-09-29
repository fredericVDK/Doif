const { AuthError } = require("../auth/errors");
const {requestIdInput,storageError,cooldownError}=require('./service-support');

function playInput(body) {
  return { requestId: requestIdInput(body,"PLAY_REQUEST","Please try playing again.") };
}
function createPlayService(admin) {
  async function play(userId, input) {
    const { data, error } = await admin.rpc("play_game_pigeon", {
      p_user_id: userId, p_request_id: input.requestId
    });
    if (error) {
      throw storageError(error,"PLAY_STORAGE","We could not confirm playtime. Please try again; the same playtime will only be saved once.");
    }
    if (data?.error === "NO_PIGEON") throw new AuthError(409, "NO_PIGEON", "Adopt your first pigeon before playing.");
    if (data?.error === "PLAY_COOLDOWN") {
      throw cooldownError(data,"PLAY_COOLDOWN","Give your pigeon a moment before playing again.");
    }
    if (data?.error === "TOO_TIRED" && data.pigeon) {
      const failure = new AuthError(409, "TOO_TIRED", `${data.pigeon.nickname} is too tired to play.`);
      failure.pigeon = data.pigeon;
      throw failure;
    }
    if (!data?.pigeon || !data?.effects) throw new AuthError(503, "PLAY_STORAGE", "Playtime could not be confirmed. Please try again.");
    return data;
  }
  return { play };
}
module.exports = { playInput, createPlayService };
