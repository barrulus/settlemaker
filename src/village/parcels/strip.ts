import { Point } from '../../types/point.js';
import { unit } from '../geometry.js';

/**
 * Offset a polyline sideways by `distanceM`. `side` is +1 for the right of
 * the direction of travel, -1 for the left. Corners use the angle bisector
 * so both legs stay parallel to their originals.
 */
export function offsetPolyline(points: Point[], distanceM: number, side: 1 | -1): Point[] {
  if (points.length < 2) return [];
  const normals: Point[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const d = unit(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
    normals.push(new Point(-d.y * side, d.x * side));
  }
  const out: Point[] = [];
  for (let i = 0; i < points.length; i++) {
    const before = normals[Math.max(0, i - 1)];
    const after = normals[Math.min(i, normals.length - 1)];
    const bisector = unit(before.x + after.x, before.y + after.y);
    // Miter length: how far along the bisector to travel so both legs are
    // `distanceM` from their originals.
    const cos = bisector.x * after.x + bisector.y * after.y;
    const scale = cos === 0 ? 1 : 1 / cos;
    const miter = Math.min(Math.abs(scale), 4) * Math.sign(scale || 1);
    out.push(new Point(
      points[i].x + bisector.x * distanceM * miter,
      points[i].y + bisector.y * distanceM * miter,
    ));
  }
  return out;
}
