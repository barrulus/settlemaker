import { Point } from '../../types/point.js';

/**
 * GATE 8.3: the planar half of the field system -- convex-polygon algebra
 * with no bearings, no radii and no reference to the green in it anywhere.
 *
 * The engine's whole field frame was POLAR until this gate: a parcel was an
 * annular sector, both its long edges curving about the village centre and
 * both its short ones pointing at it. Gates 8.1 and 8.2 varied every
 * parameter inside that frame and the owner's complaint survived all of it,
 * because the circularity was in the COORDINATE SYSTEM (the same lesson
 * gate 8 learned about the village body). So the farmland is now cut by
 * STRAIGHT LINES out of a polygon region, and this module is the cutting.
 *
 * Everything here works on CONVEX polygons, and that is load-bearing rather
 * than incidental: a half-plane is convex, Sutherland-Hodgman clipping is
 * exact for a convex subject, and the two pieces of a convex polygon cut by
 * a line are themselves convex. So the invariant holds all the way down the
 * recursion, from the region's own convex hull to the last parcel, and no
 * general polygon-boolean is needed anywhere.
 *
 * There is a recursive-bisection precedent in the OLD city engine
 * (`createAlleys`, `src/wards/ward.ts`): pick a cut across the longest
 * edge, jitter the angle, split off-centre, recurse while the piece is too
 * big. The pattern is borrowed; the code is not, because the village engine
 * imports nothing from `src/generator` or `src/wards`.
 */

/** Signed-area magnitude of a simple polygon. */
export function polygonArea(poly: Point[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

/** Area centroid; falls back to the vertex mean for a degenerate polygon. */
export function polygonCentroid(poly: Point[]): Point {
  let s = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const cross = a.x * b.y - b.x * a.y;
    s += cross;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }
  if (Math.abs(s) < 1e-12) {
    let mx = 0;
    let my = 0;
    for (const p of poly) { mx += p.x; my += p.y; }
    return new Point(mx / poly.length, my / poly.length);
  }
  return new Point(cx / (3 * s), cy / (3 * s));
}

/**
 * Sutherland-Hodgman against ONE half-plane: keep the points with
 * `nx*x + ny*y <= c`. Exact for a convex subject, which is the invariant
 * this module maintains. Returns [] when nothing survives.
 */
export function clipHalfPlane(
  poly: Point[], nx: number, ny: number, c: number,
): Point[] {
  if (poly.length === 0) return [];
  const out: Point[] = [];
  const value = (p: Point): number => nx * p.x + ny * p.y - c;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const va = value(a);
    const vb = value(b);
    if (va <= 0) out.push(a);
    if ((va < 0 && vb > 0) || (va > 0 && vb < 0)) {
      const t = va / (va - vb);
      out.push(new Point(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t));
    }
  }
  // Drop vertices duplicated by a cut that grazes a corner.
  const cleaned: Point[] = [];
  for (const p of out) {
    const last = cleaned[cleaned.length - 1];
    if (last && Math.hypot(last.x - p.x, last.y - p.y) < 1e-9) continue;
    cleaned.push(p);
  }
  if (cleaned.length > 2) {
    const first = cleaned[0];
    const last = cleaned[cleaned.length - 1];
    if (Math.hypot(first.x - last.x, first.y - last.y) < 1e-9) cleaned.pop();
  }
  return cleaned.length >= 3 ? cleaned : [];
}

/** Shrink a convex polygon by `d` metres on every side -- the baulk between
 * two parcels, and the only reason a field boundary is VISIBLE at all in a
 * render that outlines nothing. */
export function insetConvex(poly: Point[], d: number): Point[] {
  if (d <= 0) return poly;
  // Orientation decides which way the edge normals point.
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += a.x * b.y - b.x * a.y;
  }
  const sign = s >= 0 ? 1 : -1;
  let cur = poly;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const len = Math.hypot(ex, ey);
    if (len < 1e-9) continue;
    // Outward normal of edge a->b for this orientation.
    const nx = (sign * ey) / len;
    const ny = (-sign * ex) / len;
    cur = clipHalfPlane(cur, nx, ny, nx * a.x + ny * a.y - d);
    if (cur.length === 0) return [];
  }
  return cur;
}

/**
 * The direction the polygon is LONGEST in, degrees clockwise from north
 * (the engine's bearing convention).
 *
 * Defined as the PERPENDICULAR of the direction of least extent -- the
 * rotating-calipers reading -- not as the direction of greatest extent,
 * which is a different and wrong answer: the widest projection of a 100 x
 * 10 rectangle is its DIAGONAL, so "greatest extent" calls a rectangle long
 * at six degrees off its own length. Brute force over 2-degree steps rather
 * than principal axes: a parcel has at most a dozen vertices, the cost is
 * nothing, and no interpretation of second moments sits in between.
 */
export function longAxisDeg(poly: Point[]): number {
  let bestDeg = 0;
  let bestSpan = Infinity;
  for (let deg = 0; deg < 180; deg += 2) {
    const r = (deg * Math.PI) / 180;
    const dx = Math.sin(r);
    const dy = -Math.cos(r);
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of poly) {
      const t = p.x * dx + p.y * dy;
      if (t < lo) lo = t;
      if (t > hi) hi = t;
    }
    if (hi - lo < bestSpan) { bestSpan = hi - lo; bestDeg = deg; }
  }
  return (bestDeg + 90) % 180;
}

/**
 * The bearing of the polygon's LONGEST EDGE, degrees clockwise from north.
 *
 * This -- not the long axis -- is what a cut's orientation is taken from,
 * for the same reason `createAlleys` picks the longest edge in the old city
 * engine: cutting ACROSS the longest edge (i.e. with the cut's normal along
 * it) turns a rectangle into two rectangles, and keeps a quadrilateral a
 * quadrilateral. The first draft cut across the direction of greatest
 * EXTENT instead, and on a hull whose sides run every which way it
 * shattered the region into acute triangles -- forty of them beside a
 * village reads as broken glass, not as farmland.
 */
export function longestEdgeDeg(poly: Point[]): number {
  let best = 0;
  let bestLen = -1;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len > bestLen) {
      bestLen = len;
      best = (Math.atan2(b.x - a.x, -(b.y - a.y)) * 180) / Math.PI;
    }
  }
  return ((best % 360) + 360) % 360;
}

/** The polygon's extent along `deg`: [min, max] of the projection. */
export function extentAlong(poly: Point[], deg: number): { lo: number; hi: number; nx: number; ny: number } {
  const r = (deg * Math.PI) / 180;
  const nx = Math.sin(r);
  const ny = -Math.cos(r);
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of poly) {
    const t = p.x * nx + p.y * ny;
    if (t < lo) lo = t;
    if (t > hi) hi = t;
  }
  return { lo, hi, nx, ny };
}

/**
 * Cut a convex polygon with the straight line whose NORMAL runs along
 * `normalDeg`, placed at fraction `t` of the polygon's own extent in that
 * direction, with `gapM` of ground taken out either side of the line.
 *
 * The gap is what makes the cut a TRACK rather than a shared boundary --
 * it is how a road corridor is taken out of the region and how a headland
 * is left between two courses of the same field. Returns 0, 1 or 2 pieces,
 * every one of them convex.
 */
export function cutConvex(
  poly: Point[], normalDeg: number, t: number, gapM = 0,
): Point[][] {
  const { lo, hi, nx, ny } = extentAlong(poly, normalDeg);
  const at = lo + (hi - lo) * t;
  const half = gapM / 2;
  const pieces: Point[][] = [];
  const a = clipHalfPlane(poly, nx, ny, at - half);
  const b = clipHalfPlane(poly, -nx, -ny, -(at + half));
  if (a.length >= 3) pieces.push(a);
  if (b.length >= 3) pieces.push(b);
  return pieces;
}

/**
 * Cut a convex polygon by the straight line through `p` running along
 * `dirDeg`, leaving `halfWidthM` of ground clear either side of it: the
 * ROAD CORRIDOR cut. Pieces come back in no particular order; both are
 * convex, and a polygon the line misses comes back whole.
 */
export function cutCorridor(
  poly: Point[], p: Point, dirDeg: number, halfWidthM: number,
): Point[][] {
  const r = ((dirDeg + 90) * Math.PI) / 180;
  const nx = Math.sin(r);
  const ny = -Math.cos(r);
  const at = nx * p.x + ny * p.y;
  const pieces: Point[][] = [];
  const a = clipHalfPlane(poly, nx, ny, at - halfWidthM);
  const b = clipHalfPlane(poly, -nx, -ny, -(at + halfWidthM));
  if (a.length >= 3) pieces.push(a);
  if (b.length >= 3) pieces.push(b);
  return pieces;
}

/** Andrew's monotone chain. The farmland region's outer boundary is the
 * hull of a ring of jittered points, which is what keeps every descendant
 * of the recursion convex. */
export function convexHull(points: Point[]): Point[] {
  const pts = points.slice().sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  if (pts.length < 3) return pts;
  const cross = (o: Point, a: Point, b: Point): number => (
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  );
  const lower: Point[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Point[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}
