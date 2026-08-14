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

// Village rows (Task 4, stampVillageRows; fix rounds 1-2): populations
// below ROW_HOUSING_MIN_POPULATION (600) no longer subdivide CommonWard
// lots — dwellings are stamped along road frontage instead. Pop 350
// briefly needed a lowered floor here: the original road-major walk only
// accepted slots on already-built ROW_WARDS patches, and most road length
// in a village runs past open countryside (in this scenario, 19 of ~220
// patches carried a ROW_WARDS type), so yield bottomed out around 27-45%
// of target. Fix round 2 made villages true street villages — acceptSlot
// now also accepts probes on open countryside (patches with `ward ===
// null` or the base Ward's default `WardType.Empty`, within
// maxBuiltRadius * 1.3 of the settlement centre; see RibbonContext in
// village-rows.ts) and attributes the resulting ribbon houses to the
// nearest built ward for census/POI/GeoJSON purposes. Re-measured after
// that fix: this test's own scenario (name-derived seed "Densitown350")
// now yields 88/88 = 100%; a wider explicit-seed sample (seeds 1-5, same
// population/overrides) yields 88, 78, 88, 81, 88 out of 88
// (88.6%-100%). The shared 60% floor below now holds with a large margin,
// so the pop-350 special case is gone.

describe('density targeting: buildings ≈ households', () => {
  it.each([60, 350, 1200, 4500])('pop %i lands within [60%, 100%] of target', (pop) => {
    const { model } = generateFromBurg(inland(pop));
    const target = buildingBudget(pop);
    const n = countOrdinaryBuildings(model);
    expect(n).toBeGreaterThanOrEqual(Math.floor(target * 0.6));
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
