import { Point } from '../../types/point.js';
import { SeededRandom } from '../../utils/random.js';
import { bearingVector, inAnyWater } from '../geometry.js';
import type { Green, GreenShape, Site, SiteRoute } from '../types.js';
import { classRank, isRoadClass } from '../route-class.js';
import {
  GREEN_BUILT_RADIUS_DIVISOR, GREEN_DIAMETER_CAP_M, GREEN_DIAMETER_FLOOR_M,
  GREEN_REFERENCE_POP, GREEN_WATER_MARGIN_M,
} from '../constants.js';

/** Only road-group routes influence the green. */
export function roadArms(site: Site): SiteRoute[] {
  return site.routes.filter((r) => isRoadClass(r.type));
}

// Floors, reference population and caps all live in constants.ts — a gate
// verdict on green size is one edit there, not a hunt through this pass.

/**
 * The shape is a fossil of the junction that made it: a dead end pools
 * into a round blob; a single through-road swells into a lens; three
 * arms make the classic triangular green; four or more give a square.
 *
 * A `through` route arrives as ONE SiteRoute (through: true) — the lane
 * pass later splits it into two lanes (entering and leaving). So here,
 * arms.length === 1 with through: true is the lens case, and BOTH
 * arms.length === 2 and === 3 give a triangle: two distinct routes plus
 * a through route's far side is still a three-way (Y) junction. This
 * looks like an off-by-one bug to anyone who hasn't worked through it —
 * it isn't.
 */
export function greenShape(arms: SiteRoute[], clippedByWater: boolean): GreenShape {
  if (clippedByWater) return 'sm-green-d';
  if (arms.length === 0) return 'sm-green-round';
  if (arms.length === 1) {
    if (!arms[0].through) return 'sm-green-round';
    return classRank(arms[0].type) <= classRank('main')
      ? 'sm-green-lens-long' : 'sm-green-lens';
  }
  if (arms.length === 2) return 'sm-green-triangle';
  if (arms.length === 3) return 'sm-green-triangle';
  return 'sm-green-square';
}

/**
 * Built radius, predicted before any geometry exists, from the census.
 * Refined by the pass-4 feedback loop if it turns out wrong.
 */
export function predictedBuiltRadius(
  population: number, meanOccupancy: number, meanLotAreaM2: number,
): number {
  const dwellings = Math.max(1, population / meanOccupancy);
  return Math.sqrt((dwellings * meanLotAreaM2) / Math.PI);
}

/**
 * Diameter floor comes from the highest-class road arm present, scaled by
 * the square root of population relative to the reference village, then
 * clamped between that floor and a hard cap.
 *
 * The cap — the lesser of the absolute cap and builtRadius / divisor —
 * takes priority over the floor when the two conflict: a green cannot be
 * physically larger than the built area allows, no matter how grand the
 * road that reaches it.
 */
export function greenDiameter(
  arms: SiteRoute[], population: number, builtRadiusM: number,
): number {
  const best = arms.length
    ? arms.reduce((a, b) => (classRank(a.type) <= classRank(b.type) ? a : b))
    : undefined;
  const floor = best ? (GREEN_DIAMETER_FLOOR_M[best.type] ?? GREEN_DIAMETER_FLOOR_M.local) : GREEN_DIAMETER_FLOOR_M.local;
  const scaled = floor * Math.sqrt(population / GREEN_REFERENCE_POP);
  const cap = Math.min(GREEN_DIAMETER_CAP_M, builtRadiusM / GREEN_BUILT_RADIUS_DIVISOR);
  return Math.min(Math.max(scaled, floor), cap);
}

/** Local to this pass: how the search walks, not what a gate would tune. */
const PUSH_STEP_M = 2;
const MAX_PUSH_STEPS = 200;

/** True when any point on the green's rim, or its centre, is in water. */
export function waterClips(centre: Point, radiusM: number, water: Point[][]): boolean {
  if (water.length === 0) return false;
  const probes: Point[] = [centre];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    probes.push(new Point(centre.x + radiusM * Math.cos(a), centre.y + radiusM * Math.sin(a)));
  }
  return probes.some((p) => inAnyWater(p, water));
}

/**
 * Order within pass 2: shape → size → position. Position is last because
 * the push-away-from-water step needs the radius.
 *
 * FMG gives bearings, not geometry — every incoming route already radiates
 * from the burg origin, so the confluence IS the origin. The green starts
 * there; if water intrudes, it is pushed clear along the first arm's
 * bearing (or due south absent any arm) until the rim, plus margin, is dry.
 */
export function siteGreen(site: Site, builtRadiusM: number, rng: SeededRandom): Green {
  const arms = roadArms(site);
  const through = arms.find((a) => a.through);

  // Size first — it depends only on class and census.
  const provisionalShape = greenShape(arms, false);
  const diameter = greenDiameter(arms, site.population, builtRadiusM);
  const radius = diameter / 2;

  // Position: origin, then pushed clear of water along the away bearing.
  let centre = new Point(0, 0);
  let clipped = false;
  if (waterClips(centre, radius + GREEN_WATER_MARGIN_M, site.water)) {
    clipped = true;
    // Push along the bearing of the arm that best points away from water,
    // or due south when there is no arm to follow.
    const away = arms.length ? bearingVector(arms[0].bearingDeg) : new Point(0, 1);
    for (let i = 0; i < MAX_PUSH_STEPS; i++) {
      centre = new Point(centre.x + away.x * PUSH_STEP_M, centre.y + away.y * PUSH_STEP_M);
      if (!waterClips(centre, radius + GREEN_WATER_MARGIN_M, site.water)) break;
    }
  }

  const shape = clipped ? 'sm-green-d' : provisionalShape;
  const bearingDeg = through ? through.bearingDeg : 0;
  const variant = rng.bool(0.5) ? 'a' : 'b';

  return { shape, variant, centre, diameter, bearingDeg };
}
