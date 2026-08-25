// PII scanner for the dataset.
//
// Example transaction texts come from real bank statements, so anything that
// survives scrubbing is a leak: a real charge amount, a card reference, a
// booking code. The convention (see README "Transaction texts and PII") is
// that variable identifiers are replaced with ascending placeholders — 1234,
// 12345, 1234567890 — and amounts with 12.34 / 1.23. This script flags
// whatever doesn't look like one of those placeholders.
//
//   npm run scan-pii            # scan src/public/data/merchants.csv
//   node src/tools/scan-pii.mjs path/to/other.csv
//
// Exits 1 when it finds anything, so it can gate CI or a pre-commit hook.
//
// Some flagged strings are merchant-side, not personal: a store's terminal
// number ("BABETTE 111515") or its public phone line prints identically on
// every customer's statement. Once reviewed, list them in
// src/tools/pii-allowlist.txt ("merchant | flagged text") and they stop
// being reported.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { csvToObjects } from '../lib/csv.js';

const here = dirname(fileURLToPath(import.meta.url));
const csvPath = process.argv[2] ?? join(here, '../public/data/merchants.csv');
const allowlistPath = join(here, 'pii-allowlist.txt');

// A digit run is a placeholder when each digit is the successor of the one
// before it, mod 10 — 1234, 56789, 1234567890. After a 9, both 0 and 1 count
// as successors, so longer keyboard-typed runs like 12345678912 pass too.
function isPlaceholderDigits(digits) {
  for (let i = 1; i < digits.length; i++) {
    const prev = Number(digits[i - 1]);
    const next = Number(digits[i]);
    if (next === (prev + 1) % 10) continue;
    if (prev === 9 && next === 1) continue;
    return false;
  }
  return true;
}

const PLACEHOLDER_AMOUNTS = new Set(['12.34', '1.23']);

// Each check returns the offending substrings found in one text.
const CHECKS = [
  {
    label: 'real amount',
    find(text) {
      // Real card amounts always carry cents ("71.74 EURO", "6.97 US
      // DOLLAR"); scrubbed ones are 12.34 / 1.23 or whole numbers.
      return [...text.matchAll(/\d+\.\d{2}\b/g)]
        .map((m) => m[0])
        .filter((amount) => !PLACEHOLDER_AMOUNTS.has(amount));
    },
  },
  {
    label: 'card/statement reference',
    find(text) {
      // Amex-style "##NNNN" references; the scrubbed form is ##1234.
      return [...text.matchAll(/##\s*(\d+)/g)]
        .filter((m) => !isPlaceholderDigits(m[1]))
        .map((m) => m[0]);
    },
  },
  {
    label: 'masked card digits',
    find(text) {
      // "Revolut**1234*" — the digits after a mask must be placeholders.
      return [...text.matchAll(/(?:\*{2,}|x{2,})(\d{2,})/gi)]
        .filter((m) => !isPlaceholderDigits(m[1]))
        .map((m) => m[0]);
    },
  },
  {
    label: 'identifier',
    find(text) {
      // Any bare run of 5+ digits that isn't an ascending placeholder:
      // account fragments, booking references, phone numbers. Runs of four
      // or fewer are ubiquitous in legitimate descriptors (store numbers,
      // years) and stay below the noise floor.
      return [...text.matchAll(/\d{5,}/g)]
        .filter((m) => !isPlaceholderDigits(m[0]))
        .map((m) => m[0]);
    },
  },
  {
    label: 'email address',
    find(text) {
      return [...text.matchAll(/[\w.+-]+@[\w-]+\.[a-z]{2,}/gi)].map((m) => m[0]);
    },
  },
];

// Zero-width and bidi-control characters sneak in when text is edited in a
// rich editor. They're invisible in a diff but ship in the CSV, so every
// field is scanned for them, not just the transaction texts.
const INVISIBLE = /[­​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;

function findInvisible(text) {
  return [...text.matchAll(INVISIBLE)].map(
    (m) => `U+${m[0].codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`,
  );
}

// Tracking parameters have no business in website_url: they're either inert
// campaign cruft or, like srsltid, tied to the browsing session of whoever
// copied the link.
const TRACKING_PARAMS =
  /^(utm_|srsltid$|gclid$|fbclid$|cm_mmc$|sourceid$|merchantid$|mc_[ce]id$|s_kwcid$|ef_id$)/i;

function loadAllowlist() {
  let text;
  try {
    text = readFileSync(allowlistPath, 'utf8');
  } catch {
    return new Set();
  }
  return new Set(
    text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#')),
  );
}

function parseExamples(value) {
  return [...value.matchAll(/`([^`]*)`/g)].map((m) => m[1]);
}

const merchants = csvToObjects(readFileSync(csvPath, 'utf8'));
const allowlist = loadAllowlist();
const findings = [];
let allowlisted = 0;

for (const merchant of merchants) {
  const texts = [
    ...parseExamples(merchant.transaction_text_examples ?? ''),
    merchant.transaction_text_regexp ?? '',
  ];
  for (const text of texts) {
    for (const { label, find } of CHECKS) {
      for (const match of find(text)) {
        if (allowlist.has(`${merchant.name} | ${match}`)) {
          allowlisted++;
          continue;
        }
        findings.push({ merchant: merchant.name, label, match, text });
      }
    }
  }

  for (const [column, value] of Object.entries(merchant)) {
    for (const match of findInvisible(value ?? '')) {
      findings.push({
        merchant: merchant.name,
        label: 'invisible character',
        match,
        text: `${column}: ${value.replace(INVISIBLE, '�')}`,
      });
    }
  }

  const url = merchant.website_url ?? '';
  if (url.includes('?') || url.includes('#')) {
    try {
      for (const key of new URL(url).searchParams.keys()) {
        if (TRACKING_PARAMS.test(key)) {
          findings.push({
            merchant: merchant.name,
            label: 'tracking parameter',
            match: key,
            text: url,
          });
        }
      }
    } catch {
      findings.push({ merchant: merchant.name, label: 'malformed URL', match: url, text: url });
    }
  }
}

if (findings.length === 0) {
  console.log(
    `Scanned ${merchants.length} merchants: clean` +
      (allowlisted > 0 ? ` (${allowlisted} allowlisted)` : ''),
  );
  process.exit(0);
}

console.error(`Scanned ${merchants.length} merchants: ${findings.length} finding(s)\n`);
for (const { merchant, label, match, text } of findings) {
  console.error(`  ${merchant}`);
  console.error(`    ${label}: "${match}" in: ${text}`);
}
console.error(
  '\nScrub real values to placeholders (1234, 12.34 — see README), or, for',
  "merchant-side identifiers that print on every customer's statement, add",
  `"merchant | text" lines to ${allowlistPath}`,
);
process.exit(1);
