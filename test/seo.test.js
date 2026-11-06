const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { robotsTxt, sitemapXml } = require("../server");

test("robots.txt allows crawling and points to the sitemap", () => {
  const body = robotsTxt();
  assert.match(body, /User-agent: \*/);
  assert.match(body, /Sitemap: https:\/\/.+\/sitemap\.xml/);
  assert.match(body, /Disallow: \/api\//);
});

test("sitemap lists the public pages", () => {
  const body = sitemapXml();
  for (const page of ["/", "/pigeondex.html", "/pigder.html", "/drawings.html"]) {
    assert.ok(body.includes(`${page}</loc>`), page);
  }
});

test("home page carries brand keywords, canonical and structured data", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");
  assert.match(html, /<title>[^<]*Doif[^<]*<\/title>/);
  assert.match(html, /<meta name="description" content="[^"]*duif[^"]*pigeon/i);
  assert.match(html, /<link rel="canonical"/);
  const ld = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s);
  assert.ok(ld);
  assert.equal(JSON.parse(ld[1]).name, "Doif");
});

const { renderBreedPage, renderPigeondexIndex, breedPaths, findBreedBySlug, slugify, buildSlugIndex } = require("../lib/seo-pages");
const catalog = { breeds: [
  { id: "birdnet:BN1", kind: "species", name: "Rock Dove", nameNl: "Rotsduif", scientificName: "Columba livia",
    fact: "The rock dove is a member of the bird family Columbidae. == Taxonomy == It was described in 1789.",
    history: "The rock dove is a member of the bird family Columbidae.\n== Taxonomy ==\nIt was described in 1789.",
    image: "https://example.org/rock.jpg", origin: "Not listed in source", descriptionNl: "De rotsduif is een vogel.",
    sourceUrl: "https://en.wikipedia.org/wiki/Rock_dove" },
  { id: "aachen cropper", kind: "breed", name: "Aachen Cropper", image: "https://example.org/a.jpg",
    fact: "A <fancy> pigeon breed.", history: "", origin: "Germany" }
] };

test("slugs are url-safe and unique", () => {
  assert.equal(slugify("Ägyptische Möwchen & Co."), "agyptische-mowchen-and-co");
  const index = buildSlugIndex([{ id: "a", name: "Dove" }, { id: "b", name: "Dove" }, { id: "c", name: "Dove", scientificName: "Zenaida x" }]);
  assert.equal(new Set(index.byId.values()).size, 3);
});

test("breed pages are server-rendered with title, canonical and escaped text", () => {
  const breed = findBreedBySlug(catalog, "rock-dove");
  const html = renderBreedPage(breed, { catalog, origin: "https://example.test" });
  assert.match(html, /<title>Rock Dove \(Rotsduif\) – Columba livia · Doif<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/example.test\/pigeondex\/rock-dove">/);
  assert.doesNotMatch(html, /==/);
  assert.doesNotMatch(html, /Not listed in source/);
  assert.match(html, /lang="nl">De rotsduif/);
  const other = renderBreedPage(findBreedBySlug(catalog, "aachen-cropper"), { catalog, origin: "https://example.test" });
  assert.match(other, /A &lt;fancy&gt; pigeon breed\./);
});

test("PigeonDex index links every pigeon and the sitemap lists them", () => {
  const html = renderPigeondexIndex({ catalog, origin: "https://example.test" });
  for (const p of breedPaths(catalog)) assert.ok(html.includes(`href="${p}"`), p);
  const xml = sitemapXml(catalog);
  assert.ok(xml.includes("/pigeondex/rock-dove</loc>"));
  assert.ok(xml.includes("/nl/</loc>"));
});

test("Dutch home page exists with hreflang back to English", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "public", "index-nl.html"), "utf8");
  assert.match(html, /<html lang="nl">/);
  assert.match(html, /hreflang="en"/);
  assert.match(html, /duif/i);
});
