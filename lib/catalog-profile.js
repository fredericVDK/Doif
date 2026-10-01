const MISSING_SOURCE = "Not listed in source";
const RARITIES = ["common", "uncommon", "rare", "epic", "legendary"];
const KNOWN_ORIGINS = new Map([
  ["jacobin pigeon", "Asia"],
  ["indian fantail", "India"],
  ["australian saddleback tumbler", "Australia"]
]);

function missing(value) {
  return !value || value === MISSING_SOURCE;
}

function stableNumber(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function readableRange(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/,?\s+(?:where|which|while|although|but|with selective breeding|listed on|and (?:it|is|has|was|one))\b.*$/i, "")
    .replace(/\s*\([^)]*\)\s*$/g, "")
    .replace(/\s+(?:during|using)\b.*$/i, "")
    .replace(/[,;:\s]+$/g, "")
    .trim()
    .slice(0, 120);
}

const RANGE_PATTERNS = [
  /\bfound (?:only |primarily |mainly |widely |patchily distributed )?(?:on|in|throughout|across|from)\s+([^.;]+)/i,
  /\bendemic to\s+([^.;]+)/i,
  /\bnative to\s+([^.;]+)/i,
  /\b(?:occurs?|inhabits?|lives?) (?:only |primarily |mainly |widely )?(?:(?:on|in|throughout|across)\s+|the\s+)([^.;]+)/i,
  /\b(?:confined|restricted) to\s+([^.;]+)/i,
  /\b(?:widespread )?resident (?:breeding )?bird (?:on|in|throughout|across)\s+([^.;]+)/i,
  /\b(?:widespread|resident|present) (?:and common )?(?:on|in|throughout|across)\s+([^.;]+)/i,
  /\b(?:breeds?|resident breeder) (?:widely )?(?:on|in|throughout|across|from)\s+([^.;]+)/i,
  /\bdistributed (?:patchily )?(?:on|in|throughout|across|from)\s+([^.;]+)/i,
  /\b(?:range|distribution) (?:is |extends |ranges )?(?:from|across|throughout|in)\s+([^.;]+)/i,
  /\boriginat(?:ed|ing|es) (?:from|in)\s+([^.;]+)/i,
  /\b(?:developed|created|crafted|bred) (?:primarily )?in\s+([^.;]+)/i
];

const NAME_REGIONS = new Map([
  ["african", "Africa"], ["american", "United States"], ["andaman", "Andaman and Nicobar Islands"],
  ["anatolian", "Turkey"], ["antwerp", "Belgium"], ["arabian", "Arabian Peninsula"], ["armenian", "Armenia"], ["australian", "Australia"],
  ["azores", "Azores"], ["balearic", "Balearic Islands"], ["barbados", "Barbados"],
  ["berlin", "Germany"], ["birmingham", "United Kingdom"], ["bohemian", "Czech Republic"], ["bokhara", "Uzbekistan"], ["bolivian", "Bolivia"], ["breslau", "Poland"], ["budapest", "Hungary"],
  ["californian", "United States"], ["canary", "Canary Islands"], ["caribbean", "Caribbean"],
  ["chilean", "Chile"], ["chinese", "China"], ["comoro", "Comoros"], ["congo", "Central Africa"],
  ["carneau", "France"], ["cauchois", "France"], ["crete", "Crete"], ["danish", "Denmark"], ["danzig", "Poland"], ["debrecin", "Hungary"], ["dresden", "Germany"], ["dutch", "Netherlands"], ["egyptian", "Egypt"],
  ["english", "United Kingdom"], ["ethiopian", "Ethiopia"], ["fiji", "Fiji"],
  ["flores", "Indonesia"], ["german", "Germany"], ["ghana", "Ghana"], ["grenada", "Grenada"],
  ["ghent", "Belgium"], ["guinea", "New Guinea"], ["hawaiian", "Hawaii"], ["henderson", "Henderson Island"],
  ["indian", "India"], ["indonesian", "Indonesia"], ["jamaican", "Jamaica"],
  ["japanese", "Japan"], ["kosrae", "Micronesia"], ["luzon", "Philippines"],
  ["lahore", "Pakistan"], ["lebanon", "Lebanon"], ["lucerne", "Switzerland"], ["madagascar", "Madagascar"], ["malagasy", "Madagascar"], ["marquesan", "Marquesas Islands"],
  ["mauritius", "Mauritius"], ["mexican", "Mexico"], ["mindoro", "Philippines"],
  ["nicobar", "Nicobar Islands"], ["nigerian", "Nigeria"], ["nis ", "Serbia"], ["norwich", "United Kingdom"], ["palau", "Palau"], ["parisian", "France"],
  ["peruvian", "Peru"], ["philippine", "Philippines"], ["polish", "Poland"], ["prishtina", "Kosovo"],
  ["puerto rican", "Puerto Rico"], ["samoan", "Samoa"], ["seychelles", "Seychelles"],
  ["saxon", "Germany"], ["solomon", "Solomon Islands"], ["sri lanka", "Sri Lanka"], ["stralsund", "Germany"], ["sulawesi", "Indonesia"], ["sverdlovsk", "Russia"], ["szegedin", "Hungary"], ["thuringian", "Germany"], ["timor", "Timor"],
  ["turkish", "Turkey"], ["ukrainian", "Ukraine"], ["vienna", "Austria"], ["voorburg", "Netherlands"],
  ["wales", "United Kingdom"], ["wetar", "Indonesia"], ["zanzibar", "Tanzania"]
]);

function inferredOrigin(record, text) {
  if (!missing(record.origin)) return record.origin;
  if (KNOWN_ORIGINS.has(record.id)) return KNOWN_ORIGINS.get(record.id);
  for (const pattern of RANGE_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const value = readableRange(match[1]);
      if (value.length > 1 && !/specific island|^[a-z]:|\b(?:cover|journal|book|painting|specimen|captivity|museum)\b/i.test(value)) return value;
    }
  }
  const name = String(record.name || "").toLowerCase();
  for (const [term, region] of NAME_REGIONS) if (name.includes(term)) return region;
  return record.kind === "breed" ? "Domestic rock pigeon lineage" : "Wild range described in species profile";
}

function inferredSize(record, text) {
  if (!missing(record.size)) return record.size;
  const values = [...text.matchAll(/(?:up to |length of |measures? |about |approximately )?(\d{1,3})(?:[–-](\d{1,3}))?\s*cm\b/gi)]
    .map(match => Number(match[2] || match[1])).filter(value => value >= 10 && value <= 100);
  if (values.length) {
    const length = values[0], size = length <= 24 ? "Small" : length <= 38 ? "Medium" : "Large";
    return `${size} (about ${length} cm)`;
  }
  const name = String(record.name || "").toLowerCase();
  const genus = String(record.scientificName || "").split(" ")[0];
  if (/\b(giant|runt|king|mondain|crowned|imperial)\b/.test(name) || ["Ducula","Goura","Hemiphaga","Lopholaimus","Trugon"].includes(genus)) return "Large";
  if (/\b(diamond|ground dove|pygmy|dwarf|peaceful|zebra)\b/.test(name) || ["Columbina","Geopelia","Metriopelia","Oena","Uropelia"].includes(genus)) return "Small";
  return "Medium";
}

function inferredFlight(record) {
  if (!missing(record.flight)) return record.flight;
  const name = String(record.name || "").toLowerCase();
  if (/\b(tumbler|roller)\b/.test(name)) return "Acrobatic flyer";
  if (/\b(tippler|highflyer|high-flyer|flying|flight|skycutter|racer|homer|carrier)\b/.test(name)) return "Strong endurance flyer";
  if (/\b(ground|quail|bleeding-heart|crowned)\b/.test(name)) return "Mostly ground-dwelling; short flights";
  if (/\b(fruit|green|imperial|wood)\b/.test(name)) return "Strong forest flyer";
  if (record.kind === "breed" && /\b(pouter|cropper|owl|fantail|jacobin|trumpeter|helmet|modena|frill|show)\b/.test(name)) return "Mostly show and fancy flying";
  return record.kind === "breed" ? "Moderate domestic flyer" : "Agile wild flyer";
}

function inferredTemperament(record) {
  if (!missing(record.temperament)) return record.temperament;
  const name = String(record.name || "").toLowerCase();
  if (record.kind === "breed") {
    if (/\b(tumbler|roller|tippler|highflyer|racer|homer|carrier|flight|skycutter)\b/.test(name)) return "Active, energetic and trainable";
    return "Calm, social and people-oriented";
  }
  if (/\b(ground|quail|bleeding-heart)\b/.test(name)) return "Shy, quiet and ground-oriented";
  if (/\b(fruit|green|imperial|wood)\b/.test(name)) return "Alert, social and tree-dwelling";
  return "Alert and cautious in the wild";
}

function inferredRarity(record, text) {
  if (RARITIES.includes(String(record.gameRarity || record.rarity || "").toLowerCase())) return String(record.gameRarity || record.rarity).toLowerCase();
  if (/\b(extinct|critically endangered)\b/i.test(text)) return "legendary";
  if (/\bendangered\b/i.test(text)) return "epic";
  if (/\b(vulnerable|near threatened|rare breed)\b/i.test(text)) return "rare";
  if (/\b(widespread|abundant|very common|least concern)\b/i.test(text)) return "common";
  const roll = stableNumber(record.id || record.name) % 100;
  return roll < 50 ? "common" : roll < 77 ? "uncommon" : roll < 91 ? "rare" : roll < 98 ? "epic" : "legendary";
}

function enrichCatalogRecord(record) {
  const text = `${record.history || ""} ${record.fact || ""}`.replace(/\s+/g, " ").trim();
  const origin = inferredOrigin(record, text);
  const size = inferredSize(record, text);
  const flight = inferredFlight(record);
  const temperament = inferredTemperament(record);
  const fieldSources = {...record.fieldSources};
  if (missing(record.origin)) fieldSources.origin = origin.includes("profile") || origin.includes("lineage") ? "PigeonDex profile" : "Profile description";
  if (missing(record.size)) fieldSources.size = /about \d+ cm/.test(size) ? "Profile description" : "PigeonDex profile";
  if (missing(record.flight)) fieldSources.flight = "PigeonDex profile";
  if (missing(record.temperament)) fieldSources.temperament = "PigeonDex profile";
  return {...record, origin, size, flight, temperament, gameRarity: inferredRarity(record, text), fieldSources};
}

module.exports = {MISSING_SOURCE, RARITIES, enrichCatalogRecord, stableNumber};
