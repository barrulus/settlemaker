import { describe, it, expect } from 'vitest';
import { Point } from '../../src/types/point.js';
import { pointInPolygon } from '../../src/geom/point-in-polygon.js';
import {
  clipHalfPlane, convexHull, cutConvex, cutCorridor, extentAlong, insetConvex,
  longAxisDeg, longestEdgeDeg, polygonArea, polygonCentroid,
} from '../../src/village/dressing/parcel-cut.js';

const square = (s: number): Point[] => [
  new Point(0, 0), new Point(s, 0), new Point(s, s), new Point(0, s),
];

describe('parcel-cut (gate 8.3: the planar half of the field system)', () => {
  it('polygonArea and polygonCentroid agree with the closed forms', () => {
    expect(polygonArea(square(10))).toBeCloseTo(100, 9);
    const c = polygonCentroid(square(10));
    expect(c.x).toBeCloseTo(5, 9);
    expect(c.y).toBeCloseTo(5, 9);
    // Winding must not matter.
    expect(polygonArea(square(10).slice().reverse())).toBeCloseTo(100, 9);
  });

  it('clipHalfPlane keeps exactly the half asked for', () => {
    const half = clipHalfPlane(square(10), 1, 0, 4);
    expect(polygonArea(half)).toBeCloseTo(40, 6);
    for (const p of half) expect(p.x).toBeLessThanOrEqual(4 + 1e-9);
    // A half-plane containing the whole polygon returns it unchanged.
    expect(polygonArea(clipHalfPlane(square(10), 1, 0, 99))).toBeCloseTo(100, 6);
    // One containing none of it returns nothing.
    expect(clipHalfPlane(square(10), 1, 0, -1)).toEqual([]);
  });

  // THE invariant the whole module rests on: a half-plane is convex, so a
  // convex cell cut by one gives convex pieces, all the way down the
  // recursion from the region's hull to the last parcel. Sutherland-Hodgman
  // is only exact for a convex subject, so if this broke, every clip below
  // it would be quietly wrong.
  it('cuts of a convex polygon are convex, and spend exactly the area cut', () => {
    const isConvex = (poly: Point[]): boolean => {
      let sign = 0;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        const c = poly[(i + 2) % poly.length];
        const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
        if (Math.abs(cross) < 1e-9) continue;
        const s = Math.sign(cross);
        if (sign === 0) sign = s; else if (s !== sign) return false;
      }
      return true;
    };
    const pieces = cutConvex(square(40), 0, 0.4, 0);
    expect(pieces).toHaveLength(2);
    for (const piece of pieces) expect(isConvex(piece)).toBe(true);
    expect(pieces[0].length + pieces[1].length).toBeGreaterThanOrEqual(8);
    const total = pieces.reduce((s, p) => s + polygonArea(p), 0);
    expect(total).toBeCloseTo(1600, 6);
  });

  it('a cut with a gap takes exactly the gap out of the polygon', () => {
    const pieces = cutConvex(square(40), 0, 0.5, 4);
    const total = pieces.reduce((s, p) => s + polygonArea(p), 0);
    // The gap runs the full 40 m width of the square, 4 m deep.
    expect(total).toBeCloseTo(1600 - 160, 6);
  });

  it('cutCorridor leaves the corridor clear on both sides of the line', () => {
    const pieces = cutCorridor(square(40), new Point(20, 20), 0, 5);
    expect(pieces).toHaveLength(2);
    for (const piece of pieces) {
      for (const p of piece) expect(Math.abs(p.x - 20)).toBeGreaterThanOrEqual(5 - 1e-9);
    }
    // A line that misses the polygon leaves it whole.
    const missed = cutCorridor(square(40), new Point(200, 0), 0, 5);
    expect(missed).toHaveLength(1);
    expect(polygonArea(missed[0])).toBeCloseTo(1600, 6);
  });

  it('insetConvex shrinks by the offset on every side', () => {
    const inner = insetConvex(square(40), 2);
    expect(polygonArea(inner)).toBeCloseTo(36 * 36, 6);
    // An inset deeper than the polygon leaves nothing rather than
    // inverting it.
    expect(insetConvex(square(4), 5)).toEqual([]);
  });

  // Long axis = perpendicular of LEAST extent, not direction of greatest
  // extent: the widest projection of a 100 x 10 rectangle is its DIAGONAL,
  // so the greatest-extent reading calls this rectangle long at 96 degrees.
  it('longAxisDeg reads a rectangle as long along its own length', () => {
    const wide = [new Point(0, 0), new Point(100, 0), new Point(100, 10), new Point(0, 10)];
    // Bearings are 0 = north (-y), clockwise, so a polygon long in +x is
    // long along bearing 90.
    expect(Math.abs(((longAxisDeg(wide) - 90) % 180))).toBeLessThanOrEqual(2);
    const ext = extentAlong(wide, longAxisDeg(wide));
    expect(ext.hi - ext.lo).toBeGreaterThan(99);
    const across = extentAlong(wide, longAxisDeg(wide) + 90);
    expect(across.hi - across.lo).toBeCloseTo(10, 6);
  });

  // GATE 8.3's most consequential single choice, and it is under test
  // because the first draft got it wrong: cutting across the direction of
  // greatest EXTENT shattered the region into acute triangles, and cutting
  // across the LONGEST EDGE keeps a rectangle a pair of rectangles.
  it('longestEdgeDeg drives cuts that keep a rectangle rectangular', () => {
    const rect = [new Point(0, 0), new Point(80, 0), new Point(80, 20), new Point(0, 20)];
    expect(Math.abs((longestEdgeDeg(rect) - 90) % 180)).toBeLessThanOrEqual(1e-6);
    const pieces = cutConvex(rect, longestEdgeDeg(rect), 0.5, 0);
    expect(pieces).toHaveLength(2);
    for (const piece of pieces) expect(piece.length).toBe(4);
  });

  it('convexHull returns a convex ring containing every input point', () => {
    const pts = [
      new Point(0, 0), new Point(10, 0), new Point(10, 10), new Point(0, 10),
      new Point(5, 5), new Point(3, 7),
    ];
    const hull = convexHull(pts);
    expect(hull).toHaveLength(4);
    expect(polygonArea(hull)).toBeCloseTo(100, 6);
    for (const p of pts) {
      expect(pointInPolygon(p, hull) || hull.some((h) => Math.hypot(h.x - p.x, h.y - p.y) < 1e-9)
        || Math.abs(p.x) < 1e-9 || Math.abs(p.y) < 1e-9).toBe(true);
    }
  });
});
