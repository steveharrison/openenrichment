import styles from './RegionBadge.module.css';

// Small pill naming the region folder a merchant row came from. `regionsByCode`
// supplies the display name; an unknown code shows as-is.
export default function RegionBadge({ code, regionsByCode }) {
  if (!code) return null;
  const name = regionsByCode?.get(code)?.name || code;
  return (
    <span className={styles.badge} title={`data/${code}/`}>
      {name}
    </span>
  );
}
