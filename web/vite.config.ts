import { defineConfig } from 'vite';

export default defineConfig({
  // The library is imported from ../src — allow it through Vite's fs guard.
  server: { fs: { allow: ['..'] } },
  build: { outDir: 'dist', target: 'es2022' },
});
