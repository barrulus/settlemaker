import { describe, it, expect } from 'vitest';
import { Point } from '../src/types/point.js';
import {
  SHIFT_FACTOR,
  SHIFT_HYSTERESIS,
  MAX_SHIFT_MULTIPLIER,
  nearestCoastEdge,
  computeOriginShift,
  applyOutputShift,
} from '../src/generator/origin-shift.js';

const rect = (x0: number, y0: number, x1: number, y1: number): Point[] => [
  new Point(x0, y0), new Point(x1, y0), new Point(x1, y1), new Point(x0, y1),
];

describe('nearestCoastEdge', () => {
  it('returns null for empty coastline', () => {
    expect(nearestCoastEdge([])).toBeNull();
  });

  it('returns distance=0 when origin is inside a water polygon', () => {
    const r = nearestCoastEdge([rect(-5, -5, 5, 5)]);
    expect(r).not.toBeNull();
    expect(r!.distance).toBe(0);
  });

  it('finds the closest edge and its bearing', () => {
    const r = nearestCoastEdge([rect(-400, -100, -20, 100)]);
    expect(r).not.toBeNull();
    expect(r!.distance).toBeCloseTo(20, 5);
    expect(r!.bearing.x).toBeCloseTo(-1, 5);
    expect(r!.bearing.y).toBeCloseTo(0, 5);
  });

  it('picks the closest across multiple polygons', () => {
    const r = nearestCoastEdge([rect(-400, -100, -20, 100), rect(50, -10, 60, 10)]);
    expect(r!.distance).toBeCloseTo(20, 5);
  });
});

describe('computeOriginShift', () => {
  const wallRadius = 25;

  it('returns null when no coastline', () => {
    expect(computeOriginShift(undefined, wallRadius)).toBeNull();
    expect(computeOriginShift([], wallRadius)).toBeNull();
  });

  it('returns null when origin is inside water (distance=0)', () => {
    expect(computeOriginShift([rect(-5, -5, 5, 5)], wallRadius)).toBeNull();
  });

  it('returns null when hysteresis gate fails (coast already close enough)', () => {
    // d = 10 = 0.4R. Gate requires d > 0.44R = 11. No shift.
    expect(computeOriginShift([rect(-400, -100, -10, 100)], wallRadius)).toBeNull();
  });

  it('shifts toward coast for Ertelenlik-like setup', () => {
    // d = 20, R = 25 → translation = 20 - 0.4*25 = 10 along bearing (-1, 0)
    const shift = computeOriginShift([rect(-400, -100, -20, 100)], wallRadius);
    expect(shift).not.toBeNull();
    expect(shift!.dx).toBeCloseTo(-10, 5);
    expect(shift!.dy).toBeCloseTo(0, 5);
    expect(shift!.source).toBe('coast_pull');
  });

  it('post-shift nearestEdgeDistance equals wallRadius * SHIFT_FACTOR', () => {
    const coast = [rect(-400, -100, -20, 100)];
    const shift = computeOriginShift(coast, wallRadius);
    const shifted: Point[][] = coast.map(ring => ring.map(p => new Point(p.x - shift!.dx, p.y - shift!.dy)));
    const r = nearestCoastEdge(shifted);
    expect(r!.distance).toBeCloseTo(wallRadius * SHIFT_FACTOR, 5);
  });

  it('returns coast_too_far (zero translation) when nearest edge exceeds MAX_SHIFT_MULTIPLIER * R', () => {
    // d ≈ 707 for a rectangle at (500,500)-(600,600); 3R = 75, so the
    // polygon is well beyond the cut-off. Shift declines.
    const shift = computeOriginShift([rect(500, 500, 600, 600)], wallRadius);
    expect(shift).not.toBeNull();
    expect(shift!.source).toBe('coast_too_far');
    expect(shift!.dx).toBe(0);
    expect(shift!.dy).toBe(0);
  });

  it('still shifts at d just below MAX_SHIFT_MULTIPLIER * R', () => {
    // d = 3R − ε = 74.99. Shift should still fire as 'coast_pull'.
    const nearEdge = -(wallRadius * MAX_SHIFT_MULTIPLIER - 0.01);
    const shift = computeOriginShift([rect(-400, -100, nearEdge, 100)], wallRadius);
    expect(shift!.source).toBe('coast_pull');
  });
});

describe('applyOutputShift', () => {
  it('returns identity for zero shift', () => {
    expect(applyOutputShift(3, 4, { dx: 0, dy: 0, source: 'none' })).toEqual([3, 4]);
  });

  it('adds the shift', () => {
    expect(applyOutputShift(3, 4, { dx: -10, dy: 2, source: 'coast_pull' })).toEqual([-7, 6]);
  });
});

describe('constants', () => {
  it('SHIFT_FACTOR = 0.4', () => expect(SHIFT_FACTOR).toBe(0.4));
  it('SHIFT_HYSTERESIS = 0.1', () => expect(SHIFT_HYSTERESIS).toBe(0.1));
  it('MAX_SHIFT_MULTIPLIER = 3.0', () => expect(MAX_SHIFT_MULTIPLIER).toBe(3.0));
});

import {
  generateFromBurg,
  computeLocalBounds,
  parseSvgViewBox,
  computeTileInfo,
  enumerateTiles,
  type AzgaarBurgInput,
} from '../src/index.js';
// SHIFT_FACTOR already imported at top of file.

function coastalBurg(overrides: Partial<AzgaarBurgInput> = {}): AzgaarBurgInput {
  // Near edge at x=-100 (d=100). Density-targeting Task 1 derives nPatches
  // from the household target, which grew wallRadius for this pop-12000
  // burg to ≈175 (was ≈77) — gate ≈ 0.44 * 175 ≈ 77. Since d=100 > gate,
  // the hysteresis test passes and coast_pull fires.
  return {
    name: 'Ertelenlik',
    population: 12000,
    port: true,
    citadel: false,
    walls: true,
    plaza: true,
    temple: false,
    shanty: false,
    capital: false,
    coastlineGeometry: [[
      { x: -700, y: -200 }, { x: -100, y: -200 },
      { x: -100, y: 200 },   { x: -700, y: 200 },
    ]],
    harbourSize: 'large',
    ...overrides,
  };
}

describe('generateFromBurg two-pass shift', () => {
  it('degradedFlags array still populated for a coastal burg', () => {
    const result = generateFromBurg(coastalBurg());
    expect(Array.isArray(result.degradedFlags)).toBe(true);
  });

  it('returns a coast_pull shift for Ertelenlik-like coastal burg', () => {
    const result = generateFromBurg(coastalBurg());
    expect(result.originShift.source).toBe('coast_pull');
    expect(result.originShift.dx).toBeLessThan(0);
    expect(Math.abs(result.originShift.dy)).toBeLessThan(1e-6);
  });

  it('returns a none-source shift for inland burgs', () => {
    const result = generateFromBurg(coastalBurg({
      name: 'Inland',
      coastlineGeometry: undefined,
      harbourSize: undefined,
    }));
    expect(result.originShift.source).toBe('none');
    expect(result.originShift.dx).toBe(0);
    expect(result.originShift.dy).toBe(0);
  });
});

describe('SVG output reflects shift', () => {
  it('SVG viewBox shifts with the origin', () => {
    // Measured against the model's own unshifted frame, not against a
    // second generation.
    //
    // This used to compare the viewBox of a coastal run with that of an
    // inland one and assert the difference carried the shift's sign and at
    // least its magnitude. That only ever worked while the frame was
    // dominated by the farm ring, which is near-symmetric and so cancelled
    // between the two runs; every comment above the old assertion records
    // the residual growing under it (0.2 -> 2.2 -> 5 -> 312 units). Once
    // `computeLocalBounds` was narrowed to features that actually draw ink,
    // the frame closed onto the built content and the two runs' content is
    // genuinely different: the coastal run has half its map under water, so
    // it grows no fields to the west and its frame is ~80 units narrower.
    // Measured at pop 20000: shift dx -73.0, inland viewBox minX -171.5,
    // coastal -132.0 — the proxy now reports the opposite sign from an
    // intact shift. Nothing about the shift moved; the proxy stopped
    // proxying, so it is replaced with the property it was standing in for.
    //
    // `computeLocalBounds(model, padding, shift)` is the single source of
    // both the SVG viewBox and the GeoJSON `local_bounds`, so the frame
    // tracking the origin is exactly: frame == unshifted frame + shift.
    //
    // Note: both sides of the assertion below go through this same
    // `computeLocalBounds` function (once unshifted here, once internally
    // via the real pipeline with the shift applied). That proves the shift
    // PLUMBING — that `originShift` actually reaches the viewBox/geojson —
    // but it cannot catch an arithmetic error inside `computeLocalBounds`'
    // own shift-handling branch, since the same (possibly wrong) arithmetic
    // would run on both sides and still agree.
    const coastal = generateFromBurg(coastalBurg({ population: 20000 }));
    expect(coastal.originShift.source).toBe('coast_pull');
    expect(coastal.originShift.dx).toBeLessThan(0);

    // assemble-svg writes the viewBox with toFixed(1), hence 1 dp here.
    const vb = parseSvgViewBox(coastal.svg)!;
    const unshifted = computeLocalBounds(coastal.model, 20);
    expect(vb.x).toBeCloseTo(unshifted.min_x + coastal.originShift.dx, 1);
    expect(vb.y).toBeCloseTo(unshifted.min_y + coastal.originShift.dy, 1);
    // ...and the shift moves the frame without resizing it.
    expect(vb.width).toBeCloseTo(unshifted.max_x - unshifted.min_x, 1);
    expect(vb.height).toBeCloseTo(unshifted.max_y - unshifted.min_y, 1);
  });

  it('SVG wall path coordinates are shifted', () => {
    const result = generateFromBurg(coastalBurg());
    // Wall is emitted as a <path>; every vertex coord should equal
    // model-vertex + shift (within float tolerance). Easiest check:
    // the path string should contain at least one explicitly negative
    // x value matching the wall's westernmost vertex + shift.dx.
    //
    // This used to restrict the search to vertices adjacent to an active
    // segment, because `getActiveWallPolylines` skipped waterfront-inactive
    // stretches and the westernmost vertex had landed on one. Task 7 closed
    // the wall circuit along the shoreline, so this fixture's wall now has
    // no inactive segment at all (measured: 32 vertices, 0 inactive) and the
    // filter was selecting every vertex. Dropped along with its comment;
    // every wall vertex is drawn.
    const wallModel = result.model.wall!;
    const minModelX = Math.min(...wallModel.shape.vertices.map(v => v.x));
    const expectedMinOutputX = minModelX + result.originShift.dx;
    // Parse all number pairs from the SVG; at least one x should be within
    // 1 unit of expectedMinOutputX.
    const nums = [...result.svg.matchAll(/(-?\d+(?:\.\d+)?)/g)].map(m => parseFloat(m[1]));
    const hasExpectedX = nums.some(n => Math.abs(n - expectedMinOutputX) < 1);
    expect(hasExpectedX).toBe(true);
  });
});

describe('GeoJSON output reflects shift', () => {
  it('emits local_origin_shift metadata', () => {
    const result = generateFromBurg(coastalBurg());
    const meta = (result.geojson as unknown as { metadata: { local_origin_shift: { dx: number; dy: number; source: string } } }).metadata;
    expect(meta.local_origin_shift.source).toBe('coast_pull');
    expect(meta.local_origin_shift.dx).toBeLessThan(0);
  });

  it('emits schema_version=4 and settlemaker_version=1.2.0', () => {
    const result = generateFromBurg(coastalBurg());
    const meta = (result.geojson as unknown as { metadata: { schema_version: number; settlemaker_version: string } }).metadata;
    expect(meta.schema_version).toBe(4);
    expect(meta.settlemaker_version).toBe('1.2.0');
  });

  it('shifts wall feature coordinates toward the coast', () => {
    const result = generateFromBurg(coastalBurg());
    const wallFeature = result.geojson.features.find(
      f => f.properties?.layer === 'wall' && f.properties?.wallType === 'city_wall',
    );
    expect(wallFeature).toBeDefined();
    // GeoJSON polygon closes by repeating first vertex; drop the last coord for comparison.
    const allCoords = (wallFeature!.geometry as { coordinates: number[][][] }).coordinates[0];
    const coords = allCoords.slice(0, -1);
    const modelVerts = result.model.wall!.shape.vertices;
    expect(coords.length).toBe(modelVerts.length);
    // Every GeoJSON vertex should equal the corresponding model vertex + shift.
    for (let i = 0; i < coords.length; i++) {
      expect(coords[i][0]).toBeCloseTo(modelVerts[i].x + result.originShift.dx, 4);
      expect(coords[i][1]).toBeCloseTo(modelVerts[i].y + result.originShift.dy, 4);
    }
  });

  it('shifts local_bounds by (dx, dy)', () => {
    const coastal = generateFromBurg(coastalBurg());
    const shiftedBounds = ((coastal.geojson as unknown as { metadata: { local_bounds: { min_x: number } } }).metadata).local_bounds;
    // The shifted bounds should differ from the model's unshifted bounds by exactly the shift.
    const unshiftedBounds = computeLocalBounds(coastal.model, 20);
    expect(shiftedBounds.min_x - unshiftedBounds.min_x).toBeCloseTo(coastal.originShift.dx, 4);
  });
});

describe('tiler honours shifted viewBox', () => {
  it('enumerates tiles for a coastal (shifted) burg without errors', () => {
    const result = generateFromBurg(coastalBurg());
    const vb = parseSvgViewBox(result.svg);
    expect(vb).not.toBeNull();
    const tileInfo = computeTileInfo(vb!, 12000);
    const tiles = enumerateTiles(tileInfo.maxZoom);
    expect(tiles.length).toBeGreaterThan(0);
  });
});

describe('acceptance: Ertelenlik-like coastal burg', () => {
  it('post-shift nearestEdgeDistance sits in [0.3R, 0.5R]', () => {
    const result = generateFromBurg(coastalBurg());
    const R = result.model.border!.getRadius();
    // Shifted origin (in the output frame) = (originShift.dx, dy).
    // The original coastline's nearest edge is at x = -100 (west strip).
    // Distance from (dx, dy) to that edge = |-100 - dx|.
    const d = Math.abs(-100 - result.originShift.dx);
    expect(Math.abs(result.originShift.dy)).toBeLessThan(1e-6);
    expect(d).toBeGreaterThanOrEqual(0.3 * R);
    expect(d).toBeLessThanOrEqual(0.5 * R);
    expect(result.originShift.source).toBe('coast_pull');
  });
});

describe('fuzz: rectangular water strip, vary population', () => {
  it('wall stays close to coast across populations (after shift if any)', () => {
    const populations = [500, 1000, 5000, 12000, 30000, 80000];
    const failures: string[] = [];
    for (const population of populations) {
      const result = generateFromBurg({
        name: `Fuzz-${population}`,
        population,
        port: true,
        citadel: false,
        walls: true,
        plaza: true,
        temple: false,
        shanty: false,
        capital: false,
        coastlineGeometry: [[
          { x: -400, y: -100 }, { x: -20, y: -100 },
          { x: -20, y: 100 },   { x: -400, y: 100 },
        ]],
        harbourSize: 'large',
      });
      const R = result.model.border!.getRadius();
      const d = Math.abs(-20 - result.originShift.dx);
      // Invariant: wall reaches (or overlaps) the coast. d <= R means
      // the wall's west-arc either touches or crosses the coastline.
      if (d > R) {
        failures.push(`pop=${population}: d=${d.toFixed(1)} > R=${R.toFixed(1)}, shift=${JSON.stringify(result.originShift)}`);
      }
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });
});
