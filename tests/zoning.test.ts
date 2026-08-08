// tests/zoning.test.ts
import { describe, it, expect } from 'vitest';
import { generateFromBurg, mapToGenerationParams, WardType, type AzgaarBurgInput } from '../src/index.js';
import { MAX_PATCHES } from '../src/input/azgaar-input.js';

function metropolis(roadBearings: number[]): AzgaarBurgInput {
  return {
    name: 'Sprawlington', population: 250000,
    port: false, citadel: true, walls: true,
    plaza: true, temple: true, shanty: true, capital: false,
    roadBearings,
  };
}

describe('zoning', () => {
  it('grows suburbs outside the walls for a metropolis', () => {
    const { model } = generateFromBurg(metropolis([0, 120, 240]), { seed: 5 });
    const suburbs = model.patches.filter(p => p.zone === 'suburb');
    expect(suburbs.length).toBeGreaterThan(20);
  }, 20000);

  it('keeps the walled core small regardless of population', () => {
    const { model } = generateFromBurg(metropolis([0, 120, 240]), { seed: 5 });
    // Round 4 Task 6 fix round: coreCapacity is a ceiling, not a target —
    // extramuralShare(population) keeps rising right up to its 25% ceiling
    // at population 10000, so 10000 itself is where the cap *starts* to
    // bind, not where it's already fully binding (corePopulation keeps
    // growing with population — at its 25%-share ceiling — until
    // population*0.75 first reaches coreCapacity, around population
    // 13333). Use 20000, comfortably past that, so both runs are fully
    // cap-bound and their core sizes are actually comparable.
    const small = generateFromBurg({ ...metropolis([0, 120, 240]), population: 20000 }, { seed: 5 });
    // A 250k city's core is no bigger than a fully cap-bound 20k city's core.
    expect(model.inner.length).toBeLessThanOrEqual(small.model.inner.length + 2);
  }, 20000);

  it('never exceeds the total built patch budget', () => {
    const { model } = generateFromBurg(metropolis([0, 120, 240]), { seed: 5 });
    const built = model.patches.filter(p => p.zone === 'core' || p.zone === 'suburb' || p.zone === 'satellite');
    expect(built.length).toBeLessThanOrEqual(MAX_PATCHES);
  }, 20000);

  it('puts every suburb within reach of a road', () => {
    const { model } = generateFromBurg(metropolis([90]), { seed: 5 });
    // One road due east: no suburb may sit to the west of the core.
    const suburbs = model.patches.filter(p => p.zone === 'suburb');
    expect(suburbs.length).toBeGreaterThan(0);
    expect(suburbs.every(p => p.shape.center.x > -model.border!.getRadius())).toBe(true);
  }, 20000);

  it('falls back to a belt when the burg has no roads', () => {
    const { model } = generateFromBurg({ ...metropolis([]), roadBearings: [] }, { seed: 5 });
    const built = model.patches.filter(p => p.zone === 'suburb');
    expect(built.length).toBeGreaterThan(20);
  }, 20000);

  it('emits satellites only above the population threshold', () => {
    const big = generateFromBurg(metropolis([0, 180]), { seed: 5 });
    const small = generateFromBurg({ ...metropolis([0, 180]), population: 12000 }, { seed: 5 });
    expect(big.model.patches.some(p => p.zone === 'satellite')).toBe(true);
    expect(small.model.patches.some(p => p.zone === 'satellite')).toBe(false);
  }, 20000);

  it('never labels a patch satellite below the population threshold (known reproducers)', () => {
    // `along` (the field's road-projection distance) can exceed
    // coreRadius*SATELLITE_DISTANCE for an off-axis ribbon patch even when
    // `satellites` is false — pop 49000 (just under SATELLITE_POP_THRESHOLD
    // 50000) at seeds 1/5/7 reproduced a mislabeled 'satellite' patch before
    // the fix (3/60 sampled runs). Assert directly against those known
    // reproducers instead of relying on one seed happening to be clean.
    for (const seed of [1, 5, 7]) {
      const burg = { ...metropolis([0, 90, 180, 270]), population: 49000 };
      const { model } = generateFromBurg(burg, { seed });
      expect(model.patches.some(p => p.zone === 'satellite')).toBe(false);
    }
  }, 20000);

  it('builds nothing on water (seed sweep)', () => {
    // seed 5 alone is clean by luck (same seed-luck problem the satellite
    // test above was fixed for) — the outskirts "Outskirts" gate-ward loop
    // in createWards bypasses assignSprawl's isBuildable check entirely, and
    // seeds 1/6/9/10 reproduced fully-submerged 'suburb'-zoned outskirts
    // patches before that loop got its own water guard.
    //
    // Round 4 Task 6 fix round 3: the defect is "the outskirts loop lacks a
    // predicate at all" — it reproduces at ANY walled port with gates, not
    // specifically at the metropolis scale. Three seeds at a much smaller
    // (much faster) population plus the two known worst reproducers from
    // the original pop-250000 measurement (seeds 1 and 9) keeps the
    // regression value at a fraction of sweeping all 10 seeds at pop 250000.
    const check = (built: ReturnType<typeof generateFromBurg>['model']['patches'], model: ReturnType<typeof generateFromBurg>['model']) => {
      const suburbsOrSatellites = built.filter(p => p.zone === 'suburb' || p.zone === 'satellite');
      // Not just the centroid (isBuildable, which assignSprawl already
      // filters on, checks that) — no VERTEX of a built patch may sit in
      // water either, which would also catch a dry-centroid patch whose body
      // is actually submerged.
      expect(suburbsOrSatellites.every(p => p.shape.vertices.every(v => !model.isWaterAt(v)))).toBe(true);
    };

    const midPort: AzgaarBurgInput = {
      name: 'Havenmid', population: 20000, port: true, citadel: false, walls: true,
      plaza: true, temple: true, shanty: false, capital: false,
      roadBearings: [0, 120], oceanBearing: 90, harbourSize: 'large',
    };
    for (const seed of [2, 3, 4]) {
      const { model } = generateFromBurg(midPort, { seed });
      check(model.patches, model);
    }

    const bigPort: AzgaarBurgInput = {
      ...metropolis([0, 120]), port: true, oceanBearing: 90, harbourSize: 'large',
    };
    for (const seed of [1, 9]) {
      const { model } = generateFromBurg(bigPort, { seed });
      check(model.patches, model);
    }
  }, 30000);

  it('exposes the urbanisation field it built', () => {
    const { model } = generateFromBurg(metropolis([0, 120, 240]), { seed: 5 });
    expect(model.urbanisationField).not.toBeNull();
  }, 20000);

  it('nPatches never exceeds MAX_PATCHES across the coreCapacity grid (structural, no generation)', () => {
    // The MAX_PATCHES property is structural (populationToPatches clamps
    // it directly), so prove it with pure arithmetic across a grid far
    // wider than a handful of sampled generations could cover — this runs
    // in milliseconds.
    const roadBearings = Array.from({ length: 12 }, (_, i) => i * 30);
    for (const coreCapacity of [100000, 150000, 180000, 200000, 250000]) {
      const params = mapToGenerationParams({ ...metropolis(roadBearings), coreCapacity }, 1);
      expect(params.nPatches).toBeLessThanOrEqual(MAX_PATCHES);
      expect(params.nCore).toBeLessThanOrEqual(params.nPatches);
    }
  });

  it('built total honours MAX_PATCHES end to end at the worst-case coreCapacity', () => {
    // The structural test above proves nPatches/nCore never exceed the
    // budget; this is the ONE full generation (not a sampled sweep) that
    // proves the "Outskirts" gate-ward loop — which is independent of
    // assignSprawl's own budget and was the actual source of the
    // MAX_PATCHES violation (244 built against a cap of 220) — honours the
    // hard cap end to end at the worst measured case.
    const roadBearings = Array.from({ length: 12 }, (_, i) => i * 30);
    const burg = { ...metropolis(roadBearings), coreCapacity: 250000 };
    const { model } = generateFromBurg(burg, { seed: 1 });
    const built = model.patches.filter(p => p.zone === 'core' || p.zone === 'suburb' || p.zone === 'satellite');
    expect(built.length).toBeLessThanOrEqual(MAX_PATCHES);
  }, 20000);

  it('sub-cap sprawl budget is never zero (structural: every population 100-14000 has nPatches - nCore >= 1)', () => {
    // Root cause fixed in azgaar-input.ts's corePatchCount: nCore and
    // nPatches used to be two independently-rounded populationToPatches
    // calls, so their difference (the sprawl budget) could land on exactly
    // zero even with a non-zero extramuralShare. Measured before the fix:
    // 11 of 140 populations swept 100-14000 in steps of 100 hit
    // nCore >= nPatches (100, 200, 1100-1600, 2000-2200). Pure arithmetic —
    // no generation needed, this covers every population in the band.
    for (let population = 100; population <= 14000; population += 100) {
      const params = mapToGenerationParams({
        name: 'Faubourg', population, port: false, citadel: false, walls: true,
        plaza: true, temple: false, shanty: false, capital: false,
        roadBearings: [0, 120, 240],
      }, 1);
      expect(params.nPatches - params.nCore).toBeGreaterThanOrEqual(1);
    }
  });

  it('genuine corridor sprawl (not just gate-ward outskirts) exists at pop 1200 and 4000', () => {
    // pop 1200 was the worst measured case: nCore === nPatches (budget 0)
    // at all 5 sampled seeds before the corePatchCount fix, so every
    // "suburb" patch there was 100% relabelled GateWard outskirts, never
    // exercising assignSprawl's corridor-scored ribbon growth at all.
    for (const population of [1200, 4000]) {
      let sawNonGateSuburb = false;
      for (const seed of [1, 2, 3, 4, 5]) {
        const burgInput: AzgaarBurgInput = {
          name: 'Faubourg', population, port: false, citadel: false, walls: true,
          plaza: true, temple: false, shanty: false, capital: false,
          roadBearings: [0, 120, 240],
        };
        const { model } = generateFromBurg(burgInput, { seed });
        const suburbs = model.patches.filter(p => p.zone === 'suburb' || p.zone === 'satellite');
        if (suburbs.some(p => p.ward?.type !== WardType.GateWard)) sawNonGateSuburb = true;
      }
      expect(sawNonGateSuburb).toBe(true);
    }
  }, 20000);
});
