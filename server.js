const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const WIKI_API = "https://en.wikipedia.org/w/api.php";
const WIKIDATA_API = "https://www.wikidata.org/w/api.php";
const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
const COMMONS_FILE = "https://commons.wikimedia.org/wiki/Special:FilePath/";
const FALLBACK_IMAGE = "assets/pigeon-hero-wide.png";
const LIST_PAGE = "List_of_pigeon_breeds";
const MAX_INITIAL_BREEDS = 260;
const PAGE_BATCH_SIZE = 35;
const BREED_CACHE_TTL = 1000 * 60 * 60 * 6;
const BREED_CACHE_VERSION = 2;
const MISSING_SOURCE = "Not listed in source";
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, "data", "app-db.json");
const FALLBACK_DATA_FILE = path.join(os.tmpdir(), "pigeon-crumbs-app-db.json");
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "dev-admin";
const SESSION_COOKIE = "pigeon_session";
const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY || "";
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID || "";
const AIRTABLE_BREEDS_TABLE = process.env.AIRTABLE_BREEDS_TABLE || "Breeds";
const AIRTABLE_CACHE_TABLE = process.env.AIRTABLE_CACHE_TABLE || "Cache";
const AIRTABLE_DRAWINGS_TABLE = process.env.AIRTABLE_DRAWINGS_TABLE || "Drawings";
const AIRTABLE_WIKIDATA_FIELD = process.env.AIRTABLE_WIKIDATA_FIELD || "WikiDataId";
const AIRTABLE_CACHED_AT_FIELD = process.env.AIRTABLE_CACHED_AT_FIELD || "CacheAt";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_VISION_MODEL = process.env.OPENAI_VISION_MODEL || "gpt-4.1-mini";
let breedCache = {
  expiresAt: 0,
  data: null,
  pending: null
};
let activeDataFile = DATA_FILE;
let appDb = loadDatabase();
const rateLimitBuckets = new Map();
const allowedRootFiles = new Set([
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
        pithumbsize: "900",
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
        iiurlwidth: "900",
        format: "json",
        origin: "*"
      })
    );
    const page = Object.values(data.query?.pages || {})[0];

    return page?.imageinfo?.[0]?.thumburl || page?.imageinfo?.[0]?.url || "";
  } catch (error) {
    console.warn(`Could not find Commons image for ${title}`, error);
    return "";
  }
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

async function enrichBreedImages(breeds) {
  const missingImages = breeds.filter((breed) => !hasSpecificImage(breed));

  await mapLimit(missingImages, 5, async (breed) => {
    const image = await findWikipediaSearchImage(breed.name) || await findCommonsImage(breed.name);

    if (image) {
      breed.image = image;
      breed.hasRealImage = true;
      breed.imageSource = "search";
    }
  });

  return sortBreeds(breeds);
}

async function buildBreeds() {
  const titles = await fetchBreedTitles();
  const pages = await fetchWikipediaPages(titles);
  const wdDetails = await fetchWikidataDetails(pages.map((page) => page.wikidataId));
  const allOriginIds = [...wdDetails.values()].flatMap((detail) => detail.originIds);
  const originLabels = await fetchLabels(allOriginIds);

  const breeds = sortBreeds(
    pages.map((page) => {
      const wdDetail = wdDetails.get(page.wikidataId);
      const origin = wdDetail?.originIds?.map((id) => originLabels.get(id)).filter(Boolean).join(", ");
      const text = `${page.title}. ${page.extract}`;
      const image = imageFor(page, wdDetail);

      return {
        id: titleToId(page.title),
        name: page.title,
        origin: origin || inferOriginFromText(text) || MISSING_SOURCE,
        size: inferSize(text),
        flight: inferFlight(text),
        temperament: inferTemperament(text),
        fact: extractFact(page.extract),
        history: page.extract || extractFact(page.extract),
        image,
        hasRealImage: Boolean(image && image !== FALLBACK_IMAGE),
        imageSource: image && image !== FALLBACK_IMAGE ? "api" : "fallback",
        sourceUrl: page.sourceUrl,
        wikidataId: page.wikidataId
      };
    })
  );

  return enrichBreedImages(breeds);
}

async function getCachedBreeds() {
  const now = Date.now();

  if (breedCache.data && breedCache.expiresAt > now) return breedCache.data;
  if (breedCache.pending) return breedCache.pending;

  const airtableCache = await readAirtableBreedCache();

  if (airtableCache?.data?.length) {
    breedCache = {
      data: airtableCache.data,
      expiresAt: airtableCache.expiresAt,
      pending: null
    };
    appDb.breedCache = airtableCache;
    saveDatabase();
    return airtableCache.data;
  }

  if (appDb.breedCache.version === BREED_CACHE_VERSION && appDb.breedCache.data?.length && appDb.breedCache.expiresAt > now) {
    breedCache = {
      data: appDb.breedCache.data,
      expiresAt: appDb.breedCache.expiresAt,
      pending: null
    };
    return appDb.breedCache.data;
  }

  breedCache.pending = buildBreeds()
    .then((data) => {
      const expiresAt = Date.now() + BREED_CACHE_TTL;
      breedCache = {
        data,
        expiresAt,
        pending: null
      };
      appDb.breedCache = {
        version: BREED_CACHE_VERSION,
        cachedAt: nowIso(),
        expiresAt,
        data
      };
      saveDatabase();
      writeAirtableBreedCache(data, expiresAt);
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

function airtableConfigured() {
  return Boolean(AIRTABLE_API_KEY && AIRTABLE_BASE_ID);
}

function airtableTableUrl(tableName, params = {}) {
  const url = new URL(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(tableName)}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== "") url.searchParams.set(key, value);
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
    throw new Error(`Airtable request failed: ${response.status}`);
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

function airtableBreedFromRecord(record) {
  const fields = record.fields || {};

  return {
    airtableRecordId: record.id,
    id: fields.Id || "",
    name: fields.Name || "",
    origin: fields.Origin || MISSING_SOURCE,
    size: fields.Size || MISSING_SOURCE,
    flight: fields.Flight || MISSING_SOURCE,
    temperament: fields.Temperament || MISSING_SOURCE,
    fact: fields.Fact || "",
    history: fields.History || fields.Fact || "",
    image: fields.Image || FALLBACK_IMAGE,
    hasRealImage: Boolean(fields.HasRealImage),
    imageSource: fields.ImageSource || "",
    sourceUrl: fields.SourceUrl || "",
    wikidataId: fields[AIRTABLE_WIKIDATA_FIELD] || fields.WikidataId || fields.WikiDataId || ""
  };
}

function airtableFieldsFromBreed(breed) {
  return {
    Id: breed.id,
    Name: breed.name,
    Origin: breed.origin,
    Size: breed.size,
    Flight: breed.flight,
    Temperament: breed.temperament,
    Fact: breed.fact,
    History: breed.history,
    Image: breed.image,
    HasRealImage: Boolean(breed.hasRealImage),
    ImageSource: breed.imageSource || "",
    SourceUrl: breed.sourceUrl,
    [AIRTABLE_WIKIDATA_FIELD]: breed.wikidataId || ""
  };
}

async function readAirtableBreedCache() {
  if (!airtableConfigured()) return null;

  try {
    const [metaRecord] = await listAirtableRecords(AIRTABLE_CACHE_TABLE, {
      filterByFormula: "{Key}='breeds'"
    });

    if (!metaRecord || Number(metaRecord.fields?.ExpiresAt || 0) <= Date.now()) return null;

    const records = await listAirtableRecords(AIRTABLE_BREEDS_TABLE);
    const breeds = records
      .map(airtableBreedFromRecord)
      .filter((breed) => breed.id && breed.name);

    return breeds.length ? {
      cachedAt: metaRecord.fields?.[AIRTABLE_CACHED_AT_FIELD] || metaRecord.fields?.CachedAt || metaRecord.fields?.CacheAt || "",
      expiresAt: Number(metaRecord.fields?.ExpiresAt || 0),
      data: sortBreeds(breeds)
    } : null;
  } catch (error) {
    console.warn("Could not read Airtable breed cache.", error);
    return null;
  }
}

async function writeAirtableBreedCache(breeds, expiresAt) {
  if (!airtableConfigured()) return;

  try {
    const existingRecords = await listAirtableRecords(AIRTABLE_BREEDS_TABLE);
    const existingById = new Map(
      existingRecords
        .filter((record) => record.fields?.Id)
        .map((record) => [record.fields.Id, record.id])
    );

    for (const batch of chunks(breeds, 10)) {
      const creates = [];
      const updates = [];

      batch.forEach((breed) => {
        const recordId = existingById.get(breed.id);
        const fields = airtableFieldsFromBreed(breed);

        if (recordId) {
          updates.push({ id: recordId, fields });
        } else {
          creates.push({ fields });
        }
      });

      if (creates.length) {
        await airtableRequest(AIRTABLE_BREEDS_TABLE, {
          method: "POST",
          body: JSON.stringify({ records: creates, typecast: true })
        });
      }

      if (updates.length) {
        await airtableRequest(AIRTABLE_BREEDS_TABLE, {
          method: "PATCH",
          body: JSON.stringify({ records: updates, typecast: true })
        });
      }
    }

    const [metaRecord] = await listAirtableRecords(AIRTABLE_CACHE_TABLE, {
      filterByFormula: "{Key}='breeds'"
    });
    const metaFields = {
      Key: "breeds",
      [AIRTABLE_CACHED_AT_FIELD]: nowIso(),
      ExpiresAt: expiresAt,
      Count: breeds.length
    };

    if (metaRecord) {
      await airtableRequest(AIRTABLE_CACHE_TABLE, {
        method: "PATCH",
        body: JSON.stringify({ records: [{ id: metaRecord.id, fields: metaFields }], typecast: true })
      });
    } else {
      await airtableRequest(AIRTABLE_CACHE_TABLE, {
        method: "POST",
        body: JSON.stringify({ records: [{ fields: metaFields }], typecast: true })
      });
    }
  } catch (error) {
    console.warn("Could not write Airtable breed cache.", error);
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
    approved: "AI approved",
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

function extractJsonObject(text) {
  const match = String(text || "").match(/\{[\s\S]*\}/);

  if (!match) return null;

  try {
    return JSON.parse(match[0]);
  } catch (error) {
    return null;
  }
}

async function validateDrawingWithAi(imageDataUrl) {
  if (!OPENAI_API_KEY) {
    return {
      configured: false,
      isDrawing: null,
      isPigeon: null,
      confidence: 0,
      feedback: "AI validation is not configured yet, so this drawing is waiting for review."
    };
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${OPENAI_API_KEY}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: OPENAI_VISION_MODEL,
      input: [{
        role: "user",
        content: [
          {
            type: "input_text",
            text: [
              "You moderate a community pigeon drawing gallery.",
              "Return only JSON with keys isDrawing boolean, isPigeon boolean, confidence number 0-1, feedback string.",
              "Approve drawings, sketches, paintings, cartoons, or digital art of pigeons.",
              "Reject real bird photos, unrelated drawings, screenshots, and non-pigeon animals."
            ].join(" ")
          },
          {
            type: "input_image",
            image_url: imageDataUrl,
            detail: "low"
          }
        ]
      }]
    })
  });

  if (!response.ok) {
    throw new Error(`AI validation failed: ${response.status}`);
  }

  const data = await response.json();
  const outputText = data.output_text || (data.output || [])
    .flatMap((item) => item.content || [])
    .map((item) => item.text || "")
    .join(" ");
  const parsed = extractJsonObject(outputText);

  if (!parsed) {
    throw new Error("AI validation returned an unreadable response.");
  }

  return {
    configured: true,
    isDrawing: Boolean(parsed.isDrawing),
    isPigeon: Boolean(parsed.isPigeon),
    confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
    feedback: String(parsed.feedback || "AI checked this submission.").slice(0, 220)
  };
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
  const ai = await validateDrawingWithAi(imageDataUrl);
  const status = ai.configured
    ? (ai.isDrawing && ai.isPigeon ? "approved" : "rejected")
    : "needs_review";
  const drawing = {
    id: makeId("drw"),
    artist,
    title,
    imageDataUrl,
    imageBytes: image.bytes,
    imageMimeType: image.mimeType,
    status,
    ai,
    aiFeedback: ai.feedback,
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

function leaderboardEntries(limit = 10) {
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

function addLeaderboardScore(nickname, amount, session, request) {
  refreshDatabaseFromStorage();

  const storedSession = appDb.sessions.find((entry) => entry.id === session.id) || session;

  if (!appDb.sessions.some((entry) => entry.id === storedSession.id)) {
    appDb.sessions.push(storedSession);
  }

  const existing = appDb.leaderboard.find((entry) => entry.nickname.toLowerCase() === nickname.toLowerCase());

  if (existing) {
    existing.feeds += amount;
    existing.updatedAt = nowIso();
    existing.sessionId = storedSession.id;
  } else {
    appDb.leaderboard.push({
      nickname,
      feeds: amount,
      sessionId: storedSession.id,
      createdAt: nowIso(),
      updatedAt: nowIso()
    });
  }

  storedSession.totalFeeds += amount;
  storedSession.submissions += 1;
  storedSession.updatedAt = nowIso();
  logEvent("feed_submitted", { nickname, amount, total: existing ? existing.feeds : amount }, request);
  saveDatabase();
  return appDb.leaderboard.find((entry) => entry.nickname.toLowerCase() === nickname.toLowerCase());
}

function deleteLeaderboardEntry(nickname) {
  refreshDatabaseFromStorage();

  const before = appDb.leaderboard.length;
  appDb.leaderboard = appDb.leaderboard.filter((entry) => entry.nickname !== nickname);
  saveDatabase();
  return appDb.leaderboard.length !== before;
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
      "AI-assisted pigeon drawing moderation",
      "Server-side PigeonDex cache",
      "Optional Airtable breed storage",
      "Wikipedia/Commons image enrichment for missing breed photos",
      "Protected admin moderation"
    ],
    auth: {
      admin: "Admin endpoints require the x-admin-token header. Set ADMIN_TOKEN in production."
    },
    endpoints: [
      { method: "GET", path: "/api/session", description: "Create or return the current anonymous session." },
      { method: "GET", path: "/api/leaderboard", description: "Return the top pigeon feeders." },
      { method: "POST", path: "/api/feed", description: "Submit a completed feeding round.", body: { nickname: "string", amount: "number" } },
      { method: "GET", path: "/api/breeds", description: "Return cached PigeonDex breed data from Wikimedia/Wikidata." },
      { method: "GET", path: "/api/breeds/:id", description: "Return one cached breed by id." },
      { method: "GET", path: "/api/drawings", description: "Return approved and review-pending pigeon drawings." },
      { method: "POST", path: "/api/drawings", description: "Submit a pigeon drawing image for AI validation and storage.", body: { artist: "string", title: "string", imageDataUrl: "base64 data URL" } },
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

    sendJson(response, 200, {
      leaderboard: leaderboardEntries(10)
    }, {
      "cache-control": "no-store"
    });
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
      .then((body) => {
        const nickname = cleanNickname(body.nickname);
        const amount = Math.max(1, Math.floor(Number(body.amount) || 1));
        const updated = addLeaderboardScore(nickname, amount, session, request);
        sendJson(response, 200, {
          nickname,
          feeds: updated.feeds,
          sessionId: session.id,
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
        aiConfigured: Boolean(OPENAI_API_KEY),
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

    getCachedBreeds()
      .then((breeds) => sendJson(response, 200, {
        cachedAt: appDb.breedCache.cachedAt || new Date(Date.now() - BREED_CACHE_TTL + Math.max(0, breedCache.expiresAt - Date.now())).toISOString(),
        expiresAt: new Date(breedCache.expiresAt || appDb.breedCache.expiresAt).toISOString(),
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

  if (url.pathname.startsWith("/api/breeds/")) {
    if (request.method !== "GET") {
      methodNotAllowed(response);
      return;
    }

    if (!requireRateLimit(request, response, "breed-detail", 120, 60_000)) return;

    const id = decodeURIComponent(url.pathname.replace("/api/breeds/", ""));
    getCachedBreeds()
      .then((breeds) => {
        const breed = breeds.find((entry) => entry.id === id);

        if (!breed) {
          sendJson(response, 404, { error: "Breed not found." });
          return;
        }

        sendJson(response, 200, { breed }, {
          "cache-control": "s-maxage=21600, stale-while-revalidate=86400"
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

    sendJson(response, 200, {
      leaderboard: leaderboardEntries(100),
      storage: activeDataFile
    }, {
      "cache-control": "no-store"
    });
    return;
  }

  if (url.pathname.startsWith("/api/admin/leaderboard/")) {
    if (request.method !== "DELETE") {
      methodNotAllowed(response);
      return;
    }

    if (!requireAdmin(request, response)) return;

    const nickname = decodeURIComponent(url.pathname.replace("/api/admin/leaderboard/", ""));
    const deleted = deleteLeaderboardEntry(nickname);
    logEvent("admin_deleted_leaderboard_entry", { nickname, deleted }, request);
    sendJson(response, deleted ? 200 : 404, {
      deleted,
      leaderboard: leaderboardEntries(100)
    }, {
      "cache-control": "no-store"
    });
    return;
  }

  if (url.pathname === "/api/admin/reset-leaderboard") {
    if (request.method !== "POST") {
      methodNotAllowed(response);
      return;
    }

    if (!requireAdmin(request, response)) return;

    refreshDatabaseFromStorage();
    const removed = appDb.leaderboard.length;
    appDb.leaderboard = [];
    logEvent("admin_reset_leaderboard", { removed }, request);
    saveDatabase();
    sendJson(response, 200, {
      removed,
      leaderboard: []
    }, {
      "cache-control": "no-store"
    });
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
