import { Point } from '../../types/point.js';
import { bearingOf, dist, greenDrawnRadius } from '../geometry.js';
import type { Green, Lane } from '../types.js';

/** Actual road crossings of the reserved green rim, independent of route class.
 * Close crossings are one mouth, not two corners of a triangular green. */
export function greenPorts(green: Green, lanes: Lane[]): Point[] {
  const c = green.centre, radius = greenDrawnRadius(green);
  const ports: Point[] = [];
  for (const lane of lanes) for (let i = 1; i < lane.points.length; i++) {
    const a = lane.points[i - 1], b = lane.points[i];
    const dx = b.x - a.x, dy = b.y - a.y, x = a.x - c.x, y = a.y - c.y;
    const aa = dx * dx + dy * dy, bb = 2 * (x * dx + y * dy);
    const discriminant = bb * bb - 4 * aa * (x * x + y * y - radius * radius);
    if (aa < 1e-9 || discriminant < 0) continue;
    for (const t of [(-bb - Math.sqrt(discriminant)) / (2 * aa), (-bb + Math.sqrt(discriminant)) / (2 * aa)]) {
      if (t < 0 || t > 1) continue;
      const p = new Point(a.x + t * dx, a.y + t * dy);
      if (!ports.some(q => dist(p, q) < 2)) ports.push(p);
    }
  }
  return ports.sort((a, b) => bearingOf(c, a) - bearingOf(c, b));
}
