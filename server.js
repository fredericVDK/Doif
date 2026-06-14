const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const WIKI_API = "https://en.wikipedia.org/w/api.php";
const WIKIDATA_API = "https://www.wikidata.org/w/api.php";
const COMMONS_FILE = "https://commons.wikimedia.org/wiki/Special:FilePath/";
const FALLBACK_IMAGE = "assets/pigeon-hero-wide.png";
const LIST_PAGE = "List_of_pigeon_breeds";
const MAX_INITIAL_BREEDS = 260;
const PAGE_BATCH_SIZE = 35;
const BREED_CACHE_TTL = 1000 * 60 * 60 * 6;
const MISSING_SOURCE = "Not listed in source";
let breedCache = {
  expiresAt: 0,
  data: null,
  pending: null
};
const LEADERBOARD_FILE = path.join(os.tmpdir(), "pigeon-crumbs-leaderboard.json");
let leaderboardScores = loadLeaderboardScores();
const allowedRootFiles = new Set([
  "index.html",
  "styles.css",
  "script.js",
  "pigeondex.html",
  "pigeondex.css",
  "pigeondex.js",
  "pigder.html",
  "pigder.css",
  "pigder.js"
]);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

function apiUrl(base, params) {
  const url = new URL(base);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return url;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      "accept": "application/json",
      "user-agent": "PigeonDex/1.0 (https://doif-eta.vercel.app; pigeon breed education project)"
    }
  });

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
  }

  return response.json();
}

function normalizeTitle(title) {
  return title.replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

function titleToId(title) {
  return normalizeTitle(title).toLowerCase();
}

function extractTitlesFromList(html) {
  const matches = [...html.matchAll(/<a\s+[^>]*href="\/wiki\/[^"]+"[^>]*title="([^"]+)"/g)];
  const ignored = new Set([
    "Columba livia",
    "Domestic pigeon",
    "Fancy pigeon",
    "Rock dove",
    "Pigeon keeping",
    "Pigeon racing",
    "List of pigeon breeds"
  ]);

  return matches
    .map((match) => normalizeTitle(match[1].replace(/&amp;/g, "&").replace(/&#039;/g, "'")))
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
        pithumbsize: "900",
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

function readClaimIds(claims = []) {
  return claims
    .map((claim) => claim.mainsnak?.datavalue?.value?.id)
    .filter(Boolean);
}

function readCommonsFile(claims = []) {
  return claims[0]?.mainsnak?.datavalue?.value || "";
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
  if (/\b(small|short-faced|pigmy|figurita|owl|movchen|frill)\b/.test(lower)) return "Small";
  if (/\b(medium|homer|racer|carrier|dragoon|trumpeter|pouter|cropper)\b/.test(lower)) return "Medium";
  return MISSING_SOURCE;
}

function inferFlight(text) {
  const lower = text.toLowerCase();

  if (/\b(highflyer|highflier|tippler|racing|racer|homer|flight)\b/.test(lower)) return "Strong flyer";
  if (/\b(tumbler|roller|performing)\b/.test(lower)) return "Acrobatic flyer";
  if (/\b(show|fancy|pouter|cropper|fantail|king|runt)\b/.test(lower)) return "Mostly show/fancy";
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
  if (wdDetail?.imageName) return `${COMMONS_FILE}${encodeURIComponent(wdDetail.imageName)}?width=900`;
  return FALLBACK_IMAGE;
}

function hasSpecificImage(breed) {
  return breed.image && breed.image !== FALLBACK_IMAGE;
}

function sortBreeds(breeds) {
  return breeds.sort((a, b) => {
    const imageDifference = Number(hasSpecificImage(b)) - Number(hasSpecificImage(a));

    if (imageDifference) return imageDifference;

    return a.name.localeCompare(b.name);
  });
}

async function buildBreeds() {
  const titles = await fetchBreedTitles();
  const pages = await fetchWikipediaPages(titles);
  const wdDetails = await fetchWikidataDetails(pages.map((page) => page.wikidataId));
  const allOriginIds = [...wdDetails.values()].flatMap((detail) => detail.originIds);
  const originLabels = await fetchLabels(allOriginIds);

  return sortBreeds(
    pages.map((page) => {
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
        history: page.extract || extractFact(page.extract),
        image: imageFor(page, wdDetail),
        hasRealImage: Boolean(imageFor(page, wdDetail) && imageFor(page, wdDetail) !== FALLBACK_IMAGE),
        sourceUrl: page.sourceUrl,
        wikidataId: page.wikidataId
      };
    })
  );
}

async function getCachedBreeds() {
  const now = Date.now();

  if (breedCache.data && breedCache.expiresAt > now) return breedCache.data;
  if (breedCache.pending) return breedCache.pending;

  breedCache.pending = buildBreeds()
    .then((data) => {
      breedCache = {
        data,
        expiresAt: Date.now() + BREED_CACHE_TTL,
        pending: null
      };
      return data;
    })
    .catch((error) => {
      breedCache.pending = null;
      throw error;
    });

  return breedCache.pending;
}

function sendJson(response, statusCode, data, headers = {}) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    ...headers
  });
  response.end(JSON.stringify(data));
}

function loadLeaderboardScores() {
  try {
    const saved = JSON.parse(fs.readFileSync(LEADERBOARD_FILE, "utf8"));

    if (!Array.isArray(saved)) return new Map();

    return new Map(saved.map((entry) => [entry.nickname, Number(entry.feeds) || 0]));
  } catch (error) {
    return new Map();
  }
}

function saveLeaderboardScores() {
  try {
    fs.writeFileSync(LEADERBOARD_FILE, JSON.stringify([...leaderboardScores.entries()].map(([nickname, feeds]) => ({
      nickname,
      feeds
    }))));
  } catch (error) {
    console.warn("Could not save leaderboard scores.", error);
  }
}

function cleanNickname(value) {
  const nickname = String(value || "")
    .replace(/[^\w .'-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 24);

  return nickname || "Anonymous";
}

function leaderboardEntries(limit = 10) {
  return [...leaderboardScores.entries()]
    .map(([nickname, feeds]) => ({ nickname, feeds }))
    .sort((left, right) => right.feeds - left.feeds || left.nickname.localeCompare(right.nickname))
    .slice(0, limit);
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;

      if (body.length > 4096) {
        reject(new Error("Request body is too large."));
        request.destroy();
      }
    });

    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(new Error("Invalid JSON body."));
      }
    });

    request.on("error", reject);
  });
}

function sendFile(response, filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const contentType = mimeTypes[extension] || "application/octet-stream";

  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(error.code === "ENOENT" ? 404 : 500, {
        "content-type": "text/plain; charset=utf-8"
      });
      response.end(error.code === "ENOENT" ? "Not found" : "Server error");
      return;
    }

    response.writeHead(200, { "content-type": contentType });
    response.end(content);
  });
}

function getStaticFilePath(pathname) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const decodedPath = decodeURIComponent(requestedPath);
  const trimmedPath = decodedPath.replace(/^\/+/, "");
  const normalizedPath = path.normalize(trimmedPath);

  if (normalizedPath.startsWith("..") || path.isAbsolute(normalizedPath)) {
    return null;
  }

  const firstSegment = normalizedPath.split(path.sep)[0];

  if (!allowedRootFiles.has(normalizedPath) && firstSegment !== "assets") {
    return null;
  }

  const filePath = path.join(PUBLIC_DIR, normalizedPath);
  const safePath = path.resolve(filePath);
  const safePublicDir = path.resolve(PUBLIC_DIR);

  if (!safePath.startsWith(safePublicDir)) {
    return null;
  }

  return safePath;
}

function handleRequest(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (url.pathname === "/api/leaderboard") {
    if (request.method !== "GET") {
      sendJson(response, 405, { error: "Method not allowed." });
      return;
    }

    sendJson(response, 200, {
      leaderboard: leaderboardEntries(10)
    }, {
      "cache-control": "no-store"
    });
    return;
  }

  if (url.pathname === "/api/feed") {
    if (request.method !== "POST") {
      sendJson(response, 405, { error: "Method not allowed." });
      return;
    }

    readJsonBody(request)
      .then((body) => {
        const nickname = cleanNickname(body.nickname);
        const amount = Math.max(1, Math.floor(Number(body.amount) || 1));
        const total = (leaderboardScores.get(nickname) || 0) + amount;
        leaderboardScores.set(nickname, total);
        saveLeaderboardScores();
        sendJson(response, 200, {
          nickname,
          feeds: total,
          leaderboard: leaderboardEntries(10)
        }, {
          "cache-control": "no-store"
        });
      })
      .catch((error) => sendJson(response, 400, {
        error: error.message
      }));
    return;
  }

  if (url.pathname === "/api/breeds") {
    getCachedBreeds()
      .then((breeds) => sendJson(response, 200, {
        cachedAt: new Date(Date.now() - BREED_CACHE_TTL + Math.max(0, breedCache.expiresAt - Date.now())).toISOString(),
        count: breeds.length,
        breeds
      }, {
        "cache-control": "s-maxage=21600, stale-while-revalidate=86400"
      }))
      .catch((error) => sendJson(response, 502, {
        error: "Could not load pigeon breed cache.",
        message: error.message
      }));
    return;
  }

  const filePath = getStaticFilePath(url.pathname);

  if (!filePath) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  sendFile(response, filePath);
}

if (require.main === module) {
  const server = http.createServer(handleRequest);

  server.listen(PORT, () => {
    console.log(`Pigeon Crumbs is running at http://localhost:${PORT}`);
  });
}

module.exports = handleRequest;
