const BREED_CACHE_API = "/api/breeds";
const FALLBACK_IMAGE = "assets/pigeon-hero-wide.png";
const favoritesKey = "pigeondex:favorites";
const dailyHistoryKey = "pigeondex:daily-history";
const battleHistoryKey = "pigeondex:battle-history";
const MISSING_SOURCE = "Not listed in source";

const breedGrid = document.querySelector("#breedGrid");
const statusEl = document.querySelector("#status");
const searchInput = document.querySelector("#searchInput");
const kindFilter = document.querySelector("#kindFilter");
const originFilter = document.querySelector("#originFilter");
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
let catalogSources = {};
let favorites = new Set(JSON.parse(localStorage.getItem(favoritesKey) || "[]"));
let compareIds = [];
let battleIds = [];
let showFavoritesOnly = false;
let lastRandomId = "";
let isBattling = false;
let battleHasResult = false;
let selectedDetailId = new URLSearchParams(window.location.search).get("breed") || "";
let battleTimers = [];
let audioContext = null;

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

  catalogSources = data.sources || {};
  return data.breeds;
}

function setStatus(message) {
  statusEl.textContent = message;
}

function hasSpecificImage(breed) {
  return breed.hasRealImage !== false && breed.image && breed.image !== FALLBACK_IMAGE;
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
  const pool = breeds;

  populateFilter(originFilter, pool.flatMap((breed) => originValues(breed.origin)), "All origins");
}

function currentFilters() {
  return {
    kind: kindFilter.value,
    origin: originFilter.value,
  };
}

function resetListFilters({ includeSearch = true, includeFavorites = true } = {}) {
  if (includeSearch) searchInput.value = "";

  kindFilter.value = "";
  originFilter.value = "";

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
  if (breed.kind === "species") return "Not assessed";
  const text = `${breed.name} ${breed.fact}`.toLowerCase();

  if (/\b(rare|endangered|old|ancient|historic)\b/.test(text)) return "Rare";
  if (/\b(common|popular|widespread)\b/.test(text)) return "Common";
  if (breed.origin === MISSING_SOURCE || breed.image === FALLBACK_IMAGE) return "Hard to document";
  return "Specialist pigeon";
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
    breeds = (await fetchCachedBreeds()).filter(hasSpecificImage);
    sortBreeds();
    populateFilters();
    render();
    renderDaily();
  } catch (error) {
    console.error(error);
    setStatus("Could not load the pigeon catalogue. Please refresh to try again.");
  }
}

function visibleBreeds() {
  const query = searchInput.value.trim().toLowerCase();
  const filters = currentFilters();

  return breeds.filter((breed) => {
    const matchesSearch = [breed.name, breed.nameNl, breed.scientificName, ...(breed.aliases || []), breed.origin, breed.size, breed.flight, breed.temperament, breed.fact]
      .join(" ")
      .toLowerCase()
      .includes(query);
    const matchesOrigin = !filters.origin || originValues(breed.origin).includes(filters.origin);
    const matchesFavorite = !showFavoritesOnly || favorites.has(breed.id);

    return (!filters.kind || breed.kind === filters.kind) && matchesSearch && matchesOrigin && matchesFavorite;
  });
}

function render() {
  const visible = visibleBreeds();

  const sortedVisible = [...visible].sort((a, b) => {
    return a.name.localeCompare(b.name);
  });
  breedGrid.innerHTML = sortedVisible.map(renderCard).join("");
  const speciesCount = breeds.filter(breed => breed.kind === "species").length;
  const unavailable = Object.values(catalogSources).some(source => ["stale", "unavailable"].includes(source.status));
  setStatus(
    (visible.length ? `Showing ${visible.length} of ${breeds.length} pigeons: ${speciesCount} species and ${breeds.length - speciesCount} domestic breeds.` : "No pigeons match these filters.")
    + (unavailable ? " A source is temporarily unavailable; saved records are shown where possible." : "")
  );
  renderCompare();
  renderBattle();
  renderDetail();
}

function catalogLabel(breed) {
  return `<p class="catalog-label"><strong>${breed.kind === "species" ? "Wild species" : "Domestic breed"}</strong>${breed.scientificName ? " · " + escapeHtml(breed.scientificName) : ""}${breed.nameNl ? "<br>" + escapeHtml(breed.nameNl) : ""}</p>`;
}

function descriptionCredit(breed) {
  if (!breed.descriptionSource) return "";
  return `<p class="description-credit">Description: ${escapeHtml(breed.descriptionSource)} via BirdNET. <a href="${escapeHtml(catalogSafeUrl(breed.descriptionUrl))}" target="_blank" rel="noreferrer">Original source</a></p>`;
}

function renderCard(breed) {
  const isFavorite = favorites.has(breed.id);
  const isCompared = compareIds.includes(breed.id);

  return `
    <article class="breed-card">
      <button class="image-button" type="button" data-detail="${escapeHtml(breed.id)}" aria-label="Open ${escapeHtml(breed.name)} details">
        <img class="breed-image" src="${escapeHtml(breed.image)}" alt="${escapeHtml(breed.name)}" loading="lazy">
      </button>
      <div class="breed-body">
        ${photoCredit(breed)}
        ${catalogLabel(breed)}
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
        <p class="summary">${escapeHtml(breed.history || breed.fact)}</p>
        ${descriptionCredit(breed)}
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
  const fields = ["origin", "size", "flight", "temperament"];
  return breeds.filter(candidate => candidate.id !== breed.id && candidate.kind === breed.kind)
    .filter(hasSpecificImage)
    .map(candidate => {
      const score = breed.kind === "species"
        ? Number(candidate.scientificName?.split(" ")[0] === breed.scientificName?.split(" ")[0])
        : fields.filter(key => breed[key] && breed[key] !== MISSING_SOURCE && breed[key] === candidate[key]).length;
      return { candidate, score };
    })
    .filter(entry => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.candidate.name.localeCompare(right.candidate.name))
    .slice(0, 4).map(entry => entry.candidate);
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
  const controls = document.querySelector(".controls");
  const offset = getComputedStyle(controls).position === "sticky" ? controls.offsetHeight : 0;
  detailPanel.style.scrollMarginTop = `${offset + 16}px`;
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

  if (!breed) {
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
        <div class="detail-photo"><img src="${escapeHtml(breed.image)}" alt="${escapeHtml(breed.name)}">${photoCredit(breed)}</div>
        <div>
          <p class="section-kicker">${breed.kind === "species" ? "Wild species" : "Domestic breed"} · ${escapeHtml(breed.source || "Wikimedia")}</p>
          <h2>${escapeHtml(breed.name)}</h2>
          ${catalogLabel(breed)}
          <p>${escapeHtml(breed.history || breed.fact)}</p>
          ${descriptionCredit(breed)}
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
          <h3>Related pigeons</h3>
          <div class="related-grid">
            ${related.length ? related.map((item) => `
              <button type="button" class="related-card" data-detail="${escapeHtml(item.id)}">
                <img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}">
                <small class="photo-credit">${escapeHtml([item.imageAttribution?.author, item.imageAttribution?.license].filter(Boolean).join(" · "))}</small>
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

function displayValue(label, value) {
  if (value && value !== MISSING_SOURCE) return value;

  if (label === "Origin") return "No verified origin found";
  if (label === "Size") return "Not available yet";
  if (label === "Flight") return "Not available yet";
  if (label === "Temperament") return "Not available yet";
  return "No verified result found";
}

function renderCompare() {
  const selected = compareIds.map((id) => breeds.find((breed) => breed.id === id)).filter(Boolean);

  if (!selected.length) {
    compareGrid.innerHTML = '<p class="empty">No pigeons selected yet.</p>';
    return;
  }

  compareGrid.innerHTML = selected.map((breed) => `
    <article class="compare-item">
      <img class="compare-image" src="${escapeHtml(breed.image)}" alt="${escapeHtml(breed.name)}">${photoCredit(breed)}
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
    <img src="${escapeHtml(breed.image)}" alt="${escapeHtml(breed.name)}">${photoCredit(breed)}
    <div>
      <h3>Today's pigeon: ${escapeHtml(breed.name)}</h3>
      <dl class="daily-meta">
        <div><dt>History</dt><dd>${escapeHtml(breed.fact)}</dd></div>
        <div><dt>Type</dt><dd>${breed.kind === "species" ? "Wild species" : "Domestic breed"}</dd></div>
        <div><dt>Source</dt><dd>${escapeHtml(breed.source || "Wikimedia")}</dd></div>
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
      <img src="${escapeHtml(breed.image)}" alt="${escapeHtml(breed.name)}">${photoCredit(breed)}
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
      <div class="winner-photo">
        <img src="${escapeHtml(winner.image)}" alt="${escapeHtml(winner.name)}">
      </div>
      ${photoCredit(winner)}
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
[kindFilter, originFilter].forEach((filter) => {
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
