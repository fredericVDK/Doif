const { safeUrl } = require("../birdnet");
const photoCredits = require("../../data/starter-photo-credits.json");

const STARTER_BREEDS = Object.freeze([
  "jacobin pigeon", "indian fantail", "australian saddleback tumbler"
]);

// Keep catalogue IDs intact. These are breeds of Columba livia, not new species.
function getStarterBreeds(records) {
  return STARTER_BREEDS.map(id => {
    const matches = records.filter(record => record.id === id);
    const record = matches[0];
    if (matches.length !== 1 || record.kind !== "breed" || !record.name?.trim()
      || record.parentSpeciesId !== "birdnet:BN03514" || record.parentScientificName !== "Columba livia"
      || !safeUrl(record.sourceUrl) || !record.fact?.trim()) {
      throw new Error(`Missing or changed starter breed: ${id}. Review the catalogue before seeding.`);
    }
    return {
      id, name: record.name, kind: "breed", parent_species_id: record.parentSpeciesId,
      scientific_name: record.parentScientificName, description: record.fact,
      image: record.hasRealImage && safeUrl(record.image) || "/assets/pigeon-hero-wide.png",
      rarity: "common", is_starter: true, source_url: record.sourceUrl,
      description_source: record.fieldSources?.description || "", description_url: record.sourceUrl,
      image_attribution: { ...photoCredits[id], ...(record.imageAttribution || {}) }
    };
  });
}

module.exports = { STARTER_BREEDS, getStarterBreeds };
