import { Point } from '../types/point.js';
import type { WeightedRoad } from './route-weight.js';

/** Population above which outlying hamlets appear along the road corridors. */
export const SATELLITE_POP_THRESHOLD = 50000;
/** Satellite bumps to emit per road, each weaker than the last. */
const SATELLITE_COUNT = 3;
/** Score multiplier per successive satellite. */
const SATELLITE_FALLOFF = 0.6;

/**
 * Weight of the isotropic halo — the skirt of building that wraps the wall.
 * This term carries the MAJORITY of extramural growth: a settlement must read
 * as a dense band around the core with thinner arms, not as arms alone.
 */
const HALO_WEIGHT = 1;
/**
 * Weight of the road corridors, relative to the halo. Deliberately below it:
 * on-road points still outrank off-road points at the same distance (the arms
 * are legible), but the whole first ring outranks anything further out along a
 * road, so the ring fills before the arms extend.
 */
const SPOKE_WEIGHT = 0.5;
/**
 * Fraction of the corridor half-width lost by the far end of the ribbon, so a
 * spoke narrows as it runs out instead of staying a constant-width stripe.
 */
const CORRIDOR_TAPER = 0.7;
/** Floor on the tapered width factor — satellites must not be infinitely thin. */
const MIN_TAPER = 0.3;
/**
 * Weight of the satellite bumps. NOT reduced by `SPOKE_WEIGHT`: a satellite is
 * a detached hamlet beyond the halo's outer bound, so it competes only against
 * the neighbour bonus of the contiguous frontier. At SPOKE_WEIGHT the frontier
 * always won and no burg ever emitted one (measured: 0 satellites at seeds 5
 * and 7, pop 250000).
 */
const SATELLITE_WEIGHT = 1;

export interface UrbanisationOptions {
  /**
   * Approaching roads, weighted by how much extramural growth each pulls
   * (`route-weight.ts`). May be empty. The weight multiplies both the
   * ribbon and satellite terms, so a bare trail or a ridge approach still
   * scores something (roads never gate to zero) but a through-route on flat
   * ground dominates.
   */
  roads: WeightedRoad[];
  /** Sprawl starts outside this radius — inside it is the core's business. */
  coreRadius: number;
  /**
   * Radius of the core edge in the direction of `p`. The core is lobed, so a
   * single scalar radius (the circumscribed one, `CurtainWall.getRadius`)
   * places the halo's inner edge at the lobe TIPS and leaves the ground
   * between lobes — exactly where a real faubourg sits — scoring zero.
   * Defaults to the scalar `coreRadius`.
   */
  coreRadiusAt?: (p: Point) => number;
  /**
   * Distance from the core edge over which the halo decays to ~37%. Governs
   * how thick the skirt is. 0 disables the halo entirely.
   */
  haloDepth: number;
  /**
   * Radius at which the halo stops. Deliberately shorter than `reach`: at
   * metropolis scale the sprawl budget is large enough to claim EVERY
   * candidate patch the halo can reach, so if the halo ran as far as the
   * ribbons the arms would have nowhere left to go and the settlement would
   * render as one isotropic blob. Bounding the skirt leaves the outer
   * candidates to the corridors, which is what makes arms legible.
   * Defaults to `reach`.
   */
  haloReach?: number;
  /** Distance at which continuous ribbon growth has decayed to nothing. */
  reach: number;
  /** Perpendicular distance at which a corridor has decayed to ~37%, before taper. */
  corridorHalfWidth: number;
  satellites: boolean;
  /** Gap between satellite bumps beyond `reach`. */
  satelliteSpacing: number;
}

export interface UrbanisationField {
  /** Built-ness at a point. 0 means "not a candidate for sprawl". */
  scoreAt(p: Point): number;
}

/**
 * Build a directional core-radius probe from a core outline. Bins the outline
 * vertices by angle and takes the furthest in each bin, then interpolates
 * linearly between bin centres so the resulting profile is continuous rather
 * than stepped. Pure and deterministic — no rng, and the bin order is fixed.
 */
export function radialProfile(outline: Point[], bins: number = 36): (p: Point) => number {
  const fallback = outline.reduce((m, v) => Math.max(m, v.length), 0);
  const raw: number[] = new Array(bins).fill(0);
  for (const v of outline) {
    const a = Math.atan2(v.y, v.x);
    let b = Math.floor(((a + Math.PI) / (2 * Math.PI)) * bins);
    if (b < 0) b = 0;
    if (b >= bins) b = bins - 1;
    raw[b] = Math.max(raw[b], v.length);
  }
  // Empty bins (a coarse outline cannot fill 36 of them) inherit the nearest
  // filled bin going each way, so the profile never collapses to zero.
  const filled = raw.slice();
  for (let i = 0; i < bins; i++) {
    if (filled[i] > 0) continue;
    let best = 0;
    for (let step = 1; step <= bins; step++) {
      const a = raw[(i - step + bins * 2) % bins];
      const b = raw[(i + step) % bins];
      if (a > 0 || b > 0) { best = Math.max(a, b); break; }
    }
    filled[i] = best > 0 ? best : fallback;
  }

  return (p: Point): number => {
    const a = Math.atan2(p.y, p.x);
    const t = ((a + Math.PI) / (2 * Math.PI)) * bins - 0.5;
    const i0 = Math.floor(t);
    const f = t - i0;
    const lo = filled[((i0 % bins) + bins) % bins];
    const hi = filled[(((i0 + 1) % bins) + bins) % bins];
    return lo + (hi - lo) * f;
  };
}

export function createUrbanisationField(opts: UrbanisationOptions): UrbanisationField {
  const {
    roads, coreRadius, haloDepth, reach, corridorHalfWidth,
    satellites, satelliteSpacing,
  } = opts;
  const haloReach = opts.haloReach ?? reach;
  const coreRadiusAt = opts.coreRadiusAt ?? (() => coreRadius);
  // When reach <= coreRadius, the ribbon branch can never fire, because the outer
  // `along > coreRadius` guard already makes `along < reach` impossible.
  const span = Math.max(1, reach - coreRadius);

  function scoreAt(p: Point): number {
    let score = 0;

    // Halo: a function of distance from the core EDGE in every direction and of
    // nothing else, so an extramural ring exists even with no roads at all.
    // Dense against the wall, thinning outward, which is also what makes
    // surplus population thicken the skirt rather than grow the core.
    if (haloDepth > 0) {
      const r = p.length;
      const d = r - coreRadiusAt(p);
      if (d > 0 && r < haloReach) score += HALO_WEIGHT * Math.exp(-d / haloDepth);
    }

    for (const { direction: d, weight } of roads) {
      const along = p.x * d.x + p.y * d.y;
      if (along <= coreRadius) continue;

      const perpX = p.x - along * d.x;
      const perpY = p.y - along * d.y;
      const perp = Math.sqrt(perpX * perpX + perpY * perpY);

      // Taper: the ribbon narrows as it runs out, so an arm reads as an arm
      // rather than a constant-width stripe whose paint merely fades.
      const t = Math.min(1, (along - coreRadius) / span);
      const width = corridorHalfWidth * Math.max(MIN_TAPER, 1 - CORRIDOR_TAPER * t);

      // Guard against NaN when corridorHalfWidth === 0: return 1 only if exactly
      // on the road (perp === 0), 0 otherwise, representing an infinitely sharp corridor.
      let lateral: number;
      if (width === 0) {
        lateral = perp === 0 ? 1 : 0;
      } else {
        lateral = Math.exp(-(perp * perp) / (width * width));
      }

      // Continuous ribbon: linear decay from the core out to `reach`.
      if (along < reach) {
        score += weight * SPOKE_WEIGHT * lateral * (1 - (along - coreRadius) / span);
      }

      // Satellites: gaussian bumps on the SAME ray, so outlying hamlets are on-road
      // by construction. The satellite loop runs at every `along` value when satellites
      // is true; separation from the ribbon comes purely from gaussian decay around
      // each bump centre at reach + k*satelliteSpacing.
      if (satellites) {
        for (let k = 1; k <= SATELLITE_COUNT; k++) {
          const centre = reach + k * satelliteSpacing;
          const u = (along - centre) / (satelliteSpacing * 0.5);
          score += weight * SATELLITE_WEIGHT * lateral * Math.exp(-u * u) * Math.pow(SATELLITE_FALLOFF, k);
        }
      }
    }

    return score;
  }

  return { scoreAt };
}
