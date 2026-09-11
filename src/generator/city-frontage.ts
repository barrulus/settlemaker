import { Point } from '../types/point.js';
import { WardType } from '../types/interfaces.js';
import type { Polygon } from '../geom/polygon.js';
import { intersectLines } from '../geom/geom-utils.js';
import { pointInPolygon } from '../geom/point-in-polygon.js';
import type { Ward, WardLane } from '../wards/ward.js';

export interface CityFrontage extends WardLane {
  at: Point;
  kind: 'street' | 'alley';
}

export function polygonsOverlap(a: Polygon, b: Polygon): boolean {
  if (a.vertices.some(p => pointInPolygon(p, b.vertices)) || b.vertices.some(p => pointInPolygon(p, a.vertices))) return true;
  let overlap = false;
  a.forEdge((p, q) => { if (blocksAccess(p, q, b)) overlap = true; });
  return overlap;
}

/** Split at every boundary crossing, then classify the intervening intervals.
 * Unlike fixed-step sampling this cannot skip a narrow concave notch. */
export function segmentInside(a: Point, b: Point, polygon: Polygon): boolean {
  const cuts = [0, 1];
  polygon.forEdge((p, q) => {
    const t = intersectLines(a.x, a.y, b.x - a.x, b.y - a.y, p.x, p.y, q.x - p.x, q.y - p.y);
    if (t && t.x > 0 && t.x < 1 && t.y >= 0 && t.y <= 1) cuts.push(t.x);
  });
  cuts.sort((x, y) => x - y);
  for (let i = 1; i < cuts.length; i++) {
    if (cuts[i] - cuts[i - 1] < 1e-8) continue;
    const t = (cuts[i] + cuts[i - 1]) / 2;
    if (!pointInPolygon(new Point(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t), polygon.vertices)) return false;
  }
  return true;
}

export function nearestOnSegment(p: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return new Point(a.x + t * dx, a.y + t * dy);
}

/** Retain only dry intervals, respecting even-odd water rings (including islands). */
export function drySegments(a: Point, b: Point, water: Point[][]): Array<[Point, Point]> {
  if (!water.length) return [[a, b]];
  const cuts = [0, 1];
  for (const ring of water) for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    const t = intersectLines(a.x, a.y, b.x - a.x, b.y - a.y, p.x, p.y, q.x - p.x, q.y - p.y);
    if (t && t.x > 1e-8 && t.x < 1 - 1e-8 && t.y >= 0 && t.y <= 1) cuts.push(t.x);
  }
  cuts.sort((x, y) => x - y);
  const at = (t: number) => t === 0 ? a : t === 1 ? b : new Point(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
  const result: Array<[Point, Point]> = [];
  for (let i = 1; i < cuts.length; i++) {
    if (cuts[i] - cuts[i - 1] < 1e-8) continue;
    const p = at((cuts[i] + cuts[i - 1]) / 2);
    if (water.filter(ring => pointInPolygon(p, ring)).length % 2) continue;
    result.push([at(cuts[i - 1]), at(cuts[i])]);
  }
  return result;
}

/** Full footprint check, including narrow water strips and enclosed ponds. */
export function overlapsWater(polygon: Polygon, water: Point[][]): boolean {
  if (!water.length) return false;
  let crosses = false;
  polygon.forEdge((a, b) => {
    const dry = drySegments(a, b, water);
    if (dry.length !== 1 || dry[0][0] !== a || dry[0][1] !== b) crosses = true;
  });
  return crosses || water.some(ring => ring.some(p => pointInPolygon(p, polygon.vertices)));
}

/** Strict intersection with another building; touching an edge is allowed. */
export function blocksAccess(a: Point, b: Point, polygon: Polygon): boolean {
  const xs = polygon.vertices.map(p => p.x), ys = polygon.vertices.map(p => p.y);
  if (Math.max(a.x, b.x) < Math.min(...xs) || Math.min(a.x, b.x) > Math.max(...xs)
    || Math.max(a.y, b.y) < Math.min(...ys) || Math.min(a.y, b.y) > Math.max(...ys)) return false;
  let crosses = false;
  polygon.forEdge((p, q) => {
    const t = intersectLines(a.x, a.y, b.x - a.x, b.y - a.y, p.x, p.y, q.x - p.x, q.y - p.y);
    if (t && t.x > 1e-6 && t.x < 1 - 1e-6 && t.y > 1e-6 && t.y < 1 - 1e-6) crosses = true;
  });
  return crosses;
}

/** Patch edges are existing reserved street corridors; positive-width cut
 * lines are actual alleys. Never treat zero-width party boundaries as roads. */
export function wardFrontages(ward: Ward): Array<WardLane & { kind: 'street' | 'alley' }> {
  const lines: Array<WardLane & { kind: 'street' | 'alley' }> = ward.lanes.map(l => ({ ...l, kind: 'alley' }));
  if (ward.type === WardType.Farm) {
    // Field boundaries are not streets. Farmhouses may face actual approach
    // segments, with their connection confined to their own patch below.
    for (const road of [...ward.model.roads, ...ward.model.arteries]) for (let i = 1; i < road.length; i++) {
      lines.push({ a: road.vertices[i - 1], b: road.vertices[i], width: 1.6, kind: 'street' });
    }
  } else {
    ward.patch.shape.forEdge((a, b) => {
      if (ward.model.wall?.bordersBy(ward.patch, a, b)) return;
      const neighbour = ward.model.getNeighbour(ward.patch, a);
      if (neighbour && ward.model.waterbody.includes(neighbour)) return;
      lines.push({ a, b, width: ward.insetScale, kind: 'street' });
    });
  }
  const water = ward.model.getWaterRings();
  return lines.flatMap(line => drySegments(line.a, line.b, water).map(([a, b]) => ({ ...line, a, b })));
}

/** Ward-local search, with a fixed candidate bound and no all-city scans. */
export function frontagesFor(
  building: Polygon, ward: Ward, lines: ReturnType<typeof wardFrontages>,
): CityFrontage[] {
  const c = building.centroid;
  const water = ward.model.getWaterRings();
  return lines.map(line => ({ ...line, at: nearestOnSegment(c, line.a, line.b) }))
    .filter(line => ward.type !== WardType.Farm || segmentInside(c, line.at, ward.patch.shape))
    .sort((a, b) => Point.distance(c, a.at) - Point.distance(c, b.at)).slice(0, 8)
    .filter(line => {
      const dry = drySegments(c, line.at, water);
      return dry.length === 1 && dry[0][0] === c && dry[0][1] === line.at;
    })
    .filter(line => !ward.geometry.some(other => other !== building && blocksAccess(c, line.at, other)))
    .slice(0, 3);
}
