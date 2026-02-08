import { describe, it, expect } from 'vitest';
import { Point } from '../src/types/point.js';
import { Voronoi } from '../src/geom/voronoi.js';

describe('Voronoi', () => {
  it('builds from a set of points', () => {
    const points = [
      new Point(0, 0),
      new Point(10, 0),
      new Point(0, 10),
      new Point(10, 10),
      new Point(5, 5),
    ];
    const v = Voronoi.build(points);
    expect(v.points.length).toBeGreaterThan(points.length); // includes frame
    expect(v.triangles.length).toBeGreaterThan(0);
  });

  it('produces regions via partitioning', () => {
    const points = [
      new Point(0, 0),
      new Point(10, 0),
      new Point(0, 10),
      new Point(10, 10),
      new Point(5, 5),
    ];
    const v = Voronoi.build(points);
    const regions = v.partitioning();
    expect(regions.length).toBeGreaterThan(0);
    expect(regions.length).toBeLessThanOrEqual(points.length);
  });

  it('relax produces a valid voronoi', () => {
    const points: Point[] = [];
    for (let i = 0; i < 20; i++) {
      points.push(new Point(Math.cos(i) * 10 + 50, Math.sin(i) * 10 + 50));
    }
    const v1 = Voronoi.build(points);
    expect(v1.partitioning().length).toBeGreaterThan(0);
    const v2 = Voronoi.relax(v1);
    // Relaxed voronoi should have triangles and points
    expect(v2.triangles.length).toBeGreaterThan(0);
    expect(v2.points.length).toBeGreaterThan(0);
  });

  it('triangulation excludes frame triangles', () => {
    const points = [
      new Point(0, 0), new Point(10, 0),
      new Point(0, 10), new Point(10, 10),
    ];
    const v = Voronoi.build(points);
    const tris = v.triangulation();
    // Frame triangles should be excluded
    for (const tr of tris) {
      expect(v.frame.includes(tr.p1)).toBe(false);
      expect(v.frame.includes(tr.p2)).toBe(false);
      expect(v.frame.includes(tr.p3)).toBe(false);
    }
  });
});
