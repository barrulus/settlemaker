import polygonClipping from 'polygon-clipping';
import type { LocalBounds } from '../generator/bounds.js';
import type { ScenePoint, WaterLayer } from './scene.js';

/** Continue an explicitly synthetic ocean to cover a requested viewport. The
 * sampled shore is unchanged; beyond its endpoints it continues alongshore.
 * Closing edges always lie outside the view and are never rendered as banks.
 * This is presentation geometry, never fed back into planning or GeoJSON. */
export function waterInView(water: WaterLayer, bounds: LocalBounds): WaterLayer {
  const coast = water.oceanContinuation;
  if (!coast || coast.shoreline.length < 2) return water;
  const d = coast.waterDirection, n = { x: -d.y, y: d.x };
  const dot = (p: ScenePoint, v: ScenePoint) => p.x * v.x + p.y * v.y;
  const point = (t: number, depth: number): ScenePoint => ({ x: n.x * t + d.x * depth, y: n.y * t + d.y * depth });
  const corners = [bounds.min_x, bounds.max_x].flatMap(x => [bounds.min_y, bounds.max_y].map(y => ({ x, y })));
  const first = coast.shoreline[0], last = coast.shoreline.at(-1)!;
  const margin = Math.max(100, bounds.max_x - bounds.min_x, bounds.max_y - bounds.min_y);
  const left = Math.min(dot(first, n), ...corners.map(p => dot(p, n))) - margin;
  const right = Math.max(dot(last, n), ...corners.map(p => dot(p, n))) + margin;
  const far = Math.max(...coast.shoreline.map(p => dot(p, d)), ...corners.map(p => dot(p, d))) + margin;
  const shore = [point(left, dot(first, d)), ...coast.shoreline, point(right, dot(last, d))];
  const ring = [...shore, point(right, far), point(left, far)];
  const polygons = [ring, ...coast.otherWater].map(r => [r.map(p => [p.x, p.y] as [number, number])]);
  const union = polygonClipping.union(polygons[0], ...polygons.slice(1))
    .map(poly => poly.map(r => r.map(([x, y]) => ({ x, y }))));
  const rings = union.flat();
  const artificial = (a: ScenePoint, b: ScenePoint) =>
    [left, right].some(t => Math.abs(dot(a, n) - t) < 1e-6 && Math.abs(dot(b, n) - t) < 1e-6)
    || (Math.abs(dot(a, d) - far) < 1e-6 && Math.abs(dot(b, d) - far) < 1e-6);
  const shorelines: ScenePoint[][] = [];
  for (const r of rings) {
    let path: ScenePoint[] = [];
    for (let i = 1; i < r.length; i++) {
      if (artificial(r[i - 1], r[i])) {
        if (path.length > 1) shorelines.push(path);
        path = [];
      } else {
        if (!path.length) path.push(r[i - 1]);
        path.push(r[i]);
      }
    }
    if (path.length > 1) shorelines.push(path);
  }
  return { ...water, polygons: union, rings, shorelines };
}
