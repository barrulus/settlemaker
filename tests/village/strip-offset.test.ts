import { describe, it, expect } from 'vitest';
import { Point } from '../../src/types/point.js';
import { offsetPolyline } from '../../src/village/parcels/strip.js';

describe('offsetPolyline', () => {
  const straight = [new Point(0, 0), new Point(10, 0), new Point(20, 0)];

  it('offsets a horizontal line to its right (+y in screen space)', () => {
    const out = offsetPolyline(straight, 4, 1);
    expect(out).toHaveLength(3);
    for (const p of out) expect(p.y).toBeCloseTo(4, 5);
    expect(out[0].x).toBeCloseTo(0, 5);
  });

  it('offsets to the left with side -1', () => {
    const out = offsetPolyline(straight, 4, -1);
    for (const p of out) expect(p.y).toBeCloseTo(-4, 5);
  });

  it('keeps one output point per input point', () => {
    const curve = [new Point(0, 0), new Point(10, 0), new Point(20, 10), new Point(30, 30)];
    expect(offsetPolyline(curve, 3, 1)).toHaveLength(4);
  });

  it('bisects the angle at a corner so the offset stays parallel on both legs', () => {
    const corner = [new Point(0, 0), new Point(10, 0), new Point(10, 10)];
    const out = offsetPolyline(corner, 2, 1);
    // At the corner the offset point is pushed diagonally outward.
    expect(out[1].x).toBeCloseTo(8, 5);
    expect(out[1].y).toBeCloseTo(2, 5);
  });

  it('returns an empty array for a degenerate input', () => {
    expect(offsetPolyline([new Point(0, 0)], 4, 1)).toEqual([]);
  });
});
