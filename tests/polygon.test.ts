import { describe, it, expect } from 'vitest';
import { Point } from '../src/types/point.js';
import { Polygon } from '../src/geom/polygon.js';

describe('Polygon', () => {
  it('calculates area of a unit square', () => {
    const sq = Polygon.rect(2, 2);
    expect(Math.abs(sq.square)).toBeCloseTo(4);
  });

  it('calculates perimeter of a rectangle', () => {
    const r = Polygon.rect(4, 2);
    expect(r.perimeter).toBeCloseTo(12);
  });

  it('calculates center', () => {
    const sq = Polygon.rect(2, 2);
    const c = sq.center;
    expect(c.x).toBeCloseTo(0);
    expect(c.y).toBeCloseTo(0);
  });

  it('calculates centroid', () => {
    const sq = Polygon.rect(2, 2);
    const c = sq.centroid;
    expect(c.x).toBeCloseTo(0, 4);
    expect(c.y).toBeCloseTo(0, 4);
  });

  it('compactness of a regular polygon is higher than a long rectangle', () => {
    const circle = Polygon.regular(32, 1);
    const longRect = Polygon.rect(10, 0.5);
    expect(circle.compactness).toBeGreaterThan(longRect.compactness);
  });

  it('identifies convex polygon', () => {
    const sq = Polygon.rect(2, 2);
    expect(sq.isConvex()).toBe(true);
  });

  it('detects borders between adjacent polygons', () => {
    const a = new Polygon([
      new Point(0, 0), new Point(1, 0), new Point(1, 1), new Point(0, 1),
    ]);
    // Sharing edge (1,0)→(1,1) — but reversed: b has (1,1)→(1,0)
    const shared1 = a.vertices[1]; // (1,0)
    const shared2 = a.vertices[2]; // (1,1)
    const b = new Polygon([
      shared1, new Point(2, 0), new Point(2, 1), shared2,
    ]);
    expect(a.borders(b)).toBe(true);
  });

  it('cuts polygon into two halves', () => {
    const sq = Polygon.rect(4, 4);
    const p1 = new Point(-5, 0);
    const p2 = new Point(5, 0);
    const halves = sq.cut(p1, p2);
    expect(halves.length).toBe(2);
    // Both halves should have positive area
    expect(Math.abs(halves[0].square)).toBeGreaterThan(0);
    expect(Math.abs(halves[1].square)).toBeGreaterThan(0);
    // Sum of areas should equal original
    expect(Math.abs(halves[0].square) + Math.abs(halves[1].square)).toBeCloseTo(16, 1);
  });

  it('shrinkEq reduces area', () => {
    const sq = Polygon.rect(10, 10);
    const shrunk = sq.shrinkEq(1);
    expect(Math.abs(shrunk.square)).toBeLessThan(Math.abs(sq.square));
    expect(Math.abs(shrunk.square)).toBeGreaterThan(0);
  });

  it('static constructors work', () => {
    const rect = Polygon.rect(3, 2);
    expect(rect.length).toBe(4);

    const regular = Polygon.regular(6, 5);
    expect(regular.length).toBe(6);

    const circle = Polygon.circle(3);
    expect(circle.length).toBe(16);
  });
});
