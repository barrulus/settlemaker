import { Point } from '../types/point.js';
import type { WeightedRoad } from './route-weight.js';

/** Population above which outlying hamlets appear along the road corridors. */
export const SATELLITE_POP_THRESHOLD = 50000;
/** Satellite bumps to emit per road, each weaker than the last. */
const SATELLITE_COUNT = 3;
/** Score multiplier per successive satellite. */
const SATELLITE_FALLOFF = 0.6;

/**
 * Weight of the isotropic halo — the thin gate apron that wraps the wall.
 * Task 6 (round-cores-faubourgs, spec 2026-08-09 §5) deleted the
 * ring-completion bonus that used to force an even band around the whole
 * core; the halo's remaining job is to give a roadless burg (and the ground
 * right against the wall on every burg) something to grow into. It no
 * longer carries the majority of extramural growth — the weighted road
 * corridors below do (see HALO_REACH_MULTIPLIER / HALO_DEPTH_FRACTION in
 * zoning.ts, which shrink the halo's reach and decay length specifically so
 * it stops competing with the corridors for outer candidates).
 */
const HALO_WEIGHT = 1;
/**
 * Weight of the road corridors, relative to the halo. Despite the name this
 * is now where most extramural growth is carried: corridors extend well
 * past the halo's (now-thin) apron, so on-road ground at distance dominates
 * the built-patch budget while the halo only seeds growth close to the
 * wall.
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

/**
 * Floor on the reach-scaling fraction (see `reachFraction` below) — even a
 * pure foot trail (rawWeight 0.15) still gets a short stub, not zero.
 * f(1.0) = 1 (full reach, unchanged), f(0.15) = MIN_REACH_FRACTION (~0.3, a
 * trail arm reaching roughly a third as far as a strong road).
 */
const MIN_REACH_FRACTION = 0.3;
/**
 * Below this raw weight, a road is too "quiet" (a trail, a foot path) to
 * throw a detached satellite hamlet — those read as deliberate settlements
 * in their own right, which a bare trail's worth of data does not support.
 * Chosen so plain trails/foot routes (0.15) are suppressed while anything
 * carrying at least normal road weight (1.0) or better still can.
 */
const SATELLITE_MIN_RAW_WEIGHT = 0.5;

/**
 * Data-driven reach scaling. Identity clamped to [MIN_REACH_FRACTION, 1]:
 * boosts above 1.0 (through-routes, river-followers) are clamped back to 1
 * so they extend a corridor's SCORE but never its REACH — reach extension
 * was never approved for those. Deliberately keyed on `rawWeight` (the
 * pre-decay, data-only component from route-weight.ts) rather than the final
 * `weight`, which folds in the seeded rank decay: bare-bearing burgs (no
 * route data at all) have rawWeight === 1 for every approach, so this always
 * returns 1 for them and their reach — and therefore their rendered SVG —
 * is untouched.
 */
function reachFraction(rawWeight: number): number {
  return Math.min(1, Math.max(MIN_REACH_FRACTION, rawWeight));
}

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
  // `along > coreRadius` guard already makes `along < roadReach` impossible
  // (roadReach is always <= reach; see `reachFraction`, computed per-road below).

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

    for (const { direction: d, weight, rawWeight } of roads) {
      const along = p.x * d.x + p.y * d.y;
      if (along <= coreRadius) continue;

      // Per-road reach: a road's corridor ribbon (and, by extension, its
      // satellites) extends only as far as its DATA-DRIVEN weight earns —
      // a trail stays short and stubby even when the sprawl budget is huge,
      // rather than growing a full-sized arm once the strong roads saturate.
      // See `reachFraction` for why this uses `rawWeight`, not `weight`.
      const frac = reachFraction(rawWeight);
      const roadReach = coreRadius + (reach - coreRadius) * frac;
      const roadSpan = Math.max(1, roadReach - coreRadius);

      const perpX = p.x - along * d.x;
      const perpY = p.y - along * d.y;
      const perp = Math.sqrt(perpX * perpX + perpY * perpY);

      // Taper: the ribbon narrows as it runs out, so an arm reads as an arm
      // rather than a constant-width stripe whose paint merely fades.
      const t = Math.min(1, (along - coreRadius) / roadSpan);
      const width = corridorHalfWidth * Math.max(MIN_TAPER, 1 - CORRIDOR_TAPER * t);

      // Guard against NaN when corridorHalfWidth === 0: return 1 only if exactly
      // on the road (perp === 0), 0 otherwise, representing an infinitely sharp corridor.
      let lateral: number;
      if (width === 0) {
        lateral = perp === 0 ? 1 : 0;
      } else {
        lateral = Math.exp(-(perp * perp) / (width * width));
      }

      // Continuous ribbon: linear decay from the core out to this road's
      // own reach.
      if (along < roadReach) {
        score += weight * SPOKE_WEIGHT * lateral * (1 - (along - coreRadius) / roadSpan);
      }

      // Satellites: gaussian bumps on the SAME ray, so outlying hamlets are on-road
      // by construction. The satellite loop runs at every `along` value when satellites
      // is true; separation from the ribbon comes purely from gaussian decay around
      // each bump centre at roadReach + k*satelliteSpacing. Quiet approaches
      // (trails, foot paths) are suppressed entirely — see SATELLITE_MIN_RAW_WEIGHT.
      if (satellites && rawWeight >= SATELLITE_MIN_RAW_WEIGHT) {
        for (let k = 1; k <= SATELLITE_COUNT; k++) {
          const centre = roadReach + k * satelliteSpacing;
          const u = (along - centre) / (satelliteSpacing * 0.5);
          score += weight * SATELLITE_WEIGHT * lateral * Math.exp(-u * u) * Math.pow(SATELLITE_FALLOFF, k);
        }
      }
    }

    return score;
  }

  return { scoreAt };
}
