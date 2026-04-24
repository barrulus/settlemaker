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

import { generateFromBurg, computeLocalBounds, type AzgaarBurgInput } from '../src/index.js';
// SHIFT_FACTOR already imported at top of file.

function coastalBurg(overrides: Partial<AzgaarBurgInput> = {}): AzgaarBurgInput {
  // Near edge at x=-50 (d=50). With a pop-12000 burg, wallRadius ≈ 77 and
  // gate ≈ 0.44 * 77 ≈ 34. Since d=50 > gate, the hysteresis test passes
  // and coast_pull fires.
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
      { x: -400, y: -100 }, { x: -50, y: -100 },
      { x: -50, y: 100 },   { x: -400, y: 100 },
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

describe('GeoJSON output reflects shift', () => {
  it('emits local_origin_shift metadata', () => {
    const result = generateFromBurg(coastalBurg());
    const meta = (result.geojson as unknown as { metadata: { local_origin_shift: { dx: number; dy: number; source: string } } }).metadata;
    expect(meta.local_origin_shift.source).toBe('coast_pull');
    expect(meta.local_origin_shift.dx).toBeLessThan(0);
  });

  it('emits schema_version=4 and settlemaker_version=0.6.0', () => {
    const result = generateFromBurg(coastalBurg());
    const meta = (result.geojson as unknown as { metadata: { schema_version: number; settlemaker_version: string } }).metadata;
    expect(meta.schema_version).toBe(4);
    expect(meta.settlemaker_version).toBe('0.6.0');
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
