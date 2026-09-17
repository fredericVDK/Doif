const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { normalizeSpecies } = require("../lib/birdnet");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pigeon-catalog-test-"));
process.env.DATA_FILE = path.join(temp, "db.json");
process.env.AIRTABLE_API_KEY = "";
process.env.AIRTABLE_BASE_ID = "";
const source = records => ({ records, cachedAt: new Date().toISOString(), expiresAt: Date.now() + 3600000, status: "live" });
fs.writeFileSync(process.env.DATA_FILE, JSON.stringify({ catalogCache: {
  birdnet: source([normalizeSpecies({ birdnet_id: "BN03520", scientific_name: "Columba palumbus", common_name: "Wood Pigeon" })]),
  domestic: source([{ id: "english pouter", name: "English Pouter", image: "assets/pigeon-hero-wide.png" }])
} }));
const handle = require("../server");

test("list and detail API expose the mixed catalogue and source health", async () => {
  const server = http.createServer(handle);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    const list = await (await fetch(`${url}/api/breeds`)).json();
    assert.equal(list.primarySource, "BirdNET");
    assert.deepEqual(list.counts, { species: 1, breeds: 1 });
    assert.equal(list.count, 2);
    for (const id of ["birdnet:BN03520", "english pouter"]) {
      const detail = await (await fetch(`${url}/api/breeds/${encodeURIComponent(id)}`)).json();
      assert.equal(detail.breed.id, id);
    }
    assert.equal((await fetch(`${url}/api/breeds/unknown`)).status, 404);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test("races are parsed from list bullets, not gallery captions, references or navigation", () => {
  const text = `Intro [[Domestic pigeon]]\n==A==\n* [[African Owl]]<ref name="x" />\n<gallery>File:Owl.jpg|Black</gallery>\n** Unlinked Racer (D/42)<ref>Reference</ref>\n* [[American bohemian pouter|American\nBohemian Pouter]]\n==B==\n* [[Barb (pigeon)|Barb]] (= alternate)\n==References==\n* [[Unrelated page]]`;
  assert.deepEqual(handle.extractBreedEntries(text).map(row => row.title), ["African Owl", "Unlinked Racer", "American bohemian pouter", "Barb (pigeon)"]);
  const many = "==A==\n" + Array.from({ length: 400 }, (_, i) => `* Breed ${i}`).join("\n") + "\n==References==";
  assert.equal(handle.extractBreedEntries(many).length, 400);
});

test("Wikipedia batching retrieves descriptions beyond the first 20 entries", async () => {
  const titles = Array.from({ length: 41 }, (_, i) => `Breed ${i}`);
  const sizes = [];
  const pages = await handle.fetchWikipediaPages(titles, async request => {
    const params = new URL(request).searchParams;
    const batch = params.get("titles").split("|");
    sizes.push(batch.length);
    const limit = params.get("exlimit") === "max" ? 20 : 1;
    return { query: { pages: Object.fromEntries(batch.map((title, i) => [i, {
      title, pageid: i, ...(i < limit ? { extract: `Description for ${title}` } : {})
    }])) } };
  });
  assert.deepEqual(sizes, [20, 20, 1]);
  assert.equal(pages.filter(page => page.extract).length, 41);
});
