import { Point } from '../types/point.js';
import type { HarbourPlan } from '../wards/harbour-plan.js';

/** Choose local terrain for an unmeasured, direction-only coast. Keep the
 * viable working bank and give it rounded headlands reaching halfway along the
 * compact harbour. The original coast resumes beyond those shoulders. This
 * runs after the working site is selected and before roads and buildings. */
export function harbourInlet(shoreline: Point[], plan: HarbourPlan, metresPerUnit: number): Point[] | null {
  if (plan.kind !== 'protected' || plan.breakwaters.length !== 2 || !plan.quays[0]) return null;
  const edge = plan.quays[0].edge.map(p => p.scale(metresPerUnit));
  const first = edge[0], last = edge.at(-1)!;
  const centre = first.add(last).scale(.5), tangent = last.subtract(first).norm();
  const arm = plan.breakwaters[0].path.map(p => p.scale(metresPerUnit));
  const normal = arm[1].subtract(arm[0]).norm();
  const depth = Math.min(20, Point.distance(arm[0], arm[1]) * .5);
  const halfWidth = Point.distance(first, last) / 2 + 3, shoulder = Math.max(14, depth);
  const extent = halfWidth + shoulder * 5;
  const local = (p: Point) => {
    const d = p.subtract(centre);
    return { t: d.dot(tangent), s: d.dot(normal) };
  };
  const shapeShoulder = (p: Point): Point => {
    const q = local(p), distance = Math.abs(q.t);
    if (distance >= extent || Math.abs(q.s) > 40) return p;
    let fraction = 0;
    if (distance > halfWidth && distance < halfWidth + shoulder)
      fraction = (1 - Math.cos(Math.PI * (distance - halfWidth) / shoulder)) / 2;
    else if (distance >= halfWidth + shoulder && distance <= halfWidth + shoulder * 2)
      fraction = 1;
    else if (distance > halfWidth + shoulder * 2)
      fraction = (1 + Math.cos(Math.PI * (distance - halfWidth - shoulder * 2) / (shoulder * 3))) / 2;
    return p.add(normal.scale(depth * fraction));
  };
  const result: Point[] = [];
  for (let i = 0; i < shoreline.length - 1; i++) {
    const a = shoreline[i], b = shoreline[i + 1], u = local(a), v = local(b);
    const nearby = Math.min(u.t, v.t) < extent && Math.max(u.t, v.t) > -extent
      && Math.min(u.s, v.s) < 40 && Math.max(u.s, v.s) > -40;
    const steps = nearby ? Math.max(1, Math.ceil(Point.distance(a, b) / 2)) : 1;
    for (let j = 0; j < steps; j++) {
      const point = j === 0 ? a : new Point(a.x + (b.x - a.x) * j / steps, a.y + (b.y - a.y) * j / steps);
      result.push(shapeShoulder(point));
    }
  }
  result.push(shapeShoulder(shoreline.at(-1)!));
  return result;
}
