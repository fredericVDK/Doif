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
