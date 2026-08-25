// MapKit JS loader.
//
// MapKit JS authenticates with a JWT signed by an Apple Maps private key. The
// key itself must never reach the browser, so we ship a pre-signed, long-lived,
// origin-scoped token instead (VITE_MAPKIT_TOKEN, see .env.example). Without
// one configured the Apple embed simply doesn't render.

const TOKEN = (import.meta.env.VITE_MAPKIT_TOKEN || '').trim();
const SRC = 'https://cdn.apple-mapkit.com/mk/5.x.x/mapkit.js';

export const hasMapkitToken = Boolean(TOKEN);

let loader = null;
let lastError = null;
const errorListeners = new Set();

function reportError(message) {
  lastError = message;
  for (const fn of errorListeners) fn(message);
}

// MapKit reports a bad/expired token asynchronously, well after init() resolves,
// so components subscribe rather than relying on the load promise alone.
export function onMapkitError(fn) {
  errorListeners.add(fn);
  if (lastError) fn(lastError);
  return () => errorListeners.delete(fn);
}

export function loadMapkit() {
  if (!TOKEN) return Promise.reject(new Error('No MapKit JS token configured'));
  if (loader) return loader;

  loader = new Promise((resolve, reject) => {
    const start = () => {
      const mapkit = window.mapkit;
      mapkit.addEventListener('error', (event) => {
        // `Unauthorized` here almost always means the token expired or its
        // origin claim doesn't match the site it's being served from.
        reportError(event.status || 'MapKit error');
      });
      mapkit.init({ authorizationCallback: (done) => done(TOKEN) });
      resolve(mapkit);
    };

    if (window.mapkit) return start();

    const script = document.createElement('script');
    script.src = SRC;
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.addEventListener('load', start);
    script.addEventListener('error', () => {
      loader = null;
      reject(new Error('Failed to load MapKit JS'));
    });
    document.head.appendChild(script);
  });

  return loader;
}
