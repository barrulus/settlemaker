import { Point } from '../types/point.js';
import { pointInPolygon } from '../geom/point-in-polygon.js';

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
