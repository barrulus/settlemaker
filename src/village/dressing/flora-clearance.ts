import { assertWaterQuery, waterBoundarySegments } from '../water-boundary.js';
import { Point } from '../../types/point.js';
import { pointInPolygon } from '../../geom/point-in-polygon.js';
import { closestPointOnSegment, dist, greenDrawnRadius } from '../geometry.js';
import { lotObb, pointInObb } from '../parcels/overlap.js';
import { SHOREFRONT_BAND_M, VEG_LANE_CLEAR_M } from '../constants.js';
import type { Croft, FieldBlock, Green, Lane, Lot } from '../types.js';

/** Index occupied ground once: dense woodland must not rescan every parcel
 * and every road segment for each candidate tree. Padding keeps crowns off
 * crops and the henge; larger road clearance keeps the road surface visible. */
export function floraClearance(
  green: Green, lanes: Lane[], lots: Lot[], crofts: Croft[], fields: FieldBlock[],
  water: Point[][], shorefrontReachM: number, reservations: Point[][],
): (p: Point) => boolean {
  const cells = new Map<string, ((p: Point) => boolean)[]>();
  const size = 24;
  function add(points: Point[], padding: number, rejects: (p: Point) => boolean): void {
    if (!points.length) return;
    const minX = Math.floor((Math.min(...points.map(p => p.x)) - padding) / size);
    const maxX = Math.floor((Math.max(...points.map(p => p.x)) + padding) / size);
    const minY = Math.floor((Math.min(...points.map(p => p.y)) - padding) / size);
    const maxY = Math.floor((Math.max(...points.map(p => p.y)) + padding) / size);
    for (let x = minX; x <= maxX; x++) for (let y = minY; y <= maxY; y++) {
      const key = `${x},${y}`;
      const bucket = cells.get(key);
      if (bucket) bucket.push(rejects); else cells.set(key, [rejects]);
    }
  }
  function polygon(poly: Point[], padding: number): void {
    add(poly, padding, p => pointInPolygon(p, poly) || poly.some((a, i) =>
      dist(p, closestPointOnSegment(p, a, poly[(i + 1) % poly.length])) <= padding));
  }
  for (const lane of lanes) for (let i = 1; i < lane.points.length; i++) {
    const a = lane.points[i - 1], b = lane.points[i];
    const clearance = lane.widthM / 2 + Math.max(3, VEG_LANE_CLEAR_M);
    add([a, b], clearance, p => dist(p, closestPointOnSegment(p, a, b)) <= clearance);
  }
  for (const lot of lots) {
    const obb = lotObb(lot);
    const r = Math.hypot(obb.halfW, obb.halfD) + 3;
    add([new Point(obb.center.x - r, obb.center.y - r), new Point(obb.center.x + r, obb.center.y + r)], 0,
      p => pointInObb(p, obb, 1.5));
  }
  for (const croft of crofts) polygon(croft.polygon, 1.5);
  for (const field of fields) polygon(field.polygon, 1.5);
  for (const clearing of reservations) polygon(clearing, 3);
  // Water polygons can cover a huge off-map area. Keep them out of the grid.
  return p => {
    assertWaterQuery(water, p);
    if (dist(p, green.centre) < greenDrawnRadius(green) + 1.5) return true;
    if (cells.get(`${Math.floor(p.x / size)},${Math.floor(p.y / size)}`)?.some(test => test(p))) return true;
    for (const poly of water) {
      if (pointInPolygon(p, poly)) return true;

    }
    if (dist(p, green.centre) <= shorefrontReachM && waterBoundarySegments(water).some(([a, b]) =>
      dist(p, closestPointOnSegment(p, a, b)) <= SHOREFRONT_BAND_M)) return true;
    return false;
  };
}
