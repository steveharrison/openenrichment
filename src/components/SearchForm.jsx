import { useEffect, useRef, useState } from 'react';
import styles from './SearchForm.module.css';

export default function SearchForm({ disabled, onSearch }) {
  const [query, setQuery] = useState('');
  const inputRef = useRef(null);

  // Focus the input once the CSV data has loaded and the form enables
  useEffect(() => {
    if (!disabled) inputRef.current?.focus();
  }, [disabled]);

  function handleSubmit(event) {
    event.preventDefault();
    onSearch(query.trim());
  }

  return (
    <form className={styles.search} autoComplete="off" onSubmit={handleSubmit}>
      <input
        ref={inputRef}
        className={styles.input}
        type="text"
        name="q"
        placeholder="e.g. SQ *SOCIAL SOCIETY"
        aria-label="Raw transaction text"
        disabled={disabled}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <button className={`${styles.button} ${styles.primary}`} type="submit" disabled={disabled}>
        Search
      </button>
    </form>
  );
}
