import type { Patch } from './patch.js';
import type { PatchAdjacency } from './adjacency.js';
import { Point } from '../types/point.js';
import { createUrbanisationField, SATELLITE_POP_THRESHOLD, type UrbanisationField } from './urbanisation.js';

export type Zone = 'core' | 'suburb' | 'satellite' | 'farm' | 'wilderness';

/** Ribbon reach as a multiple of the core radius. */
const REACH_MULTIPLIER = 4;
/** Corridor half-width as a fraction of the core radius. */
const CORRIDOR_FRACTION = 0.45;
/** Extra score for touching already-built fabric — this is what fuses ribbons into a belt. */
const NEIGHBOUR_BONUS = 0.35;
/** Beyond this multiple of the core radius, a built patch reads as an outlying hamlet. */
const SATELLITE_DISTANCE = 4;

export interface SprawlArgs {
  patches: Patch[];
  inner: Patch[];
  adjacency: PatchAdjacency;
  roadDirections: Point[];
  coreRadius: number;
  population: number;
  /** Patches to leave alone: water, and anything already given a ward. */
  isBuildable: (patch: Patch) => boolean;
  /** How many patches sprawl may claim (total budget minus the core). */
  budget: number;
}

/**
 * Label every patch. The core is already chosen; this grows extramural
 * fabric outward along road corridors, greedily and one patch at a time so
 * that the neighbour bonus can fuse crowded ribbons into a continuous belt.
 *
 * Returns the field it built so callers (and tests) can score patches
 * against the very field that produced the zoning, rather than rebuilding
 * it from constants that may later be tuned.
 */
export function assignSprawl(args: SprawlArgs): UrbanisationField {
  const { patches, inner, adjacency, roadDirections, coreRadius, population, isBuildable, budget } = args;

  for (const p of patches) p.zone = 'wilderness';
  for (const p of inner) p.zone = 'core';

  const satellites = population >= SATELLITE_POP_THRESHOLD;
  const reach = coreRadius * REACH_MULTIPLIER;

  // No roads is a real case (roadBearings: [] is authoritative). Fall back to
  // a ring of directions so the overflow forms a belt rather than a disc of
  // the same shape as the core.
  const directions = roadDirections.length > 0
    ? roadDirections
    : Array.from({ length: 6 }, (_, i) => {
        const a = i * Math.PI / 3;
        return new Point(Math.cos(a), Math.sin(a));
      });

  const field = createUrbanisationField({
    roadDirections: directions,
    coreRadius,
    reach,
    corridorHalfWidth: Math.max(1, coreRadius * CORRIDOR_FRACTION),
    satellites,
    satelliteSpacing: coreRadius,
  });

  // Nothing to claim (core already fills the budget) — the field is still
  // returned so callers can score against it.
  if (budget <= 0) return field;

  const candidates = patches.filter(p => p.zone === 'wilderness' && isBuildable(p));
  const base = new Map<Patch, number>();
  for (const p of candidates) base.set(p, field.scoreAt(p.shape.center));

  const built = new Set<Patch>(inner);
  const remaining = candidates.filter(p => (base.get(p) ?? 0) > 0);

  for (let claimed = 0; claimed < budget && remaining.length > 0; claimed++) {
    let bestIdx = -1;
    let bestScore = 0;
    for (let i = 0; i < remaining.length; i++) {
      const p = remaining[i];
      let score = base.get(p)!;
      for (const n of adjacency.neighboursOf(p)) {
        if (built.has(n)) { score += NEIGHBOUR_BONUS; break; }
      }
      if (score > bestScore) { bestScore = score; bestIdx = i; }
    }
    if (bestIdx === -1) break;

    const chosen = remaining.splice(bestIdx, 1)[0];
    built.add(chosen);
    // `along` (the field's road-projection distance) is what actually
    // separates ribbon from satellite — raw distance-from-centre can exceed
    // coreRadius*SATELLITE_DISTANCE for an off-axis ribbon patch even when
    // `satellites` is false (measured: 3/60 runs mislabeled a patch
    // 'satellite' below SATELLITE_POP_THRESHOLD, e.g. pop 49000 seeds
    // 1/5/7). Gate on the same `satellites` flag the field itself was built
    // with, so a below-threshold settlement can never emit the label.
    chosen.zone = satellites && chosen.shape.center.length > coreRadius * SATELLITE_DISTANCE
      ? 'satellite'
      : 'suburb';
    chosen.withinCity = true;
  }

  return field;
}
