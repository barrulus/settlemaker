import { Point } from '../types/point.js';
import type { RoadEntry } from './generation-params.js';
import type { SeededRandom } from '../utils/random.js';

export interface WeightedRoad {
  direction: Point;
  weight: number;
  /**
   * The data-driven component of `weight`, BEFORE the seeded rank decay
   * (`rawRouteWeight(entry)`). Used by urbanisation.ts to scale a road's
   * corridor reach: bare-bearing burgs (no route data) must scale by 1.0 so
   * their reach is untouched and their SVG stays byte-identical — only the
   * decay-driven score-order tilt, not a reach change, produces their
   * asymmetry. Only burgs sending genuine route character (trails, ridges,
   * through-routes) should have their reach reshaped.
   */
  rawWeight: number;
}

const RANK_DECAY = 0.55; // TUNE: weight multiplier per rank step down

export function rawRouteWeight(e: RoadEntry): number {
  const base = e.group === 'trails' || e.kind === 'foot' ? 0.15 : 1.0;
  const through = e.through ? 1.5 : 1.0;
  const relief = e.relief === 'ridge' ? 0.25 : e.relief === 'ascent' ? 0.5 : 1.0;
  const river = e.followsRiver ? 1.2 : 1.0;
  return base * through * relief * river;
}

/**
 * Raw weights x seeded rank decay. The decay is what makes 1-2 approaches
 * dominate even when FMG sends no distinguishing data (bare bearings):
 * routes are ranked by raw weight with seeded jitter breaking ties, then
 * rank k keeps RANK_DECAY^k of its weight.
 */
export function routeWeights(entries: RoadEntry[], rng: SeededRandom): WeightedRoad[] {
  const jittered = entries.map(e => ({ e, key: rawRouteWeight(e) * (0.75 + 0.5 * rng.float()) }));
  const order = [...jittered].sort((a, b) => b.key - a.key);
  const rankOf = new Map(order.map((o, i) => [o.e, i]));
  return entries.map(e => ({
    direction: e.point,
    weight: rawRouteWeight(e) * Math.pow(RANK_DECAY, rankOf.get(e)!),
    rawWeight: rawRouteWeight(e),
  }));
}
