/**
 * Rasterise the render-gate SVGs to PNG so they can actually be LOOKED at.
 *
 * `probe-afmg.ts --render` writes SVGs; the project's rule is that no visual
 * claim counts until someone has looked at a raster. This turns the gate
 * directory's SVGs into PNGs of the same name.
 *
 *   nix develop --command bash -c "npx tsx scripts/rasterise-gate.ts"
 *   nix develop --command bash -c "npx tsx scripts/rasterise-gate.ts afmg-"
 *
 * An optional prefix argument restricts which files are converted.
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const DIR = '/home/barrulus/settlemaker-village-gate';

async function main(): Promise<void> {
  const prefix = process.argv[2] ?? '';
  const files = fs.readdirSync(DIR)
    .filter((f) => f.endsWith('.svg') && f.startsWith(prefix))
    .sort();
  let n = 0;
  for (const f of files) {
    const svg = fs.readFileSync(path.join(DIR, f));
    await sharp(svg, { density: 96 }).png().toFile(path.join(DIR, f.replace(/\.svg$/, '.png')));
    n += 1;
  }
  process.stdout.write(`${n} PNG${n === 1 ? '' : 's'} written to ${DIR}\n`);
}

main().catch((e) => { process.stderr.write(`${String(e)}\n`); process.exit(1); });
