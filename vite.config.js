import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import merchantEditor from './src/tools/merchant-editor-plugin.mjs';

export default defineConfig(({ mode }) => {
  // '' loads every variable, not only VITE_ ones; the map credentials below
  // stay on the dev server and never reach the browser
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [
      react(),
      // Dev server only: the "Add merchant" form writes and looks up places
      // through this
      merchantEditor({
        dataDir: fileURLToPath(new URL('./src/public/data', import.meta.url)),
        googleKey: env.GOOGLE_MAPS_API_KEY,
        appleCredentialsFile: env.APPLE_MAPS_CREDENTIALS_FILE,
      }),
    ],
    // Relative asset paths, so the build works both at a domain root and under
    // a GitHub Pages /repo-name/ project path.
    base: './',
    // Everything the app owns lives under src/; these are copied to the root of
    // dist/ verbatim, so the app still fetches them from data/ and
    // merchant-icons/.
    publicDir: 'src/public',
  };
});
