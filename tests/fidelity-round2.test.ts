import { describe, it, expect } from 'vitest';
import { generateFromBurg, WardType, type AzgaarBurgInput, type Model } from '../src/index.js';
import { buildingBudget } from '../src/generator/model.js';
import { CommonWard } from '../src/wards/common-ward.js';

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

  it('budget cap still binds exactly', () => {
    const { count } = ordinaryStats(model);
    expect(count).toBeLessThanOrEqual(buildingBudget(4200));
    expect(count).toBeGreaterThan(buildingBudget(4200) * 0.9); // trim, not collapse
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
    // Proportional quotas: a patch loses everything only if it had almost
    // nothing to begin with. Allow a small remainder-rounding tail.
    expect(stripped).toBeLessThanOrEqual(Math.ceil(withWard * 0.1));
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
    const piers = (model.harbour!.ward as { piers: unknown[] }).piers;
    expect(piers.length).toBeGreaterThanOrEqual(1);
  });
});
