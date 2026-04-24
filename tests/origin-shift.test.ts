import { describe, it, expect } from 'vitest';
import { Point } from '../src/types/point.js';
import {
  SHIFT_FACTOR,
  SHIFT_HYSTERESIS,
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
});
