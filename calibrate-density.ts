/**
 * Calibration harness for the fidelity round-4 density fix (2026-08-05).
 *
 * The Voronoi point count feeding buildPatches() is `nPatches * 8`, and
 * `mapToGenerationParams` caps nPatches at 60 regardless of population. Past
 * roughly 6k population, every burg collapses onto the same 60-patch mesh:
 * gen time, wallRadius, and buildings-per-patch all flatten out even though
 * the population budget keeps climbing. This script is the ground-truth
 * measurement table Task 2's constants (a population-scaled point multiplier
 * and/or patch cap) get chosen from.
 *
 * Run: nix develop --command bash -c "npx tsx calibrate-density.ts"
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { generateFromBurg, mapToGenerationParams, type AzgaarBurgInput } from './src/index.js';
import { CommonWard } from './src/wards/common-ward.js';

const BUDGET_EXEMPT = new Set(['castle', 'cathedral', 'market', 'harbour', 'park']);

function countOrdinaryBuildings(model: { patches: Array<{ ward: { type: string; geometry: unknown[] } | null }> }): number {
  let n = 0;
  for (const patch of model.patches) {
    if (!patch.ward || BUDGET_EXEMPT.has(String(patch.ward.type))) continue;
    n += patch.ward.geometry.length;
  }
  return n;
}

function buildingsPerWalledCommonWardPatch(model: {
  patches: Array<{ ward: unknown; withinWalls: boolean }>;
}): number {
  let wards = 0, buildings = 0;
  for (const patch of model.patches) {
    if (!(patch.ward instanceof CommonWard) || !patch.withinWalls) continue;
    wards++;
    buildings += patch.ward.geometry.length;
  }
  return wards > 0 ? buildings / wards : NaN;
}

const aldford = (population: number): AzgaarBurgInput => ({
  name: 'Aldford', population, port: false, citadel: false, walls: true,
  plaza: true, temple: true, shanty: false, capital: false,
});

const POPS = [300, 1000, 5000, 20000, 70000, 200000];
const SEED = 9;

mkdirSync('output/calibrate', { recursive: true });

interface Row {
  pop: number;
  nPatches: number;
  genMs: number;
  ordinaryBuildings: number;
  buildingsPerWalledPatch: number;
  wallRadius: number;
}

const rows: Row[] = [];

for (const pop of POPS) {
  const burg = aldford(pop);
  const params = mapToGenerationParams(burg, SEED);

  const t0 = Date.now();
  const { model, svg } = generateFromBurg(burg, { seed: SEED });
  const genMs = Date.now() - t0;

  const ordinaryBuildings = countOrdinaryBuildings(model);
  const buildingsPerWalledPatch = buildingsPerWalledCommonWardPatch(model);
  const wallRadius = model.border!.getRadius();

  rows.push({
    pop,
    nPatches: params.nPatches,
    genMs,
    ordinaryBuildings,
    buildingsPerWalledPatch,
    wallRadius,
  });

  writeFileSync(`output/calibrate/aldford-${pop}.svg`, svg);
}

const header = ['pop', 'nPatches', 'gen ms', 'ordinary buildings', 'buildings/walled CommonWard patch', 'wallRadius'];
const widths = header.map(h => h.length);
const cells = rows.map(r => [
  String(r.pop),
  String(r.nPatches),
  String(r.genMs),
  String(r.ordinaryBuildings),
  r.buildingsPerWalledPatch.toFixed(2),
  r.wallRadius.toFixed(1),
]);
for (const row of cells) {
  row.forEach((c, i) => { widths[i] = Math.max(widths[i], c.length); });
}

function fmtRow(cells: string[]): string {
  return cells.map((c, i) => c.padEnd(widths[i])).join(' | ');
}

console.log(fmtRow(header));
console.log(widths.map(w => '-'.repeat(w)).join('-|-'));
for (const row of cells) console.log(fmtRow(row));
