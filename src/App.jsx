import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import Masthead from './components/Masthead.jsx';
import SearchForm from './components/SearchForm.jsx';
import MerchantCard, { NoMatchCard } from './components/MerchantCard.jsx';
import RegionBrowser from './components/RegionBrowser.jsx';
import { loadDataset } from './lib/dataset.js';
import { buildMatchers, findMerchantMatch } from './lib/rules.js';
import styles from './App.module.css';

// The local editor writes through a dev-server endpoint, so production builds
// leave it out entirely
const MerchantEditor = import.meta.env.DEV ? lazy(() => import('./components/MerchantEditor.jsx')) : null;

async function loadData(options) {
  const { regions, regionsByCode, merchants, categoriesById } = await loadDataset(options);
  const merchantsById = new Map();
  for (const merchant of merchants) {
    if (merchant.id) merchantsById.set(merchant.id, merchant);
  }
  const matchers = buildMatchers(merchants);
  return { merchants, matchers, merchantsById, categoriesById, regions, regionsByCode };
}

export default function App() {
  const [data, setData] = useState(null); // { merchants, matchers, merchantsById, categoriesById, regions, regionsByCode }
  const [loadFailed, setLoadFailed] = useState(false);
  // { type: 'match', match } from the search box, { type: 'merchant', merchant }
  // from the region browser, or { type: 'no-match', query }
  const [result, setResult] = useState(null);
  const resultRef = useRef(null);
  const [editing, setEditing] = useState(null); // the merchant open in the local editor
  const editorRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const loaded = await loadData();
        if (!cancelled) setData(loaded);
      } catch {
        if (!cancelled) setLoadFailed(true);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // The editor sits below the region list, so bring it into view
  useEffect(() => {
    if (editing) editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [editing]);

  // Reloads the CSVs after the editor saves, then shows the saved merchant
  async function handleSaved(saved) {
    const loaded = await loadData({ fresh: true });
    setData(loaded);
    setEditing(null);
    const merchant = loaded.merchantsById.get(saved.id);
    if (merchant) {
      setResult({ type: 'merchant', merchant });
      resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function handleSearch(query) {
    if (!query) {
      setResult(null);
      return;
    }

    const match = findMerchantMatch(query, data.matchers);
    setResult(match ? { type: 'match', match } : { type: 'no-match', query });
  }

  let statusText = 'Loading merchant data…';
  if (loadFailed) {
    statusText = 'Could not load the CSV data. If you opened this page from disk, serve it over HTTP (e.g. npm run dev).';
  } else if (data) {
    statusText = `${data.merchantsById.size.toLocaleString()} merchants across ${data.regions.length} regions · ${data.matchers.length.toLocaleString()} with transaction patterns`;
  }

  const shownMerchant = result?.type === 'match' ? result.match.merchant : result?.type === 'merchant' ? result.merchant : null;

  return (
    <main className={styles.page}>
      <Masthead />

      <SearchForm disabled={!data} onSearch={handleSearch} />

      <div className={`${styles.status}${loadFailed ? ` ${styles.error}` : ''}`} role="status">
        {statusText}
      </div>

      <section ref={resultRef} className={styles.result} aria-live="polite">
        {shownMerchant && (
          <MerchantCard
            key={shownMerchant.id}
            merchant={shownMerchant}
            merchantsById={data.merchantsById}
            categoriesById={data.categoriesById}
            regionsByCode={data.regionsByCode}
            match={result.type === 'match' ? result.match : undefined}
            onEdit={MerchantEditor ? setEditing : undefined}
          />
        )}
        {result?.type === 'no-match' && <NoMatchCard query={result.query} />}
      </section>

      {data && (
        <RegionBrowser
          regions={data.regions}
          merchants={data.merchants}
          merchantsById={data.merchantsById}
          selectedId={shownMerchant?.id}
          onSelect={(merchant) => {
            setResult({ type: 'merchant', merchant });
            // The card renders above the list, so bring it into view
            resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }}
        />
      )}

      {MerchantEditor && data && (
        <div ref={editorRef} className={styles.editor}>
          <Suspense fallback={null}>
            <MerchantEditor
              key={editing?.id ?? 'new'}
              data={data}
              editing={editing}
              onSaved={handleSaved}
              onEditDone={() => setEditing(null)}
            />
          </Suspense>
        </div>
      )}

      <footer className={styles.footer}>
        <p>
          Matching runs entirely in your browser against every region's <code>merchants.csv</code> under{' '}
          <a href="data/regions.csv">data/</a>.
        </p>
      </footer>
    </main>
  );
}
