import type { Patch } from './patch.js';
import type { PatchAdjacency } from './adjacency.js';
import { Point } from '../types/point.js';
import { createUrbanisationField, radialProfile, SATELLITE_POP_THRESHOLD, type UrbanisationField } from './urbanisation.js';
import type { WeightedRoad } from './route-weight.js';

export type Zone = 'core' | 'suburb' | 'satellite' | 'farm' | 'wilderness';

/** Ribbon reach as a multiple of the core radius. */
const REACH_MULTIPLIER = 6;
/**
 * Halo reach as a multiple of the core radius — now a thin apron rather than
 * a deep skirt. Task 6 (round-cores-faubourgs) deleted the ring-completion
 * bonus that used to force an even band around the whole core; the halo's
 * job is now only to give a roadless burg (and the ground right against the
 * wall on every burg) something to grow into, while weighted corridors
 * (route-weight.ts) carry the asymmetric bulk of extramural growth. TUNE:
 * shrunk from 2.5 so the halo does not compete with the corridors for the
 * outer candidates.
 */
const HALO_REACH_MULTIPLIER = 1.5;
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
 * Beyond this multiple of the core radius a built patch reads as an outlying
 * hamlet. Tied to REACH_MULTIPLIER by definition: the ribbons stop there, so
 * anything further out is on a satellite bump, not on the continuous ribbon.
 */
const SATELLITE_DISTANCE = REACH_MULTIPLIER;

export interface SprawlArgs {
  patches: Patch[];
  inner: Patch[];
  adjacency: PatchAdjacency;
  /** Approaching roads, weighted by data + seeded rank decay (route-weight.ts). */
  roads: WeightedRoad[];
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
  /** Physical city districts grow contiguously before following distant roads. */
  compact?: boolean;
  seed?: number;
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
  const { patches, inner, adjacency, roads, coreRadius, coreOutline, population, isBuildable, budget } = args;

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
    roads,
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
  if (args.compact) {
    const available = new Set(candidates), built = new Set(inner);
    const meanArea = inner.reduce((s,p)=>s+Math.abs(p.shape.square),0)/Math.max(1,inner.length);
    const cityRadius = Math.max(coreRadius,Math.sqrt(meanArea*(inner.length+budget)/Math.PI));
    const phase = (args.seed??0)*2.399963229728653;
    const priority = new Map(candidates.map(p=>{
      const c=p.shape.center, angle=Math.atan2(c.y,c.x);
      // Road influence must reach the OUTER city, not expire near the small
      // historic core. Broad corridors and coherent local variation shape an
      // uneven outline while frontier growth keeps neighbourhoods connected.
      const corridor = roads.reduce((best,road)=>{
        const along=c.x*road.direction.x+c.y*road.direction.y;
        const across=c.x*road.direction.y-c.y*road.direction.x;
        return along<=0 ? best : Math.max(best,Math.sqrt(road.weight)*Math.exp(-Math.pow(across/(cityRadius*.28),2)));
      },0);
      const growth = .8+1.1*corridor+.06*Math.sin(2*angle+phase)+.04*Math.sin(3*angle-phase);
      return [p,c.length/growth] as const;
    }));
    const frontier = new Set<Patch>();
    const addNeighbours = (p: Patch) => {
      for (const n of adjacency.neighboursOf(p)) if (available.has(n)) frontier.add(n);
    };
    inner.forEach(addNeighbours);
    for (let claimed = 0; claimed < budget && frontier.size; claimed++) {
      let chosen: Patch | undefined, best = Infinity;
      for (const p of frontier) {
        const neighbours = adjacency.neighboursOf(p).filter(n=>built.has(n)).length;
        const score = priority.get(p)! - Math.min(3,neighbours)*cityRadius*.03;
        if (score < best) { best = score; chosen = p; }
      }
      if (!chosen) break;
      frontier.delete(chosen);available.delete(chosen);built.add(chosen);
      chosen.zone = 'suburb';chosen.withinCity = true;addNeighbours(chosen);
    }
    return field;
  }
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
