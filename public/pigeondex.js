const WIKI_API = "https://en.wikipedia.org/w/api.php";
const WIKIDATA_API = "https://www.wikidata.org/w/api.php";
const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
const BREED_CACHE_API = "/api/breeds";
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
const originFilter = document.querySelector("#originFilter");
const sizeFilter = document.querySelector("#sizeFilter");
const temperamentFilter = document.querySelector("#temperamentFilter");
const flightFilter = document.querySelector("#flightFilter");
const randomButton = document.querySelector("#randomButton");
const favoritesButton = document.querySelector("#favoritesButton");
const clearFiltersButton = document.querySelector("#clearFiltersButton");
const fightButton = document.querySelector("#fightButton");
const compareGrid = document.querySelector("#compareGrid");
const dailyPigeon = document.querySelector("#dailyPigeon");
const dailyHistoryEl = document.querySelector("#dailyHistory");
const battleSlots = document.querySelector("#battleSlots");
const battleStage = document.querySelector("#battleStage");
const battleHistoryEl = document.querySelector("#battleHistory");
const rateUpload = document.querySelector("#rateUpload");
const rateResult = document.querySelector("#rateResult");
const detailPanel = document.querySelector("#detailPanel");
const battleCommentary = document.querySelector("#battleCommentary");

let breeds = [];
let favorites = new Set(JSON.parse(localStorage.getItem(favoritesKey) || "[]"));
let expandedCardIds = new Set();
let compareIds = [];
let battleIds = [];
let showFavoritesOnly = false;
let lastRandomId = "";
let isBattling = false;
let battleHasResult = false;
let selectedDetailId = new URLSearchParams(window.location.search).get("breed") || "";
let battleTimers = [];
let audioContext = null;

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

async function fetchCachedBreeds() {
  const data = await fetchJson(BREED_CACHE_API);

  if (!Array.isArray(data.breeds)) {
    throw new Error("Cached breed response was invalid.");
  }

  return data.breeds;
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

function hasSpecificImage(breed) {
  return breed.image && breed.image !== FALLBACK_IMAGE;
}

function photoBreeds() {
  return breeds.filter(hasSpecificImage);
}

function originValues(origin) {
  if (!origin || origin === MISSING_SOURCE) return [];

  return String(origin)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function uniqueSorted(values) {
  return [...new Set(values.filter((value) => value && value !== MISSING_SOURCE))]
    .sort((left, right) => left.localeCompare(right));
}

function optionHtml(value, selectedValue) {
  return `<option value="${escapeHtml(value)}" ${value === selectedValue ? "selected" : ""}>${escapeHtml(value)}</option>`;
}

function populateFilter(select, values, allLabel) {
  const previousValue = select.value;
  const options = uniqueSorted(values);
  const nextValue = options.includes(previousValue) ? previousValue : "";

  select.innerHTML = [
    `<option value="">${escapeHtml(allLabel)}</option>`,
    ...options.map((value) => optionHtml(value, nextValue))
  ].join("");
  select.value = nextValue;
}

function populateFilters() {
  const pool = photoBreeds();

  populateFilter(originFilter, pool.flatMap((breed) => originValues(breed.origin)), "All origins");
  populateFilter(sizeFilter, pool.map((breed) => breed.size), "All sizes");
  populateFilter(temperamentFilter, pool.map((breed) => breed.temperament), "All temperaments");
  populateFilter(flightFilter, pool.map((breed) => breed.flight), "All flight types");
}

function currentFilters() {
  return {
    origin: originFilter.value,
    size: sizeFilter.value,
    temperament: temperamentFilter.value,
    flight: flightFilter.value
  };
}

function resetListFilters({ includeSearch = true, includeFavorites = true } = {}) {
  if (includeSearch) searchInput.value = "";

  originFilter.value = "";
  sizeFilter.value = "";
  temperamentFilter.value = "";
  flightFilter.value = "";

  if (includeFavorites) {
    showFavoritesOnly = false;
    favoritesButton.setAttribute("aria-pressed", "false");
  }
}

function sortBreeds() {
  breeds.sort((a, b) => {
    const imageDifference = Number(hasSpecificImage(b)) - Number(hasSpecificImage(a));

    if (imageDifference) return imageDifference;

    return a.name.localeCompare(b.name);
  });
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
  const pool = photoBreeds();

  if (!pool.length) return null;

  return pool[seededIndex(todayKey(), pool.length)];
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

function battleMoveNames(breed) {
  const seed = seededIndex(`${breed.id}:moves`, 99);
  const starters = [
    "Crumb Cyclone",
    "Pavement Pirouette",
    "Sidewalk Shoulder Check",
    "Bread Loaf Feint",
    "Fancy Feather Flash",
    "Municipal Head Bob",
    "Emergency Wing Wiggle",
    "Tiny Street Thunder"
  ];
  const finishers = [
    "Final Peck Protocol",
    "Golden Crumb Uppercut",
    "Royal Strut Slam",
    "Forbidden Balcony Dive",
    "Exhibition Hall Shockwave",
    "Lunch Table Judgment"
  ];

  return [
    starters[seed % starters.length],
    finishers[(seed + breed.name.length) % finishers.length]
  ];
}

function battleCommentaryLines(left, right, winner) {
  const leftMoves = battleMoveNames(left);
  const rightMoves = battleMoveNames(right);

  return [
    `${left.name} opens with ${leftMoves[0]}.`,
    `${right.name} counters using ${rightMoves[0]}.`,
    `The arena briefly becomes 80% feathers and 20% legal confusion.`,
    `${winner.name} lands ${battleMoveNames(winner)[1]}.`
  ];
}

function clearBattleTimers() {
  battleTimers.forEach((timer) => window.clearTimeout(timer));
  battleTimers = [];
}

function playBattleSound(kind = "tap") {
  try {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const now = audioContext.currentTime;

    oscillator.type = kind === "win" ? "triangle" : "square";
    oscillator.frequency.setValueAtTime(kind === "win" ? 660 : 180 + Math.random() * 160, now);
    oscillator.frequency.exponentialRampToValueAtTime(kind === "win" ? 980 : 90, now + 0.16);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(kind === "win" ? 0.08 : 0.035, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.2);
  } catch (error) {
    console.warn("Battle sound could not play.", error);
  }
}

async function loadBreeds() {
  try {
    try {
      breeds = await fetchCachedBreeds();
      sortBreeds();
      populateFilters();
      setStatus(`Loaded ${breeds.length} pigeon breeds from the Vercel API cache.`);
      render();
      renderDaily();
      renderBattle();
      renderDetail();
      return;
    } catch (cacheError) {
      console.warn("Falling back to direct Wikimedia APIs.", cacheError);
      setStatus("Cache is warming up. Loading directly from live APIs...");
    }

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
    sortBreeds();
    populateFilters();

    render();
    renderDaily();
    renderBattle();
    renderDetail();
    enrichMissingData()
      .then(() => {
        sortBreeds();
        populateFilters();
        render();
        renderDaily();
        renderBattle();
        renderDetail();
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
  const filters = currentFilters();

  return photoBreeds().filter((breed) => {
    const matchesSearch = [breed.name, breed.origin, breed.size, breed.flight, breed.temperament, breed.fact]
      .join(" ")
      .toLowerCase()
      .includes(query);
    const matchesOrigin = !filters.origin || originValues(breed.origin).includes(filters.origin);
    const matchesSize = !filters.size || breed.size === filters.size;
    const matchesTemperament = !filters.temperament || breed.temperament === filters.temperament;
    const matchesFlight = !filters.flight || breed.flight === filters.flight;
    const matchesFavorite = !showFavoritesOnly || favorites.has(breed.id);

    return matchesSearch && matchesOrigin && matchesSize && matchesTemperament && matchesFlight && matchesFavorite;
  });
}

function render() {
  const visible = visibleBreeds();
  const missing = countMissing();
  const hiddenWithoutPhotos = breeds.length - photoBreeds().length;
  const sortedVisible = [...visible].sort((a, b) => {
    return a.name.localeCompare(b.name);
  });
  breedGrid.innerHTML = sortedVisible.map(renderCard).join("");
  setStatus(
    visible.length
      ? `Showing ${visible.length} photographed breeds. ${hiddenWithoutPhotos} breeds without photos are hidden. Extra searches tried for ${missing.fields} unavailable fields and ${missing.images} images.`
      : `No photographed breeds match that search. ${hiddenWithoutPhotos} breeds without photos are hidden.`
  );
  renderCompare();
  renderBattle();
  renderDetail();
}

function renderCard(breed) {
  const isFavorite = favorites.has(breed.id);
  const isCompared = compareIds.includes(breed.id);
  const isExpanded = expandedCardIds.has(breed.id);
  const hasLongSummary = breed.fact.length > 165;

  return `
    <article class="breed-card ${isExpanded ? "is-expanded" : ""}">
      <button class="image-button" type="button" data-detail="${escapeHtml(breed.id)}" aria-label="Open ${escapeHtml(breed.name)} details">
        <img class="breed-image" src="${escapeHtml(breed.image)}" alt="${escapeHtml(breed.name)}" loading="lazy">
      </button>
      <div class="breed-body">
        <div class="breed-title">
          <h2><button class="title-button" type="button" data-detail="${escapeHtml(breed.id)}">${escapeHtml(breed.name)}</button></h2>
          <button class="icon-button ${isFavorite ? "is-active" : ""}" type="button" data-favorite="${escapeHtml(breed.id)}" aria-label="Favorite ${escapeHtml(breed.name)}">&#9733;</button>
        </div>
        <div class="facts">
          ${renderFact("Origin", breed.origin)}
          ${renderFact("Size", breed.size)}
          ${renderFact("Flight", breed.flight)}
          ${renderFact("Temperament", breed.temperament)}
        </div>
        <div class="summary-wrap">
          <p class="summary ${hasLongSummary && !isExpanded ? "is-clamped" : ""}">${escapeHtml(breed.fact)}</p>
          ${hasLongSummary ? `<button class="summary-toggle" type="button" data-more="${escapeHtml(breed.id)}" aria-expanded="${isExpanded}">${isExpanded ? "Less" : "More"}</button>` : ""}
        </div>
        <div class="card-actions">
          <button type="button" data-compare="${escapeHtml(breed.id)}">${isCompared ? "Remove compare" : "Compare"}</button>
          <button type="button" data-battle="${escapeHtml(breed.id)}">${battleIds.includes(breed.id) ? "Ready" : "Prepare for battle"}</button>
          <button type="button" data-detail="${escapeHtml(breed.id)}">Details</button>
          <a class="source-link" href="${escapeHtml(breed.sourceUrl)}" target="_blank" rel="noreferrer">Source</a>
        </div>
      </div>
    </article>
  `;
}

function detailTraits(breed) {
  return [
    displayValue("Origin", breed.origin),
    displayValue("Size", breed.size),
    displayValue("Flight", breed.flight),
    displayValue("Temperament", breed.temperament),
    rarityFor(breed)
  ].filter(Boolean);
}

function relatedBreeds(breed) {
  const traits = new Set(detailTraits(breed).map((trait) => trait.toLowerCase()));

  return breeds
    .filter((candidate) => candidate.id !== breed.id)
    .filter(hasSpecificImage)
    .map((candidate) => {
      const candidateTraits = detailTraits(candidate).map((trait) => trait.toLowerCase());
      const score = candidateTraits.filter((trait) => traits.has(trait)).length;
      return { candidate, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.candidate.name.localeCompare(right.candidate.name))
    .slice(0, 4)
    .map((entry) => entry.candidate);
}

function originMapUrl(breed) {
  const origin = displayValue("Origin", breed.origin);

  if (!origin || origin === "No verified origin found") return "";

  return `https://www.openstreetmap.org/search?query=${encodeURIComponent(origin)}`;
}

function openDetail(id, pushState = true) {
  selectedDetailId = id;

  if (pushState) {
    const url = new URL(window.location.href);
    url.searchParams.set("breed", id);
    window.history.pushState({ breed: id }, "", url);
  }

  renderDetail();
  detailPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeDetail(pushState = true) {
  selectedDetailId = "";

  if (pushState) {
    const url = new URL(window.location.href);
    url.searchParams.delete("breed");
    window.history.pushState({}, "", url);
  }

  renderDetail();
}

function renderDetail() {
  if (!selectedDetailId) {
    detailPanel.innerHTML = "";
    detailPanel.hidden = true;
    return;
  }

  const breed = breeds.find((item) => item.id === selectedDetailId);

  if (!breed || !hasSpecificImage(breed)) {
    detailPanel.innerHTML = "";
    detailPanel.hidden = true;
    return;
  }

  const related = relatedBreeds(breed);
  const mapUrl = originMapUrl(breed);

  detailPanel.hidden = false;
  detailPanel.innerHTML = `
    <article class="detail-card">
      <div class="detail-hero">
        <img src="${escapeHtml(breed.image)}" alt="${escapeHtml(breed.name)}">
        <div>
          <p class="section-kicker">Breed detail page</p>
          <h2>${escapeHtml(breed.name)}</h2>
          <p>${escapeHtml(breed.history || breed.fact)}</p>
          <div class="detail-actions">
            <button type="button" data-close-detail>Back to list</button>
            <a class="source-link" href="${escapeHtml(breed.sourceUrl)}" target="_blank" rel="noreferrer">Source</a>
          </div>
        </div>
      </div>
      <div class="detail-grid">
        <section>
          <h3>Traits</h3>
          <div class="facts detail-facts">
            ${renderFact("Origin", breed.origin)}
            ${renderFact("Size", breed.size)}
            ${renderFact("Flight", breed.flight)}
            ${renderFact("Temperament", breed.temperament)}
            ${renderFact("Rarity", rarityFor(breed))}
          </div>
        </section>
        <section>
          <h3>Origin map</h3>
          <div class="map-card">
            <span>${escapeHtml(displayValue("Origin", breed.origin))}</span>
            ${mapUrl ? `<a href="${escapeHtml(mapUrl)}" target="_blank" rel="noreferrer">Open map</a>` : "<p>No verified map location found.</p>"}
          </div>
        </section>
        <section class="related-section">
          <h3>Related breeds</h3>
          <div class="related-grid">
            ${related.length ? related.map((item) => `
              <button type="button" class="related-card" data-detail="${escapeHtml(item.id)}">
                <img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}">
                <span>${escapeHtml(item.name)}</span>
              </button>
            `).join("") : '<p class="empty">No close relatives found yet.</p>'}
          </div>
        </section>
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

function toggleCardSummary(id) {
  if (expandedCardIds.has(id)) {
    expandedCardIds.delete(id);
  } else {
    expandedCardIds.add(id);
  }

  render();
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
    ? history.map((item) => `
      <li class="battle-history-card">
        <strong>${escapeHtml(item.winner)} won</strong>
        <span>${escapeHtml(item.date)}: ${escapeHtml(item.left)} vs ${escapeHtml(item.right)}</span>
        ${item.move ? `<em>${escapeHtml(item.move)}</em>` : ""}
        ${item.reason ? `<p>${escapeHtml(item.reason)}</p>` : ""}
      </li>
    `).join("")
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
  render();
}

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function selectDifferentRandom() {
  const pool = photoBreeds().filter((breed) => breed.id !== lastRandomId);

  if (!pool.length) return null;

  const breed = pool[Math.floor(Math.random() * pool.length)];
  lastRandomId = breed.id;
  return breed;
}

function recordBattle(left, right, winner) {
  const history = loadHistory(battleHistoryKey);
  const loser = winner.id === left.id ? right : left;
  const move = battleMoveNames(winner)[1];
  const entry = {
    date: todayKey(),
    left: left.name,
    right: right.name,
    winner: winner.name,
    move,
    reason: battleReason(winner, loser, battleStats(winner))
  };

  saveHistory(battleHistoryKey, [entry, ...history], 10);
}

function seededNumber(text) {
  let seed = 0;

  for (let index = 0; index < text.length; index += 1) {
    seed = (seed * 31 + text.charCodeAt(index)) >>> 0;
  }

  return seed;
}

function seededPick(items, seed, offset = 0) {
  return items[(seed + offset) % items.length];
}

function handleRateUpload(event) {
  const [file] = event.target.files;

  if (!file) return;

  const seed = seededNumber(`${file.name}:${file.size}:${file.lastModified}`);
  const elegance = (5.6 + (seed % 43) / 10).toFixed(1);
  const threat = ((seed >> 5) % 31 / 10).toFixed(1);
  const looks = seededPick([
    "a Victorian gentleman",
    "a tiny mayor with excellent posture",
    "a retired opera critic",
    "a pastry inspector in disguise",
    "a sidewalk philosopher",
    "a royal messenger who lost the message"
  ], seed);
  const mood = seededPick([
    "deeply confident",
    "mildly suspicious of modern architecture",
    "ready to judge crumbs by texture",
    "dramatic but fair",
    "quietly powerful",
    "surprisingly diplomatic"
  ], seed, 7);
  const talent = seededPick([
    "finding the sunniest square of pavement",
    "entering every photo like it owns the museum",
    "turning one crumb into a public event",
    "staring into the middle distance with purpose",
    "making grey feathers look expensive",
    "walking away from nonsense with dignity"
  ], seed, 13);
  const previewUrl = URL.createObjectURL(file);

  rateResult.innerHTML = `
    <img class="rating-photo" src="${previewUrl}" alt="Uploaded pigeon photo">
    <div>
      <div class="rating-grid">
        <div class="rating-pill">
          <span>Elegance</span>
          <strong>${elegance}/10</strong>
        </div>
        <div class="rating-pill">
          <span>Threat level</span>
          <strong>${threat}/10</strong>
        </div>
        <div class="rating-pill">
          <span>Looks like</span>
          <strong>${looks}</strong>
        </div>
        <div class="rating-pill">
          <span>Report</span>
          <strong>GPT-style</strong>
        </div>
      </div>
      <p class="personality-report">
        Pigeon Personality Report: This pigeon appears ${mood}. Its strongest
        known talent is ${talent}. Recommended treatment: respectful eye contact,
        premium crumbs, and room to make one mysterious little turn.
      </p>
    </div>
  `;
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
  const commentaryLines = battleCommentaryLines(left, right, winner);

  clearBattleTimers();
  isBattling = true;
  battleHasResult = false;
  fightButton.disabled = true;
  battleCommentary.innerHTML = '<p>The referee finds a whistle. Nobody respects it.</p>';
  battleStage.classList.add("is-fighting");
  battleStage.innerHTML = `
    <div class="battle-matchup">
      ${renderBattleCard(left)}
      <div class="versus">${renderDustCloud()}</div>
      ${renderBattleCard(right)}
    </div>
  `;
  playBattleSound("tap");

  commentaryLines.forEach((line, index) => {
    battleTimers.push(window.setTimeout(() => {
      battleCommentary.innerHTML = `<p>${escapeHtml(line)}</p>`;
      playBattleSound(index === commentaryLines.length - 1 ? "win" : "tap");
    }, 900 + index * 900));
  });

  window.setTimeout(() => {
    clearBattleTimers();
    battleStage.classList.remove("is-fighting");
    battleStage.innerHTML = renderWinner(winner, loser, winnerStats);
    battleCommentary.innerHTML = `<p>${escapeHtml(battleReason(winner, loser, winnerStats))}</p>`;
    playBattleSound("win");
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
  const detailButton = event.target.closest("[data-detail]");
  const moreButton = event.target.closest("[data-more]");

  if (moreButton) toggleCardSummary(moreButton.dataset.more);
  if (favoriteButton) toggleFavorite(favoriteButton.dataset.favorite);
  if (compareButton) toggleCompare(compareButton.dataset.compare);
  if (battleButton) toggleBattle(battleButton.dataset.battle);
  if (detailButton) openDetail(detailButton.dataset.detail);
});

detailPanel.addEventListener("click", (event) => {
  const closeButton = event.target.closest("[data-close-detail]");
  const detailButton = event.target.closest("[data-detail]");

  if (closeButton) closeDetail();
  if (detailButton) openDetail(detailButton.dataset.detail);
});

window.addEventListener("popstate", () => {
  selectedDetailId = new URLSearchParams(window.location.search).get("breed") || "";
  renderDetail();
});

searchInput.addEventListener("input", render);
[originFilter, sizeFilter, temperamentFilter, flightFilter].forEach((filter) => {
  filter.addEventListener("change", render);
});

favoritesButton.addEventListener("click", () => {
  scrollToTop();
  showFavoritesOnly = !showFavoritesOnly;
  favoritesButton.setAttribute("aria-pressed", String(showFavoritesOnly));
  render();
});

fightButton.addEventListener("click", fightBattle);

rateUpload.addEventListener("change", handleRateUpload);

clearFiltersButton.addEventListener("click", () => {
  scrollToTop();
  resetListFilters();
  render();
});

randomButton.addEventListener("click", () => {
  scrollToTop();
  const breed = selectDifferentRandom();

  if (!breed) return;

  resetListFilters({ includeSearch: false });
  searchInput.value = breed.name;
  render();
  document.querySelector(`[data-compare="${CSS.escape(breed.id)}"]`)?.scrollIntoView({
    behavior: "smooth",
    block: "center"
  });
});

loadBreeds();
