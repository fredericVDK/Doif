const { safeUrl } = require("../birdnet");

// These are game choices keyed by existing catalogue IDs, not new taxonomy records.
const STARTERS = Object.freeze([
  Object.freeze({ id: "birdnet:BN03514", scientificName: "Columba livia", rarity: "common" }),
  Object.freeze({ id: "birdnet:BN03520", scientificName: "Columba palumbus", rarity: "common" }),
  Object.freeze({ id: "birdnet:BN03516", scientificName: "Columba oenas", rarity: "common" })
]);

function getStarterSpecies(records) {
  if (!Array.isArray(records)) throw new TypeError("Expected catalogue records.");

  return STARTERS.map((starter) => {
    const matches = records.filter((record) => record.id === starter.id);
    const record = matches[0];
    if (matches.length !== 1 || record.kind !== "species"
      || record.scientificName !== starter.scientificName || !record.name?.trim()) {
      throw new Error(`Missing or changed starter species: ${starter.id}. Review the catalogue before seeding.`);
    }
    const sourceUrl = safeUrl(record.sourceUrl);
    if (!sourceUrl) throw new Error(`Missing source URL for ${starter.id}.`);

    return {
      id: record.id,
      name: record.name,
      scientificName: record.scientificName,
      description: record.history || record.fact || "",
      image: record.hasRealImage && safeUrl(record.image) || "assets/pigeon-hero-wide.png",
      // The current catalogue has no verified structured habitat/diet fields.
      habitat: null,
      diet: null,
      rarity: starter.rarity,
      isStarter: true,
      sourceUrl,
      descriptionSource: record.descriptionSource || "",
      descriptionUrl: safeUrl(record.descriptionUrl),
      imageAttribution: { ...(record.imageAttribution || {}) }
    };
  });
}

module.exports = { STARTERS, getStarterSpecies };
