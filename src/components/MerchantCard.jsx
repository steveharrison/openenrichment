import { useEffect, useState } from 'react';
import { avatarColor, merchantLocation, mapLinks } from '../lib/merchant.js';
import { categoryPath } from '../lib/categories.js';
import { mccName } from '../lib/mcc.js';
import MapEmbeds from './MapEmbeds.jsx';
import styles from './MerchantCard.module.css';

function Avatar({ merchant }) {
  const [failed, setFailed] = useState(false);
  const iconFile = (merchant.icon_url || '').trim().split('/').pop();
  const hasIcon = iconFile && /\.(png|jpe?g|svg|webp|gif)$/i.test(iconFile);

  // Fall back to a coloured-initial avatar if there's no usable icon, or the
  // icon file isn't in merchant-icons/
  if (!hasIcon || failed) {
    return (
      <div className={styles.avatar} style={{ background: avatarColor(merchant) }}>
        {(merchant.name || '?').trim().charAt(0).toUpperCase()}
      </div>
    );
  }
  return (
    <img
      className={`${styles.avatar} ${styles.avatarIcon}`}
      src={`merchant-icons/${encodeURIComponent(iconFile)}`}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

// The CSV holds examples either as a plain string or as a backtick-quoted
// list like [`FIRST EXAMPLE`, `SECOND EXAMPLE`]
function parseExamples(raw) {
  const text = (raw || '').trim();
  if (!text) return [];
  if (text.startsWith('[') && text.endsWith(']')) {
    const items = [...text.matchAll(/`([^`]*)`/g)].map((m) => m[1].trim()).filter(Boolean);
    if (items.length) return items;
  }
  return [text];
}

function DetailRow({ label, children }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

// Merchant card. `merchantsById` powers the "Child of …" button, which stacks
// the parent's card on top of this one; `match` (optional) adds the
// matched-pattern footer; `onClose` (optional) adds a close button.
export default function MerchantCard({ merchant, merchantsById, categoriesById, match, onClose, stacked, deferMaps }) {
  // 'closed' → 'opening' → 'open' → 'closing' → 'closed'; the transitional
  // phases keep the card mounted while the reveal/dismiss animation plays
  const [parentPhase, setParentPhase] = useState('closed');

  function settleParentPhase() {
    setParentPhase((phase) => (phase === 'opening' ? 'open' : phase === 'closing' ? 'closed' : phase));
  }

  // Failsafe in case the transition never fires (e.g. no @starting-style support)
  useEffect(() => {
    if (parentPhase !== 'opening' && parentPhase !== 'closing') return;
    const timer = setTimeout(settleParentPhase, 400);
    return () => clearTimeout(timer);
  }, [parentPhase]);

  const parent = merchant.parent_id ? merchantsById.get(merchant.parent_id) : null;
  const location = merchantLocation(merchant);
  const maps = mapLinks(merchant, location);
  const category = categoryPath(categoriesById, merchant.category_id);
  const mcc = (merchant.mcc || '').trim();
  const pattern = (merchant.transaction_text_regexp || '').trim();
  const examples = parseExamples(merchant.transaction_text_examples);
  // The CSV spells it "colour"; keep reading "color" for older exports
  const colour = (merchant.colour || merchant.color || '').trim();
  const backgroundColour = (merchant.background_colour || merchant.background_color || '').trim();

  return (
    <>
      {parent && parentPhase !== 'closed' && (
        <div
          className={`${styles.parentSlot}${parentPhase === 'opening' ? ` ${styles.opening}` : ''}${parentPhase === 'closing' ? ` ${styles.closing}` : ''}`}
          onTransitionEnd={(event) => {
            if (event.target === event.currentTarget) settleParentPhase();
          }}
        >
          <div className={styles.parentSlotInner}>
            <MerchantCard
              merchant={parent}
              merchantsById={merchantsById}
              categoriesById={categoriesById}
              stacked
              deferMaps={parentPhase === 'opening'}
              onClose={() => setParentPhase('closing')}
            />
          </div>
        </div>
      )}
      <div className={`${styles.card}${stacked ? ` ${styles.stacked}` : ''}`}>
        {onClose && (
          <button type="button" className={styles.cardClose} aria-label="Close" onClick={onClose}>
            <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
              <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        )}

        {match && (
          <div className={styles.ruleHeader}>
            {'Matched pattern '}
            <code>{match.pattern}</code>
            {match.matchedText && (
              <>
                {' on '}
                <code>{match.matchedText}</code>
              </>
            )}
          </div>
        )}

        <div className={styles.cardHeader}>
          <Avatar merchant={merchant} />
          <div>
            <h2 className={styles.merchantName}>{merchant.name || 'Unnamed merchant'}</h2>
            {parent && parent.name && (
              <p className={styles.merchantParent}>
                Child of{' '}
                <button type="button" className={styles.parentLink} onClick={() => setParentPhase('opening')}>
                  {parent.name}
                </button>
              </p>
            )}
          </div>
        </div>

        <dl className={styles.cardDetails}>
          {merchant.website_url && (
            <DetailRow label="Website">
              <a href={merchant.website_url} target="_blank" rel="noopener noreferrer">
                {merchant.website_url.replace(/^https?:\/\//, '').replace(/\/$/, '')}
              </a>
            </DetailRow>
          )}
          {location.address && <DetailRow label="Address">{location.address}</DetailRow>}
          {location.lat != null && location.lng != null && (
            <DetailRow label="Coordinates">{`${location.lat}, ${location.lng}`}</DetailRow>
          )}
          {merchant.apple_place_id && (
            <DetailRow label="Apple Place ID">
              {maps?.apple ? (
                <a href={maps.apple} target="_blank" rel="noopener noreferrer">
                  <code>{merchant.apple_place_id}</code>
                </a>
              ) : (
                <code>{merchant.apple_place_id}</code>
              )}
            </DetailRow>
          )}
          {merchant.google_place_id && (
            <DetailRow label="Google Place ID">
              {maps?.google ? (
                <a href={maps.google} target="_blank" rel="noopener noreferrer">
                  <code>{merchant.google_place_id}</code>
                </a>
              ) : (
                <code>{merchant.google_place_id}</code>
              )}
            </DetailRow>
          )}
          {category.length > 0 && (
            <DetailRow label="Category">
              <span className={styles.categoryPath} title={merchant.category_id}>
                {category.map((name, i) => (
                  <span key={name}>
                    {i > 0 && <span className={styles.categorySeparator}> › </span>}
                    {name}
                  </span>
                ))}
              </span>
            </DetailRow>
          )}
          {/* No matching row in categories.csv — show the raw id rather than nothing */}
          {category.length === 0 && merchant.category_id && (
            <DetailRow label="Category ID">
              <code>{merchant.category_id}</code>
            </DetailRow>
          )}
          {mcc && (
            <DetailRow label="MCC">
              <span>
                <code>{mcc}</code>
                {mccName(mcc) && <span className={styles.mccName}>{` ${mccName(mcc)}`}</span>}
              </span>
            </DetailRow>
          )}
          {backgroundColour && (
            <DetailRow label="Background Colour">
              <span className={styles.colorValue}>
                <span className={styles.colorSwatch} style={{ background: backgroundColour }} />
                {backgroundColour}
              </span>
            </DetailRow>
          )}
          {colour && (
            <DetailRow label="Colour">
              <span className={styles.colorValue}>
                <span className={styles.colorSwatch} style={{ background: colour }} />
                {colour}
              </span>
            </DetailRow>
          )}
          {pattern && (
            <DetailRow label="Regular Expression">
              <code>{pattern}</code>
            </DetailRow>
          )}
          {examples.length > 0 && (
            <DetailRow label="Transaction Text Examples">
              <span className={styles.exampleList}>
                {examples.map((example) => (
                  <code key={example}>{example}</code>
                ))}
              </span>
            </DetailRow>
          )}
          <DetailRow label="Merchant ID">{merchant.id}</DetailRow>
        </dl>

        <MapEmbeds merchant={merchant} location={location} defer={deferMaps} />
      </div>
    </>
  );
}

export function NoMatchCard({ query }) {
  return (
    <div className={`${styles.card} ${styles.noMatch}`}>
      <p className={styles.title}>No merchant matched</p>
      <p>{`No merchant's transaction pattern matched “${query}”.`}</p>
    </div>
  );
}
