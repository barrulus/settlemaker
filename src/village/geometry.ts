import { Point } from '../types/point.js';
import { pointInPolygon } from '../geom/point-in-polygon.js';
import { GREEN_JOIN_RATIO, RING_SETBACK_M } from './constants.js';
import type { Green, Lane } from './types.js';

/**
 * Bearings are degrees, 0 = North, clockwise, wrapped to [0, 360).
 * North is -y: SVG-native, matching the symbol contract's upVector [0,-1].
 * Every pass uses these — none of them redefines them.
 */
export function wrapDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

export function bearingVector(deg: number): Point {
  const r = (deg * Math.PI) / 180;
  return new Point(Math.sin(r), -Math.cos(r));
}

export function bearingOf(from: Point, to: Point): number {
  return wrapDeg((Math.atan2(to.x - from.x, -(to.y - from.y)) * 180) / Math.PI);
}

/** The shorter way round, 0..180. */
export function angularGap(a: number, b: number): number {
  return Math.abs(((wrapDeg(a) - wrapDeg(b) + 540) % 360) - 180);
}

/**
 * The turn from bearing `a` to bearing `b`, SIGNED and in (-180, 180]:
 * positive is clockwise (rightward, since bearings run 0 = north
 * clockwise), negative anticlockwise. `angularGap` answers "how far apart",
 * this answers "which way" — needed wherever a side of the road behaves
 * differently on the inside of a bend from the outside.
 */
export function signedTurnDeg(a: number, b: number): number {
  return ((wrapDeg(b) - wrapDeg(a) + 540) % 360) - 180;
}

export function unit(dx: number, dy: number): Point {
  const len = Math.hypot(dx, dy);
  return len === 0 ? new Point(0, 0) : new Point(dx / len, dy / len);
}

export function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function polylineLength(points: Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += dist(points[i], points[i - 1]);
  return total;
}

/** Cumulative length at each vertex. Pair it with sampleAt. */
export function arcLengths(points: Point[]): number[] {
  const acc = [0];
  for (let i = 1; i < points.length; i++) acc.push(acc[i - 1] + dist(points[i], points[i - 1]));
  return acc;
}

/** The point at arc-length `s`, and the bearing the polyline runs there. */
export function sampleAt(
  points: Point[], acc: number[], s: number,
): { p: Point; dirDeg: number } {
  const total = acc[acc.length - 1];
  const clamped = Math.min(Math.max(s, 0), total);
  let i = 1;
  while (i < acc.length - 1 && acc[i] < clamped) i++;
  const seg = acc[i] - acc[i - 1] || 1;
  const t = (clamped - acc[i - 1]) / seg;
  const a = points[i - 1];
  const b = points[i];
  return {
    p: new Point(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t),
    dirDeg: bearingOf(a, b),
  };
}

export function inAnyWater(p: Point, water: Point[][]): boolean {
  return water.some((ring) => pointInPolygon(p, ring));
}

/**
 * The closest point to `p` on the segment a—b. Used by the lane-growth
 * loop snap: a branch whose end passes near another lane joins it at this
 * point rather than stopping just short of it.
 */
export function closestPointOnSegment(p: Point, a: Point, b: Point): Point {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  if (len2 === 0) return new Point(a.x, a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2));
  return new Point(a.x + abx * t, a.y + aby * t);
}

/**
 * The green's DRAWN edge (the art fills ~GREEN_JOIN_RATIO of its box), plus
 * the ring setback — the same radius `subdivideGreen` seats the green ring's
 * lot fronts against, and the radius every dressing stage treats as "the
 * turf, keep off". Shared here (I3) because crofts, fields, vegetation and
 * POIs each had a private copy of this two-term expression.
 */
export function greenDrawnRadius(green: Green): number {
  return (green.diameter / 2) * GREEN_JOIN_RATIO + RING_SETBACK_M;
}

/**
 * Whether `p` falls inside `lane`'s corridor: its own half-width plus
 * `marginM`. Callers own the margin — the clearance a hedge stamp needs
 * (EDGE_LANE_CLEAR_M), a tree needs (VEG_LANE_CLEAR_M) and a field strip
 * needs (LANE_SETBACK_M by class) are deliberately different numbers, so
 * only the geometry is shared, never the constant.
 */
export function withinLaneCorridor(p: Point, lane: Lane, marginM: number): boolean {
  if (lane.points.length < 2) return false;
  const clearance = lane.widthM / 2 + marginM;
  for (let i = 1; i < lane.points.length; i++) {
    const q = closestPointOnSegment(p, lane.points[i - 1], lane.points[i]);
    if (dist(p, q) <= clearance) return true;
  }
  return false;
}

/**
 * The intersection point of segments a1—a2 and b1—b2, or null when they do
 * not cross. Touching at a shared endpoint does not count — a branch that
 * STARTS on its parent's centreline must not read as crossing it.
 */
export function segmentIntersection(
  a1: Point, a2: Point, b1: Point, b2: Point,
): Point | null {
  const d1x = a2.x - a1.x;
  const d1y = a2.y - a1.y;
  const d2x = b2.x - b1.x;
  const d2y = b2.y - b1.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-12) return null;
  const t = ((b1.x - a1.x) * d2y - (b1.y - a1.y) * d2x) / denom;
  const u = ((b1.x - a1.x) * d1y - (b1.y - a1.y) * d1x) / denom;
  const EPS = 1e-6;
  if (t <= EPS || t >= 1 - EPS || u <= EPS || u >= 1 - EPS) return null;
  return new Point(a1.x + d1x * t, a1.y + d1y * t);
}
