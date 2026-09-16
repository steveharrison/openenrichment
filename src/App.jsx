import { useEffect, useRef, useState } from 'react';
import Masthead from './components/Masthead.jsx';
import SearchForm from './components/SearchForm.jsx';
import MerchantCard, { NoMatchCard } from './components/MerchantCard.jsx';
import RegionBrowser from './components/RegionBrowser.jsx';
import { loadDataset } from './lib/dataset.js';
import { buildMatchers, findMerchantMatch } from './lib/rules.js';
import styles from './App.module.css';

export default function App() {
  const [data, setData] = useState(null); // { merchants, matchers, merchantsById, categoriesById, regions, regionsByCode }
  const [loadFailed, setLoadFailed] = useState(false);
  // { type: 'match', match } from the search box, { type: 'merchant', merchant }
  // from the region browser, or { type: 'no-match', query }
  const [result, setResult] = useState(null);
  const resultRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const { regions, regionsByCode, merchants, categoriesById } = await loadDataset();
        const merchantsById = new Map();
        for (const merchant of merchants) {
          if (merchant.id) merchantsById.set(merchant.id, merchant);
        }
        const matchers = buildMatchers(merchants);
        if (!cancelled) setData({ merchants, matchers, merchantsById, categoriesById, regions, regionsByCode });
      } catch {
        if (!cancelled) setLoadFailed(true);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

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

      <footer className={styles.footer}>
        <p>
          Matching runs entirely in your browser against every region's <code>merchants.csv</code> under{' '}
          <a href="data/regions.csv">data/</a>.
        </p>
      </footer>
    </main>
  );
}
