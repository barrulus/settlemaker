/**
 * Task 1 diagnostic (2026-08-24, roads-first-village readiness, TEMPORARY):
 * WHY does the census starve on the `hub` and `fan` AFMG scenarios from
 * `probe-afmg.ts`? Extends `probe-lots.ts`'s lot-fate histogram to those
 * scenarios (it only ever ran the single-road baseline fixture) and adds
 * three readings the brief specifically asks for:
 *
 *  1. arm count vs the lane budget: how much of `laneBudgetFor(targetRadiusM)`
 *     is already spent by FMG's own arms (`buildArms`'s output) BEFORE
 *     `saturateDisc`'s growth loop places a single invented lane.
 *  2. the incoming-arm bearing-separation table -- how close together the
 *     routes in each scenario really are, and how many pairs fall under
 *     MIN_ARM_SEPARATION_DEG (the separation `growOne` enforces for
 *     INVENTED ribs -- never applied to FMG arms themselves).
 *  3. the final lot-fate histogram (`newLotTrace`), exactly as
 *     `probe-lots.ts` reports it, for hub/fan pop=300/900 seed=1.
 *
 * Diagnosis only -- no engine code is touched, this only calls existing
 * exports. Read-only report, always exits 0.
 *   nix develop --command bash -c "npx tsx scripts/probe-lots-afmg.ts"
 */
import { SeededRandom } from '../src/utils/random.js';
import { generateVillage } from '../src/village/village-model.js';
import { buildSite } from '../src/village/site.js';
import { siteGreen, predictedBuiltRadius } from '../src/village/skeleton/green-siting.js';
import {
  buildArms, discRadiusFor, polylineLength, laneBudgetFor,
} from '../src/village/skeleton/lanes.js';
import {
  buildDeck, eligible, meanOccupancy, minDwellingFrontageM, ordinaryOccupancy, widestDwellingWidthM,
} from '../src/village/deck.js';
import { gapForPopulation } from '../src/village/parcels/lots.js';
import { newLotTrace, type LotFate } from '../src/village/lot-trace.js';
import {
  MEAN_LOT_AREA_M2, LANE_EXTENT_FACTOR, MIN_ARM_SEPARATION_DEG, BRANCH_SPACING_M, LOT_DEPTH_M,
} from '../src/village/constants.js';
import { SCENARIOS } from './probe-afmg.js';
import type { AzgaarBurgInput } from '../src/input/azgaar-input.js';

const SEED = 1;
const ORDER: LotFate[] = [
  'seated', 'lane-intrusion', 'building-overlap', 'no-deck-entry',
  'census-satisfied', 'converging-claim', 'clipped',
];

function pick(name: string): typeof SCENARIOS[number] {
  const sc = SCENARIOS.find((s) => s.name === name);
  if (!sc) throw new Error(`no scenario ${name}`);
  return sc;
}

// ------------------------------------------------- 1. arm count vs budget
function armBudgetReport(name: string, input: AzgaarBurgInput): void {
  const rng = new SeededRandom(SEED);
  const site = buildSite(input);
  const { entries: deck } = buildDeck(site.biome, site.population, rng);
  const occupancy = meanOccupancy(deck);
  const preFabricRadius = predictedBuiltRadius(site.population, occupancy, MEAN_LOT_AREA_M2);
  const green = siteGreen(site, preFabricRadius, rng);
  const laneExtentM = preFabricRadius * LANE_EXTENT_FACTOR;
  const arms = buildArms(site, green, laneExtentM, rng);
  const armLenTotal = arms.reduce((s, a) => s + polylineLength(a.points), 0);

  // Reported so the ratio's order of magnitude is visible, but named as
  // pre-fabric per the method rules -- nothing downstream of growth may KEY
  // off it, and this ratio isn't the one growth actually checks against.
  const budgetAtPreFabric = laneBudgetFor(preFabricRadius);

  // The REAL number: village-model.ts's own cappedRadiusM/budgetM
  // arithmetic, restated here (same formulas `generateVillage` uses at
  // round 0, before any escalation ring). This IS what `saturateDisc`'s
  // while-loop condition (`laneLengthWithin(...) < budgetM`) checks arm
  // length against on the first round.
  const nominalF0 = widestDwellingWidthM(deck) + gapForPopulation(site.population);
  const nominalLotFloorM = minDwellingFrontageM(deck);
  const meanLotFrontageM = Math.max(nominalF0, nominalLotFloorM);
  const landmarkLots = deck.filter((e) => e.cap && eligible(e, site, Infinity)).length;
  const dwellingsNeeded = Math.ceil(site.population / ordinaryOccupancy(deck)) + landmarkLots;
  const cappedRadiusM = Math.max(
    discRadiusFor(dwellingsNeeded, meanLotFrontageM),
    green.diameter / 2 + BRANCH_SPACING_M + LOT_DEPTH_M,
  );
  const realBudget = laneBudgetFor(cappedRadiusM);

  process.stdout.write(
    `${name.padEnd(12)} pop=${site.population.toString().padEnd(4)} arms=${arms.length} `
    + `armLenTotal=${armLenTotal.toFixed(0)}m laneExtentM=${laneExtentM.toFixed(0)} `
    + `preFabricR=${preFabricRadius.toFixed(0)}m budgetAtPreFabricR=${budgetAtPreFabric.toFixed(0)}m `
    + `armLen/preFabricBudget=${(armLenTotal / budgetAtPreFabric * 100).toFixed(0)}% `
    + `|| cappedRadiusM(round0)=${cappedRadiusM.toFixed(0)}m realBudgetM=${realBudget.toFixed(0)}m `
    + `armLen/realBudget=${(armLenTotal / realBudget * 100).toFixed(0)}%\n`,
  );
}

process.stdout.write('=== 1. arm length vs lane budget (pre-fabric radius, pop 300) ===\n');
for (const name of ['baseline', 'crossroads', 'hub', 'fan']) {
  armBudgetReport(name, pick(name).input(300));
}
process.stdout.write('\n=== 1b. arm length vs lane budget (pre-fabric radius, pop 900) ===\n');
for (const name of ['baseline', 'crossroads', 'hub', 'fan']) {
  armBudgetReport(name, pick(name).input(900));
}

// ------------------------------------------------- 2. bearing separation
function bearingReport(name: string, input: AzgaarBurgInput): void {
  const bearings = (input.roadBearings ?? []).map((r) => (typeof r === 'number' ? r : r.bearing_deg));
  const sorted = [...bearings].sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const next = sorted[(i + 1) % sorted.length];
    const gap = i === sorted.length - 1 ? (next + 360 - sorted[i]) : (next - sorted[i]);
    gaps.push(gap);
  }
  const nearDup = gaps.filter((g) => g < MIN_ARM_SEPARATION_DEG).length;
  process.stdout.write(
    `${name.padEnd(12)} n=${bearings.length} bearings=[${sorted.map((b) => b.toFixed(1)).join(', ')}] `
    + `gaps=[${gaps.map((g) => g.toFixed(1)).join(', ')}] `
    + `pairs<${MIN_ARM_SEPARATION_DEG}deg=${nearDup}\n`,
  );
}

process.stdout.write(`\n=== 2. bearing separation (MIN_ARM_SEPARATION_DEG=${MIN_ARM_SEPARATION_DEG}) ===\n`);
for (const name of ['baseline', 'crossroads', 'hub', 'fan']) {
  bearingReport(name, pick(name).input(300));
}

// ------------------------------------------------- 3. lot-fate histogram
function lotFateReport(name: string, pop: number): void {
  const trace = newLotTrace();
  const input = pick(name).input(pop);
  const m = generateVillage(input, SEED, trace);

  const counts = new Map<LotFate, number>();
  for (const id of trace.cut.keys()) {
    const f = trace.fates.get(id);
    if (!f) continue;
    counts.set(f, (counts.get(f) ?? 0) + 1);
  }
  const total = trace.cut.size;
  const cells = ORDER.map((f) => {
    const n = counts.get(f) ?? 0;
    return `${f} ${n} (${total === 0 ? 0 : Math.round((n / total) * 100)}%)`;
  });
  const housed = m.buildings.reduce((s, b) => s + b.occupancy, 0);
  process.stdout.write(
    `${name.padEnd(12)} pop=${pop} seed=${SEED}: housed ${housed}/${pop} bldg=${m.buildings.length} `
    + `lanes=${m.lanes.length} cut ${total}\n    | ${cells.join(' | ')}\n`,
  );
  const sub = new Map<string, number>();
  for (const [id, why] of trace.convergeDetail) {
    if (trace.fates.get(id) !== 'converging-claim') continue;
    sub.set(why, (sub.get(why) ?? 0) + 1);
  }
  process.stdout.write(`    converging-claim breakdown: ${
    [...sub.entries()].sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${k} ${n} (${Math.round((n / total) * 100)}% of cut)`).join(' | ')
  }\n`);
  process.stdout.write(`    diagnostics: ${m.diagnostics.join(' | ') || '-'}\n`);
}

process.stdout.write('\n=== 3. lot-fate histogram, final round ===\n');
for (const name of ['baseline', 'crossroads', 'hub', 'fan']) {
  for (const pop of [300, 900]) lotFateReport(name, pop);
}

process.exit(0);
