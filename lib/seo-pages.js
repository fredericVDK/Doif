// Server-rendered, crawlable pages for search engines: one page per pigeon in
// the PigeonDex, an index of all of them, and the Dutch home page.
const {renderNavigation} = require("./navigation");

const UNKNOWN = /^(not listed in source|no summary fact listed by the api\.?)$/i;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

function slugify(value) {
  return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "pigeon";
}

// Stable slug per catalog record; duplicates get the scientific name or a counter.
function buildSlugIndex(breeds) {
  const bySlug = new Map();
  const byId = new Map();
  for (const breed of [...breeds].sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
    let slug = slugify(breed.name);
    if (bySlug.has(slug) && breed.scientificName) slug = `${slug}-${slugify(breed.scientificName)}`;
    for (let n = 2; bySlug.has(slug); n++) slug = `${slugify(breed.name)}-${n}`;
    bySlug.set(slug, breed);
    byId.set(breed.id, slug);
  }
  return {bySlug, byId};
}

const slugCache = new WeakMap();
function slugIndexFor(catalog) {
  if (!slugCache.has(catalog)) slugCache.set(catalog, buildSlugIndex(catalog.breeds || []));
  return slugCache.get(catalog);
}

function cleanText(value) {
  return String(value || "").replace(/\s*==+\s*[^=]+?\s*==+\s*/g, "\n\n").replace(/[ \t]+/g, " ").trim();
}

function known(value) {
  const text = String(value || "").trim();
  return text && !UNKNOWN.test(text) ? text : "";
}

function paragraphs(text) {
  return cleanText(text).split(/\n{1,}/).map((p) => p.trim()).filter((p) => p.length > 1);
}

function summary(breed, max = 158) {
  const text = cleanText(known(breed.fact) || breed.history || "").replace(/\s+/g, " ");
  if (!text) return `${breed.name}: photo, origin and facts in the Doif PigeonDex.`;
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  return `${cut.slice(0, cut.lastIndexOf(" ")).replace(/[,;:.]$/, "")}…`;
}

function kindLabel(breed) {
  return breed.kind === "breed" ? "Domestic pigeon breed" : "Wild pigeon species";
}

function pageTitle(breed) {
  const parts = [breed.name];
  if (breed.nameNl && breed.nameNl.toLowerCase() !== breed.name.toLowerCase()) parts.push(`(${breed.nameNl})`);
  const suffix = breed.kind === "breed" ? "Pigeon Breed" : (breed.scientificName || "Pigeon Species");
  return `${parts.join(" ")} – ${suffix} · Doif`;
}

function shell({lang = "en", title, description, canonical, alternates = [], head = "", body, origin}) {
  return `<!doctype html>
<html lang="${lang}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}">
    <link rel="canonical" href="${escapeHtml(canonical)}">
${alternates.map(([hreflang, href]) => `    <link rel="alternate" hreflang="${hreflang}" href="${escapeHtml(href)}">`).join("\n")}
    <link rel="icon" type="image/png" href="/assets/favicon.png">
    <meta property="og:site_name" content="Doif">
    <meta property="og:title" content="${escapeHtml(title)}">
    <meta property="og:description" content="${escapeHtml(description)}">
    <meta property="og:url" content="${escapeHtml(canonical)}">
${head}
    <link rel="stylesheet" href="/site-navigation.css">
    <link rel="stylesheet" href="/seo-pages.css">
    <script src="/analytics.js" defer></script>
    <script defer src="/_vercel/insights/script.js"></script>
  </head>
  <body>
${body}
    <footer class="seo-footer"><a href="/">Doif</a> · <a href="/pigeondex/">All pigeons</a> · <a href="/nl/">Nederlands</a></footer>
  </body>
</html>`;
}

function attribution(breed) {
  const a = breed.imageAttribution;
  if (!a || typeof a !== "object" || !a.author) return "";
  const license = a.license ? ` (${String(a.license).toUpperCase()})` : "";
  return `<figcaption>Photo: ${escapeHtml(a.author)}${a.source ? ` via ${escapeHtml(a.source)}` : ""}${escapeHtml(license)}</figcaption>`;
}

function jsonLd(data) {
  return `    <script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;
}

function renderBreedPage(breed, {catalog, origin}) {
  const {byId} = slugIndexFor(catalog);
  const slug = byId.get(breed.id);
  const url = `${origin}/pigeondex/${slug}`;
  const description = summary(breed);
  const facts = [
    ["Type", kindLabel(breed)],
    ["Dutch name", breed.nameNl],
    ["Scientific name", breed.scientificName || (breed.kind === "breed" ? "Columba livia domestica" : "")],
    ["Family", breed.family || "Columbidae"],
    ["Origin", known(breed.origin)],
    ["Size", known(breed.size)],
    ["Flight", known(breed.flight)],
    ["Temperament", known(breed.temperament)]
  ].filter(([, value]) => value);
  const text = paragraphs(breed.history || known(breed.fact));
  const related = (catalog.breeds || []).filter((other) => other.id !== breed.id && other.kind === breed.kind);
  const start = Math.max(0, related.findIndex((other) => other.name.localeCompare(breed.name) > 0));
  const neighbours = [...related.slice(start, start + 6), ...related.slice(0, Math.max(0, 6 - related.slice(start).length))].slice(0, 6);
  const sourceUrl = breed.descriptionUrl || breed.sourceUrl;
  const head = [
    `    <meta property="og:type" content="article">`,
    breed.image ? `    <meta property="og:image" content="${escapeHtml(breed.image)}">` : "",
    jsonLd({
      "@context": "https://schema.org",
      "@graph": [
        {"@type": "WebPage", "@id": url, url, name: pageTitle(breed), description, inLanguage: "en",
          isPartOf: {"@type": "WebSite", name: "Doif", url: `${origin}/`},
          ...(breed.image ? {primaryImageOfPage: {"@type": "ImageObject", contentUrl: breed.image}} : {})},
        {"@type": "BreadcrumbList", itemListElement: [
          {"@type": "ListItem", position: 1, name: "Doif", item: `${origin}/`},
          {"@type": "ListItem", position: 2, name: "PigeonDex", item: `${origin}/pigeondex/`},
          {"@type": "ListItem", position: 3, name: breed.name, item: url}
        ]}
      ]
    })
  ].filter(Boolean).join("\n");
  const body = `    <header class="seo-header">
      ${renderNavigation("pigeondex")}
      <nav class="breadcrumbs" aria-label="Breadcrumb"><a href="/">Doif</a> › <a href="/pigeondex/">PigeonDex</a> › <span>${escapeHtml(breed.name)}</span></nav>
    </header>
    <main class="seo-main breed-page">
      <article>
        <p class="eyebrow">${escapeHtml(kindLabel(breed))}</p>
        <h1>${escapeHtml(breed.name)}${breed.nameNl ? ` <span class="name-nl" lang="nl">${escapeHtml(breed.nameNl)}</span>` : ""}</h1>
        ${breed.scientificName ? `<p class="scientific"><i>${escapeHtml(breed.scientificName)}</i></p>` : ""}
        <div class="breed-layout">
          <figure class="breed-photo">
            <img src="${escapeHtml(breed.image)}" alt="${escapeHtml(`${breed.name} pigeon`)}" width="640" height="420" loading="eager">
            ${attribution(breed)}
          </figure>
          <dl class="breed-facts">
${facts.map(([label, value]) => `            <div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("\n")}
          </dl>
        </div>
        <section class="breed-text" aria-label="About the ${escapeHtml(breed.name)}">
          <h2>About the ${escapeHtml(breed.name)}</h2>
${text.length ? text.map((p) => `          <p>${escapeHtml(p)}</p>`).join("\n") : `          <p>${escapeHtml(description)}</p>`}
          ${breed.descriptionNl ? `<h2 lang="nl">In het Nederlands</h2>\n          <p lang="nl">${escapeHtml(cleanText(breed.descriptionNl))}</p>` : ""}
          ${sourceUrl ? `<p class="source">Source: <a href="${escapeHtml(sourceUrl)}" rel="nofollow noopener">${escapeHtml(new URL(sourceUrl).hostname)}</a>${/wikipedia/.test(sourceUrl) ? " (text available under CC BY-SA)" : ""}.</p>` : ""}
        </section>
        <p class="cta"><a class="button" href="/pigeondex.html">Open the interactive PigeonDex</a> <a class="button secondary" href="/sign-in">Adopt your own pigeon</a></p>
      </article>
      ${neighbours.length ? `<aside class="related" aria-label="More pigeons">
        <h2>More ${breed.kind === "breed" ? "pigeon breeds" : "pigeon species"}</h2>
        <ul>${neighbours.map((other) => `<li><a href="/pigeondex/${byId.get(other.id)}">${escapeHtml(other.name)}</a></li>`).join("")}</ul>
      </aside>` : ""}
    </main>`;
  return shell({title: pageTitle(breed), description, canonical: url, head, body, origin});
}

function renderPigeondexIndex({catalog, origin}) {
  const {byId} = slugIndexFor(catalog);
  const breeds = catalog.breeds || [];
  const groups = [["breed", "Domestic pigeon breeds"], ["species", "Wild pigeon and dove species"]];
  const url = `${origin}/pigeondex/`;
  const description = `Browse ${breeds.length} pigeons: domestic pigeon breeds and wild pigeon and dove species, with photos, origin and facts. Alle duivenrassen en duivensoorten op Doif.`;
  const body = `    <header class="seo-header">
      ${renderNavigation("pigeondex")}
      <nav class="breadcrumbs" aria-label="Breadcrumb"><a href="/">Doif</a> › <span>PigeonDex</span></nav>
    </header>
    <main class="seo-main">
      <h1>All pigeon breeds and species</h1>
      <p class="lede">The Doif PigeonDex lists ${breeds.length} pigeons: fancy and racing pigeon breeds as well as wild pigeons and doves from around the world. <span lang="nl">Ontdek alle duivenrassen en wilde duivensoorten.</span></p>
      <p class="cta"><a class="button" href="/pigeondex.html">Open the interactive PigeonDex</a></p>
${groups.map(([kind, label]) => {
    const rows = breeds.filter((b) => (kind === "breed" ? b.kind === "breed" : b.kind !== "breed"));
    if (!rows.length) return "";
    return `      <section class="index-group">
        <h2>${label} <small>(${rows.length})</small></h2>
        <ul class="index-list">${rows.map((b) => `<li><a href="/pigeondex/${byId.get(b.id)}">${escapeHtml(b.name)}</a>${b.nameNl ? ` <span lang="nl">${escapeHtml(b.nameNl)}</span>` : ""}</li>`).join("")}</ul>
      </section>`;
  }).join("\n")}
    </main>`;
  return shell({title: "All Pigeon Breeds & Species – PigeonDex · Doif", description, canonical: url, body, origin,
    head: jsonLd({"@context": "https://schema.org", "@type": "CollectionPage", name: "PigeonDex", url, description})});
}

function breedPaths(catalog) {
  return [...slugIndexFor(catalog).bySlug.keys()].map((slug) => `/pigeondex/${slug}`);
}

function findBreedBySlug(catalog, slug) {
  return slugIndexFor(catalog).bySlug.get(slug) || null;
}

module.exports = {escapeHtml, slugify, buildSlugIndex, cleanText, summary, pageTitle,
  renderBreedPage, renderPigeondexIndex, breedPaths, findBreedBySlug};
