import { describe, it, expect } from 'vitest';
import { Polygon } from '../src/geom/polygon.js';
import { Point } from '../src/types/point.js';
import { scoreBuildings } from '../src/poi/poi-selector.js';

function rect(x: number, y: number, w: number, h: number): Polygon {
  return new Polygon([
    new Point(x, y),
    new Point(x + w, y),
    new Point(x + w, y + h),
    new Point(x, y + h),
  ]);
}

describe('scoreBuildings', () => {
  it('orders by area desc, then by distance to reference point asc', () => {
    const small = rect(0, 0, 2, 2);      // area 4
    const mediumFar = rect(100, 100, 3, 3); // area 9, far from origin
    const large = rect(0, 0, 5, 5);       // area 25
    const ref = new Point(0, 0);

    const ordered = scoreBuildings([small, mediumFar, large], ref);
    expect(ordered).toEqual([large, mediumFar, small]);
  });

  it('is stable for equal-area buildings: the closer one wins', () => {
    const a = rect(0, 0, 3, 3);     // area 9, centroid (1.5, 1.5)
    const b = rect(10, 10, 3, 3);   // area 9, centroid (11.5, 11.5)
    const ref = new Point(0, 0);

    const ordered = scoreBuildings([b, a], ref);
    expect(ordered[0]).toBe(a);
    expect(ordered[1]).toBe(b);
  });

  it('handles an empty list', () => {
    expect(scoreBuildings([], new Point(0, 0))).toEqual([]);
  });
});
