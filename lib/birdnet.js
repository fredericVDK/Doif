const API = "https://birdnet.cornell.edu/taxonomy/api";
const FALLBACK_IMAGE = "assets/pigeon-hero-wide.png";
const UNKNOWN = "Not listed in source";

// Columbidae genera, including historical names. Reviewed against the GBIF
// Backbone (family 5233) and BirdNET v0.3-Jul2026. Keep this list under review
// when taxonomy changes: BirdNET currently exposes no family filter.
const GENERA = new Set(`Alectroenas Aplopelia Bountyphaps Caloenas Carpophaga
Chalcophaps Chloroenas Claravis Columba Columbina Cryptophaps Didunculus
Drepanoptila Ducula Dysmoropelia Ectopistes Gallicolumba Geopelia Geophaps
Geotrygon Gerandia Goura Gymnophaps Hemiphaga Henicophaps Leptotila
Leptotrygon Leucosarcia Lithophaps Lopholaimus Macropygia Megaloprepia
Metriopelia Microena Microgoura Natunaornis Nesoenas Ocyphaps Oena
Otidiphaps Pampusana Paraclaravis Patagioenas Petrophassa Pezophaps
Phapitreron Phaps Primophaps Ptilinopus Ptilonopus Ramphiculus Raphus
Reinwardtoena Rupephaps Spilopelia Starnoenas Streptopelia Tongoenas
Treron Trugon Turacoena Turtur Uropelia Zenaida Zentrygon`.split(/\s+/));

function isPigeon(record) {
  return record.taxon_group === "Aves" && record.record_type === "species"
    && GENERA.has(String(record.scientific_name || "").split(" ")[0]);
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch { return ""; }
}

function normalizeSpecies(record) {
  const scientificName = record.scientific_name;
  const sourceUrl = `https://birdnet.cornell.edu/taxonomy/species/${encodeURIComponent(scientificName)}`;
  const description = record.descriptions?.en || record.descriptions?.nl || "";
  const license = record.image?.license || "";
  // Only display images with an explicit reusable license. Preserve the
  // original metadata even when the image needs permission or is unavailable.
  const reusable = /^(cc0|pd|public[ -]domain|cc-by(?:-(?:nc|nd|sa))*|cc-by(?:-(?:nc|nd|sa))*-[\d.]+)$/i.test(license);
  const original = safeUrl(record.image?.src);
  const preview = /(?:^|-)nd(?:-|$)/i.test(license) ? original : safeUrl(record.image?.medium) || original;
  const image = reusable && preview || FALLBACK_IMAGE;
  return {
    id: `birdnet:${record.birdnet_id}`, kind: "species", birdnetId: record.birdnet_id,
    name: record.common_names?.en || record.common_name || scientificName,
    nameNl: record.common_names?.nl || "", scientificName,
    aliases: [...(record.common_name_aliases || []), ...(record.scientific_name_aliases || [])],
    family: "Columbidae", origin: UNKNOWN, size: UNKNOWN, flight: UNKNOWN, temperament: UNKNOWN,
    fact: description.split(/(?<=[.!?])\s+/).slice(0, 2).join(" ") || "No description available yet.",
    history: description, descriptionNl: record.descriptions?.nl || "",
    source: "BirdNET", sourceUrl,
    descriptionSource: record.description_sources?.en || record.description_source || "",
    descriptionUrl: safeUrl(record.wikipedia_urls?.en) || sourceUrl,
    image, hasRealImage: image !== FALLBACK_IMAGE, imageSource: record.image?.source || "BirdNET",
    imageAttribution: {
      author: record.image?.author || "", license, cropped: image !== FALLBACK_IMAGE && image !== original,
      url: safeUrl(record.image?.src), source: record.image?.source || "BirdNET"
    },
    wikidataId: record.wikidata_qid || "",
    externalIds: { inaturalist: record.inat_id || null, gbif: record.gbif_id || null, ebird: record.ebird_code || "" },
    fieldSources: { name: "BirdNET", scientificName: "BirdNET", description: record.description_sources?.en || record.description_source || "BirdNET" }
  };
}

async function requestJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`BirdNET returned HTTP ${response.status}`);
  return response.json();
}

async function fetchBirdnetSpecies(fetchJson = requestJson) {
  // Enumerate all bird pages, then filter scientific genera. Searching for
  // "pigeon" misses bleeding-hearts/bronzewings and includes Pigeon Guillemot.
  const fields = "birdnet_id,scientific_name,scientific_name_aliases,common_name,common_name_aliases,common_names,taxon_group,record_type,descriptions,description_source,description_sources,wikipedia_urls,image,wikidata_qid,inat_id,gbif_id,ebird_code";
  const rows = new Map();
  let total;
  let version;
  for (let page = 1; ; page++) {
    const url = new URL(`${API}/species`);
    Object.entries({ group: "Aves", page, per_page: 500, locale: "en,nl", fields, sort: "scientific_name" })
      .forEach(([key, value]) => url.searchParams.set(key, value));
    const data = await fetchJson(url);
    if (!Array.isArray(data.results) || !Number.isInteger(data.total) || data.total <= 0
      || data.page !== page || (total !== undefined && total !== data.total)
      || (version !== undefined && version !== data.taxonomy_version)) {
      throw new Error("BirdNET returned an incomplete or changing catalogue");
    }
    total = data.total;
    version = data.taxonomy_version;
    const before = rows.size;
    for (const row of data.results) {
      if (!/^BN\d+$/.test(row.birdnet_id || "") || !row.scientific_name) throw new Error("Invalid BirdNET species record");
      rows.set(row.birdnet_id, row);
    }
    if (rows.size === before || rows.size > total) throw new Error("BirdNET pagination repeated or stopped early");
    if (rows.size === total) break;
    if (data.results.length < 500 || page >= 100) throw new Error("BirdNET pagination ended before its reported total");
  }
  const records = [...rows.values()].filter(isPigeon).map(normalizeSpecies);
  if (!records.length) throw new Error("BirdNET returned no Columbidae species");
  return { records, version, scannedBirds: total };
}

module.exports = { fetchBirdnetSpecies, isPigeon, normalizeSpecies, safeUrl };
