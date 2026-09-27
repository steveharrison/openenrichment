// Row order inside a region's merchants.csv: top-level merchants sorted by
// name (case-insensitive), each followed directly by its own children, also
// sorted by name. A child whose parent lives in another region's file sorts
// with the top-level rows.
//
// Order matters beyond looks: a tie in findMerchantMatch goes to the later
// row. A new row goes after any row with the same name, so on a tie it wins.

const compareNames = (a, b) => (a || '').localeCompare(b || '', undefined, { sensitivity: 'base' });
const sameId = (a, b) => (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();

// Index in `rows` (one region's rows, in file order) to insert `row` at
export function insertionIndex(rows, row) {
  const parentIndex = row.parent_id ? rows.findIndex((r) => sameId(r.id, row.parent_id)) : -1;
  if (parentIndex !== -1) {
    let i = parentIndex + 1;
    while (i < rows.length && sameId(rows[i].parent_id, row.parent_id) && compareNames(rows[i].name, row.name) <= 0) i++;
    return i;
  }

  const ids = new Set(rows.map((r) => (r.id || '').trim().toLowerCase()));
  const isTopLevel = (r) => !r.parent_id || !ids.has(r.parent_id.trim().toLowerCase());
  const next = rows.findIndex((r) => isTopLevel(r) && compareNames(r.name, row.name) > 0);
  return next === -1 ? rows.length : next;
}
