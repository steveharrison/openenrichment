// Builds a transaction_text_regexp from a merchant's example statement
// lines, for the dev-only merchant editor.
//
// Statement lines read "<MERCHANT> <location / store number / country>", so
// the merchant is the shared start of the lines. Candidates come most
// general first, and choosePattern keeps the first that matches every
// example, wins each one against the rest of the dataset, and takes no other
// merchant's examples. So a brand gets a short pattern and a branch gets one
// specific enough to beat its brand without taking its sibling branches.

import { stripPaymentProcessors } from './paymentProcessors.js';
import { findMerchantMatch } from './rules.js';

// Shared text shorter than this matches far too much ("A")
const MIN_CHARS = 2;
// A cut-off word ("QUEANBE", "PRET A MANGE") is kept when at least this long
const MIN_PARTIAL = 3;

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isWordChar = (c) => /\w/.test(c || '');

// The part of a line before its location noise: a run of 2+ spaces (padding
// before the city), a comma, "#" or "*", or the first word with a digit in it
// after the first word ("ASDA STORES 4777 FILTON" -> "ASDA STORES")
function head(line) {
  const cut = line.split(/ {2,}|,|#|\*/)[0];
  const words = cut.trim().split(/\s+/).filter(Boolean);
  const firstNumber = words.findIndex((w, i) => i > 0 && /\d/.test(w));
  return (firstNumber === -1 ? words : words.slice(0, firstNumber)).join(' ');
}

const squash = (line) => line.trim().replace(/\s+/g, ' ');

// Longest shared start of `texts` (case-insensitive), ending on a whole word
// or on a cut-off word of MIN_PARTIAL+ letters. Returns { text, wholeWord }.
function sharedStart(texts) {
  const upper = texts.map((t) => t.toUpperCase());
  let n = 0;
  while (upper.every((t) => n < t.length && t[n] === upper[0][n])) n++;
  let text = texts[0].slice(0, n);

  const wholeWord = texts.every((t) => !isWordChar(t[text.length]) || !isWordChar(text.at(-1)));
  if (!wholeWord) {
    const partial = text.match(/\w+$/)?.[0] || '';
    if (partial.length < MIN_PARTIAL) text = text.slice(0, text.length - partial.length);
  }
  text = text.replace(/[\s\-&/]+$/, '');
  const endsWhole = texts.every((t) => !isWordChar(t[text.length]) || !isWordChar(text.at(-1)));
  return { text, wholeWord: endsWhole };
}

// Longest run of whole words that every line contains
function sharedRun(lines) {
  const words = lines.map((l) => squash(l).split(' '));
  const haystacks = words.slice(1).map((w) => ` ${w.join(' ').toUpperCase()} `);
  const first = words[0];
  for (let len = first.length; len > 0; len--) {
    for (let start = 0; start + len <= first.length; start++) {
      const run = first.slice(start, start + len).join(' ');
      if (haystacks.every((h) => h.includes(` ${run.toUpperCase()} `))) return run;
    }
  }
  return '';
}

// Words every line has, in the same order but not side by side
// ("BUNNINGS 1234 ALEXANDRIA", "BUNNINGS ALEXANDRIA NSW" -> BUNNINGS, ALEXANDRIA)
function sharedWords(lines) {
  const lcs = (a, b) => {
    const t = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
    for (let i = a.length - 1; i >= 0; i--) {
      for (let j = b.length - 1; j >= 0; j--) {
        t[i][j] = a[i].toUpperCase() === b[j].toUpperCase() ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
      }
    }
    const out = [];
    for (let i = 0, j = 0; i < a.length && j < b.length; ) {
      if (a[i].toUpperCase() === b[j].toUpperCase()) {
        out.push(a[i]);
        i++;
        j++;
      } else if (t[i + 1][j] >= t[i][j + 1]) i++;
      else j++;
    }
    return out;
  };
  return lines.map((l) => squash(l).split(' ')).reduce(lcs);
}

// Text -> regex source. Statement lines pad with runs of spaces, so the loose
// variant allows any whitespace where the text has a space.
function source(text, { anchored, wholeWord, loose }) {
  const body = escapeRegex(text).replace(/ /g, loose ? '\\s+' : ' ');
  const start = anchored ? '^' : isWordChar(text[0]) ? '\\b' : '';
  const end = wholeWord && isWordChar(text.at(-1)) ? '\\b' : '';
  return `${start}${body}${end}`;
}

const both = (build) => [build(false), build(true)];

// Groups lines by their first `words` words and returns each group's shared
// start. A group whose shared start is too short ("B AND M…" and "B & M…"
// share only "B") is split again by one more word, up to three, and then
// line by line.
function spellings(lines, words) {
  const groups = new Map();
  for (const line of lines) {
    const k = line.split(' ').slice(0, words).join(' ').toUpperCase();
    groups.set(k, [...(groups.get(k) || []), line]);
  }
  return [...groups.values()].flatMap((group) => {
    const shared = sharedStart(group);
    if (shared.text.length >= MIN_CHARS) return [shared];
    if (words < 3 && group.length > 1) return spellings(group, words + 1);
    return group.map((line) => ({ text: line, wholeWord: true }));
  });
}

export function patternCandidates(examples) {
  const lines = examples.map((e) => stripPaymentProcessors(e.trim())).filter(Boolean);
  if (!lines.length) return [];
  const candidates = [];
  const add = (...patterns) => candidates.push(...patterns.map((p) => `(?i)${p}`));

  // 1. Every line starts with the same merchant name
  const heads = lines.map(head);
  const start = sharedStart(heads.map(squash));
  if (start.text.length >= MIN_CHARS) {
    add(...both((loose) => source(start.text, { anchored: true, wholeWord: start.wholeWord, loose })));
  }

  // 2. Every line has the same words in order, with other text between them
  //    (a branch: brand, store number, locality)
  const words = sharedWords(lines);
  if (words.length > 1 && words.join(' ').length >= MIN_CHARS) {
    const anchored = lines.every((l) => squash(l).toUpperCase().startsWith(`${words[0].toUpperCase()} `));
    const parts = words.map((w) => source(w, { anchored: false, wholeWord: true, loose: false }));
    add(`${anchored ? parts[0].replace(/^\\b/, '^') : parts[0]}${parts.slice(1).map((p) => `.*${p}`).join('')}`);
  }

  // 3. Every line has the same words side by side, not at the start
  const run = sharedRun(lines);
  if (run.length >= MIN_CHARS) add(...both((loose) => source(run, { anchored: false, wholeWord: true, loose })));

  // 4. Different spellings: one alternative per group of lines that share
  //    their first words
  const heads3 = heads.map((h, i) => squash(h || lines[i]));
  if (new Set(heads3.map((h) => h.split(' ')[0].toUpperCase())).size > 1) {
    const parts = spellings(heads3, 1);
    if (parts.length > 1) {
      add(
        ...both((loose) => {
          const alts = [...new Set(parts.map((p) => source(p.text, { anchored: false, wholeWord: p.wholeWord, loose }).replace(/^\\b/, '')))];
          alts.sort((a, b) => b.length - a.length); // more specific spelling first
          return `^(?:${alts.join('|')})`;
        })
      );
    }
  }

  // 5. Most specific: the shared start of the full lines, location included
  const full = sharedStart(lines.map(squash));
  if (full.text.length > start.text.length) {
    add(...both((loose) => source(full.text, { anchored: true, wholeWord: full.wholeWord, loose })));
  }

  return [...new Set(candidates)];
}

// Scores each candidate against the dataset and returns the first that is
// clean ({ pattern, total, matched, won, taken }), else the best of the rest
// (most examples matched, then fewest taken, then most won), else null.
//
//   withDraft(pattern)  every matcher in dataset order, with the draft row in
//                       the place it will be saved, or null if the pattern
//                       does not compile
//   isDraft(merchant)   true for the draft row
//   otherExamples       example lines of every other merchant
export function choosePattern(examples, { withDraft, isDraft, otherExamples }) {
  const own = examples.map((e) => e.trim()).filter(Boolean);
  let best = null;
  for (const pattern of patternCandidates(own)) {
    const matchers = withDraft(pattern);
    const draft = matchers?.find((m) => isDraft(m.merchant));
    if (!draft) continue;
    const winsFor = (text) => findMerchantMatch(text, [draft]) && isDraft(findMerchantMatch(text, matchers)?.merchant);

    const score = {
      pattern,
      total: own.length,
      matched: own.filter((text) => findMerchantMatch(text, [draft])).length,
      won: own.filter(winsFor).length,
      taken: otherExamples.filter(winsFor).length,
    };
    if (score.matched === score.total && score.won === score.total && score.taken === 0) return score;
    if (
      !best ||
      score.matched > best.matched ||
      (score.matched === best.matched && (score.taken < best.taken || (score.taken === best.taken && score.won > best.won)))
    ) {
      best = score;
    }
  }
  return best;
}
