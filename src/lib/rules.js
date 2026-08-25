// Merchant matching.
//
// Each merchant row in merchants.csv carries its own
// `transaction_text_regexp` — the pattern that identifies its transactions on
// a statement. Matching is just "run every merchant's pattern over the text".
//
// Patterns come from a PCRE-flavoured source and are written with an inline
// `(?i)` flag, which JavaScript's RegExp doesn't accept. Leading inline flags
// are lifted off the pattern and translated into RegExp flags instead.

import { stripPaymentProcessors } from './paymentProcessors.js';

const SUPPORTED_INLINE_FLAGS = 'imsu';

// "(?i)^FOO" -> { source: "^FOO", flags: "i" }. Only flags at the very start
// are lifted: a `(?i)` in the middle of a pattern is scoped to what follows
// it, and moving it would change the meaning.
function translatePattern(pattern) {
  let source = pattern;
  let flags = '';
  let match;
  while ((match = /^\(\?([a-zA-Z]+)\)/.exec(source))) {
    for (const flag of match[1]) {
      if (SUPPORTED_INLINE_FLAGS.includes(flag) && !flags.includes(flag)) flags += flag;
    }
    source = source.slice(match[0].length);
  }
  return { source, flags };
}

// Compiled patterns, keyed by merchant id. Built once per merchant list.
export function buildMatchers(merchants) {
  const matchers = [];
  for (const merchant of merchants) {
    const pattern = (merchant.transaction_text_regexp || '').trim();
    if (!pattern) continue;
    const { source, flags } = translatePattern(pattern);
    let regexp;
    try {
      regexp = new RegExp(source, flags);
    } catch {
      continue; // a pattern JS can't compile simply never matches
    }
    matchers.push({ merchant, pattern, regexp });
  }
  return matchers;
}

// Anchored patterns ("^HARRIS FARM…") miss when the statement line still
// carries the acquirer's tag, so each candidate is tried against the raw text
// and against the processor-stripped text.
function firstMatch(regexp, candidates) {
  for (const text of candidates) {
    const found = regexp.exec(text);
    if (found) return found[0];
  }
  return null;
}

// Returns { merchant, pattern, matchedText } for the best match, or null.
//
// The longest matched substring wins — the pattern that accounts for more of
// the line is the more specific description of it — and when two match the
// same amount of text, the later row in the CSV wins. That second rule makes
// appending a row an override: a new pattern matching at least as much as an
// existing one takes precedence over it.
//
// Length is measured on the text matched, not on the pattern: regex syntax
// would otherwise count toward it, so `(?: |\s)` — eight characters matching a
// single space — would outweigh four literal ones.
function beats(candidate, best) {
  if (candidate.matchedText.length !== best.matchedText.length) {
    return candidate.matchedText.length > best.matchedText.length;
  }
  return true; // tied on length — candidate is the later row, so it takes over
}

export function findMerchantMatch(rawText, matchers) {
  const text = String(rawText ?? '');
  const candidates = [text];
  const stripped = stripPaymentProcessors(text);
  if (stripped !== text) candidates.push(stripped);

  let best = null;
  for (const { merchant, pattern, regexp } of matchers) {
    const matchedText = firstMatch(regexp, candidates);
    if (matchedText == null) continue;
    const candidate = { merchant, pattern, matchedText };
    if (!best || beats(candidate, best)) best = candidate;
  }
  return best;
}
