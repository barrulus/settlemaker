import { Point } from '../types/point.js';
import { cross, intersectLines } from './geom-utils.js';
import { sign } from '../utils/math-utils.js';

const DELTA = 0.000001;

/**
 * Polygon — ordered list of Point vertices.
 * Port of Polygon.hx. Uses identity-based (===) vertex comparison
 * to match Haxe reference semantics.
 */
export class Polygon {
  vertices: Point[];

  constructor(vertices?: Point[]) {
    this.vertices = vertices ? vertices.slice() : [];
  }

  get length(): number {
    return this.vertices.length;
  }

  /** Overwrite this polygon's vertex positions from another polygon */
  setPositions(p: Polygon): void {
    for (let i = 0; i < p.length; i++) {
      this.vertices[i].set(p.vertices[i]);
    }
  }

  /** Signed area (positive = CCW) */
  get square(): number {
    const verts = this.vertices;
    const len = verts.length;
    if (len < 3) return 0;
    let v1 = verts[len - 1];
    let v2 = verts[0];
    let s = v1.x * v2.y - v2.x * v1.y;
    for (let i = 1; i < len; i++) {
      v1 = v2;
      v2 = verts[i];
      s += v1.x * v2.y - v2.x * v1.y;
    }
    return s * 0.5;
  }

  get perimeter(): number {
    let len = 0;
    this.forEdge((v0, v1) => {
      len += Point.distance(v0, v1);
    });
    return len;
  }

  /** Compactness ratio: 1.0 for circle, ~0.79 for square, ~0.60 for triangle */
  get compactness(): number {
    const p = this.perimeter;
    return 4 * Math.PI * this.square / (p * p);
  }

  /** Average of vertices (fast centroid approximation) */
  get center(): Point {
    const c = new Point();
    for (const v of this.vertices) c.addEq(v);
    c.scaleEq(1 / this.vertices.length);
    return c;
  }

  /** True geometric centroid */
  get centroid(): Point {
    let x = 0, y = 0, a = 0;
    this.forEdge((v0, v1) => {
      const f = cross(v0.x, v0.y, v1.x, v1.y);
      a += f;
      x += (v0.x + v1.x) * f;
      y += (v0.y + v1.y) * f;
    });
    const s6 = 1 / (3 * a);
    return new Point(s6 * x, s6 * y);
  }

  /** Identity-based containment check */
  contains(v: Point): boolean {
    return this.vertices.indexOf(v) !== -1;
  }

  indexOf(v: Point, fromIndex?: number): number {
    return this.vertices.indexOf(v, fromIndex);
  }

  lastIndexOf(v: Point): number {
    return this.vertices.lastIndexOf(v);
  }

  /** Iterate over each edge (wrapping last→first) */
  forEdge(f: (v0: Point, v1: Point) => void): void {
    const len = this.vertices.length;
    for (let i = 0; i < len; i++) {
      f(this.vertices[i], this.vertices[(i + 1) % len]);
    }
  }

  /** Iterate over segments (no wrap) */
  forSegment(f: (v0: Point, v1: Point) => void): void {
    for (let i = 0; i < this.vertices.length - 1; i++) {
      f(this.vertices[i], this.vertices[i + 1]);
    }
  }

  /** Offset all vertices by (dx, dy) */
  offset(p: Point): void {
    for (const v of this.vertices) {
      v.offset(p.x, p.y);
    }
  }

  /** Rotate all vertices around origin */
  rotate(a: number): void {
    const cosA = Math.cos(a);
    const sinA = Math.sin(a);
    for (const v of this.vertices) {
      const vx = v.x * cosA - v.y * sinA;
      const vy = v.y * cosA + v.x * sinA;
      v.setTo(vx, vy);
    }
  }

  isConvexVertexi(i: number): boolean {
    const len = this.vertices.length;
    const v0 = this.vertices[(i + len - 1) % len];
    const v1 = this.vertices[i];
    const v2 = this.vertices[(i + 1) % len];
    return cross(v1.x - v0.x, v1.y - v0.y, v2.x - v1.x, v2.y - v1.y) > 0;
  }

  isConvexVertex(v1: Point): boolean {
    const v0 = this.prev(v1);
    const v2 = this.next(v1);
    return cross(v1.x - v0.x, v1.y - v0.y, v2.x - v1.x, v2.y - v1.y) > 0;
  }

  isConvex(): boolean {
    for (const v of this.vertices) {
      if (!this.isConvexVertex(v)) return false;
    }
    return true;
  }

  smoothVertexi(i: number, f: number = 1.0): Point {
    const len = this.vertices.length;
    const v = this.vertices[i];
    const p = this.vertices[(i + len - 1) % len];
    const n = this.vertices[(i + 1) % len];
    return new Point(
      (p.x + v.x * f + n.x) / (2 + f),
      (p.y + v.y * f + n.y) / (2 + f),
    );
  }

  smoothVertex(v: Point, f: number = 1.0): Point {
    const p = this.prev(v);
    const n = this.next(v);
    return new Point(
      (p.x + v.x * f + n.x) / (2 + f),
      (p.y + v.y * f + n.y) / (2 + f),
    );
  }

  /** Minimum vertex distance to a point (not true polygon distance) */
  distance(p: Point): number {
    let d = Point.distance(this.vertices[0], p);
    for (let i = 1; i < this.vertices.length; i++) {
      const d1 = Point.distance(this.vertices[i], p);
      if (d1 < d) d = d1;
    }
    return d;
  }

  /** Return a new polygon with all vertices smoothed */
  smoothVertexEq(f: number = 1.0): Polygon {
    const len = this.vertices.length;
    const result: Point[] = [];
    let v1 = this.vertices[len - 1];
    let v2 = this.vertices[0];
    for (let i = 0; i < len; i++) {
      const v0 = v1;
      v1 = v2;
      v2 = this.vertices[(i + 1) % len];
      result.push(new Point(
        (v0.x + v1.x * f + v2.x) / (2 + f),
        (v0.y + v1.y * f + v2.y) / (2 + f),
      ));
    }
    return new Polygon(result);
  }

  /** Remove edges shorter than threshold */
  filterShort(threshold: number): Polygon {
    let i = 1;
    let v0 = this.vertices[0];
    let v1 = this.vertices[1];
    const result = [v0];
    do {
      do {
        v1 = this.vertices[i++];
      } while (Point.distance(v0, v1) < threshold && i < this.vertices.length);
      result.push(v0 = v1);
    } while (i < this.vertices.length);
    return new Polygon(result);
  }

  /** Inset one edge defined by its first vertex */
  inset(p1: Point, d: number): void {
    const verts = this.vertices;
    const i1 = verts.indexOf(p1);
    const i0 = i1 > 0 ? i1 - 1 : verts.length - 1;
    const p0 = verts[i0];
    const i2 = i1 < verts.length - 1 ? i1 + 1 : 0;
    const p2 = verts[i2];
    const i3 = i2 < verts.length - 1 ? i2 + 1 : 0;
    const p3 = verts[i3];

    const vec0 = p1.subtract(p0);
    const vec1 = p2.subtract(p1);
    const vec2 = p3.subtract(p2);

    let cos = vec0.dot(vec1) / vec0.length / vec1.length;
    let z = vec0.x * vec1.y - vec0.y * vec1.x;
    let t = d / Math.sqrt(1 - cos * cos);
    if (z > 0) {
      t = Math.min(t, vec0.length * 0.99);
    } else {
      t = Math.min(t, vec1.length * 0.5);
    }
    t *= sign(z);
    verts[i1] = p1.subtract(vec0.norm(t));

    cos = vec1.dot(vec2) / vec1.length / vec2.length;
    z = vec1.x * vec2.y - vec1.y * vec2.x;
    t = d / Math.sqrt(1 - cos * cos);
    if (z > 0) {
      t = Math.min(t, vec2.length * 0.99);
    } else {
      t = Math.min(t, vec1.length * 0.5);
    }
    verts[i2] = p2.add(vec2.norm(t));
  }

  insetAll(d: number[]): Polygon {
    const p = new Polygon(this.vertices);
    for (let i = 0; i < p.length; i++) {
      if (d[i] !== 0) p.inset(p.vertices[i], d[i]);
    }
    return p;
  }

  insetEq(d: number): void {
    for (let i = 0; i < this.vertices.length; i++) {
      this.inset(this.vertices[i], d);
    }
  }

  /** Buffer all edges by distances. Handles self-intersection. */
  buffer(d: number[]): Polygon {
    const q = new Polygon();
    let i = 0;
    this.forEdge((v0, v1) => {
      const dd = d[i++];
      if (dd === 0) {
        q.push(v0);
        q.push(v1);
      } else {
        const v = v1.subtract(v0);
        const n = v.rotate90().norm(dd);
        q.push(v0.add(n));
        q.push(v1.add(n));
      }
    });

    // Resolve self-intersections
    let wasCut: boolean;
    let lastEdge = 0;
    do {
      wasCut = false;
      const n = q.length;
      for (let ii = lastEdge; ii < n - 2; ii++) {
        lastEdge = ii;

        const p11 = q.vertices[ii];
        const p12 = q.vertices[ii + 1];
        const x1 = p11.x;
        const y1 = p11.y;
        const dx1 = p12.x - x1;
        const dy1 = p12.y - y1;

        for (let j = ii + 2; j < (ii > 0 ? n : n - 1); j++) {
          const p21 = q.vertices[j];
          const p22 = j < n - 1 ? q.vertices[j + 1] : q.vertices[0];
          const x2 = p21.x;
          const y2 = p21.y;
          const dx2 = p22.x - x2;
          const dy2 = p22.y - y2;

          const int = intersectLines(x1, y1, dx1, dy1, x2, y2, dx2, dy2);
          if (int !== null && int.x > DELTA && int.x < 1 - DELTA && int.y > DELTA && int.y < 1 - DELTA) {
            const pn = new Point(x1 + dx1 * int.x, y1 + dy1 * int.x);
            q.vertices.splice(j + 1, 0, pn);
            q.vertices.splice(ii + 1, 0, pn);
            wasCut = true;
            break;
          }
        }
        if (wasCut) break;
      }
    } while (wasCut);

    // Find the biggest part
    const regular: number[] = [];
    for (let ii = 0; ii < q.length; ii++) regular.push(ii);

    let bestPart: Polygon | null = null;
    let bestPartSq = -Infinity;

    while (regular.length > 0) {
      const indices: number[] = [];
      const start = regular[0];
      let idx = start;
      do {
        indices.push(idx);
        const regIdx = regular.indexOf(idx);
        if (regIdx !== -1) regular.splice(regIdx, 1);

        const nextIdx = (idx + 1) % q.length;
        const v = q.vertices[nextIdx];
        const next1 = q.vertices.indexOf(v);
        const next1Last = q.vertices.lastIndexOf(v);
        idx = (next1 !== nextIdx && next1 !== -1) ? next1 : (next1Last !== nextIdx && next1Last !== -1) ? next1Last : nextIdx;
      } while (idx !== start);

      const part = new Polygon(indices.map(ii => q.vertices[ii]));
      const s = part.square;
      if (s > bestPartSq) {
        bestPart = part;
        bestPartSq = s;
      }
    }

    return bestPart!;
  }

  bufferEq(d: number): Polygon {
    return this.buffer(this.vertices.map(() => d));
  }

  /** Shrink by cutting edges inward. Works well for convex polygons. */
  shrink(d: number[]): Polygon {
    let q = new Polygon(this.vertices);
    let i = 0;
    this.forEdge((v1, v2) => {
      const dd = d[i++];
      if (dd > 0) {
        const v = v2.subtract(v1);
        const n = v.rotate90().norm(dd);
        const halves = q.cut(v1.add(n), v2.add(n), 0);
        q = halves[0];
      }
    });
    return q;
  }

  shrinkEq(d: number): Polygon {
    return this.shrink(this.vertices.map(() => d));
  }

  /** Cut a peel along one edge */
  peel(v1: Point, d: number): Polygon {
    const i1 = this.vertices.indexOf(v1);
    const i2 = i1 === this.vertices.length - 1 ? 0 : i1 + 1;
    const v2 = this.vertices[i2];

    const v = v2.subtract(v1);
    const n = v.rotate90().norm(d);

    return this.cut(v1.add(n), v2.add(n), 0)[0];
  }

  /** Simplify polygon to n vertices by removing least-significant ones */
  simplify(n: number): void {
    let len = this.vertices.length;
    while (len > n) {
      let result = 0;
      let min = Infinity;

      let b = this.vertices[len - 1];
      let c = this.vertices[0];
      for (let i = 0; i < len; i++) {
        const a = b;
        b = c;
        c = this.vertices[(i + 1) % len];
        const measure = Math.abs(a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
        if (measure < min) {
          result = i;
          min = measure;
        }
      }

      this.vertices.splice(result, 1);
      len--;
    }
  }

  /** Find edge index where a→b is an edge */
  findEdge(a: Point, b: Point): number {
    const index = this.vertices.indexOf(a);
    return (index !== -1 && this.vertices[(index + 1) % this.vertices.length] === b) ? index : -1;
  }

  next(a: Point): Point {
    return this.vertices[(this.vertices.indexOf(a) + 1) % this.vertices.length];
  }

  prev(a: Point): Point {
    const len = this.vertices.length;
    return this.vertices[(this.vertices.indexOf(a) + len - 1) % len];
  }

  /** Direction vector from vertex a to its next */
  vector(v: Point): Point {
    return this.next(v).subtract(v);
  }

  vectori(i: number): Point {
    return this.vertices[i === this.vertices.length - 1 ? 0 : i + 1].subtract(this.vertices[i]);
  }

  /** Check if this polygon shares an edge with another */
  borders(another: Polygon): boolean {
    const len1 = this.vertices.length;
    const len2 = another.vertices.length;
    for (let i = 0; i < len1; i++) {
      const j = another.vertices.indexOf(this.vertices[i]);
      if (j !== -1) {
        const nextV = this.vertices[(i + 1) % len1];
        if (nextV === another.vertices[(j + 1) % len2] ||
            nextV === another.vertices[(j + len2 - 1) % len2]) {
          return true;
        }
      }
    }
    return false;
  }

  getBounds(): { left: number; right: number; top: number; bottom: number } {
    let left = this.vertices[0].x;
    let right = left;
    let top = this.vertices[0].y;
    let bottom = top;
    for (const v of this.vertices) {
      left = Math.min(left, v.x);
      right = Math.max(right, v.x);
      top = Math.min(top, v.y);
      bottom = Math.max(bottom, v.y);
    }
    return { left, right, top, bottom };
  }

  split(p1: Point, p2: Point): Polygon[] {
    return this.spliti(this.vertices.indexOf(p1), this.vertices.indexOf(p2));
  }

  spliti(i1: number, i2: number): Polygon[] {
    if (i1 > i2) {
      const t = i1;
      i1 = i2;
      i2 = t;
    }
    return [
      new Polygon(this.vertices.slice(i1, i2 + 1)),
      new Polygon(this.vertices.slice(i2).concat(this.vertices.slice(0, i1 + 1))),
    ];
  }

  /** Cut polygon by a line through p1→p2 */
  cut(p1: Point, p2: Point, gap: number = 0): Polygon[] {
    const x1 = p1.x;
    const y1 = p1.y;
    const dx1 = p2.x - x1;
    const dy1 = p2.y - y1;

    const len = this.vertices.length;
    let edge1 = 0, ratio1 = 0;
    let edge2 = 0, ratio2 = 0;
    let cnt = 0;

    for (let i = 0; i < len; i++) {
      const v0 = this.vertices[i];
      const v1 = this.vertices[(i + 1) % len];

      const x2 = v0.x;
      const y2 = v0.y;
      const dx2 = v1.x - x2;
      const dy2 = v1.y - y2;

      const t = intersectLines(x1, y1, dx1, dy1, x2, y2, dx2, dy2);
      if (t !== null && t.y >= 0 && t.y <= 1) {
        if (cnt === 0) {
          edge1 = i;
          ratio1 = t.x;
        } else if (cnt === 1) {
          edge2 = i;
          ratio2 = t.x;
        }
        cnt++;
      }
    }

    if (cnt === 2) {
      const dir = p2.subtract(p1);
      const point1 = p1.add(dir.scale(ratio1));
      const point2 = p1.add(dir.scale(ratio2));

      const half1 = new Polygon(this.vertices.slice(edge1 + 1, edge2 + 1));
      half1.vertices.unshift(point1);
      half1.vertices.push(point2);

      const half2 = new Polygon(
        this.vertices.slice(edge2 + 1).concat(this.vertices.slice(0, edge1 + 1)),
      );
      half2.vertices.unshift(point2);
      half2.vertices.push(point1);

      let h1 = half1;
      let h2 = half2;
      if (gap > 0) {
        h1 = half1.peel(point2, gap / 2);
        h2 = half2.peel(point1, gap / 2);
      }

      const v = this.vectori(edge1);
      return cross(dx1, dy1, v.x, v.y) > 0 ? [h1, h2] : [h2, h1];
    } else {
      return [new Polygon(this.vertices)];
    }
  }

  /** Inverse-distance interpolation weights for a point */
  interpolate(p: Point): number[] {
    let sum = 0;
    const dd = this.vertices.map(v => {
      const d = 1 / Point.distance(v, p);
      sum += d;
      return d;
    });
    return dd.map(d => d / sum);
  }

  // Array-like operations
  push(v: Point): void {
    this.vertices.push(v);
  }

  unshift(v: Point): void {
    this.vertices.unshift(v);
  }

  pop(): Point | undefined {
    return this.vertices.pop();
  }

  splice(start: number, deleteCount: number, ...items: Point[]): Point[] {
    return this.vertices.splice(start, deleteCount, ...items);
  }

  filter(fn: (v: Point) => boolean): Point[] {
    return this.vertices.filter(fn);
  }

  copy(): Point[] {
    return this.vertices.slice();
  }

  last(): Point {
    return this.vertices[this.vertices.length - 1];
  }

  // Static constructors
  static rect(w: number = 1, h: number = 1): Polygon {
    return new Polygon([
      new Point(-w / 2, -h / 2),
      new Point(w / 2, -h / 2),
      new Point(w / 2, h / 2),
      new Point(-w / 2, h / 2),
    ]);
  }

  static regular(n: number = 8, r: number = 1): Polygon {
    const verts: Point[] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      verts.push(new Point(r * Math.cos(a), r * Math.sin(a)));
    }
    return new Polygon(verts);
  }

  static circle(r: number = 1): Polygon {
    return Polygon.regular(16, r);
  }
}
