import { describe, test, expect } from 'vitest';
import { Model, mapToGenerationParams, Point } from '../src/index.js';
import { activeWallPolylines } from '../src/scene/build-scene.js';
import type { AzgaarBurgInput } from '../src/index.js';

const portBurg = (seed: number) => mapToGenerationParams({
  name: 'Port', population: 20000, port: true, citadel: false, walls: true,
  plaza: true, temple: false, shanty: false, capital: false,
  roadBearings: [0, 240], oceanBearing: 90, harbourSize: 'large',
}, seed);

const smallPort = (seed: number) => mapToGenerationParams({
  name: 'Cove', population: 4000, port: true, citadel: false, walls: true,
  plaza: true, temple: false, shanty: false, capital: false,
  roadBearings: [0, 240], oceanBearing: 90, harbourSize: 'small',
}, seed);

describe('water-first classification', () => {
  test('no core patch centroid is in water, any seed', () => {
    for (const seed of [1, 2, 3, 5, 8]) {
      const m = new Model(portBurg(seed)).generate();
      for (const p of m.inner) {
        expect(m.isWaterAt(p.shape.center)).toBe(false);
      }
    }
  });
  test('no wall vertex is in water', () => {
    for (const seed of [1, 2, 3, 5, 8]) {
      const m = new Model(portBurg(seed)).generate();
      for (const v of m.border!.shape.vertices) {
        expect(m.isWaterAt(v)).toBe(false);
      }
    }
  });
});

/**
 * Saint-Malo rule (spec §6): a walled ocean settlement carries its wall along
 * the water's edge too. The circuit is CLOSED — landward arc plus a seaward
 * run tracing the waterline, towers included — and the only break in it is a
 * gate. It must still never dip into the sea.
 */
describe('coastal wall is a closed shoreline circuit', () => {
  test('a walled port has wall towers on its seaward side', () => {
    const m = new Model(portBurg(3)).generate();
    const ocean = new Point(1, 0); // oceanBearing 90 => +x in local coords
    const seaward = m.wall!.towers.filter(t => (t.x * ocean.x + t.y * ocean.y) > 0);
    expect(seaward.length).toBeGreaterThan(0);
  });

  test('the wall circuit is unbroken — one closed ring, every segment built', () => {
    for (const seed of [1, 2, 3, 5, 8]) {
      const m = new Model(portBurg(seed)).generate();
      const wall = m.wall!;
      expect(wall.segments.every(s => s)).toBe(true);
      const polylines = activeWallPolylines(wall);
      expect(polylines.length).toBe(1);
      const ring = polylines[0];
      // Closed: the polyline returns to its first vertex.
      expect(ring[ring.length - 1]).toBe(ring[0]);
      expect(ring.length).toBe(wall.shape.length + 1);
    }
  });

  test('every waterfront wall vertex carries a tower or a gate', () => {
    for (const seed of [1, 2, 3, 5, 8]) {
      const m = new Model(portBurg(seed)).generate();
      const wall = m.wall!;
      // Vertices on the seaward half of the circuit (ocean is +x).
      const seaward = wall.shape.vertices.filter(v => v.x > 0);
      expect(seaward.length).toBeGreaterThan(2);
      for (const v of seaward) {
        expect(wall.towers.includes(v) || wall.gates.includes(v)).toBe(true);
      }
    }
  });

  test('the harbour opens onto the quay through a sea gate in the wall', () => {
    for (const seed of [1, 2, 3, 5, 8]) {
      for (const params of [portBurg(seed), smallPort(seed)]) {
        const m = new Model(params).generate();
        if (m.harbour === null) continue;
        const wallVerts = m.border!.shape.vertices;
        const gate = wallVerts.find(v => m.harbour!.shape.contains(v));
        expect(gate).toBeDefined();
        expect(m.gates.includes(gate!)).toBe(true);
        expect(m.border!.gateMeta.get(gate!)?.kind).toBe('sea');
        // The quay itself stays OUTSIDE the walled core.
        expect(m.inner.includes(m.harbour!)).toBe(false);
        // Pin the RENDERED contract, not just the model-level bookkeeping:
        // `buildTowers` and the SVG/GeoJSON wall pass both read
        // `wall.gates`/`wall.towers` (the CurtainWall's own fields), not
        // `model.gates`. A gate that is only on `model.gates` renders as a
        // bare wall corner — towered shut, no gate mark on the quay. This is
        // the fix-round-1 regression test for that: the harbour vertex must
        // be gate-marked on the wall itself, and must never carry a tower.
        expect(m.wall!.gates.includes(gate!)).toBe(true);
        expect(m.wall!.towers.includes(gate!)).toBe(false);
      }
    }
  });
});

/**
 * Carried guard from Task 3's review: wall vertices are checked against the
 * waterline in `buildPatches`, but `optimizeJunctions` merges and moves
 * vertices afterwards and `buildWalls` reads them later still. Pin the whole
 * pipeline output — vertices AND the edges between them — against a
 * caller-supplied coastline, which is the path that regressed.
 */
describe('caller-supplied coastline: the wall never enters the water', () => {
  const coast = [[
    { x: -5000, y: -10 }, { x: 5000, y: -10 },
    { x: 5000, y: -5000 }, { x: -5000, y: -5000 },
  ]];
  const strandedBurg = (pop: number, harbourSize: 'small' | 'large'): AzgaarBurgInput => ({
    name: 'Strand', population: pop, port: true, citadel: false, walls: true,
    plaza: true, temple: false, shanty: false, capital: false,
    roadBearings: [180], oceanBearing: 0, harbourSize,
    coastlineGeometry: coast,
  });

  test('no wall vertex and no wall edge crosses the waterline (pops 400/4200 x seeds 1-10)', () => {
    for (const pop of [400, 4200]) {
      for (let seed = 1; seed <= 10; seed++) {
        const m = new Model(mapToGenerationParams(strandedBurg(pop, 'small'), seed)).generate();
        const wall = m.wall;
        if (wall === null) continue;
        const vs = wall.shape.vertices;
        for (const v of vs) {
          expect(m.isWaterAt(v)).toBe(false);
        }
        // Sampling the interiors catches a straight run that bridges a bay
        // between two dry vertices — a wall standing in the sea.
        for (let i = 0; i < vs.length; i++) {
          const a = vs[i];
          const b = vs[(i + 1) % vs.length];
          for (let t = 1; t < 8; t++) {
            const p = new Point(a.x + (b.x - a.x) * t / 8, a.y + (b.y - a.y) * t / 8);
            expect(m.isWaterAt(p)).toBe(false);
          }
        }
      }
    }
  }, 60000);
});
