const TTL = 6 * 60 * 60 * 1000;
const RETRY = 5 * 60 * 1000;

function domesticRecord(record) {
  return { ...record, kind: "breed", source: record.source || "Wikimedia",
    parentScientificName: "Columba livia", parentSpeciesId: "birdnet:BN03514" };
}

function mergeRecords(species, domestic) {
  // Never merge a domestic breed with its parent species or use fuzzy names.
  const records = new Map();
  for (const record of species) records.set(record.id, record);
  for (const record of domestic) {
    if (record.id && record.name && !record.id.startsWith("birdnet:")) records.set(record.id, domesticRecord(record));
  }
  return [...records.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function createCatalog({ loadSpecies, loadDomestic, readSaved, save, snapshots = {}, now = Date.now }) {
  let pending;
  let cached;
  async function source(name, loader, saved) {
    const previous = saved?.records?.length ? saved : snapshots[name];
    if (previous?.records?.length && previous.expiresAt > now()) return previous;
    try {
      const result = await loader();
      if (!result.records?.length) throw new Error("Source returned no records");
      return { ...result, cachedAt: new Date(now()).toISOString(), expiresAt: now() + TTL, status: "live" };
    } catch (error) {
      return { ...(previous || {}), records: previous?.records || [],
        expiresAt: now() + RETRY, status: previous?.records?.length ? "stale" : "unavailable", error: error.message };
    }
  }
  return async function getCatalog() {
    if (cached && cached.expiresAt > now()) return cached;
    if (pending) return pending;
    pending = (async () => {
      const saved = readSaved() || {};
      const [birdnet, domestic] = await Promise.all([
        source("birdnet", loadSpecies, saved.birdnet),
        source("domestic", loadDomestic, saved.domestic)
      ]);
      if (!birdnet.records.length && !domestic.records.length) throw new Error("No pigeon sources are available");
      const breeds = mergeRecords(birdnet.records, domestic.records);
      const sources = Object.fromEntries(Object.entries({ birdnet, domestic }).map(([key, value]) => [key, {
        status: value.status, count: value.records.length, cachedAt: value.cachedAt || null,
        version: value.version || null, ...(value.error ? { warning: "Source unavailable; showing saved records where possible." } : {})
      }]));
      cached = { breeds, count: breeds.length, primarySource: "BirdNET", sources,
        counts: { species: birdnet.records.length, breeds: breeds.filter(row => row.kind === "breed").length },
        cachedAt: birdnet.cachedAt || domestic.cachedAt,
        expiresAt: Math.min(birdnet.expiresAt, domestic.expiresAt) };
      await save({ birdnet, domestic });
      return cached;
    })();
    try { return await pending; } finally { pending = null; }
  };
}

module.exports = { createCatalog, mergeRecords, domesticRecord };
