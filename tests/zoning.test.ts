// tests/zoning.test.ts
import { describe, it, expect } from 'vitest';
import { generateFromBurg, type AzgaarBurgInput } from '../src/index.js';
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

  it('builds nothing on water', () => {
    const port: AzgaarBurgInput = {
      ...metropolis([0, 120]), port: true, oceanBearing: 90, harbourSize: 'large',
    };
    const { model } = generateFromBurg(port, { seed: 5 });
    const built = model.patches.filter(p => p.zone === 'suburb' || p.zone === 'satellite');
    // Not just the centroid (isBuildable, which assignSprawl already
    // filters on, checks that) — no VERTEX of a built patch may sit in
    // water either, which would also catch a dry-centroid patch whose body
    // is actually submerged.
    expect(built.every(p => p.shape.vertices.every(v => !model.isWaterAt(v)))).toBe(true);
  }, 20000);

  it('exposes the urbanisation field it built', () => {
    const { model } = generateFromBurg(metropolis([0, 120, 240]), { seed: 5 });
    expect(model.urbanisationField).not.toBeNull();
  }, 20000);
});
