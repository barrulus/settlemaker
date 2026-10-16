import { Point } from '../types/point.js';
import type { Polygon } from './polygon.js';

type Constraint = [number, number, number, number];

/** Largest rectangle of a fixed aspect and orientation inside a polygon.
 * The centre may translate; scale changes uniformly. Edge half-planes give
 * exact containment for convex rings and conservative containment in the
 * kernel of concave rings. This never fills a concavity by taking its hull.
 * Small building rings make enumeration of the three active constraints
 * cheaper and more predictable than a general optimisation dependency. */
export function fitInscribedRectangle(
  polygon: Polygon, width: number, height: number, rotation: number,
  maxScale = Infinity, clearance = .002,
): { center: Point; scale: number } | null {
  if (polygon.length < 3 || Math.abs(polygon.square) < 1e-8
    || !Number.isFinite(width + height + rotation + clearance)
    || width <= 0 || height <= 0 || maxScale <= 0 || Number.isNaN(maxScale) || clearance < 0) return null;
  const origin = polygon.centroid, winding = Math.sign(polygon.square);
  const ax = Math.cos(rotation), ay = Math.sin(rotation);
  const constraints: Constraint[] = [];
  polygon.forEdge((a, b) => {
    const length = Point.distance(a, b);
    if (length < 1e-8) return;
    const nx = winding * (b.y - a.y) / length, ny = -winding * (b.x - a.x) / length;
    const support = (Math.abs(nx * ax + ny * ay) * width + Math.abs(-nx * ay + ny * ax) * height) / 2;
    constraints.push([nx, ny, support, nx * (a.x - origin.x) + ny * (a.y - origin.y) - clearance]);
  });
  if (Number.isFinite(maxScale)) constraints.push([0, 0, 1, maxScale]);
  const feasible = (x: number, y: number, scale: number) =>
    constraints.every(([a, b, c, d]) => a * x + b * y + c * scale <= d + 1e-8);
  let scale = 0, cx = 0, cy = 0;
  for (let i = 0; i < constraints.length; i++) for (let j = i + 1; j < constraints.length; j++) {
    const [a, b, c, d] = constraints[i], [e, f, g, h] = constraints[j];
    for (let k = j + 1; k < constraints.length; k++) {
      const [l, m, n, o] = constraints[k];
      const determinant = a * (f * n - g * m) - b * (e * n - g * l) + c * (e * m - f * l);
      if (Math.abs(determinant) < 1e-10) continue;
      const s = (a * (f * o - h * m) - b * (e * o - h * l) + d * (e * m - f * l)) / determinant;
      if (s <= scale || !Number.isFinite(s)) continue;
      const x = (d * (f * n - g * m) - b * (h * n - g * o) + c * (h * m - f * o)) / determinant;
      const y = (a * (h * n - g * o) - d * (e * n - g * l) + c * (e * o - h * l)) / determinant;
      if (feasible(x, y, s)) { scale = s; cx = x; cy = y; }
    }
  }
  if (scale <= 0) return null;
  // A physical size cap often leaves many equally good centres. Prefer the
  // nearest feasible centre to the original centroid, avoiding arbitrary
  // moves to a corner when the same-sized building fits more centrally.
  const consider = (x: number, y: number) => {
    if (x * x + y * y < cx * cx + cy * cy && feasible(x, y, scale)) { cx = x; cy = y; }
  };
  consider(0, 0);
  for (let i = 0; i < constraints.length; i++) {
    const [a, b, c, d] = constraints[i], distance = d - c * scale, norm = a * a + b * b;
    if (norm < 1e-10) continue;
    consider(a * distance / norm, b * distance / norm);
    for (let j = i + 1; j < constraints.length; j++) {
      const [e, f, g, h] = constraints[j], determinant = a * f - b * e;
      if (Math.abs(determinant) < 1e-10) continue;
      const otherDistance = h - g * scale;
      consider((distance * f - b * otherDistance) / determinant, (a * otherDistance - distance * e) / determinant);
    }
  }
  return { center: new Point(origin.x + cx, origin.y + cy), scale };
}
