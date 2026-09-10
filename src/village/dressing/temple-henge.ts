import { Point } from '../../types/point.js';
import { STONE_CIRCLE_FOOTPRINT_RADIUS_M } from '../constants.js';
import { arcLengths, dist, greenDrawnRadius, sampleAt } from '../geometry.js';
import { hasGlyph } from '../glyphs.js';
import type { Croft, Green, Lane, Lot, Poi, Site } from '../types.js';
import { circleClearOfClaims, circleIntersectsPolygon } from './pois.js';

/** Reserve FMG's requested henge beside an accessible street before fields
 * and woodland claim its ground. Nearer the village centre wins. */
export function reserveTempleHenge(
  site: Site, green: Green, lanes: Lane[], lots: Lot[], crofts: Croft[], fabricRadiusM: number,
): { poi: Poi; clearing: Point[]; access: Lane } | null {
  if (!site.flags.temple || !hasGlyph('sm-stone-circle')) return null;
  const radius = STONE_CIRCLE_FOOTPRINT_RADIUS_M;
  let best: { poi: Poi; clearing: Point[]; access: Lane; score: number } | undefined;
  const limit = Math.max(fabricRadiusM + 50, greenDrawnRadius(green) + 60);
  // A routeless village can reach its clearing across the central common.
  const paths = lanes.length ? lanes : [{ id: 'green', type: 'footpath' as const, widthM: 1,
    points: [green.centre, new Point(green.centre.x + greenDrawnRadius(green), green.centre.y)] }];
  for (const lane of [...paths].sort((a, b) => a.id.localeCompare(b.id))) {
    const acc = arcLengths(lane.points);
    for (let s = 0; s <= acc.at(-1)!; s += 6) {
      const q = sampleAt(lane.points, acc, s).p;
      if (dist(q, green.centre) > limit) continue;
      const a = sampleAt(lane.points, acc, Math.max(0, s - .5)).p;
      const b = sampleAt(lane.points, acc, Math.min(acc.at(-1)!, s + .5)).p;
      const length = dist(a, b); if (length < 1e-6) continue;
      for (const side of [-1, 1]) for (const extra of [0, 8, 16]) {
        const offset = radius + lane.widthM / 2 + 3 + extra;
        const nx = -(b.y - a.y) / length * side, ny = (b.x - a.x) / length * side;
        const position = new Point(q.x + nx * offset, q.y + ny * offset);
        if (dist(position, green.centre) < greenDrawnRadius(green) + radius + 2) continue;
        const score = dist(position, green.centre) + extra * .5;
        if (best && score >= best.score) continue;
        if (!circleClearOfClaims(position, radius + 2, lanes, lots, crofts, [])) continue;
        if (site.water.some(p => circleIntersectsPolygon(position, radius + 2, p))) continue;
        const end = new Point(position.x - nx * (radius + 1), position.y - ny * (radius + 1));
        let clear = true;
        const steps = Math.max(1, Math.ceil(dist(q, end)));
        for (let i = 0; i <= steps && clear; i++) {
          const p = new Point(q.x + (end.x - q.x) * i / steps, q.y + (end.y - q.y) * i / steps);
          clear = circleClearOfClaims(p, .7, [], lots, crofts, [])
            && !site.water.some(w => circleIntersectsPolygon(p, .7, w));
        }
        if (!clear) continue;
        best = {
          score,
          poi: { id: 'poi:stone-circle', kind: 'stone-circle', glyph: 'sm-stone-circle', position, bearingDeg: 0 },
          // Circumscribed, so field clipping cannot nibble inside the round clearing.
          clearing: Array.from({ length: 24 }, (_, i) => new Point(position.x + Math.cos(i * Math.PI / 12) * (radius + 2) / Math.cos(Math.PI / 24), position.y + Math.sin(i * Math.PI / 12) * (radius + 2) / Math.cos(Math.PI / 24))),
          access: { id: 'poi:stone-circle/access', type: 'footpath', routeRole: 'street', widthM: 1.4, surfaceWidthM: 1,
            setbackM: .3, points: [q, end], ...(lane.id !== 'green' ? { parentId: lane.id } : {}) },
        };
      }
    }
  }
  return best ?? null;
}
