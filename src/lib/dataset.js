// Loads the region-split dataset and merges it into one list.
//
// data/regions.csv names each region; data/<code>/ holds that region's
// merchants.csv, payment_processors.csv and merchant-icons/. The site shows
// everything together, so each merchant row is tagged with its `region`
// code (an in-memory field only — it's implied by the folder on disk).

import { csvToObjects } from './csv.js';
import { buildCategoryIndex } from './categories.js';
import { parsePaymentProcessors, setPaymentProcessors } from './paymentProcessors.js';

export const GLOBAL_REGION = 'global';

// Global first, then the rest alphabetically by name, so lists and menus read
// the same everywhere.
export function sortRegions(regions) {
  return [...regions].sort((a, b) => {
    if (a.code === GLOBAL_REGION) return -1;
    if (b.code === GLOBAL_REGION) return 1;
    return a.name.localeCompare(b.name);
  });
}

async function fetchCsv(path, { optional = false } = {}) {
  let res;
  try {
    res = await fetch(path);
  } catch (err) {
    if (optional) return [];
    throw err;
  }
  if (!res.ok) {
    if (optional) return [];
    throw new Error(`HTTP ${res.status} for ${path}`);
  }
  return csvToObjects(await res.text());
}

// Resolves to { regions, regionsByCode, merchants, categoriesById }. Each
// region carries a `merchantCount`. Payment processors are installed into the
// matcher as a side effect, before the promise resolves, so matching never
// runs without them.
export async function loadDataset() {
  const regions = sortRegions(
    (await fetchCsv('data/regions.csv'))
      .filter((r) => r.code)
      .map((r) => ({ code: r.code.trim(), name: (r.name || r.code).trim() }))
  );
  if (regions.length === 0) throw new Error('regions.csv is empty');

  const [perRegion, categories] = await Promise.all([
    Promise.all(
      regions.map(async (region) => {
        const [merchants, processors] = await Promise.all([
          fetchCsv(`data/${region.code}/merchants.csv`),
          // A region without its own processors just contributes none
          fetchCsv(`data/${region.code}/payment_processors.csv`, { optional: true }),
        ]);
        for (const merchant of merchants) merchant.region = region.code;
        region.merchantCount = merchants.length;
        return { merchants, processors };
      })
    ),
    // Categories only label the card, so a missing file isn't fatal
    fetchCsv('data/categories.csv', { optional: true }),
  ]);

  // Processors fall back to a built-in list when every region's file is empty
  setPaymentProcessors(parsePaymentProcessors(perRegion.flatMap((r) => r.processors)));

  return {
    regions,
    regionsByCode: new Map(regions.map((r) => [r.code, r])),
    merchants: perRegion.flatMap((r) => r.merchants),
    categoriesById: buildCategoryIndex(categories),
  };
}

// Path of a merchant's icon inside the built site, or null when it has none
export function iconPath(merchant) {
  const file = (merchant.icon_url || '').trim().split('/').pop();
  if (!file || !/\.(png|jpe?g|svg|webp|gif)$/i.test(file)) return null;
  return `data/${encodeURIComponent(merchant.region || GLOBAL_REGION)}/merchant-icons/${encodeURIComponent(file)}`;
}
