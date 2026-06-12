const WIKI_API = "https://en.wikipedia.org/w/api.php";
const FALLBACK_IMAGE = "assets/pigeon-hero-wide.png";
const LIST_PAGE = "List_of_pigeon_breeds";
const MAX_SWIPES = 20;
const MAX_BREEDS = 90;
const cacheKey = "pigder:breed-cache";

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

const fallbackBreeds = [
  ["Fantail", "A fancy pigeon known for its dramatic fan-shaped tail.", ["Fancy feathers", "Exhibition pigeons"]],
  ["Oriental Frill", "A small ornamental pigeon with refined feather details.", ["Fancy feathers", "Small breeds", "Exhibition pigeons"]],
  ["Stralsund Highflyer", "A flying pigeon associated with high flight ability.", ["Acrobatic flyers", "European classics"]],
  ["Brunner Pouter", "A tall pouter breed with a theatrical inflated crop.", ["Dramatic pouters", "Exhibition pigeons"]],
  ["Jacobin", "A fancy pigeon with a hood of feathers around the head.", ["Fancy feathers", "Exhibition pigeons"]],
  ["German Owl", "A compact fancy pigeon with a short beak and gentle expression.", ["Small breeds", "European classics"]],
  ["English Carrier", "A historic pigeon breed with a bold, serious profile.", ["Street-smart charm"]],
  ["Bokhara Trumpeter", "A richly feathered breed often kept for show.", ["Fancy feathers", "Exhibition pigeons"]],
  ["Tippler", "A flying breed admired for endurance in the air.", ["Acrobatic flyers"]],
  ["Modena", "A compact exhibition pigeon with a proud stance.", ["Small breeds", "Exhibition pigeons"]],
  ["King pigeon", "A large domestic pigeon breed with a solid build.", ["Street-smart charm"]],
  ["Lahore", "A decorative pigeon with striking markings.", ["Fancy feathers", "Exhibition pigeons"]],
  ["Nun pigeon", "A fancy pigeon with clean contrasting markings.", ["Fancy feathers", "Exhibition pigeons"]],
  ["Archangel", "A metallic-looking fancy pigeon with dramatic color.", ["Fancy feathers"]],
  ["Dutch Capuchine", "An old fancy breed with a feathered collar.", ["Fancy feathers", "European classics"]],
  ["West of England Tumbler", "A tumbler breed associated with agile flight.", ["Acrobatic flyers", "Exhibition pigeons"]],
  ["Indian Fantail", "A decorative fantail breed with an elegant carriage.", ["Fancy feathers", "Exhibition pigeons"]],
  ["Frillback", "A pigeon with curled feathers and high fashion energy.", ["Fancy feathers", "Exhibition pigeons"]],
  ["Saxon Monk", "A marked fancy pigeon from Germany.", ["European classics", "Exhibition pigeons"]],
  ["Budapest Short-faced Tumbler", "A small tumbler with an intense expression.", ["Small breeds", "Acrobatic flyers"]]
].map(([name, summary, preferences]) => ({
  id: name.toLowerCase(),
  name,
  image: FALLBACK_IMAGE,
  hasRealImage: false,
  summary,
  preferences
}));

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
    .slice(0, MAX_BREEDS);
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

async function fetchBreedPages(titles) {
  const pages = [];

  for (const titleBatch of chunks(titles, 30)) {
    const data = await fetchJson(
      apiUrl(WIKI_API, {
        action: "query",
        prop: "extracts|pageimages|info",
        exintro: "1",
        explaintext: "1",
        inprop: "url",
        piprop: "thumbnail",
        pithumbsize: "900",
        redirects: "1",
        titles: titleBatch.join("|"),
        format: "json",
        origin: "*"
      })
    );

    pages.push(...Object.values(data.query.pages).filter((page) => !page.missing));
  }

  return pages;
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

function buildBreed(page) {
  const summary = page.extract || "No short description listed by the API.";

  return {
    id: normalizeTitle(page.title).toLowerCase(),
    name: normalizeTitle(page.title),
    image: page.thumbnail?.source || FALLBACK_IMAGE,
    hasRealImage: Boolean(page.thumbnail?.source),
    summary,
    preferences: classifyBreed({ name: page.title, summary })
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
    <img src="${escapeHtml(currentBreed.image)}" alt="${escapeHtml(currentBreed.name)}">
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
}

function swipe(direction) {
  if (!currentBreed || swipes.length >= MAX_SWIPES) return;

  swipes.push({ direction, breed: currentBreed });
  renderCard();
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

function renderResult() {
  const liked = swipes.filter((entry) => entry.direction === "like");
  const favoritePool = liked.length ? liked : swipes;
  const ideal = favoritePool[Math.floor(Math.random() * favoritePool.length)]?.breed || breeds[0];
  const preferences = preferenceWinners(favoritePool);

  likeButton.disabled = true;
  nopeButton.disabled = true;

  resultPanel.innerHTML = `
    <p class="section-kicker">Your ideal pigeon</p>
    <h2>${escapeHtml(ideal.name)}</h2>
    <img src="${escapeHtml(ideal.image)}" alt="${escapeHtml(ideal.name)}">
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
    const cached = JSON.parse(sessionStorage.getItem(cacheKey) || "null");

    if (cached?.length) {
      breeds = cached;
      restart();
      return;
    }

    const titles = await fetchBreedTitles();
    const pages = await fetchBreedPages(titles);
    breeds = pages
      .map(buildBreed)
      .sort((left, right) => Number(right.hasRealImage) - Number(left.hasRealImage));
    sessionStorage.setItem(cacheKey, JSON.stringify(breeds));
    restart();
  } catch (error) {
    breeds = fallbackBreeds;
    restart();
    resultPanel.innerHTML = `
      <p class="section-kicker">Live API busy</p>
      <h2>Fallback flock loaded</h2>
      <p>The live pigeon database is temporarily rate-limiting requests, so Pigder loaded a small backup flock for swiping.</p>
    `;
  }
}

likeButton.addEventListener("click", () => swipe("like"));
nopeButton.addEventListener("click", () => swipe("nope"));
restartButton.addEventListener("click", restart);

loadBreeds();
