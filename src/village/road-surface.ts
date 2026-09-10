import { Point } from '../types/point.js';
import { roadCrossSection } from './cross-section.js';
import { arcLengths, closestPointOnSegment, dist } from './geometry.js';
import { offsetPolyline } from './parcels/strip.js';
import type { Lane } from './types.js';

/** Narrow a wider terminating surface into the road it joins. This is a paint
 * clip wholly within the existing stroke: reserved corridors and frontage stay
 * conservative. SVG and GeoJSON expose the same clip for downstream styling. */
export function roadSurfaceClips(lanes: Lane[]): Map<string, Point[]> {
  const clips = new Map<string, Point[]>();
  for (const lane of lanes) {
    if (lane.points.length < 2) continue;
    const width = roadCrossSection(lane).surfaceM;
    const joinWidth = (end: Point): number => {
      const touching = lanes.filter(other => other.id !== lane.id && other.points.slice(1).some((p, i) =>
        dist(end, closestPointOnSegment(end, other.points[i], p)) < 0.15));
      return touching.length ? Math.min(width, Math.max(...touching.map(l => roadCrossSection(l).surfaceM))) : width;
    };
    const startWidth = joinWidth(lane.points[0]), endWidth = joinWidth(lane.points.at(-1)!);
    if (startWidth >= width && endWidth >= width) continue;
    const acc = arcLengths(lane.points), total = acc.at(-1)!;
    const taper = Math.min(total / 3, Math.max(3, width * 2));
    if (taper <= 0) continue;
    const smooth = (t: number) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
    // Add samples along the taper even when an original road is one segment.
    const samples: Point[] = [];
    for (let i = 1; i < lane.points.length; i++) {
      const a = lane.points[i - 1], b = lane.points[i], length = dist(a, b);
      const steps = Math.max(1, Math.ceil(length / 1.5));
      for (let j = 0; j < steps; j++) samples.push(new Point(a.x + (b.x - a.x) * j / steps, a.y + (b.y - a.y) * j / steps));
    }
    samples.push(lane.points.at(-1)!);
    const edge = (side: 1 | -1): Point[] => offsetPolyline(samples, width / 2 + 0.02, side).map(p => {
      let nearest = lane.points[0], at = 0, distance = Infinity;
      for (let i = 1; i < lane.points.length; i++) {
        const q = closestPointOnSegment(p, lane.points[i - 1], lane.points[i]), d = dist(p, q);
        if (d < distance) { nearest = q; distance = d; at = acc[i - 1] + dist(q, lane.points[i - 1]); }
      }
      const local = Math.min(startWidth + (width - startWidth) * smooth(at / taper),
        endWidth + (width - endWidth) * smooth((total - at) / taper));
      const factor = (local / 2 + 0.02) / (width / 2 + 0.02);
      return new Point(nearest.x + (p.x - nearest.x) * factor, nearest.y + (p.y - nearest.y) * factor);
    });
    clips.set(lane.id, [...edge(1), ...edge(-1).reverse()]);
  }
  return clips;
}
