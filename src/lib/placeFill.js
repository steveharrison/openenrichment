// Turns a looked-up place into merchant form values, for the dev-only
// merchant editor. Every guess here follows how existing rows are filled in,
// and the form shows each one so it can be corrected before saving.

// "https://www.sacher.com/en/…" -> "sacher.com", the icon naming convention
export function siteHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Statement lines are plain ASCII: "Café" prints as "CAFE"
const plain = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').trim();

// ISO country code -> region folder. Region codes are the lowercase country
// code, except the United Kingdom's "uk".
export function regionForCountry(regions, country) {
  const code = (country || '').toLowerCase();
  if (!code) return null;
  const wanted = code === 'gb' ? 'uk' : code;
  return regions.find((r) => r.code === wanted)?.code ?? null;
}

// The category existing rows most often use with this MCC
export function categoryForMcc(merchants, mcc) {
  if (!mcc) return '';
  const votes = new Map();
  for (const m of merchants) {
    if (m.mcc === mcc && m.category_id) votes.set(m.category_id, (votes.get(m.category_id) || 0) + 1);
  }
  let best = '';
  let count = 0;
  for (const [id, n] of votes) {
    if (n > count) [best, count] = [id, n];
  }
  return best;
}

// A top-level merchant with the same website domain is the likely brand this
// place is a branch of. The place itself (same name) is not its own parent.
export function findParentByDomain(merchants, place) {
  const host = siteHost(place.website);
  if (!host) return null;
  const nameKey = (s) => plain(s || '').toLowerCase();
  return (
    merchants.find(
      (m) => !m.parent_id && m.id && siteHost(m.website_url) === host && nameKey(m.name) !== nameKey(place.name)
    ) ?? null
  );
}

// Existing rows that already point at this place
export function findDuplicates(merchants, place) {
  return merchants.filter(
    (m) =>
      (place.google_place_id && m.google_place_id === place.google_place_id) ||
      (place.apple_place_id && m.apple_place_id === place.apple_place_id)
  );
}

// Brand rows match the name at the start of the line; branch rows match the
// brand and the locality (child examples read "<BRAND> <LOCALITY>")
export function suggestPattern(name, parent, locality) {
  if (parent) {
    return locality ? `(?i)${escapeRegex(plain(parent.name))}.*${escapeRegex(plain(locality))}` : '';
  }
  return name ? `(?i)^${escapeRegex(plain(name))}` : '';
}

// Most common non-white colour in an image, as #rrggbb, or '' when the
// image is all white or transparent
export async function dominantColour(src) {
  const img = new Image();
  img.src = src;
  await img.decode();
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, size, size);
  const { data } = ctx.getImageData(0, 0, size, size);

  const buckets = new Map();
  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
    if (a < 128 || (r > 235 && g > 235 && b > 235)) continue;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bucket = buckets.get(key) || { r: 0, g: 0, b: 0, n: 0 };
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    bucket.n += 1;
    buckets.set(key, bucket);
  }
  let best = null;
  for (const bucket of buckets.values()) if (!best || bucket.n > best.n) best = bucket;
  if (!best) return '';
  const hex = (v) => Math.round(v / best.n).toString(16).padStart(2, '0');
  return `#${hex(best.r)}${hex(best.g)}${hex(best.b)}`;
}

const ICON_EXTENSIONS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/svg+xml': 'svg', 'image/webp': 'webp', 'image/gif': 'gif' };

export function iconExtension(type) {
  return ICON_EXTENSIONS[(type || '').split(';')[0].trim()] ?? null;
}
