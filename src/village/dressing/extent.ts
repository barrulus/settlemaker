import { Point } from '../../types/point.js';
import { bearingOf, dist } from '../geometry.js';
import { EXTENT_BIN_DEG } from '../constants.js';

/**
 * GATE 8: HOW FAR THE VILLAGE REACHES, PER BEARING.
 *
 * Every dressing stage after the fields used to take a single number for
 * "where the built-up edge is" (`computeFabricRadius`, a max over every
 * claim) and a single number for "where the field ring ends", and then laid
 * a band of fixed depth beyond it. With the radius profile making the body
 * itself irregular, those two scalars were the last concentric circles in
 * the picture: an irregular village inside a perfectly round grove edge and
 * a perfectly round tree line reads WORSE than a round village, because the
 * eye has the circle right beside the blob to compare it to.
 *
 * A `RadialExtent` is the same measurement taken per bearing bin. It is
 * MEASURED from geometry that already exists (housed claims, croft
 * polygons, field blocks) rather than predicted from the profile, which is
 * the fix-wave rule: after pass 3 nothing keys off a prediction.
 *
 * Empty bins borrow their nearest occupied neighbour, so a bearing with no
 * fabric at all still has an answer, and the result is smoothed over
 * neighbouring bins so a single deep claim does not make a spike.
 */
export interface RadialExtent {
  at(p: Point): number;
  atBearing(bearingDeg: number): number;
  readonly maxM: number;
  /** The same extent pushed out by a fixed depth -- the vegetation band. */
  plus(depthM: number): RadialExtent;
}

const BINS = Math.round(360 / EXTENT_BIN_DEG);

function fromBins(centre: Point, bins: number[], floorM: number): RadialExtent {
  // Interpolated between BIN CENTRES, not stepped: a stepped edge draws the
  // field ring as a staircase of 15-degree treads, which is a different
  // artefact from the circle and no better.
  const atBearing = (bearingDeg: number): number => {
    const t = (((bearingDeg / EXTENT_BIN_DEG) - 0.5) % BINS + BINS) % BINS;
    const i = Math.floor(t);
    const f = t - i;
    return bins[i % BINS] + (bins[(i + 1) % BINS] - bins[i % BINS]) * f;
  };
  return {
    atBearing,
    at: (p: Point): number => atBearing(bearingOf(centre, p)),
    maxM: Math.max(floorM, ...bins),
    plus: (depthM: number): RadialExtent => fromBins(
      centre, bins.map((v) => v + depthM), floorM + depthM,
    ),
  };
}

/**
 * The extent that IS a circle -- one radius at every bearing. The village
 * engine never builds one (that is the point of gate 8); it exists for
 * callers that genuinely have a single radius to work with, and as the
 * thing the anisotropy tests measure against.
 */
export function circularExtent(centre: Point, radiusM: number): RadialExtent {
  return fromBins(centre, new Array<number>(BINS).fill(radiusM), radiusM);
}

/**
 * `points` are whatever marks the edge being measured -- claim corners,
 * croft vertices, field-block vertices. `floorM` is the answer for a
 * village with none of them at all.
 */
export function radialExtent(
  centre: Point, points: Iterable<Point>, floorM: number, percentile = 1,
): RadialExtent {
  // `percentile` 1 is "everything is inside here" -- the max, which is what
  // the vegetation band wants. The FIELD ring wants a high percentile
  // instead (gate 5's rule that the handful of ribbon claims beyond it are
  // clipped around, and that is what opens the road passes through the
  // ring), so the same measurement serves both.
  const perBin: number[][] = Array.from({ length: BINS }, () => []);
  for (const p of points) {
    const k = ((Math.floor(bearingOf(centre, p) / EXTENT_BIN_DEG) % BINS) + BINS) % BINS;
    perBin[k].push(dist(centre, p));
  }
  const raw: Array<number | null> = perBin.map((xs) => {
    if (xs.length === 0) return null;
    const sorted = xs.sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1,
      Math.max(0, Math.round(percentile * (sorted.length - 1))));
    return sorted[idx];
  });
  // Fill empty bins from the nearest occupied one either way.
  const filled: number[] = raw.map((v, i) => {
    if (v !== null) return v;
    for (let step = 1; step <= BINS; step++) {
      const a = raw[(i + step) % BINS];
      const b = raw[(i - step + BINS) % BINS];
      if (a !== null && b !== null) return (a + b) / 2;
      if (a !== null) return a;
      if (b !== null) return b;
    }
    return floorM;
  });
  // One pass of 3-bin smoothing: the edge of a village wanders, it does not
  // jag by a whole claim depth from one 15-degree bin to the next.
  const smoothed = filled.map((_, i) => (
    (filled[(i - 1 + BINS) % BINS] + filled[i] + filled[(i + 1) % BINS]) / 3
  ));
  return fromBins(centre, smoothed.map((v) => Math.max(floorM, v)), floorM);
}
