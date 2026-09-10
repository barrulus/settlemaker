import { build } from 'esbuild';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const refIndex = args.indexOf('--source-ref');
let sourceRoot, sourceRevision;
try {
  if (refIndex >= 0) {
    const ref = args[refIndex + 1];
    if (!ref) throw new Error('--source-ref needs a Git revision');
    sourceRevision = execFileSync('git', ['rev-parse', '--verify', `${ref}^{commit}`], { encoding: 'utf8' }).trim();
    sourceRoot = await mkdtemp(join(tmpdir(), 'settlemaker-road-baseline-'));
    const archive = execFileSync('git', ['archive', sourceRevision, 'src'], { maxBuffer: 64 * 1024 * 1024 });
    execFileSync('tar', ['-x', '-C', sourceRoot], { input: archive });
  }
  await mkdir('output/road-review', { recursive: true });
  await build({
    entryPoints: ['scripts/review-village-roads.ts'], bundle: true, platform: 'node', format: 'cjs',
    outfile: 'output/road-review/runner.cjs',
    plugins: sourceRoot ? [{ name: 'historical-generator', setup(builder) {
      builder.onResolve({ filter: /^\.\.\/src\/(index|village\/render)\.js$/ }, args => {
        if (args.importer !== resolve('scripts/review-village-roads.ts')) return;
        return { path: join(sourceRoot, args.path.replace('../', '').replace(/\.js$/, '.ts')) };
      });
    } }] : [],
  });
  const result = spawnSync(process.execPath, ['output/road-review/runner.cjs', ...args], {
    stdio: 'inherit', env: { ...process.env, ROAD_REVIEW_SOURCE_REVISION: sourceRevision ?? '' },
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  if (sourceRoot) await rm(sourceRoot, { recursive: true, force: true });
}
