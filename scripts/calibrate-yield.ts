/**
 * Calibration harness for the fidelity round-4 texture-yield fix (fix round 2,
 * 2026-08-06).
 *
 * `CommonWard.createGeometry()`'s `createAlleys` yield is nonlinear in
 * `minSq`: halving `minSq` more than doubles the building count (round-3
 * observation, reconfirmed below). The naive `baseMinSqScale = 9 /
 * perPatchDensity(pop)` formula assumed a roughly-linear relationship, so at
 * city scale (baseMinSqScale = 9/30 = 0.3) the natural pre-trim yield lands
 * FAR above the per-patch target, and `applyBuildingBudget`'s keep-nearest-
 * patch-centre trim policy then aggressively strips each patch down to a
 * small cluster at its centre with a bare rim — visually wrong (not
 * contiguous urban fabric).
 *
 * This script sweeps `textureScaleOverride` (the internal calibration hook
 * added to `GenerationParams`/`Model` for exactly this purpose) across a
 * fixed population/seed and records the pre-trim yield curve, so
 * `baseScaleForYield` in `generation-params.ts` can be fitted from it. Note
 * pop 20000 and pop 70000 both target perPatchDensity=30 (it saturates at
 * pop >= 20000) but have very different average patch AREA (bigger cities'
 * patches aren't just more numerous, they're individually bigger too), so
 * their yield-vs-scale curves diverge substantially at the same scale --
 * `baseScaleForYield`'s single scale-30 anchor is fitted as the best
 * compromise across BOTH curves (documented in its own doc comment and in
 * task-2-report.md's "Fix round 2" section), not a perfect match to either.
 *
 * Run: nix develop --command bash -c "npx tsx scripts/calibrate-yield.ts"
 */
import { mapToGenerationParams, Model, type AzgaarBurgInput } from '../src/index.js';
import { perPatchDensity } from '../src/generator/generation-params.js';
import { CommonWard } from '../src/wards/common-ward.js';

const aldford = (population: number): AzgaarBurgInput => ({
  name: 'Aldford', population, port: false, citadel: false, walls: true,
  plaza: true, temple: true, shanty: false, capital: false,
});

const SEED = 9;
const SCALES = [0.2, 0.3, 0.5, 0.7, 1.0, 1.5, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0, 12.0];

const BUDGET_EXEMPT = new Set(['castle', 'cathedral', 'market', 'harbour', 'park']);

/** Mirrors Model's private countOrdinaryBuildings()/isBudgeted() exclusion
 * rules exactly, so "postTrim total" is measured on the same population
 * applyBuildingBudget actually trims (all budgeted wards, not just walled
 * CommonWard patches) — matching what drives its <=budget early-return. */
function totalOrdinary(model: {
  patches: Array<{ ward: { type: string; geometry: unknown[] } | null }>;
}): number {
  let n = 0;
  for (const patch of model.patches) {
    if (!patch.ward || BUDGET_EXEMPT.has(String(patch.ward.type))) continue;
    n += patch.ward.geometry.length;
  }
  return n;
}

function walledCommonWardPatchCount(model: {
  patches: Array<{ ward: unknown; withinWalls: boolean }>;
}): number {
  let n = 0;
  for (const patch of model.patches) {
    if (patch.ward instanceof CommonWard && patch.withinWalls) n++;
  }
  return n;
}

function walledCommonWardOrdinary(model: {
  patches: Array<{ ward: { type: string; geometry: unknown[] } | null; withinWalls: boolean }>;
}): number {
  let n = 0;
  for (const patch of model.patches) {
    if (patch.ward instanceof CommonWard && patch.withinWalls) n += patch.ward.geometry.length;
  }
  return n;
}

interface Row {
  scale: number;
  totalPreTrim: number;
  totalPostTrim: number;
  trimmedFrac: number;
  patches: number;
  wcwPostTrim: number;
  preTrimPerPatch: number;
  postTrimPerPatch: number;
}

function runFor(pop: number): Row[] {
  const rows: Row[] = [];
  const burg = aldford(pop);
  const baseParams = mapToGenerationParams(burg, SEED);
  const target = perPatchDensity(pop);

  for (const scale of SCALES) {
    // generateFromBurg doesn't accept params overrides directly; go through
    // mapToGenerationParams then splice the internal hook onto the result,
    // mirroring what generateFromBurg does internally for other optional
    // fields (coastlineGeometry, harbourSize, ...).
    const params = { ...baseParams, textureScaleOverride: scale };
    // generateFromBurg only accepts AzgaarBurgInput + overrides (seed); it
    // doesn't thread arbitrary GenerationParams fields through. Call Model
    // directly instead, mirroring generateFromBurg's inland (no-shift) path
    // since Aldford has no oceanBearing/coastlineGeometry.
    const model = new Model(params);
    model.generate();

    const patches = walledCommonWardPatchCount(model);
    // totalPreTrim/totalPostTrim mirror EXACTLY what applyBuildingBudget's
    // own total<=budget decision operates on (all budgeted wards, not just
    // walled CommonWard) -- this is the correct pair for "trimmed %".
    const totalPreTrim = model.pretrimOrdinaryCount;
    const totalPostTrim = totalOrdinary(model);
    // Per-patch pre-trim yield isn't separately tracked (Model only exposes
    // the population-wide total), so "totalPreTrim/patches" below is a
    // proxy: total pre-trim ordinary buildings (all budgeted wards) divided
    // by the walled-CommonWard patch count. It slightly overstates each
    // walled patch's own yield (a handful of ordinary buildings live in
    // unwalled/military wards too), but tracks the same curve closely
    // enough to fit `baseScaleForYield` from -- it's within the tables'
    // own [0.9,1.15] fitting tolerance, not a load-bearing exact figure.
    const wcwPostTrim = walledCommonWardOrdinary(model);
    rows.push({
      scale,
      totalPreTrim,
      totalPostTrim,
      trimmedFrac: totalPreTrim > 0 ? (totalPreTrim - totalPostTrim) / totalPreTrim : 0,
      patches,
      wcwPostTrim,
      preTrimPerPatch: patches > 0 ? totalPreTrim / patches : NaN,
      postTrimPerPatch: patches > 0 ? wcwPostTrim / patches : NaN,
    });
  }

  console.log(`\n=== pop=${pop}, target perPatchDensity=${target.toFixed(2)} ===`);
  const header = [
    'scale', 'totalPreTrim', 'totalPostTrim', 'trimmed%', 'wcwPatches',
    'totalPreTrim/wcwPatch', 'wcwPostTrim/wcwPatch',
  ];
  console.log(header.join(' | '));
  for (const r of rows) {
    console.log([
      r.scale.toFixed(2),
      String(r.totalPreTrim),
      String(r.totalPostTrim),
      (r.trimmedFrac * 100).toFixed(1) + '%',
      String(r.patches),
      r.preTrimPerPatch.toFixed(2),
      r.postTrimPerPatch.toFixed(2),
    ].join(' | '));
  }
  return rows;
}

runFor(300);
runFor(1000);
runFor(20000);
runFor(70000);
