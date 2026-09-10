import polygonClipping from 'polygon-clipping';
import { Point } from '../types/point.js';
import { coverageExceeded, WaterContextError } from '../input/water-context.js';

interface WaterDomain { radius: number; paths: Point[][]; rings: Point[][]; segments: Array<[Point, Point]>; }
const domains = new WeakMap<Point[][], WaterDomain>();
const ringDomains = new WeakMap<Point[], number>();
const same = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-7;

/** Cache the dissolved union once per immutable site. Rings include their closing
 * point; exposed paths can be open where the survey square cuts the water. */
export function prepareWaterBoundary(water: Point[][], radius: number): void {
  let union: polygonClipping.MultiPolygon;
  try {
    const polys = water.map(r => [r.map(p => [p.x, p.y] as [number, number])]);
    union = polys.length ? polygonClipping.union(polys[0], ...polys.slice(1)) : [];
  } catch {
    throw new WaterContextError('water-context-invalid', 'Water polygon union could not be constructed.');
  }
  const rings = union.flatMap(poly => poly.map(r => r.map(([x, y]) => new Point(x, y))));
  const paths: Point[][] = [];
  const crop = (a: Point, b: Point) => [a.x, a.y].some((v, axis) =>
    Math.abs(Math.abs(v) - radius) < 1e-6 && Math.abs(v - (axis === 0 ? b.x : b.y)) < 1e-6);
  for (const ring of rings) {
    const count = ring.length - 1;
    const cut = ring.slice(0, -1).findIndex((a, i) => crop(a, ring[i + 1]));
    if (cut < 0) { paths.push(ring); continue; }
    let path: Point[] = [];
    for (let k = 1; k <= count; k++) {
      const i = (cut + k) % count, a = ring[i], b = ring[i + 1];
      if (crop(a, b)) { if (path.length > 1) paths.push(path); path = []; }
      else { if (!path.length) path.push(a); path.push(b); }
    }
    if (path.length > 1) paths.push(path);
  }
  for (const ring of water) ringDomains.set(ring, radius);
  domains.set(water, { radius, paths, rings, segments: paths.flatMap(r => r.slice(1).map((b, i): [Point, Point] => [r[i], b])) });
}
export function waterBoundaryPaths(water: Point[][]): Point[][] {
  return domains.get(water)?.paths ?? water.filter(r => r.length > 1).map(r => same(r[0], r.at(-1)!) ? r : [...r, r[0]]);
}
export function waterBoundarySegments(water: Point[][]): Array<[Point, Point]> {
  return domains.get(water)?.segments ?? waterBoundaryPaths(water).flatMap(r => r.slice(1).map((b, i): [Point, Point] => [r[i], b]));
}
export function waterFillRings(water: Point[][]): Point[][] | undefined { return domains.get(water)?.rings; }
export function assertWaterQuery(water: Point[][], point: Point, margin = 0): void {
  const domain = domains.get(water);
  if (domain && Math.hypot(point.x, point.y) + margin > domain.radius + 1e-7) {
    coverageExceeded(Math.hypot(point.x, point.y) + margin);
  }
}

export function assertWaterRingQuery(ring: Point[], point: Point, margin: number): void {
  const radius = ringDomains.get(ring);
  if (radius !== undefined && Math.hypot(point.x, point.y) + margin > radius) {
    coverageExceeded(Math.hypot(point.x, point.y) + margin);
  }
}
