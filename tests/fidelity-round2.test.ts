import { describe, it, expect } from 'vitest';
import { generateFromBurg, WardType, type AzgaarBurgInput, type Model } from '../src/index.js';
import { buildingBudget } from '../src/generator/model.js';
import { CommonWard } from '../src/wards/common-ward.js';
import { Harbour } from '../src/wards/harbour.js';

const EXEMPT = new Set<WardType>([
  WardType.Castle, WardType.Cathedral, WardType.Market, WardType.Harbour, WardType.Park,
]);

function ordinaryStats(model: Model): { count: number; maxR: number } {
  let count = 0;
  let maxR = 0;
  for (const patch of model.patches) {
    if (!patch.ward || EXEMPT.has(patch.ward.type)) continue;
    count += patch.ward.geometry.length;
    for (const poly of patch.ward.geometry) {
      maxR = Math.max(maxR, Math.hypot(poly.center.x, poly.center.y));
    }
  }
  return { count, maxR };
}

// Farm buildings legitimately sit far outside the wall by design, so they
// must not dilute the "does the periphery hollow out" measurement — that
// defect lives specifically in walled CommonWard blocks. Using ordinaryStats
// (which includes Farm) here would make the gap assertion pass vacuously
// even with the fix reverted, since farmhouses alone push maxR past wallR.
function walledCommonWardMaxR(model: Model): number {
  let maxR = 0;
  for (const patch of model.patches) {
    if (!(patch.ward instanceof CommonWard) || !patch.withinWalls) continue;
    for (const poly of patch.ward.geometry) {
      maxR = Math.max(maxR, Math.hypot(poly.center.x, poly.center.y));
    }
  }
  return maxR;
}

// The live-site defect reproduction: Salt Harbour, walled port, pop 4200.
const saltHarbour: AzgaarBurgInput = {
  name: 'Salt Harbour', population: 4200, port: true, citadel: false, walls: true,
  plaza: true, temple: false, shanty: false, capital: false,
  oceanBearing: 135, harbourSize: 'large',
};

describe('fidelity round 2: wall gap', () => {
  const { model } = generateFromBurg(saltHarbour, { seed: 7 });

  it('the built town reaches near the wall (no hollow periphery)', () => {
    const wallR = model.wall!.getRadius();
    // Measured over walled CommonWard buildings only — that is where the
    // defect lives. Including Farm (which sits outside the wall by design)
    // would make this assertion pass vacuously regardless of the trim policy.
    const maxR = walledCommonWardMaxR(model);
    // Baseline defect: gap was 46% of wall radius (wall 214, buildings 116).
    expect(wallR - maxR).toBeLessThan(wallR * 0.25);
  });

  it('budget cap is respected; natural yield stays a meaningful fraction of it', () => {
    // Round-4 fix round 2 changed WHY this holds. Before: baseMinSqScale
    // badly over-generated at city/town texture, so applyBuildingBudget's
    // trim pushed count right up against the cap (>90% of it) every time --
    // "binds exactly" described the trim doing the work. After: baseMinSqScale
    // is fitted so natural per-patch yield already lands near
    // perPatchDensity(pop)'s target, so the trim barely engages and `count`
    // reflects natural yield directly, not a budget-chasing trim. The cap
    // must still never be exceeded; the floor guards against an actual
    // collapse (createAlleys/budget logic breaking) rather than insisting on
    // a specific convergence percentage.
    //
    // Round-cores-faubourgs task 5 (2026-08-09) raised the perPatchDensity
    // anchor so city texture (target 30) is reached at pop 10000 instead of
    // 20000, which raised perPatchDensity(4200) from 19.06 to 23.52/patch
    // and, with it, baseScaleForYield's fitted scale (5.98 -> 7.38, bigger
    // blocks, fewer buildings). Measured at this fixture (Salt Harbour, pop
    // 4200, seed 7) after that change: count 234 vs a budget of 487 (~48%,
    // down from ~69%). Floor lowered to match; still comfortably above a
    // collapse.
    const { count } = ordinaryStats(model);
    expect(count).toBeLessThanOrEqual(buildingBudget(4200));
    expect(count).toBeGreaterThan(buildingBudget(4200) * 0.4);
  });

  it('no walled CommonWard patch is stripped bare by the trim', () => {
    let stripped = 0;
    let withWard = 0;
    for (const patch of model.patches) {
      if (!(patch.ward instanceof CommonWard) || !patch.withinWalls) continue;
      withWard++;
      if (patch.ward.geometry.length === 0) stripped++;
    }
    expect(withWard).toBeGreaterThan(0);
    // `stripped` counts ALL walled CommonWard patches with zero buildings,
    // which conflates two distinct sources: patches createAlleys already
    // yielded nothing for (too small/degenerate — applyBuildingBudget's
    // perPatch construction skips these, they never enter quota math) and
    // patches the trim itself stripped to zero. Proportional quotas mean the
    // trim should only ever zero out a patch that had almost nothing to
    // begin with, so its own contribution stays bounded by a small
    // remainder-rounding tail.
    // Instrumented at this fixture (seed 7, round-3 density curve, task 2):
    // of 49 walled CommonWard patches, 4 were empty before applyBuildingBudget
    // ran (pre-existing createAlleys empties) and 2 were zeroed by the trim.
    // Bound = fixture-measured pre-existing baseline (4) + the original 10%
    // trim allowance, so a trim that starts stripping 6+ patches still fails.
    expect(stripped).toBeLessThanOrEqual(4 + Math.ceil(withWard * 0.1));
  });
});

describe('fidelity round 2: harbour at the painted shoreline', () => {
  it('bearing-mode harbour patch straddles the painted shore', () => {
    // seed 1, not 7: seed 7's first tryGenerate() attempt does have a
    // straddling candidate, but that attempt throws downstream ("Unable to
    // build a street") and gets discarded; the retry that succeeds draws a
    // fresh mesh with no straddling candidate at all, so even the fixed
    // algorithm correctly falls back to the dry adjacency pick for that
    // seed. Seed 1 reproduces the defect pre-fix (harbour fully dry, 0 of 4
    // vertices wet) and is fixed post-fix (1 of 5 vertices wet) in the mesh
    // that actually succeeds, so it exercises the straddle-preferring path
    // end to end.
    const { model } = generateFromBurg(saltHarbour, { seed: 1 });
    expect(model.harbour).not.toBeNull();
    const verts = model.harbour!.shape.vertices;
    const wet = verts.filter(v => model.isWaterAt(v)).length;
    expect(wet).toBeGreaterThan(0);          // reaches into the painted water
    expect(wet).toBeLessThan(verts.length);  // and stands on painted land
  });

  it('vector-coast harbours still place and keep piers', () => {
    const coast = [[
      { x: 40, y: -1500 }, { x: 1500, y: -1500 }, { x: 1500, y: 1500 }, { x: 40, y: 1500 },
    ]];
    const { model } = generateFromBurg({
      name: 'Pierhaven', population: 900, port: true, citadel: false, walls: false,
      plaza: true, temple: false, shanty: false, capital: false,
      coastlineGeometry: coast, harbourSize: 'small',
    });
    expect(model.harbour).not.toBeNull();
    const piers = (model.harbour!.ward as Harbour).piers;
    expect(piers.length).toBeGreaterThanOrEqual(1);
  });

  // Pier drop-off is silent and seed-dependent (see task-2-report.md): a
  // straddling harbour patch can carry a shared edge that lies entirely on
  // the wet side, and if a pier anchors there with no dry land nearby,
  // rescueDetachedPier drops it without error. Pin survival across a seed
  // sweep so a regression here fails loudly instead of needing another
  // manual sweep to rediscover. Swept seeds 1-10 for saltHarbour by hand
  // (~1s total for all 10) before writing this test: every one produced a
  // harbour with >=1 pier, so no seed is expected-null here. If a future
  // change legitimately makes some seed fall back to no harbour, add that
  // seed number to NO_HARBOUR_EXPECTED with a comment explaining why.
  const NO_HARBOUR_EXPECTED = new Set<number>();

  it('harbour survives with >=1 pier across a seed sweep (1-10)', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const { model } = generateFromBurg(saltHarbour, { seed });
      if (model.harbour === null) {
        expect(NO_HARBOUR_EXPECTED.has(seed), `seed ${seed}: unexpected missing harbour`).toBe(true);
        continue;
      }
      const piers = (model.harbour.ward as Harbour).piers;
      expect(piers.length, `seed ${seed}: harbour has no piers`).toBeGreaterThanOrEqual(1);
    }
  });
});
