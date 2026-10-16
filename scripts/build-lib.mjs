import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const hash = createHash('sha256');
async function fingerprint(directory) {
  const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'));
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await fingerprint(path);
    else if (entry.isFile()) {
      hash.update(relative(root, path)).update('\0').update(await readFile(path)).update('\0');
    }
  }
}
await fingerprint(join(root, 'src'));
for (const file of ['package.json', 'scripts/build-lib.mjs']) {
  hash.update(file).update('\0').update(await readFile(join(root, file))).update('\0');
}
// npm excludes package-lock.json from published packages. Include it when
// available, while keeping the shipped source build usable without that file.
try { hash.update(await readFile(join(root, 'package-lock.json'))); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const revision = `source-${hash.digest('hex').slice(0, 24)}`;
await build({
  absWorkingDir: root,
  entryPoints: ['src/index.ts'],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: true,
  outfile: 'dist/settlemaker.browser.js',
  define: { __SETTLEMAKER_BUILD_REVISION__: JSON.stringify(revision) },
  banner: { js: '/* settlemaker — GPL-3.0-only. Corresponding source: https://github.com/barrulus/settlemaker */' },
});
console.log(`Built dist/settlemaker.browser.js (${revision})`);
