/**
 * Diagnostic: render the ladder to standalone SVG files for visual inspection.
 *   nix develop --command bash -c "npx tsx diag-render.ts <outdir>"
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Model, mapToGenerationParams, generateSvg } from './src/index.js';
import type { AzgaarBurgInput } from './src/index.js';

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

const cells: [string, AzgaarBurgInput][] = [
  ['pop300', burg('Threehundred', 300)],
  ['pop1200', burg('Twelvehundred', 1200)],
  ['pop4000', burg('Fourthousand', 4000)],
  ['pop10000', burg('Tenthousand', 10000)],
  ['pop50000', burg('Fiftythousand', 50000, { citadel: true })],
  ['pop250000', burg('Quartermillion', 250000, { citadel: true, shanty: true })],
  ['port20000', burg('Saltmouth', 20000, { port: true, oceanBearing: 90, harbourSize: 'large' })],
];

for (const [label, input] of cells) {
  const params = mapToGenerationParams(input, 3);
  const model = new Model(params).generate();
  const svg = generateSvg(model);
  writeFileSync(join(outdir, `${label}.svg`), svg);
  console.log(`${label}: ${svg.length} bytes`);
}
