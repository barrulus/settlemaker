import type { Patch } from './patch.js';
import type { PatchAdjacency } from './adjacency.js';
import { Point } from '../types/point.js';
import { createUrbanisationField, radialProfile, SATELLITE_POP_THRESHOLD, type UrbanisationField } from './urbanisation.js';

export type Zone = 'core' | 'suburb' | 'satellite' | 'farm' | 'wilderness';

/** Ribbon reach as a multiple of the core radius. */
const REACH_MULTIPLIER = 6;
/**
 * Halo reach as a multiple of the core radius — a skirt two core-radii deep
 * beyond the wall. Shorter than REACH_MULTIPLIER on purpose: at metropolis
 * scale the budget (181 patches) exceeds every candidate within 4 core radii
 * (measured: ~200), so an unbounded skirt swallows the whole budget and the
 * arms vanish. Bounding it hands the outer candidates to the corridors.
 */
const HALO_REACH_MULTIPLIER = 2.5;
/** Corridor half-width as a fraction of the core radius. */
const CORRIDOR_FRACTION = 0.45;
/**
 * Halo decay length as a fraction of the core radius. At 0.75 the skirt is
 * still at 26% of full strength one core-radius out from the wall, but down to
 * 7% at two — so the whole first ring outranks any arm patch beyond it, and
 * the render reads as a band with arms rather than arms alone.
 */
const HALO_DEPTH_FRACTION = 0.75;
/** Extra score for touching already-built fabric — this is what fuses ribbons into a belt. */
const NEIGHBOUR_BONUS = 0.35;
/**
 * Angular bins used to track which bearings from the settlement centre already
 * carry extramural fabric. 36 bins = 10 degrees, finer than the 24-bin (15
 * degree) measure the render is judged by, so the preference resolves gaps the
 * measure can see.
 */
const COVERAGE_BINS = 36;
/**
 * Bins of angular separation from the nearest already-built extramural patch
 * at which the coverage preference is at full strength. 3 bins = 30 degrees:
 * roughly the angular width a single suburb patch's buildings occupy just
 * outside the wall, so "full bonus" means "far enough away to be a genuinely
 * new piece of the ring".
 */
const COVERAGE_SPAN_BINS = 3;
/**
 * Weight of the angular-coverage preference. Deliberately larger than
 * NEIGHBOUR_BONUS: the neighbour bonus is what fuses crowded ribbons into a
 * continuous belt and must stay, but it directly fights ring COMPLETION —
 * extra budget otherwise piles onto whichever side got started first (measured
 * at pop 4000: only 11-17 of 24 angular sectors covered, while cities reached
 * 24/24). At 0.5 an empty bearing outranks a patch that merely thickens an
 * existing cluster, while the two remain the same order of magnitude, so a
 * strongly-scored frontier patch can still win. The preference is self-
 * cancelling at city scale: once every bin carries fabric — which happens
 * within the first ~36 of a metropolis's 180-odd claims — the term is zero
 * everywhere and belt fusion proceeds exactly as before (verified: 24/24
 * coverage preserved at pops 50000 and 250000, roaded and roadless).
 */
const COVERAGE_BONUS = 0.5;
/**
 * Beyond this multiple of the core radius a built patch reads as an outlying
 * hamlet. Tied to REACH_MULTIPLIER by definition: the ribbons stop there, so
 * anything further out is on a satellite bump, not on the continuous ribbon.
 */
const SATELLITE_DISTANCE = REACH_MULTIPLIER;

export interface SprawlArgs {
  patches: Patch[];
  inner: Patch[];
  adjacency: PatchAdjacency;
  roadDirections: Point[];
  coreRadius: number;
  /**
   * Vertices of the core outline (the wall shape), origin-centred. The core is
   * lobed, so `coreRadius` alone (the circumscribed radius) would put the
   * halo's inner edge at the lobe tips. Optional: without it the halo falls
   * back to the scalar radius.
   */
  coreOutline?: Point[];
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
  const { patches, inner, adjacency, roadDirections, coreRadius, coreOutline, population, isBuildable, budget } = args;

  for (const p of patches) p.zone = 'wilderness';
  for (const p of inner) p.zone = 'core';

  const satellites = population >= SATELLITE_POP_THRESHOLD;
  const reach = coreRadius * REACH_MULTIPLIER;

  // No roads is a real case (roadBearings: [] is authoritative) and needs no
  // special handling any more: the halo term is isotropic, so a roadless burg
  // gets a continuous ring on its own. The previous six-direction fallback
  // only existed because the field could score nothing off a road ray, and it
  // produced a lumpy hexagon rather than a belt.
  const field = createUrbanisationField({
    roadDirections,
    coreRadius,
    coreRadiusAt: coreOutline && coreOutline.length >= 3 ? radialProfile(coreOutline) : undefined,
    haloDepth: Math.max(1, coreRadius * HALO_DEPTH_FRACTION),
    haloReach: coreRadius * HALO_REACH_MULTIPLIER,
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

  // Angular occupancy of the extramural fabric built so far. Plain boolean
  // array indexed by bin, so nothing about the iteration order of a Set or Map
  // can decide a winner — the greedy loop stays deterministic.
  const occupied = new Array<boolean>(COVERAGE_BINS).fill(false);
  let anyOccupied = false;
  const binOf = (p: Patch): number => {
    const c = p.shape.center;
    const a = Math.atan2(c.y, c.x);
    const b = Math.floor(((a + Math.PI) / (2 * Math.PI)) * COVERAGE_BINS);
    return Math.min(COVERAGE_BINS - 1, Math.max(0, b));
  };
  // Bins of separation from the nearest bin that already carries fabric, 0 if
  // this bin does. Scans outward from the candidate's own bin, so it is O(bins)
  // and needs no distance transform.
  const gapBins = (bin: number): number => {
    for (let d = 0; d <= COVERAGE_BINS / 2; d++) {
      if (occupied[(bin + d) % COVERAGE_BINS]) return d;
      if (occupied[(bin - d + COVERAGE_BINS) % COVERAGE_BINS]) return d;
    }
    return COVERAGE_BINS / 2;
  };

  for (let claimed = 0; claimed < budget && remaining.length > 0; claimed++) {
    let bestIdx = -1;
    let bestScore = 0;
    for (let i = 0; i < remaining.length; i++) {
      const p = remaining[i];
      let score = base.get(p)!;
      for (const n of adjacency.neighboursOf(p)) {
        if (built.has(n)) { score += NEIGHBOUR_BONUS; break; }
      }
      // Prefer a bearing the ring does not cover yet over one that merely
      // thickens an existing cluster. Inert until something extramural exists
      // (the term would be uniform, and so could not rank anything) and inert
      // again once every bearing is covered.
      if (anyOccupied) {
        score += COVERAGE_BONUS * Math.min(1, gapBins(binOf(p)) / COVERAGE_SPAN_BINS);
      }
      if (score > bestScore) { bestScore = score; bestIdx = i; }
    }
    if (bestIdx === -1) break;

    const chosen = remaining.splice(bestIdx, 1)[0];
    built.add(chosen);
    occupied[binOf(chosen)] = true;
    anyOccupied = true;
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
