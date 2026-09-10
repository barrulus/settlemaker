import { Point } from '../../types/point.js';
import { angularGap, bearingOf, closestPointOnSegment, dist } from '../geometry.js';
import type { Lane } from '../types.js';

export const CURVE_CHORD_ERROR_M = 0.12;
export const CURVE_CORNER_CUT_M = 6;
export const SNAP_MAX_TURN_DEG = 70;

/** A snap may continue or turn a lane, never turn back along its own approach. */
export function forwardJoin(previous: Point, end: Point, target: Point): boolean {
  return dist(end, target) < 0.05 || angularGap(bearingOf(previous, end), bearingOf(end, target)) <= SNAP_MAX_TURN_DEG;
}

function quadratic(a: Point, b: Point, c: Point): Point[] {
  const result: Point[] = [a];
  const split = (p: Point, q: Point, r: Point, depth: number): void => {
    const mid = new Point((p.x + 2 * q.x + r.x) / 4, (p.y + 2 * q.y + r.y) / 4);
    if (depth >= 7 || dist(mid, closestPointOnSegment(mid, p, r)) <= CURVE_CHORD_ERROR_M) { result.push(r); return; }
    const pq = new Point((p.x + q.x) / 2, (p.y + q.y) / 2), qr = new Point((q.x + r.x) / 2, (q.y + r.y) / 2);
    split(p, pq, mid, depth + 1); split(mid, qr, r, depth + 1);
  };
  split(a, b, c, 0);
  return result;
}

/** Round corners before parcels exist. Endpoints and existing attachments are
 * pinned. Return null for a hairpin; smoothing must not disguise a bad route. */
export function smoothLane(points: Point[], hosts: Lane[] = []): Point[] | null {
  if (points.length < 3) return points;
  const result: Point[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1], b = points[i], c = points[i + 1];
    const ab = dist(a, b), bc = dist(b, c);
    if (ab < 0.01 || bc < 0.01) continue;
    const turn = angularGap(bearingOf(a, b), bearingOf(b, c));
    if (turn > 120) return null;
    const pinned = hosts.some(l => l.points.slice(1).some((p, j) => dist(b, closestPointOnSegment(b, l.points[j], p)) < 0.05));
    if (turn < 4 || pinned) { result.push(b); continue; }
    const cut = Math.min(CURVE_CORNER_CUT_M, ab * 0.4, bc * 0.4);
    const from = new Point(b.x + (a.x - b.x) * cut / ab, b.y + (a.y - b.y) * cut / ab);
    const to = new Point(b.x + (c.x - b.x) * cut / bc, b.y + (c.y - b.y) * cut / bc);
    result.push(...quadratic(from, b, to));
  }
  result.push(points[points.length - 1]);
  return result.filter((p, i) => i === 0 || dist(p, result[i - 1]) > 1e-6);
}
