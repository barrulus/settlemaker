/**
 * Diagnostic: render the ladder to standalone SVG files for visual inspection.
 *   nix develop --command bash -c "npx tsx scripts/diag-render.ts <outdir>"
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Model, mapToGenerationParams, generateSvg } from '../src/index.js';
import type { AzgaarBurgInput } from '../src/index.js';

const outdir = process.argv[2] ?? 'diag-out';
mkdirSync(outdir, { recursive: true });

const CROSSROADS = [0, 120, 240];

function burg(name: string, population: number, extra: Partial<AzgaarBurgInput> = {}): AzgaarBurgInput {
  return {
    name, population,
    port: false, citadel: false, walls: population >= 1000,
    plaza: true, temple: false, shanty: false, capital: false,
    roadBearings: CROSSROADS,
    ...extra,
  };
}

const port = (name: string, pop: number, harbourSize: 'small' | 'large') =>
  burg(name, pop, { port: true, oceanBearing: 90, harbourSize });

// [label, input, seed] — the coastal cells repeat across seeds because the
// wall's shoreline closure has to hold on every layout, not just seed 3.
const cells: [string, AzgaarBurgInput, number][] = [
  ['pop300', burg('Threehundred', 300), 3],
  ['pop1200', burg('Twelvehundred', 1200), 3],
  ['pop4000', burg('Fourthousand', 4000), 3],
  ['pop10000', burg('Tenthousand', 10000), 3],
  ['pop50000', burg('Fiftythousand', 50000, { citadel: true }), 3],
  ['pop250000', burg('Quartermillion', 250000, { citadel: true, shanty: true }), 3],
  ['port20000', port('Saltmouth', 20000, 'large'), 3],
  ['port20000-seed5', port('Saltmouth', 20000, 'large'), 5],
  ['port20000-seed8', port('Saltmouth', 20000, 'large'), 8],
  ['port4000-small', port('Cockleshell', 4000, 'small'), 3],
];

for (const [label, input, seed] of cells) {
  const params = mapToGenerationParams(input, seed);
  const model = new Model(params).generate();
  const svg = generateSvg(model);
  writeFileSync(join(outdir, `${label}.svg`), svg);
  console.log(`${label}: ${svg.length} bytes`);
}
