import { describe, it, expect } from 'vitest';
import { Point } from '../src/types/point.js';
import { Polygon } from '../src/geom/polygon.js';
import { intersectsSite } from '../src/generator/symbols.js';
import { pointInPolygon } from '../src/geom/point-in-polygon.js';
import { CommonWard } from '../src/wards/common-ward.js';
import { Farm } from '../src/wards/farm.js';
import { buildScene } from '../src/scene/build-scene.js';
import { Model, mapToGenerationParams, type AzgaarBurgInput } from '../src/index.js';
import { WardType } from '../src/types/interfaces.js';
import { scoreBuildings, scoringReference } from '../src/poi/poi-selector.js';

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

  // Model.buildGeometry's refineDensity/densifyGroup pass can call a
  // CommonWard's createGeometry() a second time when the first pass
  // under-yields (live at hamlet scale too). A well placed on the first
  // call must not survive stale against the rebuilt geometry, and the
  // ward must never hold more than one well's worth of budget.
  it('a second createGeometry() call on the same ward never strands or duplicates its well', () => {
    const m = mk(4000, 3);
    const wardPatch = m.patches.find(p =>
      p.ward instanceof CommonWard &&
      m.symbols.some(s => s.id === 'sm-well' && pointInPolygon(s.at, p.shape.vertices)),
    );
    expect(wardPatch).toBeDefined();
    const ward = wardPatch!.ward as CommonWard;

    const wellsForWard = () => m.symbols.filter(s =>
      s.id === 'sm-well' && pointInPolygon(s.at, wardPatch!.shape.vertices),
    );
    expect(wellsForWard().length).toBe(1);
    const budgetBefore = m.wellBudget;

    ward.createGeometry();

    expect(wellsForWard().length).toBeLessThanOrEqual(1);
    // The ward retracts its stale well (refunding the budget) before any
    // re-roll, so it can never hold a net second draw against the budget.
    expect(m.wellBudget).toBeGreaterThanOrEqual(budgetBefore);

    for (const w of wellsForWard()) {
      for (const building of ward.geometry) {
        expect(pointInPolygon(w.at, building.vertices)).toBe(false);
      }
    }
  });

  it('every well sits outside every building polygon, across seeds', () => {
    for (const seed of [3, 7, 12]) {
      const m = mk(4000, seed);
      const wells = m.symbols.filter(s => s.id === 'sm-well');
      for (const w of wells) {
        for (const patch of m.patches) {
          if (!patch.ward) continue;
          for (const building of patch.ward.geometry) {
            expect(pointInPolygon(w.at, building.vertices)).toBe(false);
          }
        }
      }
    }
  });
});

function modelWithMill(): Model {
  for (let seed = 1; seed <= 40; seed++) {
    const m = mk(1200, seed);
    if (m.symbols.some(s => s.id === 'sm-mill-wind')) return m;
  }
  throw new Error('no seed in 1..40 placed a windmill');
}

describe('windmill', () => {
  it('mills share the town prevailing wind and respect budget', () => {
    const m = modelWithMill();
    const mills = m.symbols.filter(s => s.id === 'sm-mill-wind');
    expect(mills.length).toBeLessThanOrEqual(m.params.population >= 2000 ? 2 : 1);
    for (const mill of mills) expect(mill.rotationDeg).toBe(m.prevailingWindDeg);
  });

  it('no farm building intersects the mill clearance', () => {
    const m = modelWithMill();
    const sites = m.claimedSites;
    for (const patch of m.patches) {
      if (patch.ward instanceof Farm) {
        for (const b of patch.ward.buildings) expect(intersectsSite(b, sites)).toBe(false);
      }
    }
  });

  it('the mill plot loses its furrow hatch in the scene', () => {
    const m = modelWithMill();
    const scene = buildScene(m);
    expect(scene.layers.fields.some(f => f.hatch === false)).toBe(true);
  });
});

function modelWithCathedral(): Model {
  for (let seed = 1; seed <= 40; seed++) {
    const m = mk(8000, seed, { temple: true });
    const ward = m.patches.find(p => p.ward?.type === WardType.Cathedral)?.ward;
    if (ward && ward.geometry.length > 0) return m;
  }
  throw new Error('no seed in 1..40 produced a cathedral with geometry');
}

describe('church mark', () => {
  it('lands on the same building the cathedral POI adoption logic picks, upright, overlay band', () => {
    const m = modelWithCathedral();
    const ward = m.patches.find(p => p.ward?.type === WardType.Cathedral)!.ward!;
    const expected = scoreBuildings(ward.geometry, scoringReference(m))[0].centroid;
    const scene = buildScene(m);
    const marks = scene.layers.symbols.filter(s => s.id === 'sm-mark-church');
    expect(marks).toHaveLength(1);
    expect(marks[0].zBand).toBe('overlay');
    expect(marks[0].rotationDeg).toBe(0);
    expect(marks[0].at.x).toBeCloseTo(expected.x, 5); // NO_SHIFT default
    expect(marks[0].at.y).toBeCloseTo(expected.y, 5);
  });
});
