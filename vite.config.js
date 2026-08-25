import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative asset paths, so the build works both at a domain root and under
  // a GitHub Pages /repo-name/ project path.
  base: './',
  // Everything the app owns lives under src/; these are copied to the root of
  // dist/ verbatim, so the app still fetches them from data/ and
  // merchant-icons/.
  publicDir: 'src/public',
});
