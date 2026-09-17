const FALLBACK_IMAGE = "assets/pigeon-hero-wide.png";
const BREED_CACHE_API = "/api/breeds";
const MAX_SWIPES = 20;
const cacheKey = "pigder:catalog-cache-v3";

const swipeCard = document.querySelector("#swipeCard");
const swipeCount = document.querySelector("#swipeCount");
const resultPanel = document.querySelector("#resultPanel");
const likeButton = document.querySelector("#likeButton");
const nopeButton = document.querySelector("#nopeButton");
const restartButton = document.querySelector("#restartButton");

let breeds = [];
let deck = [];
let currentBreed = null;
let swipes = [];
let dragState = null;

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

function normalizeTitle(title) {
  return title.replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[character]);
}

function classifyBreed(breed) {
  const text = `${breed.name} ${breed.summary}`.toLowerCase();
  const preferences = [];

  if (/fantail|frill|jacobin|trumpeter|owl|shield|capuchine|exhibition|fancy/.test(text)) {
    preferences.push("Fancy feathers");
  }

  if (/owl|frill|mövchen|movchen|short-faced|small/.test(text)) {
    preferences.push("Small breeds");
  }

  if (/show|exhibition|fancy|ornamental|selective/.test(text)) {
    preferences.push("Exhibition pigeons");
  }

  if (/tumbler|roller|highflyer|flying|flight/.test(text)) {
    preferences.push("Acrobatic flyers");
  }

  if (/pouter|cropper/.test(text)) {
    preferences.push("Dramatic pouters");
  }

  if (/germany|czech|poland|netherlands|belgium|france/.test(text)) {
    preferences.push("European classics");
  }

  return preferences.length ? preferences : ["Street-smart charm"];
}

function breedFromCache(breed) {
  const summary = breed.history || breed.fact || "No short description listed by the API.";

  return {
    id: breed.id,
    kind: breed.kind,
    imageAttribution: breed.imageAttribution,
    source: breed.source,
    name: normalizeTitle(breed.name),
    image: breed.image,
    hasRealImage: Boolean(breed.hasRealImage || (breed.image && breed.image !== FALLBACK_IMAGE)),
    summary,
    preferences: classifyBreed({ name: breed.name, summary })
  };
}

function shuffle(items) {
  return [...items].sort(() => Math.random() - 0.5);
}

function updateCount() {
  swipeCount.textContent = `${Math.min(swipes.length, MAX_SWIPES)} / ${MAX_SWIPES} swipes`;
}

function renderCard() {
  updateCount();

  if (swipes.length >= MAX_SWIPES) {
    renderResult();
    return;
  }

  currentBreed = deck.shift() || shuffle(breeds)[0];

  if (!currentBreed) {
    swipeCard.innerHTML = '<p class="empty">No pigeons found yet.</p>';
    return;
  }

  swipeCard.innerHTML = `
    <img src="${escapeHtml(currentBreed.image)}" alt="${escapeHtml(currentBreed.name)}">${photoCredit(currentBreed)}
    <div class="swipe-stamps" aria-hidden="true">
      <span class="stamp-nope">Nope</span>
      <span class="stamp-like">Like</span>
    </div>
    <div class="swipe-body">
      <h2>${escapeHtml(currentBreed.name)}</h2>
      <div class="facts">
        ${currentBreed.preferences.slice(0, 3).map((preference) => `
          <div class="fact">
            <span>Signal</span>
            <strong>${escapeHtml(preference)}</strong>
          </div>
        `).join("")}
      </div>
      <p class="summary">${escapeHtml(currentBreed.summary)}</p>
    </div>
  `;
  resetCardMotion();
}

function swipe(direction) {
  if (!currentBreed || swipes.length >= MAX_SWIPES) return;

  swipeCard.classList.remove("dragging");
  swipeCard.classList.add(direction === "like" ? "fly-right" : "fly-left");
  swipes.push({ direction, breed: currentBreed });
  window.setTimeout(() => {
    swipeCard.classList.remove("fly-right", "fly-left");
    renderCard();
  }, 260);
}

function preferenceWinners(liked) {
  const counts = new Map();

  liked.forEach(({ breed }) => {
    breed.preferences.forEach((preference) => {
      counts.set(preference, (counts.get(preference) || 0) + 1);
    });
  });

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([preference]) => preference)
    .slice(0, 3);
}

function renderResultLegacy() {
  const liked = swipes.filter((entry) => entry.direction === "like");
  const favoritePool = liked.length ? liked : swipes;
  const ideal = favoritePool[Math.floor(Math.random() * favoritePool.length)]?.breed || breeds[0];
  const preferences = preferenceWinners(favoritePool);

  likeButton.disabled = true;
  nopeButton.disabled = true;

  resultPanel.innerHTML = `
    <p class="section-kicker">Your ideal pigeon</p>
    <h2>${escapeHtml(ideal.name)}</h2>
    <img src="${escapeHtml(ideal.image)}" alt="${escapeHtml(ideal.name)}">${photoCredit(ideal)}
    <p>You prefer:</p>
    <ul class="preference-list">
      ${(preferences.length ? preferences : ["Fancy feathers", "Small breeds", "Exhibition pigeons"]).map((preference) => `
        <li>✓ ${escapeHtml(preference)}</li>
      `).join("")}
    </ul>
  `;

  swipeCard.innerHTML = `
    <div class="swipe-body">
      <h2>Match found</h2>
      <p class="summary">Pigder has reviewed your excellent choices and declared a pigeon destiny.</p>
    </div>
  `;
  updateCount();
}

function renderResult() {
  const liked = swipes.filter((entry) => entry.direction === "like");
  const favoritePool = liked.length ? liked : swipes;
  const ideal = favoritePool[Math.floor(Math.random() * favoritePool.length)]?.breed || breeds[0];
  const preferences = preferenceWinners(favoritePool);

  likeButton.disabled = true;
  nopeButton.disabled = true;

  resultPanel.innerHTML = `
    <p class="section-kicker">Your pigeon type</p>
    <h2>${escapeHtml(ideal.name)} person</h2>
    <img src="${escapeHtml(ideal.image)}" alt="${escapeHtml(ideal.name)}">${photoCredit(ideal)}
    <p class="type-report">Your ideal pigeon is ${escapeHtml(ideal.name)}: dramatic enough to matter, practical enough to find crumbs, and visually strong enough to interrupt a meeting.</p>
    <p>You prefer:</p>
    <ul class="preference-list">
      ${(preferences.length ? preferences : ["Fancy feathers", "Small breeds", "Exhibition pigeons"]).map((preference) => `
        <li>&#10003; ${escapeHtml(preference)}</li>
      `).join("")}
    </ul>
  `;

  swipeCard.innerHTML = `
    <div class="swipe-body">
      <h2>Match found</h2>
      <p class="summary">Pigder has reviewed your excellent choices and declared a pigeon destiny.</p>
    </div>
  `;
  updateCount();
}

function resetCardMotion() {
  swipeCard.style.transform = "";
  swipeCard.style.setProperty("--swipe-like-opacity", "0");
  swipeCard.style.setProperty("--swipe-nope-opacity", "0");
}

function updateCardMotion(deltaX, deltaY) {
  const rotation = Math.max(-14, Math.min(14, deltaX / 16));
  const likeOpacity = Math.max(0, Math.min(1, deltaX / 120));
  const nopeOpacity = Math.max(0, Math.min(1, -deltaX / 120));

  swipeCard.style.transform = `translate(${deltaX}px, ${deltaY}px) rotate(${rotation}deg)`;
  swipeCard.style.setProperty("--swipe-like-opacity", String(likeOpacity));
  swipeCard.style.setProperty("--swipe-nope-opacity", String(nopeOpacity));
}

function beginDrag(event) {
  if (!currentBreed || swipes.length >= MAX_SWIPES || event.target.closest("a")) return;

  dragState = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    hasMoved: false
  };
  swipeCard.setPointerCapture(event.pointerId);
}

function moveDrag(event) {
  if (!dragState || dragState.pointerId !== event.pointerId) return;

  const deltaX = event.clientX - dragState.startX;
  const deltaY = event.clientY - dragState.startY;

  if (!dragState.hasMoved && Math.hypot(deltaX, deltaY) < 14) return;

  dragState.hasMoved = true;
  swipeCard.classList.add("dragging");
  updateCardMotion(deltaX, deltaY);
}

function endDrag(event) {
  if (!dragState || dragState.pointerId !== event.pointerId) return;

  const deltaX = event.clientX - dragState.startX;
  const deltaY = event.clientY - dragState.startY;
  const hadMoved = dragState.hasMoved;
  dragState = null;
  swipeCard.classList.remove("dragging");

  if (hadMoved && Math.abs(deltaX) > 120 && Math.abs(deltaX) > Math.abs(deltaY) * 1.35) {
    swipe(deltaX > 0 ? "like" : "nope");
    return;
  }

  resetCardMotion();
}

function restart() {
  swipes = [];
  deck = shuffle(breeds);
  currentBreed = null;
  likeButton.disabled = false;
  nopeButton.disabled = false;
  resultPanel.innerHTML = `
    <p class="section-kicker">Your result</p>
    <h2>Keep swiping</h2>
    <p>After 20 swipes, Pigder will reveal your ideal pigeon and your preferences.</p>
  `;
  renderCard();
}

async function loadBreeds() {
  try {
    let cached;
    try { cached = JSON.parse(sessionStorage.getItem(cacheKey) || "null"); } catch { cached = null; }

    if (cached?.length) {
      const cachedPhotoBreeds = cached.filter((breed) => breed.hasRealImage && breed.image !== FALLBACK_IMAGE);

      if (cachedPhotoBreeds.length >= MAX_SWIPES) {
        breeds = cachedPhotoBreeds;
        restart();
        return;
      }

      sessionStorage.removeItem(cacheKey);
    }

    breeds = (await fetchCachedBreeds()).map(breedFromCache).filter(breed => breed.hasRealImage);

    if (breeds.length < MAX_SWIPES) {
      throw new Error("Not enough image-backed pigeons are available right now.");
    }

    breeds = breeds.sort((left, right) => left.name.localeCompare(right.name));
    try { sessionStorage.setItem(cacheKey, JSON.stringify(breeds)); } catch { /* Storage is optional. */ }
    restart();
  } catch (error) {
    breeds = [];
    swipeCard.innerHTML = `
      <div class="swipe-body">
        <h2>Pigder needs photos</h2>
        <p class="summary">${escapeHtml(error.message)} Refresh to try again.</p>
      </div>
    `;
    resultPanel.innerHTML = `
      <p class="section-kicker">No standard images</p>
      <h2>Photo-only mode</h2>
      <p>Pigder is set to only use pigeons with available pigeon photos, never the standard fallback picture.</p>
    `;
  }
}

likeButton.addEventListener("click", () => swipe("like"));
nopeButton.addEventListener("click", () => swipe("nope"));
restartButton.addEventListener("click", restart);
swipeCard.addEventListener("pointerdown", beginDrag);
swipeCard.addEventListener("pointermove", moveDrag);
swipeCard.addEventListener("pointerup", endDrag);
swipeCard.addEventListener("pointercancel", endDrag);

loadBreeds();
