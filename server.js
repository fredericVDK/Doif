const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { fetchBirdnetSpecies } = require("./lib/birdnet");
const { createCatalog } = require("./lib/catalog");

function loadLocalEnvironment() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;

  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;

    const value = match[2].replace(/^(['"])(.*)\1$/, "$2");
    process.env[match[1]] = value;
  }
}

loadLocalEnvironment();

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const WIKI_API = "https://en.wikipedia.org/w/api.php";
const WIKIDATA_API = "https://www.wikidata.org/w/api.php";
const COMMONS_FILE = "https://commons.wikimedia.org/wiki/Special:FilePath/";
const FALLBACK_IMAGE = "assets/pigeon-hero-wide.png";
const LIST_PAGE = "List_of_pigeon_breeds";
// TextExtracts permits at most 20 introductory extracts per request.
const PAGE_BATCH_SIZE = 20;
const BREED_CACHE_TTL = 1000 * 60 * 60 * 6;
const MISSING_SOURCE = "Not listed in source";
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, "data", "app-db.json");
const FALLBACK_DATA_FILE = path.join(os.tmpdir(), "pigeon-crumbs-app-db.json");
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "dev-admin";
const SESSION_COOKIE = "pigeon_session";
const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY || "";
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID || "";
const AIRTABLE_DRAWINGS_TABLE = process.env.AIRTABLE_DRAWINGS_TABLE || "Drawings";
const AIRTABLE_SCORES_TABLE = process.env.AIRTABLE_SCORES_TABLE || "Scores";
let activeDataFile = DATA_FILE;
let appDb = loadDatabase();
const rateLimitBuckets = new Map();
const allowedRootFiles = new Set([
  "catalog-ui.js",
  "catalog-ui.css",
  "index.html",
  "styles.css",
  "script.js",
  "admin.html",
  "admin.css",
  "admin.js",
  "api-docs.html",
  "api-docs.css",
  "pigeondex.html",
  "pigeondex.css",
  "pigeondex.js",
  "pigder.html",
  "pigder.css",
  "pigder.js",
  "drawings.html",
  "drawings.css",
  "drawings.js"
]);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

function defaultDatabase() {
  return {
    leaderboard: [],
    sessions: [],
    events: [],
    drawings: [],
    breedCache: {
      version: 0,
      cachedAt: "",
      expiresAt: 0,
      data: []
    }
  };
}

function loadDatabase() {
  const fallback = defaultDatabase();

  for (const filePath of [DATA_FILE, FALLBACK_DATA_FILE]) {
    try {
      if (!fs.existsSync(filePath)) continue;

      const saved = JSON.parse(fs.readFileSync(filePath, "utf8"));
      activeDataFile = filePath;
      return {
        ...fallback,
        ...saved,
        breedCache: {
          ...fallback.breedCache,
          ...(saved.breedCache || {})
        }
      };
    } catch (error) {
      console.warn(`Could not load database from ${filePath}.`, error);
    }
  }

  return fallback;
}

function readDatabaseFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;

    const fallback = defaultDatabase();
    const saved = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return {
      ...fallback,
      ...saved,
      breedCache: {
        ...fallback.breedCache,
        ...(saved.breedCache || {})
      }
    };
  } catch (error) {
    console.warn(`Could not refresh database from ${filePath}.`, error);
    return null;
  }
}

function refreshDatabaseFromStorage() {
  const fresh = readDatabaseFile(activeDataFile) || readDatabaseFile(DATA_FILE) || readDatabaseFile(FALLBACK_DATA_FILE);

  if (fresh) {
    appDb = fresh;
  }
}

function saveDatabase() {
  for (const filePath of [activeDataFile, FALLBACK_DATA_FILE]) {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(appDb, null, 2));
      activeDataFile = filePath;
      return;
    } catch (error) {
      console.warn(`Could not save database to ${filePath}.`, error);
    }
  }
}

function nowIso() {
  return new Date().toISOString();
}

function requestIp(request) {
  return (request.headers["x-forwarded-for"] || request.socket.remoteAddress || "unknown")
    .toString()
    .split(",")[0]
    .trim();
}

function parseCookies(request) {
  return Object.fromEntries(
    (request.headers.cookie || "")
      .split(";")
      .map((cookie) => cookie.trim())
      .filter(Boolean)
      .map((cookie) => {
        const [key, ...value] = cookie.split("=");
        return [decodeURIComponent(key), decodeURIComponent(value.join("="))];
      })
  );
}

function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function findOrCreateSession(request, response) {
  refreshDatabaseFromStorage();

  const cookies = parseCookies(request);
  const candidate = cookies[SESSION_COOKIE];
  let session = appDb.sessions.find((entry) => entry.id === candidate);

  if (!session) {
    session = {
      id: makeId("ses"),
      createdAt: nowIso(),
      updatedAt: nowIso(),
      ip: requestIp(request),
      totalFeeds: 0,
      submissions: 0
    };
    appDb.sessions.push(session);
    saveDatabase();
  }

  if (response) {
    response.setHeader("set-cookie", `${SESSION_COOKIE}=${encodeURIComponent(session.id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`);
  }

  return session;
}

function checkRateLimit(request, bucketName, limit, windowMs) {
  const key = `${bucketName}:${requestIp(request)}:${parseCookies(request)[SESSION_COOKIE] || "no-session"}`;
  const now = Date.now();
  const bucket = rateLimitBuckets.get(key) || { resetAt: now + windowMs, count: 0 };

  if (bucket.resetAt <= now) {
    bucket.resetAt = now + windowMs;
    bucket.count = 0;
  }

  bucket.count += 1;
  rateLimitBuckets.set(key, bucket);

  return {
    allowed: bucket.count <= limit,
    retryAfter: Math.ceil((bucket.resetAt - now) / 1000),
    remaining: Math.max(0, limit - bucket.count)
  };
}

function requireRateLimit(request, response, bucketName, limit, windowMs) {
  const result = checkRateLimit(request, bucketName, limit, windowMs);

  if (result.allowed) return true;

  sendJson(response, 429, {
    error: "Too many requests.",
    retryAfter: result.retryAfter
  }, {
    "retry-after": String(result.retryAfter)
  });
  return false;
}

function logEvent(type, details = {}, request = null) {
  appDb.events.unshift({
    id: makeId("evt"),
    type,
    details,
    ip: request ? requestIp(request) : "",
    createdAt: nowIso()
  });
  appDb.events = appDb.events.slice(0, 250);
  saveDatabase();
}

function apiUrl(base, params) {
  const url = new URL(base);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return url;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(12000),
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

function extractBreedEntries(wikitext) {
  const section = wikitext.split(/^==\s*A\s*==\s*$/m)[1]?.split(/^==\s*References\s*==/m)[0];
  if (!section) throw new Error("Wikipedia breed list structure changed");
  const clean = section.replace(/<ref\b[^>]*\/\s*>/gi, "")
    .replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/gi, "")
    .replace(/<gallery\b[^>]*>[\s\S]*?<\/gallery>/gi, "")
    .replace(/\[\[([\s\S]*?)\]\]/g, (_, link) => "[[" + link.replace(/\s+/g, " ") + "]]");
  const entries = new Map();
  for (const match of clean.matchAll(/^\*+\s*([^\n]+)/gm)) {
    const line = match[1].trim();
    const link = line.match(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/);
    const title = normalizeTitle(link ? link[1] : line.split(/[=({<]/)[0]);
    const name = normalizeTitle(link ? link[2] || link[1] : title);
    if (!title || title.includes(":") || title.startsWith("[")) continue;
    entries.set(titleToId(title), { title, name, linked: Boolean(link) });
  }
  return [...entries.values()];
}

async function fetchBreedEntries() {
  const data = await fetchJson(apiUrl(WIKI_API, {
    action: "parse", page: LIST_PAGE, prop: "wikitext", format: "json"
  }));
  return extractBreedEntries(data.parse.wikitext["*"]);
}

function chunks(items, size) {
  const grouped = [];

  for (let index = 0; index < items.length; index += size) {
    grouped.push(items.slice(index, index + size));
  }

  return grouped;
}

async function fetchWikipediaPages(titles, requestJson = fetchJson) {
  const pages = [];

  for (const titleBatch of chunks(titles, PAGE_BATCH_SIZE)) {
    const data = await requestJson(
      apiUrl(WIKI_API, {
        action: "query",
        prop: "extracts|pageimages|pageprops|info",
        exintro: "1",
        exlimit: "max",
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
        .filter((page) => !("missing" in page) && !("invalid" in page))
        .map((page) => ({
          pageId: page.pageid,
          aliases: titleBatch.filter(title => {
            let resolved = title;
            for (const change of [...(data.query.normalized || []), ...(data.query.redirects || [])]) {
              if (change.from === resolved) resolved = change.to;
            }
            return resolved === page.title;
          }),
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

async function buildDomesticBreeds() {
  const entries = await fetchBreedEntries();
  const pages = await fetchWikipediaPages(entries.filter(entry => entry.linked).map(entry => entry.title));
  const details = await fetchWikidataDetails(pages.map(page => page.wikidataId)).catch(() => new Map());
  const origins = await fetchLabels([...details.values()].flatMap(detail => detail.originIds)).catch(() => new Map());
  const byTitle = new Map();
  for (const page of pages) {
    for (const title of [page.title, ...page.aliases]) byTitle.set(titleToId(title), page);
  }
  const records = entries.map(entry => {
    const page = byTitle.get(titleToId(entry.title));
    const detail = details.get(page?.wikidataId);
    const origin = detail?.originIds?.map(id => origins.get(id)).filter(Boolean).join(", ");
    const image = page ? imageFor(page, detail) : FALLBACK_IMAGE;
    const sourceUrl = page?.sourceUrl || "https://en.wikipedia.org/wiki/List_of_pigeon_breeds";
    return { id: titleToId(page?.title || entry.title), name: page?.title || entry.name,
      aliases: [...new Set([entry.name, entry.title, ...(page?.aliases || [])])],
      kind: "breed", source: "Wikimedia", origin: origin || MISSING_SOURCE,
      size: MISSING_SOURCE, flight: MISSING_SOURCE, temperament: MISSING_SOURCE,
      fact: extractFact(page?.extract || ""), history: page?.extract || "",
      image, hasRealImage: image !== FALLBACK_IMAGE, imageSource: image !== FALLBACK_IMAGE ? "Wikimedia" : "fallback",
      sourceUrl, wikidataId: page?.wikidataId || "",
      fieldSources: { name: "Wikipedia breed list", description: "Wikipedia", ...(origin ? { origin: "Wikidata" } : {}) }
    };
  });
  return [...new Map(records.map(record => [record.id, record])).values()];
}

function readCatalogSnapshot(name) {
  try {
    const snapshot = JSON.parse(fs.readFileSync(path.join(__dirname, "data", name), "utf8"));
    // Serve the bundled catalogue immediately on cold starts. Long imports run
    // via refresh:catalog; long-lived servers also refresh after this interval.
    return { ...snapshot, expiresAt: Date.now() + BREED_CACHE_TTL };
  }
  catch { return undefined; }
}

const getCatalog = createCatalog({
  loadSpecies: () => fetchBirdnetSpecies(),
  loadDomestic: async () => ({ records: await buildDomesticBreeds() }),
  readSaved: () => appDb.catalogCache,
  save: (sources) => { appDb.catalogCache = sources; saveDatabase(); },
  snapshots: {
    birdnet: readCatalogSnapshot("birdnet-pigeons.json"),
    domestic: readCatalogSnapshot("domestic-pigeons.json") || {
      records: appDb.breedCache.data || [], cachedAt: appDb.breedCache.cachedAt,
      expiresAt: appDb.breedCache.expiresAt, status: "snapshot"
    }
  }
});

function catalogCacheControl(catalog) {
  const seconds = Math.max(0, Math.floor((catalog.expiresAt - Date.now()) / 1000));
  return `public, max-age=0, s-maxage=${seconds}`;
}

function sendJson(response, statusCode, data, headers = {}) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    ...headers
  });
  response.end(JSON.stringify(data));
}

function airtableConfigured() {
  return Boolean(AIRTABLE_API_KEY && AIRTABLE_BASE_ID);
}

function airtableTableUrl(tableName, params = {}) {
  const url = new URL(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(tableName)}`);
  Object.entries(params).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((item) => url.searchParams.append(key, item));
    } else if (value !== undefined && value !== "") {
      url.searchParams.set(key, value);
    }
  });
  return url;
}

async function airtableRequest(tableName, options = {}, params = {}) {
  const response = await fetch(airtableTableUrl(tableName, params), {
    ...options,
    headers: {
      authorization: `Bearer ${AIRTABLE_API_KEY}`,
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const error = new Error(`Airtable request failed: ${response.status}`);
    error.statusCode = 502;
    throw error;
  }

  return response.status === 204 ? {} : response.json();
}

async function listAirtableRecords(tableName, params = {}) {
  const records = [];
  let offset = "";

  do {
    const data = await airtableRequest(tableName, {}, {
      pageSize: "100",
      ...params,
      offset
    });
    records.push(...(data.records || []));
    offset = data.offset || "";
  } while (offset);

  return records;
}

function cleanNickname(value) {
  const nickname = String(value || "")
    .replace(/[^\w .'-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 24);

  return nickname || "Anonymous";
}

function cleanDrawingText(value, fallback, maxLength = 48) {
  return String(value || "")
    .replace(/[^\w .,'!-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength) || fallback;
}

function parseImageDataUrl(value) {
  const match = String(value || "").match(/^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/i);

  if (!match) {
    throw new Error("Upload a PNG, JPG, or WebP drawing image.");
  }

  const mime = match[1].toLowerCase().replace("jpg", "jpeg");
  const bytes = Math.floor(match[2].length * 0.75);

  if (bytes > 650_000) {
    throw new Error("Image is too large. Please upload a smaller drawing.");
  }

  return {
    mimeType: `image/${mime}`,
    bytes
  };
}

function drawingStatusLabel(status) {
  const labels = {
    approved: "Published",
    needs_review: "Needs review",
    rejected: "Rejected"
  };

  return labels[status] || status;
}

function publicDrawing(entry) {
  return {
    id: entry.id,
    artist: entry.artist,
    title: entry.title,
    imageDataUrl: entry.imageDataUrl,
    status: entry.status,
    statusLabel: drawingStatusLabel(entry.status),
    aiFeedback: entry.aiFeedback,
    createdAt: entry.createdAt
  };
}

function drawingEntries(limit = 60) {
  refreshDatabaseFromStorage();
  return appDb.drawings
    .filter((entry) => entry.status === "approved" || entry.status === "needs_review")
    .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))
    .slice(0, limit)
    .map(publicDrawing);
}

async function writeAirtableDrawing(drawing) {
  if (!airtableConfigured()) return;

  try {
    await airtableRequest(AIRTABLE_DRAWINGS_TABLE, {
      method: "POST",
      body: JSON.stringify({
        records: [{
          fields: {
            Id: drawing.id,
            Artist: drawing.artist,
            Title: drawing.title,
            ImageDataUrl: drawing.imageDataUrl,
            Status: drawing.status,
            IsDrawing: drawing.ai.isDrawing,
            IsPigeon: drawing.ai.isPigeon,
            Confidence: drawing.ai.confidence,
            AiFeedback: drawing.aiFeedback,
            CreatedAt: drawing.createdAt
          }
        }],
        typecast: true
      })
    });
  } catch (error) {
    console.warn("Could not write drawing to Airtable.", error);
  }
}

async function addDrawingSubmission(body, request) {
  refreshDatabaseFromStorage();

  const artist = cleanDrawingText(body.artist, "Anonymous artist", 32);
  const title = cleanDrawingText(body.title, "Untitled pigeon", 48);
  const imageDataUrl = String(body.imageDataUrl || "");
  const image = parseImageDataUrl(imageDataUrl);
  const ai = {
    configured: false,
    isDrawing: null,
    isPigeon: null,
    confidence: 0
  };
  const status = "approved";
  const drawing = {
    id: makeId("drw"),
    artist,
    title,
    imageDataUrl,
    imageBytes: image.bytes,
    imageMimeType: image.mimeType,
    status,
    ai,
    aiFeedback: "Saved to the community pigeon drawing gallery.",
    createdAt: nowIso(),
    ip: requestIp(request)
  };

  appDb.drawings.unshift(drawing);
  appDb.drawings = appDb.drawings.slice(0, 120);
  logEvent("drawing_submitted", {
    id: drawing.id,
    status,
    aiConfigured: ai.configured,
    isDrawing: ai.isDrawing,
    isPigeon: ai.isPigeon
  }, request);
  saveDatabase();
  writeAirtableDrawing(drawing);

  return drawing;
}

function localLeaderboardEntries(limit = 10) {
  refreshDatabaseFromStorage();

  return appDb.leaderboard
    .map((entry) => ({
      nickname: entry.nickname,
      feeds: Number(entry.feeds) || 0,
      updatedAt: entry.updatedAt || entry.createdAt || ""
    }))
    .sort((left, right) => right.feeds - left.feeds || left.nickname.localeCompare(right.nickname))
    .slice(0, limit);
}

function leaderboardFromScoreRecords(records, limit = 10) {
  const totals = new Map();

  records.forEach((record) => {
    const fields = record.fields || {};
    const nickname = cleanNickname(fields.Nickname);
    const amount = Math.max(0, Math.floor(Number(fields.Amount) || 0));
    if (!amount) return;

    const key = nickname.toLocaleLowerCase("en");
    const createdAt = fields.CreatedAt || record.createdTime || "";
    const existing = totals.get(key);

    if (existing) {
      existing.feeds += amount;
      if (createdAt > existing.updatedAt) existing.updatedAt = createdAt;
    } else {
      totals.set(key, { nickname, feeds: amount, updatedAt: createdAt });
    }
  });

  return [...totals.values()]
    .sort((left, right) => right.feeds - left.feeds || left.nickname.localeCompare(right.nickname))
    .slice(0, limit);
}

async function leaderboardEntries(limit = 10) {
  if (!airtableConfigured()) return localLeaderboardEntries(limit);

  const records = await listAirtableRecords(AIRTABLE_SCORES_TABLE);
  return leaderboardFromScoreRecords(records, limit);
}

async function addLeaderboardScore(nickname, amount, session, request) {
  refreshDatabaseFromStorage();

  const storedSession = appDb.sessions.find((entry) => entry.id === session.id) || session;

  if (!appDb.sessions.some((entry) => entry.id === storedSession.id)) {
    appDb.sessions.push(storedSession);
  }

  let updated;

  if (airtableConfigured()) {
    await airtableRequest(AIRTABLE_SCORES_TABLE, {
      method: "POST",
      body: JSON.stringify({
        records: [{
          fields: {
            SubmissionId: makeId("score"),
            Nickname: nickname,
            Amount: amount,
            SessionId: storedSession.id,
            CreatedAt: nowIso()
          }
        }],
        typecast: true
      })
    });

    const allEntries = await leaderboardEntries(Number.MAX_SAFE_INTEGER);
    updated = allEntries.find((entry) => entry.nickname.toLowerCase() === nickname.toLowerCase());
  } else {
    const existing = appDb.leaderboard.find((entry) => entry.nickname.toLowerCase() === nickname.toLowerCase());

    if (existing) {
      existing.feeds += amount;
      existing.updatedAt = nowIso();
      existing.sessionId = storedSession.id;
      updated = existing;
    } else {
      updated = {
        nickname,
        feeds: amount,
        sessionId: storedSession.id,
        createdAt: nowIso(),
        updatedAt: nowIso()
      };
      appDb.leaderboard.push(updated);
    }
  }

  storedSession.totalFeeds += amount;
  storedSession.submissions += 1;
  storedSession.updatedAt = nowIso();
  logEvent("feed_submitted", { nickname, amount, total: updated?.feeds || amount }, request);
  saveDatabase();
  return updated || { nickname, feeds: amount };
}

async function deleteLeaderboardEntry(nickname) {
  if (airtableConfigured()) {
    const records = await listAirtableRecords(AIRTABLE_SCORES_TABLE);
    const recordIds = records
      .filter((record) => cleanNickname(record.fields?.Nickname).toLowerCase() === nickname.toLowerCase())
      .map((record) => record.id);

    for (const batch of chunks(recordIds, 10)) {
      await airtableRequest(AIRTABLE_SCORES_TABLE, { method: "DELETE" }, { "records[]": batch });
    }

    return recordIds.length > 0;
  }

  refreshDatabaseFromStorage();

  const before = appDb.leaderboard.length;
  appDb.leaderboard = appDb.leaderboard.filter((entry) => entry.nickname !== nickname);
  saveDatabase();
  return appDb.leaderboard.length !== before;
}

async function resetLeaderboard() {
  if (airtableConfigured()) {
    const records = await listAirtableRecords(AIRTABLE_SCORES_TABLE);

    for (const batch of chunks(records.map((record) => record.id), 10)) {
      await airtableRequest(AIRTABLE_SCORES_TABLE, { method: "DELETE" }, { "records[]": batch });
    }

    return records.length;
  }

  refreshDatabaseFromStorage();
  const removed = appDb.leaderboard.length;
  appDb.leaderboard = [];
  saveDatabase();
  return removed;
}

function readJsonBody(request, maxBytes = 4096) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;

      if (body.length > maxBytes) {
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

function apiDocs() {
  return {
    name: "Pigeon Crumbs API",
    version: "1.0.0",
    features: [
      "Anonymous sessions",
      "Rate-limited leaderboard submissions",
      "Community pigeon drawing uploads",
      "Server-side PigeonDex cache",
      "Optional Airtable drawing and leaderboard storage",
      "BirdNET species metadata and attributed photos alongside domestic breeds",
      "Protected admin moderation"
    ],
    auth: {
      admin: "Admin endpoints require the x-admin-token header. Set ADMIN_TOKEN in production."
    },
    endpoints: [
      { method: "GET", path: "/api/session", description: "Create or return the current anonymous session." },
      { method: "GET", path: "/api/leaderboard", description: "Return the top pigeon feeders." },
      { method: "POST", path: "/api/feed", description: "Submit a completed feeding round.", body: { nickname: "string", amount: "number" } },
      { method: "GET", path: "/api/breeds", description: "Return BirdNET pigeon species and supplemental domestic breeds, with source status and counts." },
      { method: "GET", path: "/api/breeds/:id", description: "Return one cached breed by id." },
      { method: "GET", path: "/api/drawings", description: "Return stored pigeon drawings." },
      { method: "POST", path: "/api/drawings", description: "Submit a pigeon drawing image for storage.", body: { artist: "string", title: "string", imageDataUrl: "base64 data URL" } },
      { method: "POST", path: "/api/events", description: "Record a lightweight product analytics event.", body: { type: "string", details: "object" } },
      { method: "GET", path: "/api/admin/leaderboard", description: "Admin: list full leaderboard." },
      { method: "DELETE", path: "/api/admin/leaderboard/:nickname", description: "Admin: delete one leaderboard entry." },
      { method: "POST", path: "/api/admin/reset-leaderboard", description: "Admin: clear leaderboard." },
      { method: "GET", path: "/api/admin/events", description: "Admin: view recent backend events." }
    ]
  };
}

function isAdminRequest(request) {
  return request.headers["x-admin-token"] === ADMIN_TOKEN;
}

function requireAdmin(request, response) {
  if (isAdminRequest(request)) return true;

  sendJson(response, 401, {
    error: "Admin token required."
  });
  return false;
}

function methodNotAllowed(response) {
  sendJson(response, 405, { error: "Method not allowed." });
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

  if (url.pathname === "/api/docs") {
    if (request.method !== "GET") {
      methodNotAllowed(response);
      return;
    }

    sendJson(response, 200, apiDocs(), {
      "cache-control": "no-store"
    });
    return;
  }

  if (url.pathname === "/api/session") {
    if (request.method !== "GET") {
      methodNotAllowed(response);
      return;
    }

    const session = findOrCreateSession(request, response);
    sendJson(response, 200, {
      sessionId: session.id,
      createdAt: session.createdAt,
      totalFeeds: session.totalFeeds,
      submissions: session.submissions
    }, {
      "cache-control": "no-store"
    });
    return;
  }

  if (url.pathname === "/api/leaderboard") {
    if (request.method !== "GET") {
      methodNotAllowed(response);
      return;
    }

    if (!requireRateLimit(request, response, "leaderboard", 120, 60_000)) return;

    leaderboardEntries(10)
      .then((leaderboard) => sendJson(response, 200, { leaderboard }, {
        "cache-control": "no-store"
      }))
      .catch((error) => sendJson(response, error.statusCode || 500, {
        error: "Could not load the leaderboard.",
        message: error.message
      }));
    return;
  }

  if (url.pathname === "/api/feed") {
    if (request.method !== "POST") {
      methodNotAllowed(response);
      return;
    }

    if (!requireRateLimit(request, response, "feed", 30, 60_000)) return;

    const session = findOrCreateSession(request, response);

    readJsonBody(request)
      .then(async (body) => {
        const nickname = cleanNickname(body.nickname);
        const amount = Math.max(1, Math.floor(Number(body.amount) || 1));
        const updated = await addLeaderboardScore(nickname, amount, session, request);
        const leaderboard = await leaderboardEntries(10);
        sendJson(response, 200, {
          nickname,
          feeds: updated.feeds,
          sessionId: session.id,
          leaderboard
        }, {
          "cache-control": "no-store"
        });
      })
      .catch((error) => sendJson(response, error.statusCode || 400, {
        error: error.statusCode ? "Could not save the score." : error.message,
        ...(error.statusCode ? { message: error.message } : {})
      }));
    return;
  }

  if (url.pathname === "/api/events") {
    if (request.method !== "POST") {
      methodNotAllowed(response);
      return;
    }

    if (!requireRateLimit(request, response, "events", 120, 60_000)) return;

    readJsonBody(request)
      .then((body) => {
        const type = String(body.type || "unknown").replace(/[^\w:-]/g, "").slice(0, 48) || "unknown";
        const details = typeof body.details === "object" && body.details ? body.details : {};
        logEvent(type, details, request);
        sendJson(response, 202, { ok: true });
      })
      .catch((error) => sendJson(response, 400, { error: error.message }));
    return;
  }

  if (url.pathname === "/api/drawings") {
    if (request.method === "GET") {
      if (!requireRateLimit(request, response, "drawings", 80, 60_000)) return;

      sendJson(response, 200, {
        drawings: drawingEntries(60),
        airtableConfigured: airtableConfigured()
      }, {
        "cache-control": "no-store"
      });
      return;
    }

    if (request.method === "POST") {
      if (!requireRateLimit(request, response, "drawing-submit", 8, 60_000)) return;

      readJsonBody(request, 900_000)
        .then((body) => addDrawingSubmission(body, request))
        .then((drawing) => {
          const accepted = drawing.status !== "rejected";

          sendJson(response, accepted ? 201 : 422, {
            drawing: publicDrawing(drawing),
            message: accepted
              ? "Drawing submitted to the pigeon gallery."
              : "AI rejected this image because it does not look like a pigeon drawing.",
            ai: drawing.ai
          }, {
            "cache-control": "no-store"
          });
        })
        .catch((error) => sendJson(response, 400, {
          error: error.message
        }));
      return;
    }

    methodNotAllowed(response);
    return;
  }

  if (url.pathname === "/api/breeds") {
    if (request.method !== "GET") {
      methodNotAllowed(response);
      return;
    }

    if (!requireRateLimit(request, response, "breeds", 60, 60_000)) return;

    getCatalog()
      .then((catalog) => sendJson(response, 200, {
        ...catalog, expiresAt: new Date(catalog.expiresAt).toISOString()
      }, {
        "cache-control": catalogCacheControl(catalog)
      }))
      .catch((error) => sendJson(response, 502, {
        error: "Could not load pigeon breed cache.",
        message: error.message
      }));
    return;
  }

  if (url.pathname.startsWith("/api/breeds/")) {
    if (request.method !== "GET") {
      methodNotAllowed(response);
      return;
    }

    if (!requireRateLimit(request, response, "breed-detail", 120, 60_000)) return;

    const id = decodeURIComponent(url.pathname.replace("/api/breeds/", ""));
    getCatalog()
      .then((catalog) => {
        const breed = catalog.breeds.find((entry) => entry.id === id);

        if (!breed) {
          sendJson(response, 404, { error: "Breed not found." });
          return;
        }

        sendJson(response, 200, { breed }, {
          "cache-control": catalogCacheControl(catalog)
        });
      })
      .catch((error) => sendJson(response, 502, {
        error: "Could not load pigeon breed cache.",
        message: error.message
      }));
    return;
  }

  if (url.pathname === "/api/admin/leaderboard") {
    if (request.method !== "GET") {
      methodNotAllowed(response);
      return;
    }

    if (!requireAdmin(request, response)) return;

    leaderboardEntries(100)
      .then((leaderboard) => sendJson(response, 200, {
        leaderboard,
        storage: airtableConfigured() ? `Airtable: ${AIRTABLE_SCORES_TABLE}` : activeDataFile
      }, {
        "cache-control": "no-store"
      }))
      .catch((error) => sendJson(response, error.statusCode || 500, {
        error: "Could not load the leaderboard.",
        message: error.message
      }));
    return;
  }

  if (url.pathname.startsWith("/api/admin/leaderboard/")) {
    if (request.method !== "DELETE") {
      methodNotAllowed(response);
      return;
    }

    if (!requireAdmin(request, response)) return;

    const nickname = decodeURIComponent(url.pathname.replace("/api/admin/leaderboard/", ""));
    deleteLeaderboardEntry(nickname)
      .then(async (deleted) => {
        logEvent("admin_deleted_leaderboard_entry", { nickname, deleted }, request);
        saveDatabase();
        const leaderboard = await leaderboardEntries(100);
        sendJson(response, deleted ? 200 : 404, { deleted, leaderboard }, {
          "cache-control": "no-store"
        });
      })
      .catch((error) => sendJson(response, error.statusCode || 500, {
        error: "Could not delete the leaderboard entry.",
        message: error.message
      }));
    return;
  }

  if (url.pathname === "/api/admin/reset-leaderboard") {
    if (request.method !== "POST") {
      methodNotAllowed(response);
      return;
    }

    if (!requireAdmin(request, response)) return;

    resetLeaderboard()
      .then((removed) => {
        logEvent("admin_reset_leaderboard", { removed }, request);
        saveDatabase();
        sendJson(response, 200, { removed, leaderboard: [] }, {
          "cache-control": "no-store"
        });
      })
      .catch((error) => sendJson(response, error.statusCode || 500, {
        error: "Could not reset the leaderboard.",
        message: error.message
      }));
    return;
  }

  if (url.pathname === "/api/admin/events") {
    if (request.method !== "GET") {
      methodNotAllowed(response);
      return;
    }

    if (!requireAdmin(request, response)) return;

    refreshDatabaseFromStorage();
    sendJson(response, 200, {
      events: appDb.events.slice(0, 100),
      sessions: appDb.sessions.slice(-25)
    }, {
      "cache-control": "no-store"
    });
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

module.exports.buildDomesticBreeds = buildDomesticBreeds;
module.exports.extractBreedEntries = extractBreedEntries;
module.exports.fetchWikipediaPages = fetchWikipediaPages;
module.exports.leaderboardFromScoreRecords = leaderboardFromScoreRecords;
