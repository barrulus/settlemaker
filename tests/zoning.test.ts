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
    const small = generateFromBurg({ ...metropolis([0, 120, 240]), population: 10000 }, { seed: 5 });
    // A 250k city's core is no bigger than a 10k city's core.
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

  it('builds nothing on water', () => {
    const port: AzgaarBurgInput = {
      ...metropolis([0, 120]), port: true, oceanBearing: 90, harbourSize: 'large',
    };
    const { model } = generateFromBurg(port, { seed: 5 });
    const built = model.patches.filter(p => p.zone === 'suburb' || p.zone === 'satellite');
    expect(built.every(p => !model.isWaterAt(p.shape.center))).toBe(true);
  }, 20000);
});
