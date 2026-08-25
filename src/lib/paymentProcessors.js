// Payment-processor prefixes.
//
// Card statements often arrive with the acquirer's tag glued to the front of
// the merchant name — "SQ *BRICKFIELDS CHIPPE", "LIV*SHOU", "VISA - COLES".
// The tag says who took the payment, not who was paid, so it's noise for
// merchant matching.
//
// The list lives in data/payment_processors.csv (code, separator, name) so new
// acquirers can be added without touching code. Until that file is loaded —
// and if it fails to load at all — the fallback below reproduces the two cases
// the matcher handled before the CSV existed.

const FALLBACK = [
  { code: 'SQ', separator: '*' },
  { code: 'VISA', separator: '-' },
];

let active = FALLBACK;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
}

// Rows are `{ code, separator, name }` as read from the CSV. A blank separator
// defaults to "*", which is by far the common shape. A quoted space (" ")
// means the code is set off by whitespace alone — e.g. Lightspeed's
// "LS The Eveleigh Hotel".
export function parsePaymentProcessors(rows) {
  const seen = new Set();
  const processors = [];
  for (const row of rows || []) {
    const code = (row.code || '').trim();
    if (!code) continue;
    const rawSeparator = row.separator || '';
    const separator = rawSeparator.trim() || (rawSeparator ? ' ' : '*');
    const key = `${code.toLowerCase()}${separator}`;
    if (seen.has(key)) continue;
    seen.add(key);
    processors.push({ code, separator });
  }
  // Longest code first so "FSPRG*" isn't consumed by the "FS" entry
  return processors.sort((a, b) => b.code.length - a.code.length);
}

export function setPaymentProcessors(processors) {
  active = processors && processors.length > 0 ? processors : FALLBACK;
}

export function getPaymentProcessors() {
  return active;
}

// Removes processor tags from the *start* of `text`, repeatedly, so stacked
// prefixes ("VISA - SQ *STACKS") come off in one call. Whitespace around the
// separator is optional on both sides: "SQ *X", "SQ*X" and "SQ * X" all strip,
// as does a doubled separator ("SumUp **X"). A space separator requires at
// least one whitespace character, so "LS THE COOP" strips but "LST Wilderness"
// is left alone. Matching is case-insensitive; anything mid-string is intact.
export function stripPaymentProcessors(text, processors = active) {
  let out = String(text ?? '').trimStart();

  let changed = true;
  while (changed) {
    changed = false;
    for (const { code, separator } of processors) {
      const separatorPattern =
        separator === ' ' ? '\\s+' : `(?:${escapeRegExp(separator)}\\s*)+`;
      const pattern = new RegExp(`^${escapeRegExp(code)}\\s*${separatorPattern}`, 'i');
      const next = out.replace(pattern, '');
      if (next !== out) {
        out = next.trimStart();
        changed = true;
        break; // restart the list — a stripped prefix can expose another
      }
    }
  }

  return out;
}
