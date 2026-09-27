// Dev-only Vite plugin: lets the local site add merchants to the dataset.
//
// `npm run dev` gets these endpoints; `apply: 'serve'` keeps them out of
// builds, so the published site stays read-only:
//   POST /__editor/merchants        add one row to
//                                   src/public/data/<region>/merchants.csv (in
//                                   sorted position, see lib/merchantOrder.js)
//                                   and write an uploaded icon to that region's
//                                   merchant-icons/
//   GET  /__editor/places/status    which map providers have credentials
//   GET  /__editor/places/search    Google + Apple suggestions for ?q=
//   POST /__editor/places/details   full details for one picked suggestion
//   GET  /__editor/icon             an icon for ?domain=, or the name of the
//                                   one already in ?region='s merchant-icons/

import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { csvToObjects, parseCSV } from '../lib/csv.js';
import { translatePattern } from '../lib/rules.js';
import { insertionIndex } from '../lib/merchantOrder.js';
import { createPlaces } from './places.mjs';

const ENDPOINT = '/__editor';
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const ICON_FILE = /^[\w.\-]+\.(png|jpe?g|svg|webp|gif)$/i;
const HEX_COLOUR = /^#[0-9a-f]{6}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Every field is quoted, "" escaped — the same style the files already use
function csvLine(values) {
  return values.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request is too large'));
        req.destroy();
      } else {
        chunks.push(chunk);
      }
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

class InputError extends Error {}

async function readCsv(file) {
  return csvToObjects(await fs.readFile(file, 'utf8'));
}

const ICON_EXTENSIONS = ['png', 'jpg', 'jpeg', 'svg', 'webp', 'gif'];

// The name of an icon already saved for this domain in the region, if any
async function existingIcon(dataDir, region, domain) {
  for (const ext of ICON_EXTENSIONS) {
    const name = `${domain}.${ext}`;
    if (await exists(path.join(dataDir, region, 'merchant-icons', name))) return name;
  }
  return null;
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

// Validates the posted fields and returns the row to write (without an id)
async function buildRow(dataDir, input) {
  const region = String(input.region || '').trim();
  const regions = await readCsv(path.join(dataDir, 'regions.csv'));
  if (!regions.some((r) => r.code.trim() === region)) throw new InputError(`Unknown region "${region}"`);

  const m = {};
  for (const [key, value] of Object.entries(input.merchant || {})) m[key] = String(value ?? '').trim();

  if (!m.name) throw new InputError('Name is required');
  if (m.website_url && !/^https?:\/\//i.test(m.website_url)) throw new InputError('Website must start with http:// or https://');
  for (const key of ['colour', 'background_colour']) {
    if (m[key] && !HEX_COLOUR.test(m[key])) throw new InputError(`${key} must be a #rrggbb hex colour`);
  }
  for (const key of ['latitude', 'longitude']) {
    if (m[key] && !Number.isFinite(Number(m[key]))) throw new InputError(`${key} must be a number`);
  }
  if (m.mcc && !/^\d{4}$/.test(m.mcc)) throw new InputError('MCC must be 4 digits');
  if (m.category_id && !UUID.test(m.category_id)) throw new InputError('Category id is not a UUID');
  if (m.parent_id && !UUID.test(m.parent_id)) throw new InputError('Parent id is not a UUID');
  if (m.icon_url && !ICON_FILE.test(m.icon_url)) {
    throw new InputError('Icon file name must be a plain file name ending in .png, .jpg, .svg, .webp or .gif');
  }
  if (m.transaction_text_regexp) {
    const { source, flags } = translatePattern(m.transaction_text_regexp);
    try {
      new RegExp(source, flags);
    } catch (err) {
      throw new InputError(`Pattern does not compile: ${err.message}`);
    }
  }

  // Examples arrive as a list and are stored as [`a`, `b`]
  const examples = (Array.isArray(input.examples) ? input.examples : [])
    .map((e) => String(e).trim())
    .filter(Boolean);
  if (examples.some((e) => e.includes('`'))) throw new InputError('Examples cannot contain a backtick');
  m.transaction_text_examples = examples.length ? `[${examples.map((e) => `\`${e}\``).join(', ')}]` : '';

  return { region, row: m };
}

async function appendMerchant(dataDir, input) {
  const { region, row } = await buildRow(dataDir, input);
  const regionDir = path.join(dataDir, region);
  const csvFile = path.join(regionDir, 'merchants.csv');
  const text = await fs.readFile(csvFile, 'utf8');
  const [header] = parseCSV(text);
  const existing = csvToObjects(text);

  if (row.parent_id) {
    // A parent can sit in this region or in another one (e.g. a global brand)
    const others = await Promise.all(
      (await readCsv(path.join(dataDir, 'regions.csv')))
        .map((r) => r.code.trim())
        .filter((code) => code && code !== region)
        .map((code) => readCsv(path.join(dataDir, code, 'merchants.csv')).catch(() => []))
    );
    const known = [existing, ...others].flat().some((r) => r.id.toLowerCase() === row.parent_id.toLowerCase());
    if (!known) throw new InputError('Parent merchant does not exist');
  }

  let iconFile = null;
  if (input.icon?.data) {
    if (!row.icon_url) throw new InputError('Give the icon a file name');
    iconFile = path.join(regionDir, 'merchant-icons', row.icon_url);
    if (await exists(iconFile)) throw new InputError(`merchant-icons/${row.icon_url} already exists in ${region}`);
  }

  row.id = randomUUID();
  const at = insertionIndex(existing, row);
  const rows = [...existing.slice(0, at), row, ...existing.slice(at)];

  if (iconFile) {
    await fs.mkdir(path.dirname(iconFile), { recursive: true });
    await fs.writeFile(iconFile, Buffer.from(input.icon.data, 'base64'));
  }
  // Every file is fully quoted with \n endings, so rewriting it only changes
  // the new line
  const lines = [header, ...rows.map((r) => header.map((key) => r[key] ?? ''))].map(csvLine);
  await fs.writeFile(csvFile, `${lines.join('\n')}\n`);

  return { region, merchant: Object.fromEntries(header.map((key) => [key, row[key] ?? ''])) };
}

export default function merchantEditor({ dataDir, googleKey, appleCredentialsFile }) {
  const places = createPlaces({ googleKey, appleCredentialsFile });

  const routes = {
    'POST /merchants': async (req, server) => {
      const created = await appendMerchant(dataDir, JSON.parse(await readBody(req)));
      server.config.logger.info(`merchant editor: added "${created.merchant.name}" to ${created.region}`, { timestamp: true });
      return [201, created];
    },
    'GET /places/status': async () => [200, places.status()],
    'GET /places/search': async (req, server, url) => {
      const q = (url.searchParams.get('q') || '').trim();
      if (q.length < 2) return [200, { results: [], errors: [] }];
      return [200, await places.search(q, { sessionToken: url.searchParams.get('session') })];
    },
    'POST /places/details': async (req) => {
      const { pick, session } = JSON.parse(await readBody(req));
      if (!pick?.provider || !pick.place_id) throw new InputError('Pick a place first');
      return [200, await places.details(pick, { sessionToken: session })];
    },
    'GET /icon': async (req, server, url) => {
      const domain = (url.searchParams.get('domain') || '').trim().toLowerCase();
      const region = (url.searchParams.get('region') || '').trim();
      if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) throw new InputError('Not a domain');
      if (/^[a-z]+$/.test(region)) {
        const existing = await existingIcon(dataDir, region, domain);
        if (existing) return [200, { existing }];
      }
      return [200, (await places.icon(domain)) || {}];
    },
  };

  return {
    name: 'openenrichment-merchant-editor',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(ENDPOINT, async (req, res) => {
        const url = new URL(req.url, 'http://localhost');
        const route = routes[`${req.method} ${url.pathname}`];
        if (!route) return sendJson(res, 404, { error: `No route for ${req.method} ${url.pathname}` });
        try {
          const [status, body] = await route(req, server, url);
          sendJson(res, status, body);
        } catch (err) {
          sendJson(res, err instanceof InputError || err instanceof SyntaxError ? 400 : 500, { error: err.message });
        }
      });
    },
  };
}
