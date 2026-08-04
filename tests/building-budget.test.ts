import { describe, it, expect } from 'vitest';
import { generateFromBurg, WardType, type AzgaarBurgInput, type Model } from '../src/index.js';
import { buildingBudget } from '../src/generator/model.js';

const BUDGET_EXEMPT = new Set<WardType>([
  WardType.Castle, WardType.Cathedral, WardType.Market, WardType.Harbour, WardType.Park,
]);

function countOrdinaryBuildings(model: Model): number {
  let n = 0;
  for (const patch of model.patches) {
    if (!patch.ward || BUDGET_EXEMPT.has(patch.ward.type)) continue;
    n += patch.ward.geometry.length;
  }
  return n;
}

const hamlet: AzgaarBurgInput = {
  name: 'Tinyville',
  population: 13,
  port: false,
  citadel: false,
  walls: false,
  plaza: false,
  temple: false,
  shanty: false,
  capital: false,
};

describe('population → building budget', () => {
  it('buildingBudget maps population to households', () => {
    expect(buildingBudget(13)).toBe(3);      // 13 / 4 ≈ 3 households
    expect(buildingBudget(13, 6.5)).toBe(2); // FMG urbanDensityInput override
    expect(buildingBudget(1)).toBe(2);       // floor: a burg is ≥ 2 buildings
    expect(buildingBudget(8000)).toBe(2000);
  });

  it('a pop-13 hamlet renders a handful of buildings, not a filled town', () => {
    const { model } = generateFromBurg(hamlet);
    const n = countOrdinaryBuildings(model);
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(buildingBudget(13));
  });

  it('urbanDensity tightens the budget', () => {
    const { model } = generateFromBurg({ ...hamlet, urbanDensity: 6.5 });
    expect(countOrdinaryBuildings(model)).toBeLessThanOrEqual(2);
  });

  it('a large town stays dense (budget only binds when it should)', () => {
    const { model } = generateFromBurg({ ...hamlet, name: 'Bigton', population: 8000, plaza: true, walls: true });
    const n = countOrdinaryBuildings(model);
    expect(n).toBeGreaterThan(100);
    expect(n).toBeLessThanOrEqual(buildingBudget(8000));
  });
});
