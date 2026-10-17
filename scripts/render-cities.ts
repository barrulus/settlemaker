/**
 * City render sweep — does the settlement generator still look right on this
 * branch? The seed scramble reseeds every city, so the question is not
 * "identical" (it will not be, deliberately) but "still good".
 *
 *   nix develop --command bash -c "npx tsx scripts/render-cities.ts"
 */
import fs from 'node:fs';
import sharp from 'sharp';
import { generateSettlement } from '../src/index.js';
import type { AzgaarBurgInput } from '../src/input/azgaar-input.js';

const OUT = '/home/barrulus/settlemaker-village-gate';
const base = {
  port: false, citadel: false, walls: false, plaza: false,
  temple: false, shanty: false, capital: false,
};
// Coastline coordinates use the same local metres as every physical plan.
const COAST = [[{ x: 260, y: -3000 }, { x: 3000, y: -3000 }, { x: 3000, y: 3000 }, { x: 260, y: 3000 }]];

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
    const r = generateSettlement(burg, { seed: 1 });
    fs.writeFileSync(`${OUT}/city-${name}.svg`, r.svg);
    await sharp(Buffer.from(r.svg), { density: 96 }).png().toFile(`${OUT}/city-${name}.png`);
    const buildings = r.model.scene.layers.buildings.length;
    process.stdout.write(
      `${name.padEnd(28)} districts ${String(r.model.districts.length).padStart(4)}`
      + `  buildings ${String(buildings).padStart(5)}  housed ${r.model.residents.assigned}  degraded [${r.model.degradedFlags?.join(',') ?? ''}]  svg ${(r.svg.length / 1024).toFixed(0)}k\n`,
    );
  }
}
main().catch((e) => { process.stderr.write(`${String(e)}\n`); process.exit(1); });
