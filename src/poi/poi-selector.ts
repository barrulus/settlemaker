import type { Model } from '../generator/model.js';
import type { Polygon } from '../geom/polygon.js';
import { Point } from '../types/point.js';
import type { IdAllocator } from '../output/id-allocator.js';
import type { Poi } from './poi-kinds.js';

/**
 * Order buildings by desirability: largest first, tiebreak by shortest distance
 * from building centroid to `reference`. Pure function; does not mutate inputs.
 *
 * The reference point lets callers bias selection toward streets: passing the
 * nearest artery vertex scores buildings near it higher. For burgs without
 * arteries, callers pass `model.center`.
 */
export function scoreBuildings(buildings: Polygon[], reference: Point): Polygon[] {
  const scored = buildings.map(b => {
    const c = b.centroid;
    const dx = c.x - reference.x;
    const dy = c.y - reference.y;
    return { b, area: b.square, dist2: dx * dx + dy * dy };
  });
  scored.sort((x, y) => {
    if (y.area !== x.area) return y.area - x.area; // area desc
    return x.dist2 - y.dist2;                       // distance asc
  });
  return scored.map(s => s.b);
}

/**
 * Reference point for scoring: centroid of the nearest artery vertex to the
 * burg center, or the burg center itself if no arteries exist (tiny unwalled
 * hamlets may have only approach roads).
 */
export function scoringReference(model: Model): Point {
  if (model.arteries.length === 0) return model.center;
  let best: Point | null = null;
  let bestD2 = Infinity;
  for (const artery of model.arteries) {
    for (const v of artery.vertices) {
      const dx = v.x - model.center.x;
      const dy = v.y - model.center.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) { bestD2 = d2; best = v; }
    }
  }
  return best ?? model.center;
}

// `selectPois` implementation lands in Task 5. This stub keeps the module compiling
// until then — deleted in Task 5, not a permanent placeholder.
export function selectPois(
  _model: Model,
  _population: number,
  _allocator: IdAllocator,
  _buildingIdMap: Map<Polygon, string>,
): Poi[] {
  return [];
}
