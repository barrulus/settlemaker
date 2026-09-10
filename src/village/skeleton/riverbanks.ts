import { Point } from '../../types/point.js';
import { arcLengths, closestPointOnSegment, dist, inAnyWater, sampleAt } from '../geometry.js';
import { shortenWaterCrossings, wetRuns } from './water-routing.js';

export const ROAD_BANK_GAP_M = 3;

/** Project a dry junction away from its nearest bank before its incident
 * streets are dressed. Moving all incident endpoints together keeps joins intact. */
export function clearBankPoint(p: Point, water: Point[][], clearance: number): Point {
  let nearest: Point | undefined, gap = clearance + 1;
  for (const poly of water) for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    if (p.x < Math.min(a.x, b.x) - clearance || p.x > Math.max(a.x, b.x) + clearance
      || p.y < Math.min(a.y, b.y) - clearance || p.y > Math.max(a.y, b.y) + clearance) continue;
    const q = closestPointOnSegment(p, a, b), d = dist(p, q);
    if (d < gap) { gap = d; nearest = q; }
  }
  if (!nearest || gap >= clearance || gap < 1e-8 || inAnyWater(p, water)) return p;
  return new Point(nearest.x + (p.x - nearest.x) * (clearance + .3) / gap,
    nearest.y + (p.y - nearest.y) * (clearance + .3) / gap);
}

/** Keep the road surface inland. Crossings get a short approach allowance;
 * the rest of the road clears the bank by half its width plus a grass verge.
 * Runs before housing and junction resolution, never as a rendering distortion. */
export function clearRiverbanks(path: Point[], water: Point[][], halfWidth: number): Point[] {
  if (path.length < 2 || !water.length) return path;
  // An FMG entry can already lie at sea. The coast handler explicitly takes
  // it ashore and reports that conflict; do not densify its exceptional wet
  // lead into ordinary road samples. Still clear the dry continuation.
  if (inAnyWater(path[0], water)) {
    const dry = path.findIndex(p => !inAnyWater(p, water));
    return dry < 0 ? path : [...path.slice(0, dry), ...clearRiverbanks(path.slice(dry), water, halfWidth)];
  }
  if (inAnyWater(path.at(-1)!, water)) return path;
  let points = path;
  // Repair oblique crossings locally, preserving the rest of the road's bends.
  for (const run of [...wetRuns(points, water)].reverse()) {
    if (run.endM - run.startM <= 10) continue;
    const acc = arcLengths(points), total = acc.at(-1)!;
    const lo = Math.max(0, run.startM - 45), hi = Math.min(total, run.endM + 45);
    const middle = [sampleAt(points, acc, lo).p, ...points.filter((_, i) => acc[i] > lo && acc[i] < hi), sampleAt(points, acc, hi).p];
    const repaired = shortenWaterCrossings(middle, water);
    points = [...points.filter((_, i) => acc[i] < lo), ...repaired, ...points.filter((_, i) => acc[i] > hi)];
  }
  const acc = arcLengths(points), total = acc.at(-1)!;
  const runs = wetRuns(points, water);
  const clearance = halfWidth + ROAD_BANK_GAP_M;
  const steps = Math.ceil(total / 4);
  const stations = Array.from({ length: steps + 1 }, (_, i) => total * i / steps);
  const sampled = stations.map(s => sampleAt(points, acc, s).p);
  const fixed = stations.map((s, i) => i === 0 || i === steps || runs.some(r => s >= r.startM - clearance - 4 && s <= r.endM + clearance + 4));
  let out = sampled;
  for (let pass = 0; pass < 10; pass++) {
    out = out.map((p, i) => {
      if (fixed[i]) return p;
      const before = out[i - 1], after = out[i + 1];
      const smooth = new Point((before.x + 2 * p.x + after.x) / 4, (before.y + 2 * p.y + after.y) / 4);
      return clearBankPoint(inAnyWater(smooth, water) ? p : smooth, water, clearance);
    });
  }
  return out;
}
