import { describe, it, expect } from 'vitest';
import { generateFromBurg, WardType, type AzgaarBurgInput, type Model } from '../src/index.js';
import { buildingBudget } from '../src/generator/model.js';

const EXEMPT = new Set<WardType>([
  WardType.Castle, WardType.Cathedral, WardType.Market, WardType.Harbour, WardType.Park,
]);

function countOrdinaryBuildings(model: Model): number {
  let n = 0;
  for (const patch of model.patches) {
    if (!patch.ward || EXEMPT.has(patch.ward.type)) continue;
    n += patch.ward.geometry.length;
  }
  return n;
}

function inland(population: number): AzgaarBurgInput {
  return {
    name: `Densitown${population}`,
    population,
    port: false, citadel: false, walls: population >= 2000,
    plaza: true, temple: false, shanty: false, capital: false,
  };
}

// Village rows (Task 4, stampVillageRows): populations below
// ROW_HOUSING_MIN_POPULATION (600) no longer subdivide CommonWard lots —
// dwellings are stamped along road frontage instead, and the design
// explicitly accepts falling short of the census target when road
// frontage adjacent to residential/farm wards runs out before the
// allowance does ("frontage-capped below" — see
// docs/superpowers/specs/2026-08-14-village-rows-design.md and
// task-4-brief.md's own integration test, which asserts only an upper
// bound for stamped counts).
//
// Post fix-review (deterministic fallback chain on resized-rect rejection
// + a HUT-pitch packing pass over arteries+streets, both landed after the
// initial Task 4 review): re-measured honestly rather than re-guessed.
// This test's own scenario (name-derived seed "Densitown350") now yields
// 25/88 = 28.4% (was 24/88 = 27.3% before the fix); a wider explicit-seed
// sample (seeds 1-5, same population/overrides) moved from 33-42% to
// 34-45%. The fixes close real gaps (undersized huts inside the BASE
// 6-unit pitch; resized longhouse/large-tiled rects that failed the
// neighbour-claim re-check) but pop 350's shortfall is structural, not a
// packing artifact: only 19 of 220 patches carry a ROW_WARDS type in this
// settlement, so most road length runs past undeveloped countryside no
// stamping pass can put a house on. It stays well under the ~70% mark the
// fix review asked to flag plainly if unmet — stated here rather than
// hidden behind a raised floor. The floor below is left at the pre-fix
// value (25/88 clears it with the same ~3-point margin the old
// measurement had).
const FLOOR_OVERRIDE: Partial<Record<number, number>> = { 350: 0.25 };

describe('density targeting: buildings ≈ households', () => {
  it.each([60, 350, 1200, 4500])('pop %i lands within [60%, 100%] of target', (pop) => {
    const { model } = generateFromBurg(inland(pop));
    const target = buildingBudget(pop);
    const n = countOrdinaryBuildings(model);
    const floor = FLOOR_OVERRIDE[pop] ?? 0.6;
    expect(n).toBeGreaterThanOrEqual(Math.floor(target * floor));
    expect(n).toBeLessThanOrEqual(target); // Plan A cap still binds from above
  });

  it('urbanDensity moves the target', () => {
    const dense = generateFromBurg({ ...inland(1200), urbanDensity: 3 });
    const sparse = generateFromBurg({ ...inland(1200), urbanDensity: 8 });
    expect(countOrdinaryBuildings(dense.model)).toBeGreaterThan(countOrdinaryBuildings(sparse.model));
  });

  // Regression: `Ward.filterOutskirts` thins RELATIVE to a patch's populated
  // vertices, and a settlement only a few patches across has none — the
  // filter used to delete every house in the settlement, which then rendered
  // as bare fields. Separately, `applyBuildingBudget` handed the core its
  // patch-count share of the budget even when the core was landmarks only,
  // stranding it. Seeds chosen because each was measured empty before those
  // two fixes: pop 60 default seed (both wards annihilated), pop 60 seed 20
  // (a weak gradient, not an absent one), pop 140 seeds 1 and 6 (four city
  // patches). A hamlet may be sparse; it may not be uninhabited.
  it.each([
    [60, undefined], [60, 20], [140, 1], [140, 6], [100, 3],
  ] as const)('pop %i seed %s houses somebody', (pop, seed) => {
    const { model } = generateFromBurg(inland(pop), seed === undefined ? undefined : { seed });
    // Built-up patches only — farmsteads sit outside the settlement and
    // would mask an empty village.
    let n = 0;
    for (const patch of model.patches) {
      if (!patch.withinCity || !patch.ward || EXEMPT.has(patch.ward.type)) continue;
      n += patch.ward.geometry.length;
    }
    expect(n).toBeGreaterThan(0);
  });

  it('tiny burgs keep the patch floor (no degenerate meshes)', () => {
    const { model } = generateFromBurg(inland(13));
    expect(model.patches.length).toBeGreaterThanOrEqual(3);
  });
});
