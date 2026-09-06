import { describe, it, expect } from 'vitest';
import { Point } from '../../src/types/point.js';
import {
  angularGap, arcLengths, bearingOf, bearingVector, closestPointOnPolyline, closestPointOnSegment, dist, inAnyWater,
  polylineLength, sampleAt, unit,
} from '../../src/village/geometry.js';

describe('bearings', () => {
  it('treats 0 as north, which is -y', () => {
    const v = bearingVector(0);
    expect(v.x).toBeCloseTo(0, 6);
    expect(v.y).toBeCloseTo(-1, 6);
  });

  it('treats 90 as east', () => {
    const v = bearingVector(90);
    expect(v.x).toBeCloseTo(1, 6);
    expect(v.y).toBeCloseTo(0, 6);
  });

  it('round-trips a bearing through a vector', () => {
    for (const deg of [0, 37, 90, 180, 271, 359]) {
      const v = bearingVector(deg);
      expect(bearingOf(new Point(0, 0), v)).toBeCloseTo(deg, 4);
    }
  });

  it('wraps out-of-range bearings', () => {
    expect(bearingOf(new Point(0, 0), bearingVector(370))).toBeCloseTo(10, 4);
  });

  it('measures the shorter way round', () => {
    expect(angularGap(10, 350)).toBeCloseTo(20, 6);
    expect(angularGap(350, 10)).toBeCloseTo(20, 6);
    expect(angularGap(0, 180)).toBeCloseTo(180, 6);
  });
});

describe('vectors', () => {
  it('normalises', () => {
    const u = unit(3, 4);
    expect(Math.hypot(u.x, u.y)).toBeCloseTo(1, 6);
  });

  it('survives a zero-length input instead of producing NaN', () => {
    const u = unit(0, 0);
    expect(Number.isNaN(u.x)).toBe(false);
    expect(Number.isNaN(u.y)).toBe(false);
  });

  it('measures distance', () => {
    expect(dist(new Point(0, 0), new Point(3, 4))).toBeCloseTo(5, 6);
  });
});

describe('polylines', () => {
  const line = [new Point(0, 0), new Point(10, 0), new Point(10, 10)];

  it('measures total length', () => {
    expect(polylineLength(line)).toBeCloseTo(20, 6);
  });

  it('is zero for a degenerate polyline', () => {
    expect(polylineLength([new Point(1, 1)])).toBe(0);
  });

  it('accumulates length per vertex', () => {
    expect(arcLengths(line)).toEqual([0, 10, 20]);
  });

  it('samples a point partway along, with its local direction', () => {
    const acc = arcLengths(line);
    const mid = sampleAt(line, acc, 5);
    expect(mid.p.x).toBeCloseTo(5, 6);
    expect(mid.p.y).toBeCloseTo(0, 6);
    expect(mid.dirDeg).toBeCloseTo(90, 4); // running east
  });

  it('clamps a sample beyond either end', () => {
    const acc = arcLengths(line);
    expect(sampleAt(line, acc, -5).p.x).toBeCloseTo(0, 6);
    expect(sampleAt(line, acc, 999).p.y).toBeCloseTo(10, 6);
  });
});

describe('closestPointOnPolyline', () => {
  const line = [new Point(0, 0), new Point(10, 0), new Point(10, 10)];

  it('finds the closest point on whichever segment is nearest', () => {
    const r = closestPointOnPolyline(new Point(5, 3), line);
    expect(r.point.x).toBeCloseTo(5, 6);
    expect(r.point.y).toBeCloseTo(0, 6);
    expect(r.distance).toBeCloseTo(3, 6);
  });

  it('handles a single-point polyline', () => {
    const r = closestPointOnPolyline(new Point(3, 4), [new Point(0, 0)]);
    expect(r.distance).toBeCloseTo(5, 6);
  });

  it('returns Infinity for an empty polyline', () => {
    expect(closestPointOnPolyline(new Point(1, 1), []).distance).toBe(Infinity);
  });
});

describe('inAnyWater', () => {
  const pond = [[new Point(0, 0), new Point(10, 0), new Point(10, 10), new Point(0, 10)]];

  it('is true inside a ring', () => {
    expect(inAnyWater(new Point(5, 5), pond)).toBe(true);
  });

  it('is false outside every ring', () => {
    expect(inAnyWater(new Point(50, 50), pond)).toBe(false);
  });

  it('is false when there is no water at all', () => {
    expect(inAnyWater(new Point(5, 5), [])).toBe(false);
  });
});

describe('closestPointOnSegment', () => {
  it('projects onto the segment interior', () => {
    const q = closestPointOnSegment(new Point(5, 5), new Point(0, 0), new Point(10, 0));
    expect(q.x).toBeCloseTo(5, 6);
    expect(q.y).toBeCloseTo(0, 6);
  });

  it('clamps to the nearer endpoint beyond either end', () => {
    const q = closestPointOnSegment(new Point(-3, 2), new Point(0, 0), new Point(10, 0));
    expect(q.x).toBeCloseTo(0, 6);
    const r = closestPointOnSegment(new Point(14, -2), new Point(0, 0), new Point(10, 0));
    expect(r.x).toBeCloseTo(10, 6);
  });

  it('survives a zero-length segment', () => {
    const q = closestPointOnSegment(new Point(3, 4), new Point(1, 1), new Point(1, 1));
    expect(q.x).toBeCloseTo(1, 6);
    expect(q.y).toBeCloseTo(1, 6);
  });
});
