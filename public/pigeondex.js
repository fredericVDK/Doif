const WIKI_API = "https://en.wikipedia.org/w/api.php";
const WIKIDATA_API = "https://www.wikidata.org/w/api.php";
const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
const COMMONS_FILE = "https://commons.wikimedia.org/wiki/Special:FilePath/";
const FALLBACK_IMAGE = "assets/pigeon-hero-wide.png";
const LIST_PAGE = "List_of_pigeon_breeds";
const PAGE_BATCH_SIZE = 35;
const MAX_INITIAL_BREEDS = 260;
const favoritesKey = "pigeondex:favorites";
const dailyHistoryKey = "pigeondex:daily-history";
const battleHistoryKey = "pigeondex:battle-history";
const MISSING_SOURCE = "Not listed in source";

const breedGrid = document.querySelector("#breedGrid");
const statusEl = document.querySelector("#status");
const searchInput = document.querySelector("#searchInput");
const randomButton = document.querySelector("#randomButton");
const favoritesButton = document.querySelector("#favoritesButton");
const fightButton = document.querySelector("#fightButton");
const compareGrid = document.querySelector("#compareGrid");
const dailyPigeon = document.querySelector("#dailyPigeon");
const dailyHistoryEl = document.querySelector("#dailyHistory");
const battleSlots = document.querySelector("#battleSlots");
const battleStage = document.querySelector("#battleStage");
const battleHistoryEl = document.querySelector("#battleHistory");

let breeds = [];
let favorites = new Set(JSON.parse(localStorage.getItem(favoritesKey) || "[]"));
let compareIds = [];
let battleIds = [];
let showFavoritesOnly = false;
let lastRandomId = "";
let isBattling = false;
let battleHasResult = false;

function apiUrl(base, params) {
  const url = new URL(base);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return url;
}

async function fetchJson(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
  }

  return response.json();
}

function setStatus(message) {
  statusEl.textContent = message;
}

function normalizeTitle(title) {
  return title.replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

function titleToId(title) {
  return normalizeTitle(title).toLowerCase();
}

function extractTitlesFromList(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const content = doc.querySelector(".mw-parser-output");
  const ignored = new Set([
    "Columba livia",
    "Domestic pigeon",
    "Fancy pigeon",
    "Rock dove",
    "Pigeon keeping",
    "Pigeon racing",
    "List of pigeon breeds"
  ]);

  return [...content.querySelectorAll("li a[href^='/wiki/']")]
    .map((link) => link.getAttribute("title") || normalizeTitle(link.textContent))
    .filter(Boolean)
    .map(normalizeTitle)
    .filter((title) => !ignored.has(title))
    .filter((title) => !title.includes(":"))
    .filter((title, index, list) => list.indexOf(title) === index)
    .slice(0, MAX_INITIAL_BREEDS);
}

async function fetchBreedTitles() {
  const data = await fetchJson(
    apiUrl(WIKI_API, {
      action: "parse",
      page: LIST_PAGE,
      prop: "text",
      format: "json",
      origin: "*"
    })
  );

  return extractTitlesFromList(data.parse.text["*"]);
}

function chunks(items, size) {
  const grouped = [];

  for (let index = 0; index < items.length; index += size) {
    grouped.push(items.slice(index, index + size));
  }

  return grouped;
}

async function fetchWikipediaPages(titles) {
  const pages = [];

  for (const titleBatch of chunks(titles, PAGE_BATCH_SIZE)) {
    const data = await fetchJson(
      apiUrl(WIKI_API, {
        action: "query",
        prop: "extracts|pageimages|pageprops|info",
        exintro: "1",
        explaintext: "1",
        redirects: "1",
        inprop: "url",
        piprop: "thumbnail|original",
        pithumbsize: "720",
        titles: titleBatch.join("|"),
        format: "json",
        origin: "*"
      })
    );

    pages.push(
      ...Object.values(data.query.pages)
        .filter((page) => !page.missing)
        .map((page) => ({
          pageId: page.pageid,
          title: page.title,
          extract: page.extract || "",
          sourceUrl: page.fullurl,
          thumbnail: page.thumbnail?.source || page.original?.source || "",
          wikidataId: page.pageprops?.wikibase_item || ""
        }))
    );
  }

  return pages;
}

async function fetchWikidataDetails(ids) {
  const details = new Map();
  const uniqueIds = [...new Set(ids.filter(Boolean))];

  if (!uniqueIds.length) return details;

  for (const idBatch of chunks(uniqueIds, 50)) {
    const data = await fetchJson(
      apiUrl(WIKIDATA_API, {
        action: "wbgetentities",
        ids: idBatch.join("|"),
        props: "claims|labels",
        languages: "en",
        format: "json",
        origin: "*"
      })
    );

    Object.entries(data.entities).forEach(([id, entity]) => {
      details.set(id, {
        originIds: readClaimIds(entity.claims?.P495 || entity.claims?.P17),
        imageName: readCommonsFile(entity.claims?.P18)
      });
    });
  }

  return details;
}

async function fetchLabels(ids) {
  const labels = new Map();
  const uniqueIds = [...new Set(ids.filter(Boolean))];

  if (!uniqueIds.length) return labels;

  for (const idBatch of chunks(uniqueIds, 50)) {
    const data = await fetchJson(
      apiUrl(WIKIDATA_API, {
        action: "wbgetentities",
        ids: idBatch.join("|"),
        props: "labels",
        languages: "en",
        format: "json",
        origin: "*"
      })
    );

    Object.entries(data.entities).forEach(([id, entity]) => {
      labels.set(id, entity.labels?.en?.value || id);
    });
  }

  return labels;
}

function readClaimIds(claims = []) {
  return claims
    .map((claim) => claim.mainsnak?.datavalue?.value?.id)
    .filter(Boolean);
}

function readCommonsFile(claims = []) {
  return claims[0]?.mainsnak?.datavalue?.value || "";
}

function inferOriginFromText(text) {
  const patterns = [
    /\b(?:originated|developed|created|bred|comes|came)\s+(?:in|from)\s+([A-Z][A-Za-z .'-]+?)(?:,|\.|;|\s+during|\s+in\s+the|\s+and\b)/,
    /\b(?:from|of)\s+([A-Z][A-Za-z .'-]+?)(?:,|\.|;|\s+and\b)/
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);

    if (match?.[1] && match[1].length < 36) {
      return match[1].replace(/\bthe\b/gi, "").trim();
    }
  }

  return "";
}

function inferSize(text) {
  const lower = text.toLowerCase();

  if (/\b(giant|large|heavy|runt|king pigeon|mondain|strasser)\b/.test(lower)) return "Large";
  if (/\b(small|short-faced|pigmy|figurita|owl|mövchen|movchen|frill)\b/.test(lower)) return "Small";
  if (/\b(medium|homer|racer|carrier|dragoon|trumpeter|pouter|cropper)\b/.test(lower)) return "Medium";
  return MISSING_SOURCE;
}

function inferFlight(text) {
  const lower = text.toLowerCase();

  if (/\b(highflyer|highflier|tippler|racing|racer|homer|flight)\b/.test(lower)) {
    return "Strong flyer";
  }

  if (/\b(tumbler|roller|performing)\b/.test(lower)) {
    return "Acrobatic flyer";
  }

  if (/\b(show|fancy|pouter|cropper|fantail|king|runt)\b/.test(lower)) {
    return "Mostly show/fancy";
  }

  return MISSING_SOURCE;
}

function inferTemperament(text) {
  const lower = text.toLowerCase();

  if (/\b(gentle|docile|calm|friendly|quiet)\b/.test(lower)) return "Calm";
  if (/\b(active|alert|energetic|performing|flying|racing|tumbler|roller)\b/.test(lower)) return "Active";
  if (/\b(show|fancy|exhibition|ornamental)\b/.test(lower)) return "Kept for exhibition";
  return MISSING_SOURCE;
}

function extractFact(extract) {
  const sentences = extract
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean);

  return sentences.slice(0, 2).join(" ") || "No summary fact listed by the API.";
}

function imageFor(page, wdDetail) {
  if (page.thumbnail) return page.thumbnail;
  if (wdDetail?.imageName) return `${COMMONS_FILE}${encodeURIComponent(wdDetail.imageName)}?width=720`;
  return FALLBACK_IMAGE;
}

async function findCommonsImage(title) {
  const queries = [
    `${title} pigeon`,
    `"${title}"`,
    `${title} breed`
  ];

  for (const query of queries) {
    const image = await findCommonsImageByQuery(title, query);

    if (image) return image;
  }

  return "";
}

async function findWikipediaSearchImage(title) {
  try {
    const data = await fetchJson(
      apiUrl(WIKI_API, {
        action: "query",
        generator: "search",
        gsrsearch: `${title} pigeon`,
        gsrlimit: "1",
        prop: "pageimages",
        piprop: "thumbnail|original",
        pithumbsize: "720",
        format: "json",
        origin: "*"
      })
    );
    const page = Object.values(data.query?.pages || {})[0];

    return page?.thumbnail?.source || page?.original?.source || "";
  } catch (error) {
    console.warn(`Could not find Wikipedia search image for ${title}`, error);
    return "";
  }
}

async function findCommonsImageByQuery(title, query) {
  try {
    const data = await fetchJson(
      apiUrl(COMMONS_API, {
        action: "query",
        generator: "search",
        gsrsearch: query,
        gsrnamespace: "6",
        gsrlimit: "1",
        prop: "imageinfo",
        iiprop: "url",
        iiurlwidth: "720",
        format: "json",
        origin: "*"
      })
    );
    const page = Object.values(data.query?.pages || {})[0];

    return page?.imageinfo?.[0]?.thumburl || page?.imageinfo?.[0]?.url || "";
  } catch (error) {
    console.warn(`Could not find Commons image for ${title} with ${query}`, error);
    return "";
  }
}

async function searchWikidataEntity(title) {
  try {
    const data = await fetchJson(
      apiUrl(WIKIDATA_API, {
        action: "wbsearchentities",
        search: title,
        language: "en",
        limit: "1",
        format: "json",
        origin: "*"
      })
    );

    return data.search?.[0]?.id || "";
  } catch (error) {
    console.warn(`Could not search Wikidata for ${title}`, error);
    return "";
  }
}

async function mapLimit(items, limit, worker) {
  const results = [];
  let nextIndex = 0;

  async function runNext() {
    const index = nextIndex;
    nextIndex += 1;

    if (index >= items.length) return;

    results[index] = await worker(items[index], index);
    await runNext();
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runNext));
  return results;
}

async function enrichMissingData() {
  const missingOrigin = breeds.filter((breed) => breed.origin === MISSING_SOURCE);
  const missingImages = breeds.filter((breed) => breed.image === FALLBACK_IMAGE);

  if (!missingOrigin.length && !missingImages.length) return;

  setStatus(`Searching public APIs for ${missingOrigin.length} missing origins and ${missingImages.length} missing images...`);

  const entityMatches = await mapLimit(missingOrigin, 8, async (breed) => ({
    breed,
    entityId: await searchWikidataEntity(breed.name)
  }));
  const details = await fetchWikidataDetails(entityMatches.map((match) => match.entityId));
  const originIds = [...details.values()].flatMap((detail) => detail.originIds);
  const labels = await fetchLabels(originIds);

  entityMatches.forEach(({ breed, entityId }) => {
    const origin = (details.get(entityId)?.originIds || [])
      .map((id) => labels.get(id))
      .filter(Boolean)
      .join(", ");

    if (origin) breed.origin = origin;
  });

  await mapLimit(missingImages, 8, async (breed) => {
    const image = await findWikipediaSearchImage(breed.name) || await findCommonsImage(breed.name);

    if (image) breed.image = image;
  });
}

function countMissing() {
  return breeds.reduce(
    (counts, breed) => {
      ["origin", "size", "flight", "temperament"].forEach((key) => {
        if (breed[key] === MISSING_SOURCE) counts.fields += 1;
      });
      if (breed.image === FALLBACK_IMAGE) counts.images += 1;
      return counts;
    },
    { fields: 0, images: 0 }
  );
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function seededIndex(seed, max) {
  let hash = 2166136261;

  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return Math.abs(hash) % max;
}

function dailyBreed() {
  if (!breeds.length) return null;

  return breeds[seededIndex(todayKey(), breeds.length)];
}

function loadHistory(key) {
  return JSON.parse(localStorage.getItem(key) || "[]");
}

function saveHistory(key, entries, limit = 8) {
  localStorage.setItem(key, JSON.stringify(entries.slice(0, limit)));
}

function updateDailyHistory(breed) {
  if (!breed) return;

  const history = loadHistory(dailyHistoryKey);
  const entry = {
    date: todayKey(),
    id: breed.id,
    name: breed.name
  };
  const next = [entry, ...history.filter((item) => item.date !== entry.date)];
  saveHistory(dailyHistoryKey, next, 10);
}

function rarityFor(breed) {
  const text = `${breed.name} ${breed.fact}`.toLowerCase();

  if (/\b(rare|endangered|old|ancient|historic)\b/.test(text)) return "Rare";
  if (/\b(common|popular|widespread)\b/.test(text)) return "Common";
  if (breed.origin === MISSING_SOURCE || breed.image === FALLBACK_IMAGE) return "Hard to document";
  return "Specialist breed";
}

function beautyScore(breed) {
  const text = `${breed.name} ${breed.fact}`.toLowerCase();
  let score = 55;

  if (/\b(fantail|frill|owl|shield|lace|trumpeter|jacobin|pouter|cropper)\b/.test(text)) score += 22;
  if (/\b(show|fancy|exhibition|ornamental)\b/.test(text)) score += 15;
  if (breed.image !== FALLBACK_IMAGE) score += 8;
  return clampScore(score + seededIndex(`${breed.id}:beauty`, 13));
}

function flightScore(breed) {
  const value = breed.flight;
  let score = 42;

  if (value === "Strong flyer") score = 88;
  if (value === "Acrobatic flyer") score = 82;
  if (value === "Mostly show/fancy") score = 48;
  if (value === MISSING_SOURCE) score = 56;
  return clampScore(score + seededIndex(`${breed.id}:flight`, 11) - 5);
}

function weightScore(breed) {
  if (breed.size === "Large") return 86 + seededIndex(`${breed.id}:weight`, 8);
  if (breed.size === "Medium") return 66 + seededIndex(`${breed.id}:weight`, 10);
  if (breed.size === "Small") return 42 + seededIndex(`${breed.id}:weight`, 10);
  return 58 + seededIndex(`${breed.id}:weight`, 12);
}

function rarityScore(breed) {
  const rarity = rarityFor(breed);

  if (rarity === "Rare") return 92;
  if (rarity === "Hard to document") return 78;
  if (rarity === "Specialist breed") return 68;
  return 45;
}

function clampScore(value) {
  return Math.max(1, Math.min(99, value));
}

function battleStats(breed) {
  return {
    weight: weightScore(breed),
    flight: flightScore(breed),
    beauty: beautyScore(breed),
    rarity: rarityScore(breed)
  };
}

function battleTotal(stats) {
  return stats.weight * 0.22 + stats.flight * 0.28 + stats.beauty * 0.28 + stats.rarity * 0.22;
}

function battleReason(winner, loser, stats) {
  const best = Object.entries(stats).sort((a, b) => b[1] - a[1])[0][0];
  const labels = {
    weight: "body power",
    flight: "air control",
    beauty: "runway confidence",
    rarity: "mysterious aura"
  };

  return `${winner.name} wins with superior ${labels[best]} against ${loser.name}.`;
}

async function loadBreeds() {
  try {
    const titles = await fetchBreedTitles();
    setStatus(`Found ${titles.length} breed links. Loading API details...`);

    const pages = await fetchWikipediaPages(titles);
    const wdDetails = await fetchWikidataDetails(pages.map((page) => page.wikidataId));
    const allOriginIds = [...wdDetails.values()].flatMap((detail) => detail.originIds);
    const originLabels = await fetchLabels(allOriginIds);

    breeds = pages
      .map((page) => {
        const wdDetail = wdDetails.get(page.wikidataId);
        const origin = wdDetail?.originIds?.map((id) => originLabels.get(id)).filter(Boolean).join(", ");
        const text = `${page.title}. ${page.extract}`;

        return {
          id: titleToId(page.title),
          name: page.title,
          origin: origin || inferOriginFromText(text) || MISSING_SOURCE,
          size: inferSize(text),
          flight: inferFlight(text),
          temperament: inferTemperament(text),
          fact: extractFact(page.extract),
          image: imageFor(page, wdDetail),
          sourceUrl: page.sourceUrl,
          wikidataId: page.wikidataId
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    render();
    renderDaily();
    renderBattle();
    enrichMissingData()
      .then(() => {
        render();
        renderDaily();
        renderBattle();
      })
      .catch((error) => {
        console.warn("Some extra PigeonDex enrichment calls failed.", error);
        render();
      });
  } catch (error) {
    console.error(error);
    setStatus("Could not load the live pigeon APIs. Try refreshing the page.");
  }
}

function visibleBreeds() {
  const query = searchInput.value.trim().toLowerCase();

  return breeds.filter((breed) => {
    const matchesSearch = [breed.name, breed.origin, breed.size, breed.flight, breed.temperament, breed.fact]
      .join(" ")
      .toLowerCase()
      .includes(query);
    const matchesFavorite = !showFavoritesOnly || favorites.has(breed.id);
    return matchesSearch && matchesFavorite;
  });
}

function render() {
  const visible = visibleBreeds();
  const missing = countMissing();
  breedGrid.innerHTML = visible.map(renderCard).join("");
  setStatus(
    visible.length
      ? `Showing ${visible.length} of ${breeds.length} live API breeds. Extra searches tried for ${missing.fields} unavailable fields and ${missing.images} images.`
      : "No breeds match that search."
  );
  renderCompare();
  renderBattle();
}

function renderCard(breed) {
  const isFavorite = favorites.has(breed.id);
  const isCompared = compareIds.includes(breed.id);

  return `
    <article class="breed-card">
      <img class="breed-image" src="${escapeHtml(breed.image)}" alt="${escapeHtml(breed.name)}" loading="lazy">
      <div class="breed-body">
        <div class="breed-title">
          <h2>${escapeHtml(breed.name)}</h2>
          <button class="icon-button ${isFavorite ? "is-active" : ""}" type="button" data-favorite="${escapeHtml(breed.id)}" aria-label="Favorite ${escapeHtml(breed.name)}">&#9733;</button>
        </div>
        <div class="facts">
          ${renderFact("Origin", breed.origin)}
          ${renderFact("Size", breed.size)}
          ${renderFact("Flight", breed.flight)}
          ${renderFact("Temperament", breed.temperament)}
        </div>
        <p class="summary">${escapeHtml(breed.fact)}</p>
        <div class="card-actions">
          <button type="button" data-compare="${escapeHtml(breed.id)}">${isCompared ? "Remove compare" : "Compare"}</button>
          <button type="button" data-battle="${escapeHtml(breed.id)}">${battleIds.includes(breed.id) ? "Ready" : "Prepare for battle"}</button>
          <a class="source-link" href="${escapeHtml(breed.sourceUrl)}" target="_blank" rel="noreferrer">Source</a>
        </div>
      </div>
    </article>
  `;
}

function renderFact(label, value) {
  return `
    <div class="fact">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(displayValue(label, value))}</strong>
    </div>
  `;
}

function displayValue(label, value) {
  if (value !== MISSING_SOURCE) return value;

  if (label === "Origin") return "No verified origin found";
  if (label === "Size") return "Breed standard varies";
  if (label === "Flight") return "Varies by strain";
  if (label === "Temperament") return "Varies by strain";
  return "No verified result found";
}

function renderCompare() {
  const selected = compareIds.map((id) => breeds.find((breed) => breed.id === id)).filter(Boolean);

  if (!selected.length) {
    compareGrid.innerHTML = '<p class="empty">No breeds selected yet.</p>';
    return;
  }

  compareGrid.innerHTML = selected.map((breed) => `
    <article class="compare-item">
      <img class="compare-image" src="${escapeHtml(breed.image)}" alt="${escapeHtml(breed.name)}">
      <h3>${escapeHtml(breed.name)}</h3>
      <dl>
        <dt>Origin</dt><dd>${escapeHtml(displayValue("Origin", breed.origin))}</dd>
        <dt>Size</dt><dd>${escapeHtml(displayValue("Size", breed.size))}</dd>
        <dt>Flight</dt><dd>${escapeHtml(displayValue("Flight", breed.flight))}</dd>
        <dt>Temperament</dt><dd>${escapeHtml(displayValue("Temperament", breed.temperament))}</dd>
      </dl>
    </article>
  `).join("");
}

function renderDaily() {
  const breed = dailyBreed();

  if (!breed) return;

  updateDailyHistory(breed);
  dailyPigeon.innerHTML = `
    <img src="${escapeHtml(breed.image)}" alt="${escapeHtml(breed.name)}">
    <div>
      <h3>Today's pigeon: ${escapeHtml(breed.name)}</h3>
      <dl class="daily-meta">
        <div><dt>History</dt><dd>${escapeHtml(breed.fact)}</dd></div>
        <div><dt>Fun fact</dt><dd>${escapeHtml(displayValue("Flight", breed.flight))} with ${escapeHtml(displayValue("Temperament", breed.temperament).toLowerCase())} energy.</dd></div>
        <div><dt>Breed rarity</dt><dd>${escapeHtml(rarityFor(breed))}</dd></div>
      </dl>
    </div>
  `;
  renderDailyHistory();
}

function renderDailyHistory() {
  const history = loadHistory(dailyHistoryKey);
  dailyHistoryEl.innerHTML = history.length
    ? history.map((item) => `<li>${escapeHtml(item.date)}: ${escapeHtml(item.name)}</li>`).join("")
    : '<li class="empty">No previous daily pigeons yet.</li>';
}

function renderBattle() {
  const selected = battleIds.map((id) => breeds.find((breed) => breed.id === id)).filter(Boolean);

  fightButton.disabled = selected.length !== 2 || isBattling;
  battleSlots.innerHTML = [0, 1].map((index) => {
    const breed = selected[index];

    if (!breed) {
      return `<div class="battle-slot"><p class="empty">Battle slot ${index + 1}</p></div>`;
    }

    return `
      <div class="battle-slot">
        <strong>${escapeHtml(breed.name)}</strong>
        <p>${escapeHtml(displayValue("Flight", breed.flight))} / ${escapeHtml(rarityFor(breed))}</p>
      </div>
    `;
  }).join("");

  if (!selected.length && !isBattling && !battleHasResult) {
    battleStage.innerHTML = '<p class="empty">No battle prepared yet.</p>';
  }

  renderBattleHistory();
}

function renderBattleHistory() {
  const history = loadHistory(battleHistoryKey);
  battleHistoryEl.innerHTML = history.length
    ? history.map((item) => `<li>${escapeHtml(item.date)}: ${escapeHtml(item.left)} vs ${escapeHtml(item.right)} - ${escapeHtml(item.winner)} won</li>`).join("")
    : '<li class="empty">No battles yet.</li>';
}

function renderBattleCard(breed) {
  const stats = battleStats(breed);

  return `
    <article class="battle-card">
      <img src="${escapeHtml(breed.image)}" alt="${escapeHtml(breed.name)}">
      <h3>${escapeHtml(breed.name)}</h3>
      <dl class="battle-stats">
        <div><dt>Weight</dt><dd>${stats.weight}</dd></div>
        <div><dt>Flight</dt><dd>${stats.flight}</dd></div>
        <div><dt>Beauty</dt><dd>${stats.beauty}</dd></div>
        <div><dt>Rarity</dt><dd>${stats.rarity}</dd></div>
      </dl>
    </article>
  `;
}

function renderDustCloud() {
  return `
    <div class="dust-cloud" aria-label="Battle dust cloud">
      <span></span><span></span><span></span><span></span>
    </div>
  `;
}

function renderWinner(winner, loser, stats) {
  return `
    <article class="winner-card">
      <img src="${escapeHtml(winner.image)}" alt="${escapeHtml(winner.name)}">
      <h3>${escapeHtml(winner.name)} wins</h3>
      <p>${escapeHtml(battleReason(winner, loser, stats))}</p>
      <dl class="battle-stats">
        <div><dt>Weight</dt><dd>${stats.weight}</dd></div>
        <div><dt>Flight</dt><dd>${stats.flight}</dd></div>
        <div><dt>Beauty</dt><dd>${stats.beauty}</dd></div>
        <div><dt>Rarity</dt><dd>${stats.rarity}</dd></div>
      </dl>
    </article>
  `;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function toggleFavorite(id) {
  if (favorites.has(id)) {
    favorites.delete(id);
  } else {
    favorites.add(id);
  }

  localStorage.setItem(favoritesKey, JSON.stringify([...favorites]));
  render();
}

function toggleCompare(id) {
  if (compareIds.includes(id)) {
    compareIds = compareIds.filter((breedId) => breedId !== id);
  } else {
    compareIds = [...compareIds, id].slice(-2);
  }

  render();
}

function toggleBattle(id) {
  if (battleIds.includes(id)) {
    battleIds = battleIds.filter((breedId) => breedId !== id);
  } else {
    battleIds = [...battleIds, id].slice(-2);
  }

  battleHasResult = false;
  scrollToTop();
  render();
}

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function selectDifferentRandom() {
  const pool = breeds.filter((breed) => breed.id !== lastRandomId);

  if (!pool.length) return null;

  const breed = pool[Math.floor(Math.random() * pool.length)];
  lastRandomId = breed.id;
  return breed;
}

function recordBattle(left, right, winner) {
  const history = loadHistory(battleHistoryKey);
  const entry = {
    date: new Date().toLocaleString(),
    left: left.name,
    right: right.name,
    winner: winner.name
  };

  saveHistory(battleHistoryKey, [entry, ...history], 10);
}

function fightBattle() {
  if (isBattling || battleIds.length !== 2) return;

  const fighters = battleIds.map((id) => breeds.find((breed) => breed.id === id)).filter(Boolean);

  if (fighters.length !== 2) return;

  const [left, right] = fighters;
  const leftStats = battleStats(left);
  const rightStats = battleStats(right);
  const leftTotal = battleTotal(leftStats);
  const rightTotal = battleTotal(rightStats);
  const winner = leftTotal >= rightTotal ? left : right;
  const loser = winner === left ? right : left;
  const winnerStats = winner === left ? leftStats : rightStats;

  isBattling = true;
  battleHasResult = false;
  scrollToTop();
  fightButton.disabled = true;
  battleStage.classList.add("is-fighting");
  battleStage.innerHTML = `
    <div class="battle-matchup">
      ${renderBattleCard(left)}
      <div class="versus">${renderDustCloud()}</div>
      ${renderBattleCard(right)}
    </div>
  `;

  window.setTimeout(() => {
    battleStage.classList.remove("is-fighting");
    battleStage.innerHTML = renderWinner(winner, loser, winnerStats);
    recordBattle(left, right, winner);
    isBattling = false;
    battleHasResult = true;
    renderBattle();
  }, 5000);
}

breedGrid.addEventListener("click", (event) => {
  const favoriteButton = event.target.closest("[data-favorite]");
  const compareButton = event.target.closest("[data-compare]");
  const battleButton = event.target.closest("[data-battle]");

  if (favoriteButton) toggleFavorite(favoriteButton.dataset.favorite);
  if (compareButton) toggleCompare(compareButton.dataset.compare);
  if (battleButton) toggleBattle(battleButton.dataset.battle);
});

searchInput.addEventListener("input", render);

favoritesButton.addEventListener("click", () => {
  scrollToTop();
  showFavoritesOnly = !showFavoritesOnly;
  favoritesButton.setAttribute("aria-pressed", String(showFavoritesOnly));
  render();
});

fightButton.addEventListener("click", fightBattle);

randomButton.addEventListener("click", () => {
  scrollToTop();
  const breed = selectDifferentRandom();

  if (!breed) return;

  searchInput.value = breed.name;
  showFavoritesOnly = false;
  favoritesButton.setAttribute("aria-pressed", "false");
  render();
  document.querySelector(`[data-compare="${CSS.escape(breed.id)}"]`)?.scrollIntoView({
    behavior: "smooth",
    block: "center"
  });
});

loadBreeds();
