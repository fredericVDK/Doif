const { AuthError } = require("../auth/errors");
const { STARTER_BREEDS } = require("./starter-breeds");
const { storageError } = require("./service-support");

function adoptionInput(body) {
  const nickname = typeof body.nickname === "string" ? body.nickname.trim() : "";
  if (!nickname || [...nickname].length > 32 || /[\u0000-\u001f\u007f-\u009f]/u.test(nickname)) {
    throw new AuthError(400, "NICKNAME", "Choose a name of 1–32 characters, without line breaks or control characters.");
  }
  if (typeof body.speciesId !== "string" || !STARTER_BREEDS.includes(body.speciesId)) {
    throw new AuthError(400, "STARTER", "Choose one of the three starter pigeons.");
  }
  // Extra client fields (user IDs, coins, stats, timestamps) are never forwarded.
  return { speciesId: body.speciesId, nickname };
}

function createAdoptionService(admin) {
  const failure = error => storageError(error, "GAME_STORAGE", "Your pigeon could not be loaded or saved. Please try again shortly.");
  async function getStarters() {
    const { data, error } = await admin.from("game_species").select("*")
      .in("id", STARTER_BREEDS).eq("is_starter", true);
    if (error) throw failure(error);
    if (data.length !== 3 || data.some(row => row.kind !== "breed")) {
      throw new AuthError(503, "ADOPTION_SETUP", "Pigeon adoption is being prepared. Please come back shortly.");
    }
    return STARTER_BREEDS.map(id => data.find(row => row.id === id));
  }
  async function getPigeon(userId) {
    const { data, error } = await admin.from("game_pigeons")
      .select("*,species:game_species(*)").eq("user_id", userId).order('created_at').limit(1).maybeSingle();
    if (error) throw failure(error);
    return data;
  }
  async function adopt(userId, input) {
    const { data, error } = await admin.rpc("adopt_game_pigeon", {
      p_user_id: userId, p_species_id: input.speciesId, p_nickname: input.nickname
    });
    if (error?.code === "23505") throw new AuthError(409, "ALREADY_ADOPTED", "Your pigeon is already waiting at home.");
    if (error?.code === "22023") throw new AuthError(400, "ADOPTION_INPUT", "Check your pigeon choice and nickname, then try again.");
    if (error || !data?.[0]) throw failure(error);
    return data[0];
  }
  return { getStarters, getPigeon, adopt };
}

function createGameRepository(admin) {
  return require('./index').createGameService(admin);
}
module.exports = { adoptionInput, createAdoptionService, createGameRepository };
