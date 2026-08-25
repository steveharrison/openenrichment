import styles from './Masthead.module.css';

export default function Masthead() {
  return (
    <header className={styles.masthead}>
      <div className={styles.logo} aria-hidden="true">
        <img src="icon.svg" alt="" />
      </div>
      <h1>Open Enrichment</h1>
      <p className={styles.tagline}>Paste a raw bank statement line and find the merchant behind it.</p>
    </header>
  );
}
