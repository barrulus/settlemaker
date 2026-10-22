import { Point } from '../types/point.js';
import { roadCrossSection } from './cross-section.js';
import { arcLengths, closestPointOnSegment, dist } from './geometry.js';
import { offsetPolyline } from './parcels/strip.js';
import type { Lane } from './types.js';

/** Endpoint widths are planned before viewport culling, so cropping a joined
 * road out of view cannot change the taper on its neighbour. */
export function roadJoinWidths(lanes: Lane[]): Map<string, [number, number]> {
  const widths = new Map<string, [number, number]>();
  for (const lane of lanes) {
    if (lane.points.length < 2) continue;
    const width = roadCrossSection(lane).surfaceM;
    const joinWidth = (end: Point): number => {
      const touching = lanes.filter(other => other.id !== lane.id && other.points.slice(1).some((p, i) =>
        dist(end, closestPointOnSegment(end, other.points[i], p)) < 0.15));
      return touching.length ? Math.min(width, Math.max(...touching.map(l => roadCrossSection(l).surfaceM))) : width;
    };
    const start = joinWidth(lane.points[0]), end = joinWidth(lane.points.at(-1)!);
    if (start < width || end < width) widths.set(lane.id, [start, end]);
  }
  return widths;
}

/** Taper only within the reserved corridor; frontage stays conservative. */
export function roadSurfaceClips(lanes: Lane[], insetM = 0): Map<string, Point[]> {
  const joins = roadJoinWidths(lanes), clips = new Map<string, Point[]>();
  for (const lane of lanes) {
    const widths = joins.get(lane.id);
    if (widths) clips.set(lane.id, roadSurfaceRing(lane.points, roadCrossSection(lane).surfaceM, ...widths, insetM));
  }
  return clips;
}

/** A variable-width ribbon, shared by physical scenes and the village view. */
export function roadSurfaceRing(points: Point[], width: number, startWidth: number, endWidth: number, insetM = 0): Point[] {
  if (points.length < 2) return [];
  const acc = arcLengths(points), total = acc.at(-1)!;
  const taper = Math.min(total / 3, Math.max(3, width * 2));
  if (taper <= 0) return [];
  const smooth = (t: number) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
  // Add samples along the taper even when an original road is one segment.
  const samples: Point[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], length = dist(a, b);
    const steps = Math.max(1, Math.ceil(length / 1.5));
    for (let j = 0; j < steps; j++) samples.push(new Point(a.x + (b.x - a.x) * j / steps, a.y + (b.y - a.y) * j / steps));
  }
  samples.push(points.at(-1)!);
  const edge = (side: 1 | -1): Point[] => offsetPolyline(samples, width / 2 + 0.02, side).map(p => {
    let nearest = points[0], at = 0, distance = Infinity;
    for (let i = 1; i < points.length; i++) {
      const q = closestPointOnSegment(p, points[i - 1], points[i]), d = dist(p, q);
      if (d < distance) { nearest = q; distance = d; at = acc[i - 1] + dist(q, points[i - 1]); }
    }
    const local = Math.min(startWidth + (width - startWidth) * smooth(at / taper),
      endWidth + (width - endWidth) * smooth((total - at) / taper));
    const factor = (Math.max(local * .3, local / 2 - insetM) + 0.02) / (width / 2 + 0.02);
    return new Point(nearest.x + (p.x - nearest.x) * factor, nearest.y + (p.y - nearest.y) * factor);
  });
  return [...edge(1), ...edge(-1).reverse()];
}
