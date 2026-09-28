// Dev-only "Add merchant" / "Edit merchant" form. It posts to the /__editor endpoints that
// src/tools/merchant-editor-plugin.mjs adds to `npm run dev`; App only loads
// this module when import.meta.env.DEV is true, so it never ships.

import { useMemo, useRef, useState } from 'react';
import { categoryPath } from '../lib/categories.js';
import { mccName } from '../lib/mcc.js';
import { insertionIndex } from '../lib/merchantOrder.js';
import {
  categoryForMcc,
  dominantColour,
  findDuplicates,
  findParentByDomain,
  iconExtension,
  regionForCountry,
  siteHost,
  suggestPattern,
} from '../lib/placeFill.js';
import { parseExamples } from '../lib/merchant.js';
import { choosePattern } from '../lib/patternGen.js';
import { buildMatchers, findMerchantMatch } from '../lib/rules.js';
import PlaceLookup from './PlaceLookup.jsx';
import styles from './MerchantEditor.module.css';

const EMPTY = {
  name: '',
  website_url: '',
  icon_url: '',
  address: '',
  latitude: '',
  longitude: '',
  category_id: '',
  parent_id: '',
  background_colour: '',
  colour: '',
  apple_place_id: '',
  google_place_id: '',
  mcc: '',
  transaction_text_regexp: '',
};

// A lookup may replace these fields only while they are empty or still hold
// what an earlier lookup put there, so hand edits survive a second lookup
const KEEP_EDITS = ['transaction_text_regexp', 'icon_url', 'colour'];

const DRAFT_ID = '__draft__';
const isDraft = (merchant) => merchant?.id === DRAFT_ID;
const spliceAt = (list, at, item) => [...list.slice(0, at), item, ...list.slice(at)];
const sameId = (a, b) => (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();

// The form's fields for an existing row
const fieldsOf = (merchant) => Object.fromEntries(Object.keys(EMPTY).map((key) => [key, (merchant[key] ?? '').trim()]));

// "Matches 3 of 4 examples…" for a choosePattern result
function describeGenerated({ total, matched, won, taken }) {
  const parts = [matched === total ? `Matches all ${total} example${total === 1 ? '' : 's'}` : `Matches ${matched} of ${total} examples`];
  const lost = matched - won;
  if (lost) parts.push(`but ${lost} of them still ${lost === 1 ? 'goes' : 'go'} to another merchant`);
  parts.push(taken ? `Takes ${taken} line${taken === 1 ? '' : 's'} from other merchants' examples` : "Takes no other merchant's examples");
  return `${parts.slice(0, -1).join(' ')}. ${parts.at(-1)}.`;
}

function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function Field({ label, hint, wide, children }) {
  return (
    <label className={`${styles.field}${wide ? ` ${styles.wide}` : ''}`}>
      <span className={styles.label}>{label}</span>
      {children}
      {hint && <span className={styles.hint}>{hint}</span>}
    </label>
  );
}

// `data` is App's loaded dataset; `onSaved(merchant)` runs after the row is
// on disk, with the saved row tagged with its region. With `editing` (a row
// from data.merchants) the form opens filled in and saves over that row;
// `onEditDone()` runs when the user cancels. App remounts the form for each
// merchant it edits.
export default function MerchantEditor({ data, editing, onSaved, onEditDone }) {
  const [open, setOpen] = useState(Boolean(editing));
  const [region, setRegion] = useState(editing?.region ?? '');
  const [fields, setFields] = useState(() => (editing ? fieldsOf(editing) : EMPTY));
  const [examples, setExamples] = useState(() => (editing ? parseExamples(editing.transaction_text_examples).join('\n') : ''));
  const [icon, setIcon] = useState(null); // { file, preview }
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notes, setNotes] = useState([]); // what the last lookup filled in, and doubts about it
  const autoFilled = useRef({});
  const [generated, setGenerated] = useState(null); // last choosePattern result

  const set = (key) => (e) => setFields((f) => ({ ...f, [key]: e.target.value }));

  const categoryOptions = useMemo(
    () =>
      [...data.categoriesById.values()]
        .map((row) => ({ id: row.id, label: categoryPath(data.categoriesById, row.id).join(' › ') }))
        .filter((c) => c.label)
        .sort((a, b) => a.label.localeCompare(b.label)),
    [data.categoriesById]
  );

  // Every row except the one being edited
  const others = useMemo(() => (editing ? data.merchants.filter((m) => m !== editing) : data.merchants), [data.merchants, editing]);
  const hasBranches = useMemo(() => Boolean(editing) && data.merchants.some((m) => sameId(m.parent_id, editing.id)), [data.merchants, editing]);

  // Only top-level merchants can be parents, grouped by region
  const parentGroups = useMemo(
    () =>
      data.regions
        .map((r) => ({
          region: r,
          merchants: others
            .filter((m) => m.region === r.code && m.id && !m.parent_id)
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
        }))
        .filter((g) => g.merchants.length),
    [data.regions, others]
  );

  const exampleLines = useMemo(
    () =>
      examples
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean),
    [examples]
  );

  const draftMatcher = useMemo(() => {
    const pattern = fields.transaction_text_regexp.trim();
    if (!pattern) return { state: 'empty' };
    const [matcher] = buildMatchers([{ ...fields, id: DRAFT_ID }]);
    return matcher ? { state: 'ok', matcher } : { state: 'invalid' };
  }, [fields]);

  const position = useMemo(() => new Map(data.merchants.map((m, i) => [m, i])), [data.merchants]);

  // The edited row's saved pattern gives way to the draft
  const baseMatchers = useMemo(
    () => (editing ? data.matchers.filter(({ merchant }) => merchant !== editing) : data.matchers),
    [data.matchers, editing]
  );

  // Where the draft's matcher goes in baseMatchers: the place the server will
  // put the row, since ties go to the later row
  const draftCut = useMemo(() => {
    let before;
    if (editing && editing.name === fields.name.trim() && sameId(editing.parent_id, fields.parent_id)) {
      before = position.get(editing);
    } else {
      // The server takes the edited row and its branches out before it sorts
      const regionRows = others.filter((m) => m.region === region && !(editing && sameId(m.parent_id, editing.id)));
      const at = insertionIndex(regionRows, fields);
      before =
        at < regionRows.length
          ? position.get(regionRows[at])
          : regionRows.length
            ? position.get(regionRows.at(-1)) + 1
            : data.merchants.length;
    }
    const cut = baseMatchers.findIndex(({ merchant }) => position.get(merchant) >= before);
    return cut === -1 ? baseMatchers.length : cut;
  }, [data.merchants, others, baseMatchers, position, region, fields, editing]);


  // Run each example against the full dataset with the draft row in place
  const exampleResults = useMemo(() => {
    if (draftMatcher.state !== 'ok') return [];
    const matchers = spliceAt(baseMatchers, draftCut, draftMatcher.matcher);
    return exampleLines.map((text) => ({ text, match: findMerchantMatch(text, matchers) }));
  }, [draftMatcher, baseMatchers, draftCut, exampleLines]);

  const otherExamples = useMemo(() => others.flatMap((m) => parseExamples(m.transaction_text_examples)), [others]);

  function generatePattern() {
    const result = choosePattern(exampleLines, {
      withDraft: (pattern) => {
        const [matcher] = buildMatchers([{ ...fields, transaction_text_regexp: pattern, id: DRAFT_ID }]);
        return matcher ? spliceAt(baseMatchers, draftCut, matcher) : null;
      },
      isDraft,
      otherExamples,
    });
    setGenerated(result ?? { failed: true });
    if (result) setFields((f) => ({ ...f, transaction_text_regexp: result.pattern }));
  }

  // Fills the form from a looked-up place (see PlaceLookup)
  async function applyPlace(place) {
    const found = [];
    // An edited row stays in its region's file
    const nextRegion = editing ? region : regionForCountry(data.regions, place.country) || region;
    const parent = hasBranches ? null : findParentByDomain(others, place);
    const derived = place.mccCandidates[0];
    const mcc = parent?.mcc || derived?.mcc || '';
    const name = parent && place.locality ? `${parent.name} - ${place.locality}` : place.name;

    const values = {
      name,
      website_url: place.website,
      address: place.address,
      latitude: place.latitude == null ? '' : String(place.latitude),
      longitude: place.longitude == null ? '' : String(place.longitude),
      google_place_id: place.google_place_id,
      apple_place_id: place.apple_place_id,
      parent_id: parent?.id || '',
      mcc,
      // Branches leave the category (and icon) to the parent
      category_id: parent ? '' : categoryForMcc(others, mcc),
    };
    const suggested = {
      transaction_text_regexp: suggestPattern(place.name, parent, place.locality),
      icon_url: '',
      colour: '',
    };

    const sources = [place.google_place_id && 'Google Maps', place.apple_place_id && 'Apple Maps'].filter(Boolean);
    found.push(`Filled from ${sources.join(' and ')}.`);
    for (const dup of findDuplicates(others, place)) {
      found.push(`Warning: this place is already in the dataset as “${dup.name}” (${dup.region}).`);
    }
    if (parent) found.push(`Parent set to “${parent.name}” (${parent.region}), because it has the same website domain.`);
    if (nextRegion !== region) found.push(`Region set from the country (${place.country}).`);
    if (!parent && derived) {
      const others = place.mccCandidates.slice(1).map((c) => c.mcc);
      found.push(
        `MCC ${derived.mcc} ${mccName(derived.mcc) ? `(${mccName(derived.mcc)}) ` : ''}from ${derived.source}.${others.length ? ` Other options: ${others.join(', ')}.` : ''}`
      );
    }
    if (!mcc) found.push('No MCC found. Set it by hand.');
    found.push(...place.notes);

    // Icon and colour: brands only, as branches show the parent's
    const host = siteHost(place.website);
    let newIcon = null;
    if (!parent && host) {
      try {
        const res = await fetch(`/__editor/icon?${new URLSearchParams({ domain: host, region: nextRegion })}`);
        const got = await res.json();
        if (got.existing) {
          suggested.icon_url = got.existing;
          found.push(`Icon ${got.existing} is already in merchant-icons/.`);
        } else if (got.data && iconExtension(got.type)) {
          const blob = await (await fetch(`data:${got.type};base64,${got.data}`)).blob();
          newIcon = { file: blob, preview: URL.createObjectURL(blob) };
          suggested.icon_url = `${host}.${iconExtension(got.type)}`;
          found.push(
            `Icon from ${got.source}${got.width ? `, ${got.width} px` : ''}.${got.width && got.width < 64 ? ' It is small. Replace it if you can.' : ''}`
          );
        } else {
          found.push('No icon found. Upload one.');
        }
        const src = newIcon?.preview || (got.existing && `data/${nextRegion}/merchant-icons/${encodeURIComponent(got.existing)}`);
        if (src) suggested.colour = await dominantColour(src).catch(() => '');
      } catch {
        found.push('Icon lookup failed. Upload one.');
      }
    }

    setRegion(nextRegion);
    setFields((current) => {
      const next = { ...current, ...values };
      for (const key of KEEP_EDITS) {
        const untouched = !current[key] || current[key] === autoFilled.current[key];
        if (untouched) next[key] = suggested[key];
      }
      return next;
    });
    // Replace the icon only when its name was replaced too
    const iconUntouched = !fields.icon_url || fields.icon_url === autoFilled.current.icon_url;
    if (iconUntouched) {
      if (icon) URL.revokeObjectURL(icon.preview);
      setIcon(newIcon);
    } else if (newIcon) {
      URL.revokeObjectURL(newIcon.preview);
    }
    autoFilled.current = suggested;
    setNotes(found);
  }

  async function pickIcon(e) {
    const file = e.target.files?.[0];
    if (icon) URL.revokeObjectURL(icon.preview);
    if (!file) {
      setIcon(null);
      return;
    }
    setIcon({ file, preview: URL.createObjectURL(file) });
    const ext = (file.name.match(/\.(png|jpe?g|svg|webp|gif)$/i)?.[1] || 'png').toLowerCase();
    const host = siteHost(fields.website_url);
    setFields((f) => ({ ...f, icon_url: `${host || file.name.replace(/\.[^.]+$/, '')}.${ext}` }));
  }

  function reset() {
    if (icon) URL.revokeObjectURL(icon.preview);
    setFields(EMPTY);
    setExamples('');
    setIcon(null);
    setError('');
    setNotes([]);
    setGenerated(null);
    autoFilled.current = {};
  }

  function cancel() {
    reset();
    setOpen(false);
    if (editing) onEditDone();
  }

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const body = {
        id: editing?.id,
        region,
        merchant: fields,
        examples: exampleLines,
        icon: icon ? { data: await readAsBase64(icon.file) } : null,
      };
      const res = await fetch('/__editor/merchants', {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(result.error || `HTTP ${res.status}`);
      reset();
      setOpen(false);
      onSaved({ ...result.merchant, region: result.region });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <div className={styles.launcher}>
        <button type="button" className={styles.secondary} onClick={() => setOpen(true)}>
          Add merchant
        </button>
        <span className={styles.devTag}>local dev only</span>
      </div>
    );
  }

  const existingIcon = !icon && fields.icon_url && region ? `data/${region}/merchant-icons/${encodeURIComponent(fields.icon_url)}` : null;

  return (
    <form className={styles.card} onSubmit={submit}>
      <div className={styles.header}>
        <h2>{editing ? `Edit ${editing.name || 'merchant'}` : 'Add merchant'}</h2>
        <span className={styles.devTag}>writes to src/public/data</span>
      </div>

      <PlaceLookup onPlace={applyPlace} />
      {notes.length > 0 && (
        <ul className={styles.notes}>
          {notes.map((note, i) => (
            <li key={i} className={note.startsWith('Warning') ? styles.warning : undefined}>
              {note}
            </li>
          ))}
        </ul>
      )}

      <div className={styles.grid}>
        <Field label="Region *" hint={editing ? 'An edited merchant stays in its region.' : undefined}>
          <select className={styles.input} required disabled={Boolean(editing)} value={region} onChange={(e) => setRegion(e.target.value)}>
            <option value="">Choose…</option>
            {data.regions.map((r) => (
              <option key={r.code} value={r.code}>
                {r.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Name *">
          <input className={styles.input} required value={fields.name} onChange={set('name')} />
        </Field>

        <Field
          label="Parent merchant"
          hint={
            hasBranches
              ? 'This merchant has branches, so it cannot have a parent.'
              : 'For a branch of a brand. Leave empty for a brand or a single business.'
          }
          wide
        >
          <select className={styles.input} disabled={hasBranches} value={fields.parent_id} onChange={set('parent_id')}>
            <option value="">None</option>
            {parentGroups.map((g) => (
              <optgroup key={g.region.code} label={g.region.name}>
                {g.merchants.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </Field>

        <Field label="Website" wide>
          <input className={styles.input} type="url" placeholder="https://" value={fields.website_url} onChange={set('website_url')} />
        </Field>

        <Field label="Category" wide>
          <select className={styles.input} value={fields.category_id} onChange={set('category_id')}>
            <option value="">None</option>
            {categoryOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="MCC"
          hint={
            !/^\d{4}$/.test(fields.mcc)
              ? '4-digit merchant category code'
              : mccName(fields.mcc) ||
                (fields.mcc >= '3000' && fields.mcc <= '3999'
                  ? 'Brand-specific code. Use the generic code (4511, 7011, 7512) instead.'
                  : 'Unknown code. Check it.')
          }
        >
          <input className={styles.input} inputMode="numeric" pattern="\d{4}" value={fields.mcc} onChange={set('mcc')} />
        </Field>

        <Field label="Colour">
          <div className={styles.colourRow}>
            <input
              type="color"
              className={styles.swatch}
              value={/^#[0-9a-f]{6}$/i.test(fields.colour) ? fields.colour : '#000000'}
              onChange={set('colour')}
            />
            <input className={styles.input} placeholder="#rrggbb" value={fields.colour} onChange={set('colour')} />
          </div>
        </Field>

        <Field label="Icon" hint="Saved to the region's merchant-icons/. Or type the name of an icon that is already there." wide>
          <div className={styles.iconRow}>
            {(icon || existingIcon) && <img className={styles.iconPreview} src={icon ? icon.preview : existingIcon} alt="" />}
            <input className={styles.file} type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp,image/gif" onChange={pickIcon} />
            <input className={styles.input} placeholder="example.com.png" value={fields.icon_url} onChange={set('icon_url')} />
          </div>
        </Field>

        <Field label="Address" wide>
          <input className={styles.input} value={fields.address} onChange={set('address')} />
        </Field>

        <Field label="Latitude">
          <input className={styles.input} inputMode="decimal" value={fields.latitude} onChange={set('latitude')} />
        </Field>

        <Field label="Longitude">
          <input className={styles.input} inputMode="decimal" value={fields.longitude} onChange={set('longitude')} />
        </Field>

        <Field label="Apple Maps place ID">
          <input className={styles.input} value={fields.apple_place_id} onChange={set('apple_place_id')} />
        </Field>

        <Field label="Google place ID">
          <input className={styles.input} value={fields.google_place_id} onChange={set('google_place_id')} />
        </Field>

        <Field label="Transaction examples" hint="One statement line per row. Use real lines from bank statements, with PII removed." wide>
          <textarea className={`${styles.input} ${styles.textarea} ${styles.mono}`} rows={4} value={examples} onChange={(e) => setExamples(e.target.value)} />
        </Field>

        <Field label="Transaction pattern" hint="Regular expression. A leading (?i) makes it case-insensitive." wide>
          <input
            className={`${styles.input} ${styles.mono}${draftMatcher.state === 'invalid' ? ` ${styles.invalid}` : ''}`}
            placeholder="(?i)^EXAMPLE\b"
            value={fields.transaction_text_regexp}
            onChange={(e) => {
              setGenerated(null);
              set('transaction_text_regexp')(e);
            }}
          />
          {draftMatcher.state === 'invalid' && <span className={styles.errorText}>This pattern does not compile.</span>}
          <div className={styles.generateRow}>
            <button type="button" className={styles.secondary} disabled={!exampleLines.length} onClick={generatePattern}>
              Generate from examples
            </button>
            {generated && (
              <span className={generated.failed || generated.won < generated.total || generated.taken ? styles.errorText : styles.hint}>
                {generated.failed ? 'Could not build a pattern from these examples.' : describeGenerated(generated)}
              </span>
            )}
          </div>
        </Field>
      </div>

      {exampleResults.length > 0 && (
        <ul className={styles.results} aria-label="Pattern test">
          {exampleResults.map(({ text, match }, i) => {
            const wins = match?.merchant.id === '__draft__';
            return (
              <li key={i} className={wins ? styles.pass : styles.fail}>
                <span className={styles.mark}>{wins ? '✓' : '✕'}</span>
                <code>{text}</code>
                <span className={styles.outcome}>
                  {wins ? 'matches' : match ? `matched by ${match.merchant.name}` : 'no match'}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {error && (
        <p className={styles.errorText} role="alert">
          {error}
        </p>
      )}

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.secondary}
          onClick={cancel}
        >
          Cancel
        </button>
        <button type="submit" className={styles.primary} disabled={saving || draftMatcher.state === 'invalid'}>
          {saving ? 'Saving…' : editing ? 'Save changes' : 'Save merchant'}
        </button>
      </div>
    </form>
  );
}
