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
        // extensionless /fmg path onto fmg.html. Relative paths resolve
        // against the Vite root; no node:path/__dirname — this tsconfig has
        // no Node types (the web build must not depend on the parent repo's
        // node_modules, which is exactly what masked this locally).
        index: 'index.html',
        fmg: 'fmg.html',
        // "/symbols" is the symbol-library reference sheet. Its assets live in
        // public/symbols/batch001/ and are served verbatim.
        symbols: 'symbols.html',
      },
    },
  },
});
