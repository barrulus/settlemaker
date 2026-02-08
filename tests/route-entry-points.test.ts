import { describe, it, expect } from 'vitest';
import { generateFromBurg, mapToGenerationParams } from '../src/index.js';
import type { AzgaarBurgInput } from '../src/index.js';

function makeBurg(overrides: Partial<AzgaarBurgInput> = {}): AzgaarBurgInput {
  return {
    name: 'TestBurg',
    population: 5000,
    port: false,
    citadel: true,
    walls: true,
    plaza: true,
    temple: true,
    shanty: false,
    capital: false,
    ...overrides,
  };
}

/** Normalize angle to [-PI, PI] */
function normalizeAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/** Angular distance between two angles */
function angularDistance(a: number, b: number): number {
  let diff = Math.abs(normalizeAngle(a - b));
  if (diff > Math.PI) diff = 2 * Math.PI - diff;
  return diff;
}

/** Bearing (degrees, 0=N clockwise) to angle (atan2 convention) */
function bearingToAngle(bearing: number): number {
  const rad = bearing * Math.PI / 180;
  return Math.atan2(-Math.cos(rad), Math.sin(rad));
}

describe('mapToGenerationParams: roadBearings conversion', () => {
  it('converts compass bearings to unit vectors', () => {
    const params = mapToGenerationParams(
      makeBurg({ roadBearings: [0, 90, 180, 270] }),
      42,
    );
    expect(params.roadEntryPoints).toBeDefined();
    expect(params.roadEntryPoints!.length).toBe(4);

    // Bearing 0 (N) → (0, -1)
    expect(params.roadEntryPoints![0].x).toBeCloseTo(0, 5);
    expect(params.roadEntryPoints![0].y).toBeCloseTo(-1, 5);

    // Bearing 90 (E) → (1, 0)
    expect(params.roadEntryPoints![1].x).toBeCloseTo(1, 5);
    expect(params.roadEntryPoints![1].y).toBeCloseTo(0, 5);

    // Bearing 180 (S) → (0, 1)
    expect(params.roadEntryPoints![2].x).toBeCloseTo(0, 5);
    expect(params.roadEntryPoints![2].y).toBeCloseTo(1, 5);

    // Bearing 270 (W) → (-1, 0)
    expect(params.roadEntryPoints![3].x).toBeCloseTo(-1, 5);
    expect(params.roadEntryPoints![3].y).toBeCloseTo(0, 5);
  });

  it('omits roadEntryPoints when no bearings provided', () => {
    const params = mapToGenerationParams(makeBurg(), 42);
    expect(params.roadEntryPoints).toBeUndefined();
  });

  it('omits roadEntryPoints for empty array', () => {
    const params = mapToGenerationParams(makeBurg({ roadBearings: [] }), 42);
    expect(params.roadEntryPoints).toBeUndefined();
  });
});

describe('Gate placement with roadEntryPoints', () => {
  it('places gates near provided bearing directions', () => {
    const bearings = [0, 90, 180, 270]; // N, E, S, W
    const result = generateFromBurg(
      makeBurg({ roadBearings: bearings }),
      { seed: 42 },
    );

    // Border gates should exist (may be fewer than bearings if entrances are limited)
    const borderGates = result.model.border!.gates;
    expect(borderGates.length).toBeGreaterThan(0);

    // The bearing-placed gates should be close to the expected angles
    const tolerance = Math.PI / 2;
    const placedCount = Math.min(bearings.length, borderGates.length);
    for (let i = 0; i < placedCount; i++) {
      const targetAngle = bearingToAngle(bearings[i]);
      const gateAngle = Math.atan2(borderGates[i].y, borderGates[i].x);
      const dist = angularDistance(gateAngle, targetAngle);
      expect(dist).toBeLessThan(tolerance);
    }
  });

  it('places gates near 2 bearings with remaining random', () => {
    const bearings = [45, 225]; // NE, SW
    const result = generateFromBurg(
      makeBurg({ roadBearings: bearings }),
      { seed: 42 },
    );

    const borderGates = result.model.border!.gates;
    expect(borderGates.length).toBeGreaterThanOrEqual(2);

    // First 2 gates should be near the provided bearings
    const tolerance = Math.PI / 3;
    for (let i = 0; i < bearings.length; i++) {
      const targetAngle = bearingToAngle(bearings[i]);
      const gateAngle = Math.atan2(borderGates[i].y, borderGates[i].x);
      const dist = angularDistance(gateAngle, targetAngle);
      expect(dist).toBeLessThan(tolerance);
    }
  });

  it('backward compat: no roadEntryPoints still generates gates', () => {
    const result = generateFromBurg(makeBurg(), { seed: 42 });
    expect(result.model.border!.gates.length).toBeGreaterThan(0);
    expect(result.model.gates.length).toBeGreaterThan(0);
  });

  it('handles single bearing', () => {
    const result = generateFromBurg(
      makeBurg({ roadBearings: [135] }), // SE
      { seed: 42 },
    );

    const borderGates = result.model.border!.gates;
    expect(borderGates.length).toBeGreaterThanOrEqual(1);

    // First gate should be near SE
    const targetAngle = bearingToAngle(135);
    const gateAngle = Math.atan2(borderGates[0].y, borderGates[0].x);
    expect(angularDistance(gateAngle, targetAngle)).toBeLessThan(Math.PI / 3);
  });

  it('handles more bearings than available entrances gracefully', () => {
    // Medium settlement with 8 bearings — more than typical entrance count
    const result = generateFromBurg(
      makeBurg({
        population: 5000,
        roadBearings: [0, 45, 90, 135, 180, 225, 270, 315],
      }),
      { seed: 42 },
    );

    // Should not throw — places as many as possible
    expect(result.model.border!.gates.length).toBeGreaterThan(0);
  });

  it('is deterministic with bearings', () => {
    const burg = makeBurg({ roadBearings: [0, 120, 240] });
    const r1 = generateFromBurg(burg, { seed: 99 });
    const r2 = generateFromBurg(burg, { seed: 99 });
    expect(r1.svg).toBe(r2.svg);
  });
});

describe('Integration: roads extend toward bearing directions', () => {
  it('arteries extend outward from bearing-placed gates', () => {
    const bearings = [0, 180]; // N and S
    const result = generateFromBurg(
      makeBurg({ roadBearings: bearings }),
      { seed: 42 },
    );

    // Should have arteries (streets + roads merged)
    expect(result.model.arteries.length).toBeGreaterThan(0);
    // And roads leading outward from gates
    expect(result.model.roads.length).toBeGreaterThan(0);
  });
});
