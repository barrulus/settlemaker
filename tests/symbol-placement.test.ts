import { describe, it, expect } from 'vitest';
import { Point } from '../src/types/point.js';
import { Polygon } from '../src/geom/polygon.js';
import { intersectsSite } from '../src/generator/symbols.js';
import { Model, mapToGenerationParams, type AzgaarBurgInput } from '../src/index.js';

// Canonical test-model helper (pattern from tests/degraded-generation.test.ts).
function mk(population: number, seed: number, overrides: Partial<AzgaarBurgInput> = {}): Model {
  return new Model(mapToGenerationParams({
    name: 'Test', population, port: false, citadel: false, walls: false,
    plaza: false, temple: false, shanty: false, capital: false, ...overrides,
  }, seed)).generate();
}

describe('placement primitives', () => {
  const square = new Polygon([
    new Point(0, 0), new Point(4, 0), new Point(4, 4), new Point(0, 4),
  ]);

  it('detects vertex-inside and centroid-inside overlap', () => {
    expect(intersectsSite(square, [{ at: new Point(0, 0), radius: 1 }])).toBe(true);   // vertex
    expect(intersectsSite(square, [{ at: new Point(2, 2), radius: 0.5 }])).toBe(true); // centroid
    expect(intersectsSite(square, [{ at: new Point(20, 20), radius: 3 }])).toBe(false);
  });

  it('model exposes deterministic symbol state', () => {
    const a = mk(1200, 11);
    const b = mk(1200, 11);
    expect(a.prevailingWindDeg).toBe(b.prevailingWindDeg);
    expect(a.prevailingWindDeg).toBeGreaterThanOrEqual(0);
    expect(a.prevailingWindDeg).toBeLessThan(360);
    expect(JSON.stringify(a.symbols)).toBe(JSON.stringify(b.symbols));
  });
});
