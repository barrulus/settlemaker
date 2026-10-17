import polygonClipping from 'polygon-clipping';
import { Point } from '../types/point.js';
import { boundsOfPoints } from '../geom/bounds.js';
import { pointInPolygon } from '../geom/point-in-polygon.js';
import { nearestOnSegment } from '../generator/city-frontage.js';
import { waterFillPolygons } from '../village/water-boundary.js';
import type { RoadFeature, Scene } from '../scene/scene.js';

/** Local dry-ground connectivity, with river crossings supplied by the actual
 * road/bridge plan. The bounded domain cannot walk around cropped river ends
 * outside the countryside merely because surveyed water stops there. */
export function reachableDryGround(region: Point[], water: Point[][], origin: Point,
  roads: RoadFeature[], bridges: NonNullable<Scene['layers']['bridges']> = []): (point: Point) => boolean {
  if (!water.length) return () => true;
  const coordinates = (ring: Point[]): polygonClipping.Ring => ring.map(p => [p.x, p.y]);
  const bodies = waterFillPolygons(water) ?? water.map(ring => [ring]);
  const dry = polygonClipping.difference([coordinates(region)], ...bodies.map(polygon => polygon.map(coordinates)))
    .map(polygon => {
      const rings = polygon.map(ring => ring.map(([x, y]) => new Point(x, y)));
      return { rings, bounds: boundsOfPoints(rings[0]) };
    });
  const component = (point: Point) => dry.findIndex(({ rings, bounds }) =>
    point.x >= bounds.min_x && point.x <= bounds.max_x && point.y >= bounds.min_y && point.y <= bounds.max_y
    && pointInPolygon(point, rings[0]) && !rings.slice(1).some(ring => pointInPolygon(point, ring)));
  const reachable = new Set<number>();
  const home = component(origin);
  if (home >= 0) reachable.add(home);
  const segments = roads.flatMap(road => road.path.slice(1).map((b, i) => ({
    a: new Point(road.path[i].x, road.path[i].y), b: new Point(b.x, b.y), width: road.width ?? 3,
  })));
  const onRoad = (point: Point) => segments.some(({ a, b, width }) =>
    Point.distance(point, nearestOnSegment(point, a, b)) <= width / 2 + 1e-5);
  const links = bridges.flatMap(bridge => {
    if (!(bridge.width > 0) || bridge.path.length < 2) return [];
    const path = bridge.path.map(p => new Point(p.x, p.y));
    // A detached bridge glyph is not access. Both landfalls and its intervening
    // deck must belong to the generated road corridor.
    if (!path.every(onRoad) || !path.slice(1).every((b, i) => onRoad(path[i].add(b).scale(.5)))) return [];
    const from = component(path[0]), to = component(path.at(-1)!);
    return from >= 0 && to >= 0 && from !== to ? [[from, to]] : [];
  });
  let changed = true;
  while (changed) {
    changed = false;
    for (const [from, to] of links) {
      if (reachable.has(from) === reachable.has(to)) continue;
      reachable.add(from); reachable.add(to); changed = true;
    }
  }
  return point => reachable.has(component(point));
}
