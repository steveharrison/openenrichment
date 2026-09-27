// Search box for the dev-only merchant editor: suggestions from Google Maps
// and Apple Maps (through the dev server, which holds the credentials), and
// the merged details of the one picked, handed to `onPlace(details)`.

import { useEffect, useId, useRef, useState } from 'react';
import styles from './MerchantEditor.module.css';

const PROVIDER_NAMES = { google: 'Google', apple: 'Apple' };

// Google bills autocomplete keystrokes plus the details call as one session
const newSession = () => crypto.randomUUID();

export default function PlaceLookup({ onPlace }) {
  const [status, setStatus] = useState(null); // { google, apple }
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [errors, setErrors] = useState([]);
  const [active, setActive] = useState(-1);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const session = useRef(newSession());
  const listId = useId();

  useEffect(() => {
    fetch('/__editor/places/status')
      .then((res) => res.json())
      .then(setStatus)
      .catch(() => setStatus({ google: false, apple: false }));
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q, session: session.current });
        const res = await fetch(`/__editor/places/search?${params}`, { signal: controller.signal });
        const body = await res.json();
        setResults(body.results || []);
        setErrors(body.errors || (body.error ? [body.error] : []));
        setActive(-1);
        setOpen(true);
      } catch (err) {
        if (err.name !== 'AbortError') setErrors([err.message]);
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  async function pick(result) {
    setOpen(false);
    setLoading(true);
    setErrors([]);
    try {
      const res = await fetch('/__editor/places/details', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pick: result, session: result.provider === 'google' ? session.current : undefined }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      await onPlace(body);
      setQuery('');
    } catch (err) {
      setErrors([err.message]);
    } finally {
      session.current = newSession();
      setLoading(false);
    }
  }

  function onKeyDown(e) {
    if (!open || !results.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (i + step + results.length) % results.length);
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault(); // don't submit the merchant form
      pick(results[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  const providers = status ? ['google', 'apple'].filter((p) => status[p]) : [];
  if (status && !providers.length) {
    return (
      <p className={styles.hint}>
        Place lookup is off. Set GOOGLE_MAPS_API_KEY or APPLE_MAPS_CREDENTIALS_FILE in .env.local and restart the dev server.
      </p>
    );
  }

  return (
    <div className={styles.lookup}>
      <input
        className={styles.input}
        type="search"
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls={listId}
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        placeholder={loading ? 'Filling in details…' : `Look up a place on ${providers.map((p) => `${PROVIDER_NAMES[p]} Maps`).join(' and ') || 'maps'}`}
        value={query}
        disabled={loading}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => results.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && results.length > 0 && (
        <ul id={listId} role="listbox" className={styles.suggestions}>
          {results.map((r, i) => (
            <li
              key={`${r.provider}-${r.place_id}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? styles.activeSuggestion : undefined}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(r)}
              onMouseEnter={() => setActive(i)}
            >
              <span className={styles.provider}>{PROVIDER_NAMES[r.provider]}</span>
              <span className={styles.suggestionText}>
                <strong>{r.name}</strong>
                <span>{r.address}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {errors.map((e, i) => (
        <span key={i} className={styles.errorText}>
          {e}
        </span>
      ))}
    </div>
  );
}
