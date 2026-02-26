import { Point } from '../types/point.js';

/**
 * Intersect two lines defined by point+direction.
 * Returns a Point where x=t1, y=t2 (parametric values), or null if parallel.
 */
export function intersectLines(
  x1: number, y1: number, dx1: number, dy1: number,
  x2: number, y2: number, dx2: number, dy2: number,
): Point | null {
  const d = dx1 * dy2 - dy1 * dx2;
  if (d === 0) return null;

  const t2 = (dy1 * (x2 - x1) - dx1 * (y2 - y1)) / d;
  const t1 = dx1 !== 0
    ? (x2 - x1 + dx2 * t2) / dx1
    : (y2 - y1 + dy2 * t2) / dy1;

  return new Point(t1, t2);
}

/** Linear interpolation between two points */
export function interpolate(p1: Point, p2: Point, ratio: number = 0.5): Point {
  const d = p2.subtract(p1);
  return new Point(p1.x + d.x * ratio, p1.y + d.y * ratio);
}

/** Dot product of two 2D vectors */
export function scalar(x1: number, y1: number, x2: number, y2: number): number {
  return x1 * x2 + y1 * y2;
}

/** Cross product (z-component) of two 2D vectors */
export function cross(x1: number, y1: number, x2: number, y2: number): number {
  return x1 * y2 - y1 * x2;
}

/**
 * Convex hull via incremental insertion.
 * Port of Gb.convexHull from watabou reference.
 */
export function convexHull(pts: Point[]): Point[] {
  const n = pts.length;
  if (n < 3) return pts.slice();
  if (n === 3) return pts.slice();

  const a = pts[0], b = pts[1], c = pts[2];
  const orient = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
  const hull: Point[] = orient > 0 ? [c, a, b, c] : [c, b, a, c];

  let idx = 3;
  outer: while (true) {
    if (idx >= n) {
      if (hull[0] === hull[hull.length - 1]) hull.pop();
      return hull;
    }
    const p = pts[idx++];
    const h0 = hull[0], h1 = hull[1];
    const left = (h0.x - p.x) * (h1.y - p.y) - (h1.x - p.x) * (h0.y - p.y) >= 0;
    if (left) {
      const hLast = hull[hull.length - 1], hPrev = hull[hull.length - 2];
      const rightEnd = (hLast.x - hPrev.x) * (p.y - hPrev.y) - (p.x - hPrev.x) * (hLast.y - hPrev.y) >= 0;
      if (left && rightEnd) {
        if (idx >= n) {
          if (hull[0] === hull[hull.length - 1]) hull.pop();
          return hull;
        }
        continue outer;
      }
    }
    // Remove from back
    while (hull.length >= 2) {
      const hPrev = hull[hull.length - 2], hLast = hull[hull.length - 1];
      if ((hLast.x - hPrev.x) * (p.y - hPrev.y) - (p.x - hPrev.x) * (hLast.y - hPrev.y) < 0) break;
      hull.pop();
    }
    hull.push(p);
    // Remove from front
    while (true) {
      const hh0 = hull[0], hh1 = hull[1];
      if ((hh0.x - p.x) * (hh1.y - p.y) - (hh1.x - p.x) * (hh0.y - p.y) >= 0) break;
      hull.shift();
    }
    hull.unshift(p);
  }
}

/**
 * Oriented Bounding Box — returns 4 corner Points of the minimum-area bounding rectangle.
 * Port of Gb.obb from watabou reference (rotating calipers on convex hull).
 */
export function obb(poly: Point[]): Point[] {
  const hull = convexHull(poly);
  const f = hull.length;
  let bestArea = Infinity;
  let bestBox: Point[] | null = null;
  let bestDir: Point | null = null;

  for (let i = 0; i < f; i++) {
    const p0 = hull[i];
    const p1 = hull[(i + 1) % f];
    if (p0.x === p1.x && p0.y === p1.y) continue;

    const dir = p1.subtract(p0);
    dir.normalize(1);
    const ax = dir.x;
    const ay = -dir.y; // note: Haxe uses g = -n.y (perpendicular component sign)

    let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
    for (const pt of hull) {
      const u = pt.x * ax - pt.y * ay;
      const v = pt.y * ax + pt.x * ay;
      if (u < minU) minU = u;
      if (v < minV) minV = v;
      if (u > maxU) maxU = u;
      if (v > maxV) maxV = v;
    }

    const area = (maxU - minU) * (maxV - minV);
    if (area < bestArea) {
      bestArea = area;
      bestBox = [
        new Point(minU, minV),
        new Point(maxU, minV),
        new Point(maxU, maxV),
        new Point(minU, maxV),
      ];
      bestDir = dir;
    }
  }

  if (!bestBox || !bestDir) return poly.slice(0, 4);

  // Rotate back: asRotateYX(box, dir.y, dir.x)
  const sy = bestDir.y, cx = bestDir.x;
  for (const pt of bestBox) {
    const rx = pt.x * cx - pt.y * sy;
    const ry = pt.y * cx + pt.x * sy;
    pt.setTo(rx, ry);
  }

  return bestBox;
}

/**
 * Pierce a polygon with a line from p1 to p2, returning all intersection points
 * sorted along the line direction.
 * Port of gd.pierce from watabou reference.
 */
export function pierce(poly: Point[], p1: Point, p2: Point): Point[] {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const n = poly.length;
  const params: number[] = [];

  for (let i = 0; i < n; i++) {
    const v0 = poly[i];
    const v1 = poly[(i + 1) % n];
    const t = intersectLines(p1.x, p1.y, dx, dy, v0.x, v0.y, v1.x - v0.x, v1.y - v0.y);
    if (t !== null && t.y >= 0 && t.y <= 1) {
      params.push(t.x);
    }
  }

  params.sort((a, b) => a - b);
  return params.map(t => interpolate(p1, p2, t));
}

/** Signed distance from point (x0,y0) to line through (x1,y1) with direction (dx1,dy1) */
export function distance2line(
  x1: number, y1: number, dx1: number, dy1: number,
  x0: number, y0: number,
): number {
  return (dx1 * y0 - dy1 * x0 + (y1 + dy1) * x1 - (x1 + dx1) * y1) / Math.sqrt(dx1 * dx1 + dy1 * dy1);
}
