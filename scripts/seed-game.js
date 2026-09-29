const fs = require("node:fs");
const path = require("node:path");
const { getStarterSpecies } = require("../lib/game/species");

function buildStarterSeed(records) {
  const rows = getStarterSpecies(records).map((species) => ({
    id: species.id,
    name: species.name,
    scientific_name: species.scientificName,
    description: species.description,
    image: species.image,
    habitat: species.habitat,
    diet: species.diet,
    rarity: species.rarity,
    is_starter: species.isStarter,
    source_url: species.sourceUrl,
    description_source: species.descriptionSource,
    description_url: species.descriptionUrl,
    image_attribution: species.imageAttribution
  }));
  // Standard SQL strings: JSON remains data, including quotes and backslashes.
  const json = JSON.stringify(rows).replace(/'/g, "''");
  return `-- Generated from data/birdnet-pigeons.json; do not invent or edit source facts here.
BEGIN;
SET LOCAL standard_conforming_strings = on;
INSERT INTO public.game_species (
  id, name, scientific_name, description, image, habitat, diet, rarity,
  is_starter, source_url, description_source, description_url, image_attribution
)
SELECT id, name, scientific_name, description, image, habitat, diet, rarity,
  is_starter, source_url, description_source, description_url, image_attribution
FROM jsonb_to_recordset('${json}'::jsonb) AS species (
  id text, name text, scientific_name text, description text, image text,
  habitat text, diet text, rarity text, is_starter boolean, source_url text,
  description_source text, description_url text, image_attribution jsonb
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  scientific_name = EXCLUDED.scientific_name,
  description = EXCLUDED.description,
  image = EXCLUDED.image,
  source_url = EXCLUDED.source_url,
  description_source = EXCLUDED.description_source,
  description_url = EXCLUDED.description_url,
  image_attribution = EXCLUDED.image_attribution;
-- Repeat imports refresh source facts, preserving curated habitat/diet and game balancing.
COMMIT;
`;
}

if (require.main === module) {
  const snapshot = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/birdnet-pigeons.json"), "utf8"));
  const sql = buildStarterSeed(snapshot.records);
  const args = process.argv.slice(2);
  if (args.length === 0) process.stdout.write(sql);
  else if (args.length === 2 && args[0] === "--output") fs.writeFileSync(args[1], sql, "utf8");
  else throw new Error("Usage: node scripts/seed-game.js [--output path.sql]");
}

module.exports = { buildStarterSeed };
