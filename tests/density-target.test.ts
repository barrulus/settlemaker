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

  it('tiny burgs keep the patch floor (no degenerate meshes)', () => {
    const { model } = generateFromBurg(inland(13));
    expect(model.patches.length).toBeGreaterThanOrEqual(3);
  });
});
