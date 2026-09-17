/* Shared presentation helpers for PigeonDex and Pigder. */
function catalogSafeUrl(value) {
  try { const url = new URL(value); return /^https?:$/.test(url.protocol) ? url.href : ""; }
  catch { return ""; }
}

function photoCredit(record) {
  const credit = record.imageAttribution;
  if (!credit || !record.hasRealImage) return "";
  const label = [credit.author, credit.source, credit.license].filter(Boolean).join(" · ");
  const url = catalogSafeUrl(credit.url);
  const license = credit.license?.toLowerCase();
  const cc = license?.match(/^cc-(by(?:-(?:nc|sa|nd))*)(?:-([\d.]+))?$/);
  const licenseUrl = cc ? `https://creativecommons.org/licenses/${cc[1]}/${cc[2] || "4.0"}/`
    : license === "cc0" ? "https://creativecommons.org/publicdomain/zero/1.0/" : "";
  return `<small class="photo-credit">${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>` : escapeHtml(label)}${licenseUrl ? ` · <a href="${licenseUrl}" target="_blank" rel="noreferrer">License</a>` : ""}${credit.cropped ? " · Cropped by BirdNET" : ""}</small>`;
}

// A broken photo must not make the entire species disappear from the list.
document.addEventListener("error", event => {
  const img = event.target;
  if (img.tagName !== "IMG" || img.dataset.fallbackApplied) return;
  img.dataset.fallbackApplied = "true";
  img.src = "assets/pigeon-hero-wide.png";
  img.alt = `Photo unavailable: ${img.alt}`;
}, true);
