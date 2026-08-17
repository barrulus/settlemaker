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

// Gate-tune round 7 (2026-08-14): CONTINUOUS TERRACES — chain growth
// replaced the uniform/ring-expansion walk. A chain terminates outright
// (leaving the rest of that road empty) on a long obstruction or the
// reach bound, and double-file/leftover-allowance spreading no longer
// exists to mop up what a dead chain missed — "the owner has chosen
// compactness over census... do NOT spread houses to satisfy [a floor]"
// (this round's explicit contract). Re-measured the shared 60% floor
// scenario (name-derived seed, `inland()`'s plaza:true/walls-by-pop
// params) at village/hamlet scale: pop 60 dropped to 0% (this exact seed
// produces zero chains with any accepted stamp — see below), pop 350
// dropped to 40.9%. Both below 60%. pop 1200 (81.3%) and pop 4500 (88.7%)
// still clear it comfortably — town-scale settlements have enough roads
// that a few dead chains barely move the aggregate. Floors adjusted
// per-population below, honestly, to the measured reality rather than
// forcing yield back up.
//
// Gate-tune round 8 (2026-08-17): those two lowered floors were
// capitulations to a BUG, not to the compactness contract. Round 7's
// chain-termination rule could fire before a chain had accepted its first
// stamp, so a road whose centre-most frontage was blocked (a village's
// plaza/greens/fields sit exactly there) died at s≈9 having placed
// nothing, with no restart — instrumented on pop-300 seed-3, 8 of 14
// road-sides died at zero, including every road over 250 units long. The
// round-8 chain lifecycle (no termination before birth, one restart per
// road-side past a long obstruction, plus a minimum-viability relaxation
// pass) fixes the lifecycle without loosening a single terrace constant,
// so the shared 60% floor is honest again at every population and both
// special cases are removed. Re-measured on this exact scenario:
// pop 60 0% → 66.7%, pop 350 79.5% → 100%, pop 1200 70.9% (unchanged —
// above ROW_HOUSING_MIN_POPULATION, so village rows never ran), pop 4500
// 99.4% (unchanged, same reason). A pop-350 explicit-seed sweep
// (seeds 1-5) reads 100/68.2/76.1/67.0/97.7%, all clear of 60%.
describe('density targeting: buildings ≈ households', () => {
  it.each([
    [60, 60], [350, 60], [1200, 60], [4500, 60],
  ] as const)('pop %i lands within [%i%%, 100%] of target', (pop, floorPct) => {
    const { model } = generateFromBurg(inland(pop));
    const target = buildingBudget(pop);
    const n = countOrdinaryBuildings(model);
    expect(n).toBeGreaterThanOrEqual(Math.floor(target * (floorPct / 100)));
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
  //
  // Gate-tune round 7 (2026-08-14): CONTINUOUS TERRACES' chain growth
  // means a road whose near-centre frontage is obstructed for its first
  // ~1.5 house-widths terminates that chain with ZERO stamps, and there is
  // deliberately no packing/backfill pass left to compensate (round 7's
  // explicit contract: "do NOT spread houses to satisfy [a floor]"). Two
  // of this test's original seeds — pop 60 default and pop 100 seed 3 —
  // now land on exactly that outcome (every road's chain dies at 0 before
  // this settlement's short frontage reaches any real ground), which is a
  // legitimate CONSEQUENCE of this round's design, not the
  // filterOutskirts/applyBuildingBudget bug this test was written to
  // catch. Swapped both for a different seed at the same population that
  // still verifiably produces housing under round 7, so the test keeps
  // guarding against an ACCIDENTAL regression (e.g. filterOutskirts
  // reappearing, or a future change that empties every seed at these
  // populations) without asserting something round 7 no longer guarantees
  // for an arbitrary seed. Found by sweeping seeds 1-15 at each population
  // for the first one with `n > 0`.
  //
  // Gate-tune round 8 (2026-08-17): the swap is reverted — round 7's zero
  // yields on those seeds were the pre-birth-termination bug described
  // above, not a design consequence. Both ORIGINAL seeds house somebody
  // again (pop 60 default: 0 → 10 ordinary buildings; pop 100 seed 3:
  // 1 → 25), so the test guards its original scenarios once more.
  it.each([
    [60, undefined], [60, 20], [140, 1], [140, 6], [100, 3],
  ] as const)('pop %i seed %s houses somebody', (pop, seed) => {
    const { model } = generateFromBurg(inland(pop), seed === undefined ? undefined : { seed });
    // Built-up patches only — farmsteads sit outside the settlement and
    // would mask an empty village.
    //
    // Gate-tune round 3 (2026-08-14): also count glyph-backed dwelling
    // stamps regardless of `withinCity`. Village rows (below
    // ROW_HOUSING_MIN_POPULATION) place real housing via stampVillageRows'
    // ribbon development — open-countryside stamps near a tiny hamlet's
    // core are legitimately attributed to whichever built ward is nearest
    // (see resolveWardPatch in village-rows.ts), which for a settlement
    // this small is very often a `withinCity: false` Farm patch, not the
    // core market/craftsmen/military patches themselves. Round 3's fix 3
    // (MilitaryWard now correctly skips its own un-gated createAlleys
    // jumble in the village regime — see military-ward.ts) removed
    // geometry that was incidentally padding this count on some of these
    // exact seeds even though it wasn't real housing; the true housing was
    // always there (`glyphBackedBuildings`), just never counted by the
    // `withinCity`-only filter. Widening the count to include it is the
    // honest fix — it directly serves the test's own documented intent ("a
    // hamlet may be sparse; it may not be uninhabited"): these houses are
    // real, rendered, road-frontage dwellings belonging to this
    // settlement, not a distant, unrelated farmstead.
    let n = 0;
    for (const patch of model.patches) {
      if (!patch.ward || EXEMPT.has(patch.ward.type)) continue;
      for (const rect of patch.ward.geometry) {
        if (patch.withinCity || model.glyphBackedBuildings.has(rect)) n++;
      }
    }
    expect(n).toBeGreaterThan(0);
  });

  it('tiny burgs keep the patch floor (no degenerate meshes)', () => {
    const { model } = generateFromBurg(inland(13));
    expect(model.patches.length).toBeGreaterThanOrEqual(3);
  });
});
