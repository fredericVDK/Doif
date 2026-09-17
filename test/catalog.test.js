const test = require("node:test");
const assert = require("node:assert/strict");
const { fetchBirdnetSpecies, normalizeSpecies, isPigeon } = require("../lib/birdnet");
const { createCatalog, mergeRecords } = require("../lib/catalog");

function bird(id, scientificName = "Columba palumbus") {
  return { birdnet_id: `BN${id}`, scientific_name: scientificName, common_name: "Wood Pigeon",
    taxon_group: "Aves", record_type: "species", common_names: { nl: "Houtduif" },
    descriptions: { en: "A woodland pigeon. Eats seeds." },
    image: { src: "https://example.org/pigeon.jpg", author: "Photographer", license: "cc-by" } };
}

test("scientific filtering includes bleeding-hearts and bronzewings, excludes false names", () => {
  assert.equal(isPigeon(bird(1, "Gallicolumba luzonica")), true);
  assert.equal(isPigeon(bird(2, "Phaps chalcoptera")), true);
  assert.equal(isPigeon(bird(3, "Cepphus columba")), false);
  assert.equal(isPigeon({ ...bird(4), record_type: "subspecies" }), false);
});

test("BirdNET imports every page and keeps species without photos", async () => {
  const first = Array.from({ length: 500 }, (_, index) => bird(index, "Cepphus columba"));
  first[10] = bird(10);
  const last = { ...bird(500, "Gallicolumba luzonica"), image: null };
  const pages = [];
  const result = await fetchBirdnetSpecies(async url => {
    const page = Number(url.searchParams.get("page")); pages.push(page);
    return { total: 501, page, taxonomy_version: "test", results: page === 1 ? first : [last] };
  });
  assert.deepEqual(pages, [1, 2]);
  assert.equal(result.records.length, 2);
  assert.equal(result.records[1].hasRealImage, false);
  assert.equal(result.records[0].nameNl, "Houtduif");
  assert.equal(result.records[0].imageAttribution.author, "Photographer");
  assert.equal(result.records[0].size, "Not listed in source");
});

test("repeated pages and changing totals are rejected, never cached as a full import", async () => {
  const rows = Array.from({ length: 500 }, (_, i) => bird(i));
  await assert.rejects(fetchBirdnetSpecies(async url => ({ total: 600, page: Number(url.searchParams.get("page")), results: rows })), /pagination/);
  await assert.rejects(fetchBirdnetSpecies(async url => ({ total: url.searchParams.get("page") === "1" ? 600 : 601, page: Number(url.searchParams.get("page")), results: rows })), /changing/);
});

test("unsafe or unlicensed images do not hide the species or execute URLs", () => {
  const row = normalizeSpecies({ ...bird(1), image: { src: "javascript:alert(1)", license: "cc-by" } });
  assert.equal(row.hasRealImage, false);
  assert.equal(row.imageAttribution.url, "");
  assert.equal(normalizeSpecies({ ...bird(2), image: { src: "https://example.org/a.jpg", license: "all rights reserved" } }).hasRealImage, false);
});

test("domestic breeds retain their IDs alongside the parent species", () => {
  const records = mergeRecords([normalizeSpecies(bird(3514, "Columba livia"))], [
    { id: "english pouter", name: "English Pouter", origin: "United Kingdom" }
  ]);
  assert.equal(records.length, 2);
  assert.equal(records.find(row => row.kind === "breed").id, "english pouter");
  assert.equal(records.find(row => row.kind === "breed").parentScientificName, "Columba livia");
});

test("one refresh is shared by concurrent requests and source failures preserve saved breeds", async () => {
  let calls = 0; let saved;
  const get = createCatalog({
    loadSpecies: async () => { calls++; return { records: [normalizeSpecies(bird(1))] }; },
    loadDomestic: async () => { throw new Error("Wikipedia offline"); },
    readSaved: () => ({}), save: value => { saved = value; }, now: () => 1000,
    snapshots: { domestic: { records: [{ id: "fantail", name: "Fantail" }], expiresAt: 0, cachedAt: "old" } }
  });
  const [a, b] = await Promise.all([get(), get()]);
  assert.equal(a, b); assert.equal(calls, 1);
  assert.deepEqual(a.counts, { species: 1, breeds: 1 });
  assert.equal(a.sources.domestic.status, "stale");
  assert.equal(saved.domestic.cachedAt, "old");
  await get(); assert.equal(calls, 1);
});

test("BirdNET outage uses its snapshot while supplemental breeds still load", async () => {
  const get = createCatalog({ loadSpecies: async () => { throw new Error("offline"); },
    loadDomestic: async () => ({ records: [{ id: "fantail", name: "Fantail" }] }),
    readSaved: () => ({}), save: () => {}, now: () => 1000,
    snapshots: { birdnet: { records: [normalizeSpecies(bird(1))], expiresAt: 0 } } });
  const result = await get();
  assert.equal(result.count, 2); assert.equal(result.sources.birdnet.status, "stale");
  assert.equal(result.sources.domestic.status, "live");
});

test("an unavailable source is reported and retried after five minutes", async () => {
  let time = 1000; let calls = 0;
  const get = createCatalog({ loadSpecies: async () => { calls++; throw new Error("offline"); },
    loadDomestic: async () => ({ records: [{ id: "fantail", name: "Fantail" }] }),
    readSaved: () => ({}), save: () => {}, now: () => time });
  assert.equal((await get()).sources.birdnet.status, "unavailable");
  time += 300001; await get(); assert.equal(calls, 2);
});
