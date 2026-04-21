import { describe, it, expect } from 'vitest';
import { generateFromBurg, type AzgaarBurgInput } from '../src/index.js';
import { computeLocalBounds } from '../src/generator/bounds.js';
import { Castle } from '../src/wards/castle.js';
import { Harbour } from '../src/wards/harbour.js';

function makeBurg(overrides: Partial<AzgaarBurgInput> = {}): AzgaarBurgInput {
  return {
    name: 'BoundsBurg',
    population: 5000,
    port: false,
    citadel: false,
    walls: true,
    plaza: true,
    temple: false,
    shanty: false,
    capital: false,
    ...overrides,
  };
}

describe('computeLocalBounds', () => {
  it('returns an AABB that contains every patch vertex plus padding', () => {
    const { model } = generateFromBurg(makeBurg(), { seed: 42 });
    const bounds = computeLocalBounds(model, 20);

    for (const patch of model.patches) {
      for (const v of patch.shape.vertices) {
        expect(v.x).toBeGreaterThanOrEqual(bounds.min_x);
        expect(v.x).toBeLessThanOrEqual(bounds.max_x);
        expect(v.y).toBeGreaterThanOrEqual(bounds.min_y);
        expect(v.y).toBeLessThanOrEqual(bounds.max_y);
      }
    }
  });

  it('respects the padding argument', () => {
    const { model } = generateFromBurg(makeBurg(), { seed: 42 });
    const tight = computeLocalBounds(model, 0);
    const padded = computeLocalBounds(model, 20);
    expect(padded.min_x).toBeCloseTo(tight.min_x - 20);
    expect(padded.min_y).toBeCloseTo(tight.min_y - 20);
    expect(padded.max_x).toBeCloseTo(tight.max_x + 20);
    expect(padded.max_y).toBeCloseTo(tight.max_y + 20);
  });

  it('covers street and road polylines', () => {
    const { model } = generateFromBurg(makeBurg({ population: 15000 }), { seed: 42 });
    const bounds = computeLocalBounds(model, 0);

    for (const artery of model.arteries) {
      for (const v of artery.vertices) {
        expect(v.x).toBeGreaterThanOrEqual(bounds.min_x);
        expect(v.x).toBeLessThanOrEqual(bounds.max_x);
        expect(v.y).toBeGreaterThanOrEqual(bounds.min_y);
        expect(v.y).toBeLessThanOrEqual(bounds.max_y);
      }
    }
    for (const road of model.roads) {
      for (const v of road.vertices) {
        expect(v.x).toBeGreaterThanOrEqual(bounds.min_x);
        expect(v.x).toBeLessThanOrEqual(bounds.max_x);
        expect(v.y).toBeGreaterThanOrEqual(bounds.min_y);
        expect(v.y).toBeLessThanOrEqual(bounds.max_y);
      }
    }
  });

  it('covers harbour piers for port burgs', () => {
    const { model } = generateFromBurg(
      makeBurg({ port: true, population: 15000, oceanBearing: 180, harbourSize: 'large' }),
      { seed: 42 },
    );
    const bounds = computeLocalBounds(model, 0);

    let pierCount = 0;
    for (const patch of model.patches) {
      if (!(patch.ward instanceof Harbour)) continue;
      for (const pier of patch.ward.piers) {
        pierCount++;
        for (const v of pier.vertices) {
          expect(v.x).toBeGreaterThanOrEqual(bounds.min_x);
          expect(v.x).toBeLessThanOrEqual(bounds.max_x);
          expect(v.y).toBeGreaterThanOrEqual(bounds.min_y);
          expect(v.y).toBeLessThanOrEqual(bounds.max_y);
        }
      }
    }
    expect(pierCount).toBeGreaterThan(0);
  });

  it('covers the citadel wall when present', () => {
    const { model } = generateFromBurg(
      makeBurg({ citadel: true, population: 15000 }),
      { seed: 42 },
    );
    const bounds = computeLocalBounds(model, 0);

    expect(model.citadel).not.toBeNull();
    const castle = model.citadel!.ward;
    expect(castle).toBeInstanceOf(Castle);
    for (const v of (castle as Castle).wall.shape.vertices) {
      expect(v.x).toBeGreaterThanOrEqual(bounds.min_x);
      expect(v.x).toBeLessThanOrEqual(bounds.max_x);
      expect(v.y).toBeGreaterThanOrEqual(bounds.min_y);
      expect(v.y).toBeLessThanOrEqual(bounds.max_y);
    }
  });

  it('is deterministic for the same seed', () => {
    const a = generateFromBurg(makeBurg(), { seed: 42 }).model;
    const b = generateFromBurg(makeBurg(), { seed: 42 }).model;
    expect(computeLocalBounds(a, 20)).toEqual(computeLocalBounds(b, 20));
  });
});
