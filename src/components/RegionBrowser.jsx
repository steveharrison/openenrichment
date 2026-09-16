import { useMemo, useState } from 'react';
import { avatarColor } from '../lib/merchant.js';
import { iconPath } from '../lib/dataset.js';
import styles from './RegionBrowser.module.css';

function ListIcon({ merchant }) {
  const [failed, setFailed] = useState(false);
  const src = iconPath(merchant);
  if (!src || failed) {
    return (
      <span className={styles.icon} style={{ background: avatarColor(merchant) }}>
        {(merchant.name || '?').trim().charAt(0).toUpperCase()}
      </span>
    );
  }
  return <img className={`${styles.icon} ${styles.iconImage}`} src={src} alt="" loading="lazy" onError={() => setFailed(true)} />;
}

// Region chips plus the merchant list for the chosen region. `regions` is the
// sorted list from loadDataset (each with a merchantCount); `merchants` is
// every row across regions. Picking a merchant calls `onSelect(merchant)`.
export default function RegionBrowser({ regions, merchants, merchantsById, selectedId, onSelect }) {
  const [region, setRegion] = useState(null);
  const [filter, setFilter] = useState('');

  const rows = useMemo(() => {
    if (!region) return [];
    const q = filter.trim().toLowerCase();
    return merchants
      .filter((m) => m.region === region && (!q || (m.name || '').toLowerCase().includes(q)))
      .sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }));
  }, [merchants, region, filter]);

  function pickRegion(code) {
    setRegion((current) => (current === code ? null : code));
    setFilter('');
  }

  return (
    <section className={styles.browser} aria-label="Browse merchants by region">
      <div className={styles.chips} role="group" aria-label="Region">
        {regions.map((r) => (
          <button
            key={r.code}
            type="button"
            className={`${styles.chip}${region === r.code ? ` ${styles.active}` : ''}`}
            aria-pressed={region === r.code}
            onClick={() => pickRegion(r.code)}
          >
            {r.name}
            <span className={styles.count}>{r.merchantCount.toLocaleString()}</span>
          </button>
        ))}
      </div>

      {region && (
        <div className={styles.list}>
          <input
            className={styles.filter}
            type="search"
            placeholder="Filter by name"
            aria-label="Filter merchants by name"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
          {rows.length === 0 && <p className={styles.empty}>No merchants match.</p>}
          <ul className={styles.rows}>
            {rows.map((m) => {
              const parent = m.parent_id ? merchantsById.get(m.parent_id) : null;
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    className={`${styles.row}${m.id === selectedId ? ` ${styles.selected}` : ''}`}
                    aria-pressed={m.id === selectedId}
                    onClick={() => onSelect(m)}
                  >
                    <ListIcon merchant={parent && !m.icon_url ? parent : m} />
                    <span className={styles.rowText}>
                      <span className={styles.rowName}>{m.name || 'Unnamed merchant'}</span>
                      {parent?.name && <span className={styles.rowParent}>{parent.name}</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
