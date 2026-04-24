import { Point } from '../types/point.js';

/**
 * Standard ray-casting point-in-polygon test. `polygon` is a closed polygon
 * given as an ordered vertex list (the closing edge from last→first is
 * implicit). Works for convex and non-convex polygons, winding-agnostic.
 *
 * Operates on raw (x, y) coordinates — unlike `Polygon.contains`, which is
 * identity-based — because the coastline polygons come from outside the
 * generator and share no vertex identities with the patch mesh.
 *
 * Points exactly on an edge or vertex have an implementation-defined result
 * (half-open): good enough for classifying patch centroids, which almost
 * never land exactly on a user-supplied boundary.
 */
export function pointInPolygon(point: Point, polygon: Point[]): boolean {
  if (polygon.length < 3) return false;
  const { x, y } = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersects = (yi > y) !== (yj > y)
      && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}
