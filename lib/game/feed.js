const { AuthError } = require("../auth/errors");
const {requestIdInput,storageError,cooldownError}=require('./service-support');

function feedInput(body) {
  if (body.food !== "crumbs") throw new AuthError(400, "FOOD", "Choose Crumbs to feed your pigeon.");
  return { food: body.food, requestId: requestIdInput(body,"FEED_REQUEST","Please reopen the food selector and try again.") };
}
function createFeedService(admin) {
  async function feed(userId, input) {
    const { data, error } = await admin.rpc("feed_game_pigeon", {
      p_user_id: userId, p_request_id: input.requestId, p_food: input.food
    });
    if (error) {
      throw storageError(error,"FEED_STORAGE","We could not confirm your pigeon’s meal. Please try again; the same meal will only be saved once.");
    }
    if (data?.error === "NO_PIGEON") throw new AuthError(409, "NO_PIGEON", "Adopt your first pigeon before feeding it.");
    if (data?.error === "FEED_COOLDOWN") {
      throw cooldownError(data,"FEED_COOLDOWN","Give your pigeon a moment to finish those crumbs.");
    }
    if (!data?.pigeon || !data?.effects) throw new AuthError(503, "FEED_STORAGE", "Your pigeon’s meal could not be confirmed. Please try again.");
    return data;
  }
  return { feed };
}
module.exports = { feedInput, createFeedService };
