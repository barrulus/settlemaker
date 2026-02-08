import { Point } from '../types/point.js';
import { sign } from '../utils/math-utils.js';
import { Polygon } from './polygon.js';

/**
 * Delaunay triangulation + Voronoi diagram.
 * Port of Voronoi.hx — incremental Bowyer-Watson algorithm.
 */

export class Triangle {
  p1: Point;
  p2: Point;
  p3: Point;
  c: Point;  // circumcenter
  r: number; // circumradius

  constructor(p1: Point, p2: Point, p3: Point) {
    // Ensure CCW winding
    const s = (p2.x - p1.x) * (p2.y + p1.y) +
              (p3.x - p2.x) * (p3.y + p2.y) +
              (p1.x - p3.x) * (p1.y + p3.y);
    this.p1 = p1;
    this.p2 = s > 0 ? p2 : p3;
    this.p3 = s > 0 ? p3 : p2;

    // Compute circumcenter
    const x1 = (p1.x + p2.x) / 2;
    const y1 = (p1.y + p2.y) / 2;
    const x2 = (p2.x + p3.x) / 2;
    const y2 = (p2.y + p3.y) / 2;

    const dx1 = p1.y - p2.y;
    const dy1 = p2.x - p1.x;
    const dx2 = p2.y - p3.y;
    const dy2 = p3.x - p2.x;

    const tg1 = dy1 / dx1;
    const t2 = ((y1 - y2) - (x1 - x2) * tg1) / (dy2 - dx2 * tg1);

    this.c = new Point(x2 + dx2 * t2, y2 + dy2 * t2);
    this.r = Point.distance(this.c, p1);
  }

  hasEdge(a: Point, b: Point): boolean {
    return (this.p1 === a && this.p2 === b) ||
           (this.p2 === a && this.p3 === b) ||
           (this.p3 === a && this.p1 === b);
  }
}

export class Region {
  seed: Point;
  vertices: Triangle[];

  constructor(seed: Point) {
    this.seed = seed;
    this.vertices = [];
  }

  sortVertices(): Region {
    this.vertices.sort((v1, v2) => this.compareAngles(v1, v2));
    return this;
  }

  center(): Point {
    const c = new Point();
    for (const v of this.vertices) c.addEq(v.c);
    c.scaleEq(1 / this.vertices.length);
    return c;
  }

  /** Check if this region shares an edge with another */
  borders(r: Region): boolean {
    const len1 = this.vertices.length;
    const len2 = r.vertices.length;
    for (let i = 0; i < len1; i++) {
      const j = r.vertices.indexOf(this.vertices[i]);
      if (j !== -1) {
        return this.vertices[(i + 1) % len1] === r.vertices[(j + len2 - 1) % len2];
      }
    }
    return false;
  }

  /** Convert region to a polygon of circumcenters */
  toPolygon(): Polygon {
    return new Polygon(this.vertices.map(tr => tr.c));
  }

  private compareAngles(v1: Triangle, v2: Triangle): number {
    const x1 = v1.c.x - this.seed.x;
    const y1 = v1.c.y - this.seed.y;
    const x2 = v2.c.x - this.seed.x;
    const y2 = v2.c.y - this.seed.y;

    if (x1 >= 0 && x2 < 0) return 1;
    if (x2 >= 0 && x1 < 0) return -1;
    if (x1 === 0 && x2 === 0) {
      return y2 > y1 ? 1 : -1;
    }
    return sign(x2 * y1 - x1 * y2);
  }
}

export class Voronoi {
  triangles: Triangle[];
  points: Point[];
  frame: Point[];

  private _regions: Map<Point, Region>;
  private _regionsDirty: boolean;

  constructor(minx: number, miny: number, maxx: number, maxy: number) {
    this.triangles = [];

    const c1 = new Point(minx, miny);
    const c2 = new Point(minx, maxy);
    const c3 = new Point(maxx, miny);
    const c4 = new Point(maxx, maxy);
    this.frame = [c1, c2, c3, c4];
    this.points = [c1, c2, c3, c4];
    this.triangles.push(new Triangle(c1, c2, c3));
    this.triangles.push(new Triangle(c2, c3, c4));

    this._regions = new Map();
    for (const p of this.points) {
      this._regions.set(p, this.buildRegion(p));
    }
    this._regionsDirty = false;
  }

  addPoint(p: Point): void {
    const toSplit: Triangle[] = [];
    for (const tr of this.triangles) {
      if (Point.distance(p, tr.c) < tr.r) {
        toSplit.push(tr);
      }
    }

    if (toSplit.length > 0) {
      this.points.push(p);

      const a: Point[] = [];
      const b: Point[] = [];
      for (const t1 of toSplit) {
        let e1 = true, e2 = true, e3 = true;
        for (const t2 of toSplit) {
          if (t2 !== t1) {
            if (e1 && t2.hasEdge(t1.p2, t1.p1)) e1 = false;
            if (e2 && t2.hasEdge(t1.p3, t1.p2)) e2 = false;
            if (e3 && t2.hasEdge(t1.p1, t1.p3)) e3 = false;
            if (!(e1 || e2 || e3)) break;
          }
        }
        if (e1) { a.push(t1.p1); b.push(t1.p2); }
        if (e2) { a.push(t1.p2); b.push(t1.p3); }
        if (e3) { a.push(t1.p3); b.push(t1.p1); }
      }

      let index = 0;
      do {
        this.triangles.push(new Triangle(p, a[index], b[index]));
        index = a.indexOf(b[index]);
      } while (index !== 0);

      for (const tr of toSplit) {
        const idx = this.triangles.indexOf(tr);
        if (idx !== -1) this.triangles.splice(idx, 1);
      }

      this._regionsDirty = true;
    }
  }

  private buildRegion(p: Point): Region {
    const r = new Region(p);
    for (const tr of this.triangles) {
      if (tr.p1 === p || tr.p2 === p || tr.p3 === p) {
        r.vertices.push(tr);
      }
    }
    return r.sortVertices();
  }

  get regions(): Map<Point, Region> {
    if (this._regionsDirty) {
      this._regions = new Map();
      this._regionsDirty = false;
      for (const p of this.points) {
        this._regions.set(p, this.buildRegion(p));
      }
    }
    return this._regions;
  }

  private isReal(tr: Triangle): boolean {
    return !(this.frame.includes(tr.p1) ||
             this.frame.includes(tr.p2) ||
             this.frame.includes(tr.p3));
  }

  /** Delaunay triangulation (excluding frame triangles) */
  triangulation(): Triangle[] {
    return this.triangles.filter(tr => this.isReal(tr));
  }

  /** Voronoi partitioning — only regions whose vertices are all "real" */
  partitioning(): Region[] {
    const result: Region[] = [];
    for (const p of this.points) {
      const r = this.regions.get(p)!;
      let isReal = true;
      for (const v of r.vertices) {
        if (!this.isReal(v)) {
          isReal = false;
          break;
        }
      }
      if (isReal) result.push(r);
    }
    return result;
  }

  getNeighbours(r1: Region): Region[] {
    const result: Region[] = [];
    for (const r2 of this.regions.values()) {
      if (r1.borders(r2)) result.push(r2);
    }
    return result;
  }

  static relax(voronoi: Voronoi, toRelax?: Point[]): Voronoi {
    const regions = voronoi.partitioning();
    const points = voronoi.points.slice();

    // Remove frame points
    for (const p of voronoi.frame) {
      const idx = points.indexOf(p);
      if (idx !== -1) points.splice(idx, 1);
    }

    if (!toRelax) toRelax = voronoi.points;

    for (const r of regions) {
      if (toRelax.includes(r.seed)) {
        const idx = points.indexOf(r.seed);
        if (idx !== -1) points.splice(idx, 1);
        points.push(r.center());
      }
    }

    return Voronoi.build(points);
  }

  static build(vertices: Point[]): Voronoi {
    let minx = 1e10, miny = 1e10;
    let maxx = -1e9, maxy = -1e9;
    for (const v of vertices) {
      if (v.x < minx) minx = v.x;
      if (v.y < miny) miny = v.y;
      if (v.x > maxx) maxx = v.x;
      if (v.y > maxy) maxy = v.y;
    }
    const dx = (maxx - minx) * 0.5;
    const dy = (maxy - miny) * 0.5;

    const voronoi = new Voronoi(minx - dx / 2, miny - dy / 2, maxx + dx / 2, maxy + dy / 2);
    for (const v of vertices) {
      voronoi.addPoint(v);
    }
    return voronoi;
  }
}
