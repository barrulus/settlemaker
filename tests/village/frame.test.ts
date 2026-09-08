/**
 * The drawn tile (spec 2026-09-07 §7). Aprons are the one thing excluded
 * from the box and the one thing clipped to it -- that is what stops the
 * chase where every metre of road pushed the frame ahead of itself.
 */
import { describe, it, expect } from 'vitest';
import { Point } from '../../src/types/point.js';
import { computeFrame, clipApronsToFrame } from '../../src/village/frame.js';
import { clipPolylineToRect } from '../../src/village/geometry.js';
import type { Lane } from '../../src/village/types.js';

const frame = { minX: -100, minY: -100, maxX: 100, maxY: 100 };

describe('clipPolylineToRect', () => {
  it('keeps the prefix and ends exactly on the boundary', () => {
    const clipped = clipPolylineToRect(
      [new Point(0, 0), new Point(0, -50), new Point(0, -300)], frame,
    );
    const tip = clipped[clipped.length - 1];
    expect(tip.y).toBeCloseTo(-100);
    expect(tip.x).toBeCloseTo(0);
    expect(clipped).toHaveLength(3);
  });

  it('leaves a polyline that never leaves the rectangle alone', () => {
    const points = [new Point(0, 0), new Point(10, 10)];
    expect(clipPolylineToRect(points, frame)).toEqual(points);
  });

  it('clips on the first crossing, not the last', () => {
    const clipped = clipPolylineToRect(
      [new Point(0, 0), new Point(0, -300), new Point(0, 0)], frame,
    );
    expect(clipped[clipped.length - 1].y).toBeCloseTo(-100);
  });
});

describe('computeFrame', () => {
  it('pads the fabric by FRAME_PAD_M', () => {
    const f = computeFrame({
      lanes: [], buildings: [new Point(0, 0)], greenCentre: new Point(0, 0),
      dressing: [new Point(50, 60)],
    });
    expect(f.maxX).toBeCloseTo(90);
    expect(f.maxY).toBeCloseTo(100);
  });

  it('EXCLUDES apron lanes — the whole point', () => {
    const apron: Lane = {
      id: 'trunk-main-000/a', type: 'main', widthM: 5,
      points: [new Point(0, -50), new Point(0, -5000)],
    };
    const trunk: Lane = {
      id: 'trunk-main-000', type: 'main', widthM: 5,
      points: [new Point(0, 0), new Point(0, -50)],
    };
    const withApron = computeFrame({
      lanes: [trunk, apron], buildings: [], greenCentre: new Point(0, 0), dressing: [],
    });
    const without = computeFrame({
      lanes: [trunk], buildings: [], greenCentre: new Point(0, 0), dressing: [],
    });
    expect(withApron).toEqual(without);
  });

  it('still lets an ordinary lane drive the bounds', () => {
    const lane: Lane = {
      id: 'lane-090', type: 'local', widthM: 3,
      points: [new Point(0, 0), new Point(200, 0)],
    };
    const f = computeFrame({
      lanes: [lane], buildings: [], greenCentre: new Point(0, 0), dressing: [],
    });
    expect(f.maxX).toBeCloseTo(240);
  });
});

describe('clipApronsToFrame', () => {
  it('cuts an apron to the boundary and leaves everything else alone', () => {
    const apron: Lane = {
      id: 'trunk-main-000/a', type: 'main', widthM: 5,
      points: [new Point(0, -50), new Point(0, -5000)],
    };
    const trunk: Lane = {
      id: 'trunk-main-000', type: 'main', widthM: 5,
      points: [new Point(0, 0), new Point(0, -50)],
    };
    const out = clipApronsToFrame([trunk, apron], frame);
    expect(out.find((l) => l.id === 'trunk-main-000')).toEqual(trunk);
    const cut = out.find((l) => l.id === 'trunk-main-000/a')!;
    expect(cut.points[cut.points.length - 1].y).toBeCloseTo(-100);
  });

  it('drops an apron that starts outside the frame rather than shipping it', () => {
    const stray: Lane = {
      id: 'trunk-main-000/a', type: 'main', widthM: 5,
      points: [new Point(0, -500), new Point(0, -900)],
    };
    expect(clipApronsToFrame([stray], frame)).toHaveLength(0);
  });
});
