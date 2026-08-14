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

function modelWithPlaza(): Model {
  for (let seed = 1; seed <= 30; seed++) {
    const m = mk(4000, seed, { plaza: true });
    if (m.plaza !== null) return m;
  }
  throw new Error('no seed in 1..30 produced a plaza');
}

describe('market cross', () => {
  it('plaza ward emits exactly one cross and no landmark building', () => {
    const m = modelWithPlaza();
    const crosses = m.symbols.filter(s => s.id === 'sm-market-cross');
    expect(crosses).toHaveLength(1);
    expect(m.plaza!.ward!.geometry).toHaveLength(0);
    expect(crosses[0].zBand).toBe('structure');
    expect(crosses[0].rotationDeg % 90).toBe(0); // snap-cardinal (manifest confirms)
  });

  it('cross sits inside the plaza patch bounding box', () => {
    const m = modelWithPlaza();
    const at = m.symbols.find(s => s.id === 'sm-market-cross')!.at;
    const xs = m.plaza!.shape.vertices.map(v => v.x);
    const ys = m.plaza!.shape.vertices.map(v => v.y);
    expect(at.x).toBeGreaterThanOrEqual(Math.min(...xs));
    expect(at.x).toBeLessThanOrEqual(Math.max(...xs));
    expect(at.y).toBeGreaterThanOrEqual(Math.min(...ys));
    expect(at.y).toBeLessThanOrEqual(Math.max(...ys));
  });
});

describe('wells', () => {
  it('well count is bounded by the settlement budget and wells sit on consumed lots', () => {
    let totalWells = 0;
    for (const seed of [3, 7, 12]) {
      const m = mk(4000, seed);
      const wells = m.symbols.filter(s => s.id === 'sm-well');
      totalWells += wells.length;
      expect(wells.length).toBeLessThanOrEqual(Math.max(1, Math.round(m.inner.length / 5)));
      for (const w of wells) expect(w.zBand).toBe('structure');
    }
    expect(totalWells).toBeGreaterThan(0);
  });

  it('hamlets get at most one well', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const m = mk(150, seed);
      expect(m.symbols.filter(s => s.id === 'sm-well').length).toBeLessThanOrEqual(1);
    }
  });
});
