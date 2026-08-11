/**
 * Regenerates docs/examples/ — the rendered example settlements embedded in
 * the README and docs. Run after any generator change that alters the look:
 *
 *   nix develop --command bash -c "npx tsx scripts/generate-examples.ts"
 *
 * Fixtures shared with generate-test-urls.ts so the pictures always match
 * the documented example URLs.
 */
import { writeFileSync } from 'node:fs';
import { generateFromBurg, PALETTES, type AzgaarBurgInput } from '../src/index.js';
import { thornbury, kingsmoor, saltmarsh } from './generate-test-urls.js';

const gallery: Array<[string, AzgaarBurgInput, number]> = [
  ['hamlet', {
    name: 'Fenmoor', population: 300, port: false, citadel: false, walls: false,
    plaza: true, temple: false, shanty: false, capital: false, roadBearings: [0, 120, 240],
  }, 3],
  ['town', {
    name: 'Aldford', population: 4000, port: false, citadel: false, walls: true,
    plaza: true, temple: true, shanty: false, capital: false, roadBearings: [0, 120, 240],
  }, 3],
  ['city', {
    name: 'Greywall', population: 50000, port: false, citadel: true, walls: true,
    plaza: true, temple: true, shanty: false, capital: true, roadBearings: [0, 120, 240],
  }, 3],
  ['port', {
    name: 'Saltmouth', population: 20000, port: true, citadel: false, walls: true,
    plaza: true, temple: true, shanty: false, capital: false,
    roadBearings: [200, 300], oceanBearing: 90, harbourSize: 'large',
  }, 3],
  ['route-character', thornbury, 3],
  ['core-capacity', kingsmoor, 2],
  ['coastal-full', saltmarsh, 7],
];

for (const [label, input, seed] of gallery) {
  const { svg } = generateFromBurg(input, { seed });
  writeFileSync(`docs/examples/${label}.svg`, svg);
  console.log(`${label}: ${Math.round(svg.length / 1024)}KB`);
}

// Themed variants: the SAME town (identical layout, seed 3) across palettes —
// the canonical demonstration that theme= never affects geometry.
const themedTown = gallery.find(([label]) => label === 'town')!;
for (const paletteName of ['blueprint', 'night', 'colour'] as const) {
  const { svg } = generateFromBurg(themedTown[1], {
    seed: themedTown[2],
    svg: { palette: PALETTES[paletteName] },
  });
  writeFileSync(`docs/examples/town-${paletteName}.svg`, svg);
  console.log(`town-${paletteName}: ${Math.round(svg.length / 1024)}KB`);
}
