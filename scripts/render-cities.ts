/**
 * City render sweep — does the settlement generator still look right on this
 * branch? The seed scramble reseeds every city, so the question is not
 * "identical" (it will not be, deliberately) but "still good".
 *
 *   nix develop --command bash -c "npx tsx scripts/render-cities.ts"
 */
import fs from 'node:fs';
import sharp from 'sharp';
import { generateFromBurg } from '../src/index.js';
import type { AzgaarBurgInput } from '../src/input/azgaar-input.js';

const OUT = '/home/barrulus/settlemaker-village-gate';
const base = {
  port: false, citadel: false, walls: false, plaza: false,
  temple: false, shanty: false, capital: false,
};
// City coordinates are SETTLEMENT UNITS, not metres: a pop-6000 walled burg
// has a border radius of ~49, so a coastline must sit tens of units out, not
// hundreds. A coast at x=260 is simply beyond the map and draws nothing —
// which is how the first pass of this sweep produced a "port" with no water.
const COAST = [[{ x: 55, y: -400 }, { x: 400, y: -400 }, { x: 400, y: 400 }, { x: 55, y: 400 }]];

const CASES: Array<{ name: string; burg: AzgaarBurgInput }> = [
  { name: 'town-1200', burg: { ...base, name: 'Marchford', population: 1200, roadBearings: [0, 120, 240] } as AzgaarBurgInput },
  { name: 'town-4000-walled', burg: { ...base, name: 'Aldford', population: 4000, walls: true, plaza: true, temple: true, roadBearings: [30, 150, 270] } as AzgaarBurgInput },
  { name: 'city-10000-walled-citadel', burg: { ...base, name: 'Kingsmoor', population: 10000, walls: true, citadel: true, plaza: true, temple: true, roadBearings: [0, 90, 180, 270] } as AzgaarBurgInput },
  { name: 'metropolis-20000', burg: { ...base, name: 'Greatharbour', population: 20000, walls: true, citadel: true, plaza: true, temple: true, roadBearings: [20, 110, 200, 290] } as AzgaarBurgInput },
  { name: 'port-6000-coastal', burg: { ...base, name: 'Saltwick', population: 6000, port: true, walls: true, plaza: true, roadBearings: [200, 300], coastlineGeometry: COAST } as AzgaarBurgInput },
];

async function main(): Promise<void> {
  fs.mkdirSync(OUT, { recursive: true });
  for (const { name, burg } of CASES) {
    const r = generateFromBurg(burg, { seed: 1 });
    fs.writeFileSync(`${OUT}/city-${name}.svg`, r.svg);
    await sharp(Buffer.from(r.svg), { density: 96 }).png().toFile(`${OUT}/city-${name}.png`);
    const wards = r.model.patches.filter((p) => p.ward).length;
    const buildings = r.model.patches.reduce((n, p) => n + (p.ward?.geometry.length ?? 0), 0);
    process.stdout.write(
      `${name.padEnd(28)} patches ${String(r.model.patches.length).padStart(4)}  wards ${String(wards).padStart(4)}`
      + `  buildings ${String(buildings).padStart(5)}  degraded [${r.degradedFlags.join(',')}]  svg ${(r.svg.length / 1024).toFixed(0)}k\n`,
    );
  }
}
main().catch((e) => { process.stderr.write(`${String(e)}\n`); process.exit(1); });
