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
    const { maxR } = ordinaryStats(model);
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
