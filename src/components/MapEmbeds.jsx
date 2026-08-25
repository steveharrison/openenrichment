import { useEffect, useRef, useState } from 'react';
import { loadMapkit, onMapkitError, hasMapkitToken } from '../lib/mapkit.js';
import styles from './MapEmbeds.module.css';

const GOOGLE_KEY = (import.meta.env.VITE_GOOGLE_MAPS_EMBED_KEY || '').trim();

const SPAN = 0.004; // ~450 m across, close enough to read the street

const DARK_QUERY = '(prefers-color-scheme: dark)';

function AppleMap({ placeId, lat, lng, name }) {
  const container = useRef(null);
  const mapRef = useRef(null);
  const mapkitRef = useRef(null);
  const [error, setError] = useState(null);

  useEffect(() => onMapkitError(setError), []);

  // MapKit paints its own tiles, so it can't inherit the page's colours — keep
  // it in step with the system theme, including a live switch while open.
  useEffect(() => {
    const query = window.matchMedia(DARK_QUERY);
    const sync = () => {
      const map = mapRef.current;
      const mapkit = mapkitRef.current;
      if (!map || !mapkit) return;
      map.colorScheme = query.matches ? mapkit.Map.ColorSchemes.Dark : mapkit.Map.ColorSchemes.Light;
    };
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    let map = null;
    let cancelled = false;

    loadMapkit()
      .then((mapkit) => {
        if (cancelled || !container.current) return;

        const dark = window.matchMedia(DARK_QUERY).matches;
        map = new mapkit.Map(container.current, {
          colorScheme: dark ? mapkit.Map.ColorSchemes.Dark : mapkit.Map.ColorSchemes.Light,
          showsMapTypeControl: false,
          showsCompass: mapkit.FeatureVisibility.Hidden,
        });
        mapRef.current = map;
        mapkitRef.current = mapkit;

        if (lat != null && lng != null) {
          const coordinate = new mapkit.Coordinate(lat, lng);
          map.region = new mapkit.CoordinateRegion(coordinate, new mapkit.CoordinateSpan(SPAN, SPAN));
          map.addAnnotation(new mapkit.MarkerAnnotation(coordinate, { title: name || '' }));
        }

        // With an Apple place id we can show the real POI — its own name,
        // category and pin — instead of a bare coordinate marker.
        if (placeId && mapkit.PlaceLookup) {
          new mapkit.PlaceLookup().getPlace(placeId, (err, place) => {
            if (cancelled || err || !place || !map) return;
            map.removeAnnotations(map.annotations);
            const annotation = new mapkit.PlaceAnnotation(place);
            map.addAnnotation(annotation);
            map.region = new mapkit.CoordinateRegion(
              place.coordinate,
              new mapkit.CoordinateSpan(SPAN, SPAN),
            );
          });
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });

    return () => {
      cancelled = true;
      if (map) map.destroy();
      mapRef.current = null;
      mapkitRef.current = null;
    };
  }, [placeId, lat, lng, name]);

  if (error) return <p className={styles.mapError}>{`Apple map unavailable — ${error}`}</p>;
  return <div ref={container} className={styles.mapFrame} role="img" aria-label={`Apple Maps view of ${name}`} />;
}

function GoogleMap({ placeId, lat, lng, name }) {
  const params = new URLSearchParams({ key: GOOGLE_KEY, zoom: '17' });
  let mode;
  if (placeId) {
    mode = 'place';
    params.set('q', `place_id:${placeId}`);
  } else {
    mode = 'view';
    params.set('center', `${lat},${lng}`);
  }

  return (
    <iframe
      className={styles.mapFrame}
      title={`Google Maps view of ${name}`}
      src={`https://www.google.com/maps/embed/v1/${mode}?${params}`}
      loading="lazy"
      allowFullScreen
      referrerPolicy="no-referrer-when-downgrade"
    />
  );
}

// Apple/Google map embeds for a merchant. Each provider needs both a credential
// (build-time env var) and something to point at — a place id, or coordinates
// to fall back on. Renders nothing when neither provider can show anything.
// `defer` holds the map's space with an empty frame without initialising it —
// used to keep MapKit/iframe setup off the main thread while a card animates in.
export default function MapEmbeds({ merchant, location, defer = false }) {
  const [provider, setProvider] = useState(null);

  const { lat, lng } = location;
  const hasCoords = lat != null && lng != null;
  const applePlaceId = (merchant.apple_place_id || '').trim();
  const googlePlaceId = (merchant.google_place_id || '').trim();
  const name = merchant.name || 'this merchant';

  const available = [
    hasMapkitToken && (applePlaceId || hasCoords) && { id: 'apple', label: 'Apple' },
    GOOGLE_KEY && (googlePlaceId || hasCoords) && { id: 'google', label: 'Google' },
  ].filter(Boolean);

  if (!available.length) return null;

  const active = available.some((p) => p.id === provider) ? provider : available[0].id;

  return (
    <div className={styles.maps}>
      {available.length > 1 && (
        <div className={styles.switcher} role="tablist" aria-label="Map provider">
          {available.map((p) => (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={active === p.id}
              className={`${styles.switch}${active === p.id ? ` ${styles.switchActive}` : ''}`}
              onClick={() => setProvider(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      {defer ? (
        <div className={styles.mapFrame} aria-hidden="true" />
      ) : active === 'apple' ? (
        <AppleMap placeId={applePlaceId} lat={lat} lng={lng} name={name} />
      ) : (
        <GoogleMap placeId={googlePlaceId} lat={lat} lng={lng} name={name} />
      )}
    </div>
  );
}
