import type { AzgaarBurgInput } from '../input/azgaar-input.js';
import { validateWaterContext, WaterContextError, type WaterContextResult } from '../input/water-context.js';
import { Point } from '../types/point.js';
import { pointInPolygon } from '../geom/point-in-polygon.js';
import { bearingVector, closestPointOnSegment, dist } from './geometry.js';
import { prepareWaterBoundary, waterBoundarySegments } from './water-boundary.js';

export function prepareMeasuredInput(input: AzgaarBurgInput): { input: AzgaarBurgInput; result?: WaterContextResult } {
  validateWaterContext(input);
  const c = input.waterContext;
  if (!c) return { input };
  const result: WaterContextResult = { version: 1, status: c.status, issues: [] };
  if (c.status === 'unknown-units') {
    result.issues.push({ code: 'water-units-unknown' });
    return { input: { ...input, oceanBearing: undefined, port: false }, result };
  }
  if (c.omittedRivers?.length) result.issues.push({ code: 'water-river-local-width-unavailable' });
  let polygons = input.coastlineGeometry;
  if (!Object.hasOwn(input, 'coastlineGeometry')) {
    const relevant = c.bodies.filter(b => b.distanceM <= c.surveyRadiusM);
    polygons = [];
    if (relevant.length) {
      const b = relevant[0];
      if (relevant.length !== 1 || b.kind !== 'ocean' || b.coastApproximation !== 'simple-local-coast') {
        throw new WaterContextError('water-geometry-required', 'This coast or lake needs surveyed water polygons.');
      }
      // All points on this convex polyline are at least distanceM along the
      // seaward normal. Every segment, not just the vertices, therefore obeys
      // the minimum-distance bound. t=0 is the exact surveyed nearest point.
      const dir = bearingVector(b.bearingDeg), normal = new Point(-dir.y, dir.x), R = c.surveyRadiusM * 2;
      const shore = Array.from({ length: 201 }, (_, i) => {
        const t = (i - 100) * R / 100;
        const along = b.distanceM + 80 * (1 - Math.exp(-t * t / 160000));
        return new Point(dir.x * along + normal.x * t, dir.y * along + normal.y * t);
      });
      polygons = [[...shore, new Point(dir.x * R + normal.x * R, dir.y * R + normal.y * R),
        new Point(dir.x * R - normal.x * R, dir.y * R - normal.y * R)]];
      result.status = 'approximate';
    }
  }
  return { input: { ...input, oceanBearing: undefined, coastlineGeometry: polygons }, result };
}

/** Validate summaries only against real, exposed banks belonging to that body. */
export function checkMeasuredWater(original: AzgaarBurgInput, water: Point[][], result?: WaterContextResult): void {
  const c = original.waterContext;
  if (!c || c.status !== 'measured' || !result) return;
  prepareWaterBoundary(water, c.surveyRadiusM);
  const conflict = () => { if (!result.issues.some(i => i.code === 'water-context-conflict')) result.issues.push({ code: 'water-context-conflict' }); };
  const origin = new Point(0, 0);
  if (water.some(r => pointInPolygon(origin, r))) {
    // Moving the village onto an invented land site would falsify the supplied
    // geography. There is no valid village map to return for a submerged burg.
    throw new WaterContextError('water-context-conflict', 'The supplied burg position is in water. Correct its location or shoreline survey.');
  }
  if (!Object.hasOwn(original, 'coastlineGeometry')) return;
  const exposed = waterBoundarySegments(water);
  for (const b of c.bodies) {
    if (!b.polygonIndices?.length) { if (b.distanceM <= c.surveyRadiusM) conflict(); continue; }
    const own = b.polygonIndices.map(i => water[i]);
    const onOwn = (p: Point) => own.some(r => r.some((a, i) => dist(p, closestPointOnSegment(p, a, r[(i + 1) % r.length])) < 1e-5));
    let nearest = Infinity;
    const reported = bearingVector(b.bearingDeg);
    const anchor = new Point(reported.x * b.distanceM, reported.y * b.distanceM);
    let anchorGap = Infinity;
    for (const [a, z] of exposed) {
      if (!onOwn(new Point((a.x + z.x) / 2, (a.y + z.y) / 2))) continue;
      nearest = Math.min(nearest, dist(origin, closestPointOnSegment(origin, a, z)));
      anchorGap = Math.min(anchorGap, dist(anchor, closestPointOnSegment(anchor, a, z)));
    }
    if (b.distanceM <= c.surveyRadiusM && (Math.abs(nearest - b.distanceM) > 1 || anchorGap > 1)) conflict();
    else if (nearest < c.surveyRadiusM && Math.abs(nearest - b.distanceM) > 1) conflict();
  }
}
