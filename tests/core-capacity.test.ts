import { describe, it, expect } from 'vitest';
import {
  mapToGenerationParams, corePatchCount, extramuralShare, DEFAULT_CORE_CAPACITY, MAX_PATCHES,
} from '../src/input/azgaar-input.js';
import { parseSettlementUrl } from '../src/url/params.js';
import { generateFromBurg, WardType, type AzgaarBurgInput } from '../src/index.js';

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

  it('caps core size once population is well past the capacity', () => {
    // Below the cap, extramuralShare keeps rising (20% at 10000) so the core
    // itself keeps growing right up to the cap boundary — 10000 is where the
    // cap first *starts* to bind, not where it's already fully binding.
    // Compare two populations comfortably past that (extramuralShare clamped
    // at its 20% ceiling for both, so the cap alone decides core size).
    const wellOver = corePatchCount(50000, DEFAULT_CORE_CAPACITY);
    const wayOver = corePatchCount(250000, DEFAULT_CORE_CAPACITY);
    expect(wayOver).toBe(wellOver);
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

  describe('extramuralShare — coreCapacity is a ceiling, not a target', () => {
    // Owner decision 2026-08-09 (round-cores-faubourgs task 5), replacing the
    // 20-45% curve above: most people stay INSIDE the walls at below-cap
    // sizes, and the walled interior packs tight (Saint-Malo-style) rather
    // than draining a large share out to a suburb ring. Target curve:
    // ~10% at 300, ~14% at 1200, ~17% at 4000, ~20% at 10000 (where the cap
    // takes over). Tolerance is generous (2 percentage points) — this pins
    // the shape of the curve, not the exact fitted constants.
    it.each([
      [300, 0.10],
      [1200, 0.14],
      [4000, 0.17],
      [10000, 0.20],
    ])('is ~%i%% at population %i', (population, target) => {
      expect(extramuralShare(population)).toBeCloseTo(target, 1);
    });

    it('extramural share: 10% at 300 rising to 20% at the cap', () => {
      expect(extramuralShare(300)).toBeCloseTo(0.10, 2);
      expect(extramuralShare(10000)).toBeCloseTo(0.20, 2);
      expect(extramuralShare(2000)).toBeGreaterThan(0.10);
      expect(extramuralShare(2000)).toBeLessThan(0.20);
      expect(extramuralShare(100)).toBeCloseTo(0.10, 2);  // clamped
      expect(extramuralShare(250000)).toBeCloseTo(0.20, 2); // clamped; cap governs above anyway
    });

    it('is continuous across the coreCapacity boundary (no jump at 10000)', () => {
      const justBelow = extramuralShare(9999);
      const atCap = extramuralShare(10000);
      const justAbove = extramuralShare(10001);
      expect(Math.abs(atCap - justBelow)).toBeLessThan(0.001);
      expect(Math.abs(justAbove - atCap)).toBeLessThan(0.001);
    });

    it('a below-cap settlement is not 100% intramural', () => {
      // The defect this rule fixes: min(population, coreCapacity) === population
      // below the cap, so nCore === nPatches and the sprawl budget
      // (nPatches - nCore) evaluated to exactly zero for every burg under
      // coreCapacity. 4000 is well under the default 10000 cap; nCore must
      // now be strictly smaller than nPatches, leaving budget for sprawl.
      const params = mapToGenerationParams(burg(4000));
      expect(params.nCore).toBeLessThan(params.nPatches);
    });

    it('a pop-4000 walled burg actually produces suburb patches from corridor sprawl, not just outskirts gate wards', () => {
      // The "Outskirts" gate-ward loop in createWards is a separate,
      // pre-existing mechanism (bounded by gate count, not population) that
      // also zones patches 'suburb' now — a reservation-based fix once made
      // assignSprawl's own budget evaluate to 0 at every population in this
      // range (nPatches - nCore <= 7 while a 3-gate reserve was >= 9), so
      // every "suburb" patch at these fixtures was 100% relabelled GateWard,
      // never exercising assignSprawl's corridor-scored ribbon growth at
      // all. Assert a genuine (non-GateWard) suburb patch exists, swept
      // across seeds since gate count/placement varies by seed.
      for (const seed of [1, 2, 3, 4, 5]) {
        const burgInput: AzgaarBurgInput = {
          name: 'Faubourg', population: 4000, port: false, citadel: false, walls: true,
          plaza: true, temple: false, shanty: false, capital: false,
          roadBearings: [0, 120, 240],
        };
        const { model } = generateFromBurg(burgInput, { seed });
        const suburbs = model.patches.filter(p => p.zone === 'suburb');
        expect(suburbs.length).toBeGreaterThan(0);
        expect(suburbs.some(p => p.ward?.type !== WardType.GateWard)).toBe(true);
      }
    });
  });
});
