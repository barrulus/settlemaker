import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  // The library is imported from ../src — allow it through Vite's fs guard.
  server: { fs: { allow: ['..'] } },
  build: {
    outDir: 'dist',
    target: 'es2022',
    rollupOptions: {
      input: {
        // "/" is the human builder; "/fmg" is the bare renderer — the URL
        // contract endpoint (docs/url-api.md). A Netlify rewrite maps the
        // extensionless /fmg path onto fmg.html.
        index: resolve(__dirname, 'index.html'),
        fmg: resolve(__dirname, 'fmg.html'),
      },
    },
  },
});
