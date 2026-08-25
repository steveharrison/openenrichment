// Category lookup for merchants.csv's `category_id`.
//
// Ids are matched case-insensitively: categories.csv mixes lowercase UUIDs with
// uppercase ones, and merchants.csv doesn't always agree on the case.

export function buildCategoryIndex(rows) {
  const byId = new Map();
  for (const row of rows) {
    const id = (row.id || '').trim().toLowerCase();
    if (id) byId.set(id, row);
  }
  return byId;
}

// Root-first list of names, e.g. ["Outgoing", "Lifestyle", "Cafés & Restaurants"].
// Returns [] when the id is absent — merchants.csv has ids with no matching
// category row, and those fall back to showing the raw id.
export function categoryPath(byId, categoryId) {
  const start = (categoryId || '').trim().toLowerCase();
  if (!start || !byId) return [];

  const path = [];
  const seen = new Set();
  let id = start;
  while (id && byId.has(id) && !seen.has(id)) {
    seen.add(id); // parent_id cycles would otherwise spin forever
    const row = byId.get(id);
    if (row.name) path.unshift(row.name);
    id = (row.parent_id || '').trim().toLowerCase();
  }
  return path;
}
