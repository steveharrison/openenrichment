import { useEffect, useState } from 'react';
import Masthead from './components/Masthead.jsx';
import SearchForm from './components/SearchForm.jsx';
import MerchantCard, { NoMatchCard } from './components/MerchantCard.jsx';
import { csvToObjects } from './lib/csv.js';
import { buildCategoryIndex } from './lib/categories.js';
import { buildMatchers, findMerchantMatch } from './lib/rules.js';
import { parsePaymentProcessors, setPaymentProcessors } from './lib/paymentProcessors.js';
import styles from './App.module.css';

export default function App() {
  const [data, setData] = useState(null); // { matchers, merchantsById, categoriesById }
  const [loadFailed, setLoadFailed] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [merchantsRes, categoriesRes, processorsRes] = await Promise.all([
          fetch('data/merchants.csv'),
          // Categories only label the card, so a missing file isn't fatal
          fetch('data/categories.csv').catch(() => null),
          // Processors fall back to a built-in list, so this isn't fatal either
          fetch('data/payment_processors.csv').catch(() => null),
        ]);
        if (!merchantsRes.ok) throw new Error('HTTP error');

        // Set before any matching runs — the matcher strips processor prefixes
        if (processorsRes?.ok) {
          setPaymentProcessors(parsePaymentProcessors(csvToObjects(await processorsRes.text())));
        }

        const merchants = csvToObjects(await merchantsRes.text());
        const merchantsById = new Map();
        for (const merchant of merchants) {
          if (merchant.id) merchantsById.set(merchant.id, merchant);
        }
        const matchers = buildMatchers(merchants);
        const categoriesById = categoriesRes?.ok
          ? buildCategoryIndex(csvToObjects(await categoriesRes.text()))
          : new Map();
        if (!cancelled) setData({ matchers, merchantsById, categoriesById });
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
    statusText = `${data.merchantsById.size.toLocaleString()} merchants · ${data.matchers.length.toLocaleString()} with transaction patterns`;
  }

  return (
    <main className={styles.page}>
      <Masthead />

      <SearchForm disabled={!data} onSearch={handleSearch} />

      <div className={`${styles.status}${loadFailed ? ` ${styles.error}` : ''}`} role="status">
        {statusText}
      </div>

      <section className={styles.result} aria-live="polite">
        {result?.type === 'match' && (
          <MerchantCard
            key={result.match.merchant.id}
            merchant={result.match.merchant}
            merchantsById={data.merchantsById}
            categoriesById={data.categoriesById}
            match={result.match}
          />
        )}
        {result?.type === 'no-match' && <NoMatchCard query={result.query} />}
      </section>

      <footer className={styles.footer}>
        <p>
          Matching runs entirely in your browser against{' '}
          <a href="data/merchants.csv">merchants.csv</a>.
        </p>
      </footer>
    </main>
  );
}
