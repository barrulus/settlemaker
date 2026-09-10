import { waterBoundarySegments, assertWaterQuery } from '../water-boundary.js';
import { Point } from '../../types/point.js';
import { arcLengths, closestPointOnSegment, dist, inAnyWater, sampleAt } from '../geometry.js';
import { smoothLane } from './curves.js';

export interface WetRun { points: Point[]; startM: number; endM: number; }

/** Exact bank intersections, including a river narrower than a sample step.
 * Consecutive wet pieces are joined across polyline vertices. */
export function wetRuns(points: Point[], water: Point[][]): WetRun[] {
  for (const p of points) assertWaterQuery(water, p);
  if (!water.length) return [];
  const result: WetRun[] = [];
  let run: WetRun | undefined, travelled = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], length = dist(a, b);
    if (length < 1e-8) continue;
    const ts = [0, 1], dx = b.x - a.x, dy = b.y - a.y;
    for (const polygon of water) for (let j = 0; j < polygon.length; j++) {
      const c = polygon[j], d = polygon[(j + 1) % polygon.length];
      const ex = d.x - c.x, ey = d.y - c.y, det = dx * ey - dy * ex;
      if (Math.abs(det) < 1e-9) continue;
      const t = ((c.x - a.x) * ey - (c.y - a.y) * ex) / det;
      const u = ((c.x - a.x) * dy - (c.y - a.y) * dx) / det;
      if (t > 0 && t < 1 && u >= 0 && u <= 1) ts.push(t);
    }
    ts.sort((x, y) => x - y);
    const at = (t: number) => t === 0 ? a : t === 1 ? b : new Point(a.x + dx * t, a.y + dy * t);
    for (let j = 1; j < ts.length; j++) {
      const lo = ts[j - 1], hi = ts[j];
      if (hi - lo < 1e-9) continue;
      if (inAnyWater(at((lo + hi) / 2), water)) {
        if (!run) { run = { points: [at(lo)], startM: travelled + lo * length, endM: 0 }; result.push(run); }
        run.points.push(at(hi)); run.endM = travelled + hi * length;
      } else run = undefined;
    }
    travelled += length;
  }
  return result;
}

/** Divert long oblique/river-following runs onto dry banks and one short
 * crossing. Endpoints stay fixed so junctions and FMG entries cannot drift.
 * Called before housing. If no dry detour exists, leave the route for the
 * caller's existing coastal handling rather than invent a causeway. */
export function shortenWaterCrossings(points: Point[], water: Point[][]): Point[] {
  const runs = wetRuns(points, water);
  if (!runs.some(r => r.endM - r.startM > 10)) return points;
  const first = points[0], last = points.at(-1)!;
  if (inAnyWater(first, water) || inAnyWater(last, water)) return points;
  if (!wetRuns([first, last], water).length) return [first, last];
  let best: { points: Point[]; length: number; } | undefined;
  for (const run of runs) {
    const acc = arcLengths(run.points), middle = sampleAt(run.points, acc, acc.at(-1)! / 2).p;
    const edges = waterBoundarySegments(water).map(([a, b]) => {
      const p = closestPointOnSegment(middle, a, b);
      return { a, b, p, distance: dist(middle, p) };
    }).sort((a, b) => a.distance - b.distance).slice(0, 4);
    for (const { a, b, p } of edges) {
      const length = dist(a, b); if (length < 0.1) continue;
      const tx = (b.x - a.x) / length, ty = (b.y - a.y) / length;
      for (const shift of [0, -8, 8, -16, 16, -24, 24]) {
        const centre = new Point(p.x + tx * shift, p.y + ty * shift);
        const offset = (s: number) => new Point(centre.x - ty * s, centre.y + tx * s);
        // Locate the opposite bank and allow enough dry approach for rounding.
        const normalRuns = wetRuns([offset(-20), offset(20)], water);
        if (normalRuns.length !== 1) continue;
        const wet = normalRuns[0];
        if (wet.endM - wet.startM > 10) continue;
        const left = offset(wet.startM - 20 - 8), right = offset(wet.endM - 20 + 8);
        for (const [near, far] of [[left, right], [right, left]]) {
          if (wetRuns([first, near], water).length || wetRuns([far, last], water).length) continue;
          const path = smoothLane([first, near, far, last]);
          if (!path) continue;
          const crossings = wetRuns(path, water);
          if (crossings.length !== 1 || crossings[0].endM - crossings[0].startM > 10) continue;
          const total = arcLengths(path).at(-1)!;
          if (!best || total < best.length) best = { points: path, length: total };
        }
      }
    }
  }
  return best?.points ?? points;
}

/** New residential streets must start and end on land and cross briefly. */
export function validWaterRoute(points: Point[], water: Point[][], bankClearance = 0): boolean {
  for (const p of points) assertWaterQuery(water, p, bankClearance);
  if (!water.length) return true;
  if (points.length < 2 || inAnyWater(points[0], water) || inAnyWater(points.at(-1)!, water)) return false;
  const runs = wetRuns(points, water);
  if (runs.some(r => r.endM - r.startM > 10)) return false;
  if (!(bankClearance > 0)) return true;
  const acc = arcLengths(points), total = acc.at(-1)!;
  for (let s = 0; s <= total; s += 2) {
    if (runs.some(r => s >= r.startM - bankClearance - 5 && s <= r.endM + bankClearance + 5)) continue;
    const p = sampleAt(points, acc, s).p;
    for (const [a, b] of waterBoundarySegments(water)) {
      if (p.x < Math.min(a.x, b.x) - bankClearance || p.x > Math.max(a.x, b.x) + bankClearance
        || p.y < Math.min(a.y, b.y) - bankClearance || p.y > Math.max(a.y, b.y) + bankClearance) continue;
      if (dist(p, closestPointOnSegment(p, a, b)) < bankClearance) return false;
    }
  }
  return true;
}
