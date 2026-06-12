const WIKI_API = "https://en.wikipedia.org/w/api.php";
const WIKIDATA_API = "https://www.wikidata.org/w/api.php";
const COMMONS_FILE = "https://commons.wikimedia.org/wiki/Special:FilePath/";
const LIST_PAGE = "List_of_pigeon_breeds";
const PAGE_BATCH_SIZE = 35;
const MAX_INITIAL_BREEDS = 260;
const favoritesKey = "pigeondex:favorites";

const breedGrid = document.querySelector("#breedGrid");
const statusEl = document.querySelector("#status");
const searchInput = document.querySelector("#searchInput");
const randomButton = document.querySelector("#randomButton");
const favoritesButton = document.querySelector("#favoritesButton");
const compareGrid = document.querySelector("#compareGrid");

let breeds = [];
let favorites = new Set(JSON.parse(localStorage.getItem(favoritesKey) || "[]"));
let compareIds = [];
let showFavoritesOnly = false;

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

function inferSize(text) {
  const lower = text.toLowerCase();

  if (/\b(giant|large|heavy|runt|king pigeon)\b/.test(lower)) return "Large, API-derived";
  if (/\b(small|short-faced|pigmy|figurita|owl)\b/.test(lower)) return "Small, API-derived";
  if (/\b(medium|homer|racer|carrier)\b/.test(lower)) return "Medium, API-derived";
  return "Not listed in source";
}

function inferFlight(text) {
  const lower = text.toLowerCase();

  if (/\b(highflyer|highflier|tippler|racing|racer|homer|flight)\b/.test(lower)) {
    return "Strong flyer, API-derived";
  }

  if (/\b(tumbler|roller|performing)\b/.test(lower)) {
    return "Acrobatic flyer, API-derived";
  }

  if (/\b(show|fancy|pouter|cropper|fantail|king|runt)\b/.test(lower)) {
    return "Mostly show/fancy, API-derived";
  }

  return "Not listed in source";
}

function inferTemperament(text) {
  const lower = text.toLowerCase();

  if (/\b(gentle|docile|calm|friendly|quiet)\b/.test(lower)) return "Calm, API-derived";
  if (/\b(active|alert|energetic|performing|flying)\b/.test(lower)) return "Active, API-derived";
  if (/\b(show|fancy)\b/.test(lower)) return "Kept for exhibition, API-derived";
  return "Not listed in source";
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
  return "assets/pigeon-hero-wide.png";
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
          origin: origin || "Not listed in source",
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

    setStatus(`Showing ${breeds.length} breeds loaded from Wikipedia and Wikidata APIs.`);
    render();
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
  breedGrid.innerHTML = visible.map(renderCard).join("");
  setStatus(
    visible.length
      ? `Showing ${visible.length} of ${breeds.length} live API breeds.`
      : "No breeds match that search."
  );
  renderCompare();
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
          <button class="icon-button ${isFavorite ? "is-active" : ""}" type="button" data-favorite="${escapeHtml(breed.id)}" aria-label="Favorite ${escapeHtml(breed.name)}">★</button>
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
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

function renderCompare() {
  const selected = compareIds.map((id) => breeds.find((breed) => breed.id === id)).filter(Boolean);

  if (!selected.length) {
    compareGrid.innerHTML = '<p class="empty">No breeds selected yet.</p>';
    return;
  }

  compareGrid.innerHTML = selected.map((breed) => `
    <article class="compare-item">
      <h3>${escapeHtml(breed.name)}</h3>
      <dl>
        <dt>Origin</dt><dd>${escapeHtml(breed.origin)}</dd>
        <dt>Size</dt><dd>${escapeHtml(breed.size)}</dd>
        <dt>Flight</dt><dd>${escapeHtml(breed.flight)}</dd>
        <dt>Temperament</dt><dd>${escapeHtml(breed.temperament)}</dd>
      </dl>
    </article>
  `).join("");
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

breedGrid.addEventListener("click", (event) => {
  const favoriteButton = event.target.closest("[data-favorite]");
  const compareButton = event.target.closest("[data-compare]");

  if (favoriteButton) toggleFavorite(favoriteButton.dataset.favorite);
  if (compareButton) toggleCompare(compareButton.dataset.compare);
});

searchInput.addEventListener("input", render);

favoritesButton.addEventListener("click", () => {
  showFavoritesOnly = !showFavoritesOnly;
  favoritesButton.setAttribute("aria-pressed", String(showFavoritesOnly));
  render();
});

randomButton.addEventListener("click", () => {
  const pool = visibleBreeds();

  if (!pool.length) return;

  const breed = pool[Math.floor(Math.random() * pool.length)];
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
