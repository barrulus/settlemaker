import { describe, it, expect } from 'vitest';
import { mapToGenerationParams, corePatchCount, DEFAULT_CORE_CAPACITY, MAX_PATCHES } from '../src/input/azgaar-input.js';
import { parseSettlementUrl } from '../src/url/params.js';
import type { AzgaarBurgInput } from '../src/index.js';

function burg(population: number, coreCapacity?: number): AzgaarBurgInput {
  return {
    name: 'Capsford', population,
    port: false, citadel: false, walls: true,
    plaza: true, temple: false, shanty: false, capital: false,
    ...(coreCapacity !== undefined ? { coreCapacity } : {}),
  };
}

describe('coreCapacity', () => {
  it('defaults to 10000', () => {
    expect(DEFAULT_CORE_CAPACITY).toBe(10000);
  });

  it('caps core size once population exceeds the capacity', () => {
    const atCap = corePatchCount(10000, DEFAULT_CORE_CAPACITY);
    const wayOver = corePatchCount(250000, DEFAULT_CORE_CAPACITY);
    expect(wayOver).toBe(atCap);
  });

  it('leaves small settlements uncapped', () => {
    expect(corePatchCount(800, DEFAULT_CORE_CAPACITY))
      .toBeLessThan(corePatchCount(9000, DEFAULT_CORE_CAPACITY));
  });

  it('honours an explicit capacity', () => {
    expect(corePatchCount(250000, 40000)).toBeGreaterThan(corePatchCount(250000, 10000));
  });

  it('keeps nCore within the total budget across population sweep', () => {
    // Sweep populations where populationToPatches is non-monotonic
    // (households = round(p / density) and perPatchDensity(p) step at different granularities).
    // Test with default density curve and explicit urbanDensity values.
    for (let pop = 500; pop <= 20000; pop += 50) {
      // Test with default density curve
      const defaultDensity = mapToGenerationParams(burg(pop));
      expect(defaultDensity.nCore).toBeLessThanOrEqual(defaultDensity.nPatches);
      expect(defaultDensity.nPatches).toBeLessThanOrEqual(MAX_PATCHES);

      // Test with coreCapacity slightly below population (hits the non-monotonic dips)
      const testBurg1 = burg(pop);
      testBurg1.coreCapacity = Math.max(1, pop - 5);
      const withCapacity = mapToGenerationParams(testBurg1);
      expect(withCapacity.nCore).toBeLessThanOrEqual(withCapacity.nPatches);
      expect(withCapacity.nPatches).toBeLessThanOrEqual(MAX_PATCHES);

      // Test with explicit urbanDensity=10 (known to trigger counterexamples)
      const testBurg2 = burg(pop);
      testBurg2.urbanDensity = 10;
      testBurg2.coreCapacity = Math.max(1, pop - 5);
      const withDensity = mapToGenerationParams(testBurg2);
      expect(withDensity.nCore).toBeLessThanOrEqual(withDensity.nPatches);
      expect(withDensity.nPatches).toBeLessThanOrEqual(MAX_PATCHES);
    }

    // Also test the large-city case from the original weak test
    const largeCity = mapToGenerationParams(burg(250000));
    expect(largeCity.nCore).toBeLessThanOrEqual(largeCity.nPatches);
    expect(largeCity.nPatches).toBeLessThanOrEqual(MAX_PATCHES);
  });

  it('is accepted as a flat URL param', async () => {
    const parsed = await parseSettlementUrl(new URLSearchParams('pop=250000&coreCapacity=40000'));
    expect(parsed.burg.coreCapacity).toBe(40000);
  });

  it('ignores a non-positive flat coreCapacity', async () => {
    const parsed = await parseSettlementUrl(new URLSearchParams('pop=1000&coreCapacity=0'));
    expect(parsed.burg.coreCapacity).toBeUndefined();
  });
});
