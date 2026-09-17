// Explicit, reviewable snapshot refresh. Does not modify the application DB.
const fs = require("node:fs");
const path = require("node:path");
const { fetchBirdnetSpecies } = require("../lib/birdnet");
const { domesticRecord } = require("../lib/catalog");
const { buildDomesticBreeds } = require("../server");

async function main() {
  const speciesOnly = process.argv.includes("--species-only");
  const species = await fetchBirdnetSpecies();
  const timestamp = Date.now();
  function write(name, data) {
    fs.writeFileSync(path.join(__dirname, "..", "data", name), JSON.stringify({
      ...data, cachedAt: new Date(timestamp).toISOString(),
      expiresAt: timestamp + 6 * 60 * 60 * 1000, status: "snapshot"
    }, null, 2) + "\n");
  }
  write("birdnet-pigeons.json", species);
  console.log(`BirdNET: ${species.records.length} pigeon species from ${species.scannedBirds} birds (${species.version}).`);
  if (!speciesOnly) {
    const records = (await buildDomesticBreeds()).map(domesticRecord);
    write("domestic-pigeons.json", { records });
    console.log(`Wikimedia: ${records.length} domestic breed records.`);
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
