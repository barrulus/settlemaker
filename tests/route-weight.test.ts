// tests/route-weight.test.ts
import { describe, test, expect } from 'vitest';
import { rawRouteWeight, routeWeights } from '../src/generator/route-weight.js';
import { SeededRandom } from '../src/utils/random.js';
import { Point } from '../src/types/point.js';

const entry = (over: object) => ({ point: new Point(0, -1), bearingDeg: 0, ...over });

describe('rawRouteWeight', () => {
  test('trails are heavily suppressed', () => {
    expect(rawRouteWeight(entry({ group: 'trails' }))).toBeLessThan(0.2);
  });
  test('through-routes outweigh terminal ones', () => {
    expect(rawRouteWeight(entry({ through: true }))).toBeGreaterThan(rawRouteWeight(entry({ through: false })));
  });
  test('ridge approaches are suppressed below ascent below flat', () => {
    const w = (relief: string) => rawRouteWeight(entry({ relief }));
    expect(w('ridge')).toBeLessThan(w('ascent'));
    expect(w('ascent')).toBeLessThan(w('flat'));
  });
  test('bare entries weigh 1.0', () => {
    expect(rawRouteWeight(entry({}))).toBe(1.0);
  });
});

describe('routeWeights', () => {
  test('equal raw weights still produce a dominant approach (seeded decay)', () => {
    const rng = new SeededRandom(7);
    const ws = routeWeights([entry({}), entry({ bearingDeg: 120 }), entry({ bearingDeg: 240 })], rng)
      .map(r => r.weight).sort((a, b) => b - a);
    expect(ws[0] / ws[2]).toBeGreaterThan(2); // TUNE: top approach at least 2x the weakest
  });
  test('deterministic for a given seed', () => {
    const a = routeWeights([entry({}), entry({ bearingDeg: 120 })], new SeededRandom(9));
    const b = routeWeights([entry({}), entry({ bearingDeg: 120 })], new SeededRandom(9));
    expect(a.map(r => r.weight)).toEqual(b.map(r => r.weight));
  });
});
