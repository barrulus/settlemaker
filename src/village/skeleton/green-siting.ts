import { Point } from '../../types/point.js';
import { SeededRandom } from '../../utils/random.js';
import {
  GREEN_BUILT_RADIUS_DIVISOR, GREEN_CONNECTOR_MAX_SHARE, GREEN_DIAMETER_CAP_M,
  GREEN_DIAMETER_FLOOR_M, GREEN_REFERENCE_POP,
  GREEN_WATER_MARGIN_M
} from '../constants.js';
import { bearingOf, closestPointOnPolyline, dist, greenDrawnRadius, inAnyWater, unit } from '../geometry.js';
import { classRank, laneWidth } from '../route-class.js';
import { isApron, type Green, type GreenShape, type Lane, type Site, type SiteRoute } from '../types.js';
import { greenPorts } from './green-ports.js';
// Type-only: erased at compile time, so no runtime cycle even though
// `trunks.ts` and this module now know about each other's shapes.
import type { TrunkNetwork } from './trunks.js';

/** All land access routes, including trails and footpaths, shape the green. */
export function roadArms(site: Site): SiteRoute[] {
  return site.routes;
}

// Floors, reference population and caps all live in constants.ts — a gate
// verdict on green size is one edit there, not a hunt through this pass.

/** Legacy input-only shape hint. Production siting counts actual road mouths. */
export function greenShape(arms: SiteRoute[], clippedByWater: boolean): GreenShape {
  if (clippedByWater) return 'sm-green-d';
  if (arms.length === 0) return 'sm-green-round';
  if (arms.length === 1) {
    if (!arms[0].through) return 'sm-green-round';
    return classRank(arms[0].type) <= classRank('main')
      ? 'sm-green-lens-long' : 'sm-green-lens';
  }
  if (arms.length === 2) return arms.some(a => a.through) ? 'sm-green-triangle' : 'sm-green-lens';
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
/** Below this, a sum of unit "wet" vectors is treated as cancelled to zero. */
const WET_VECTOR_EPSILON = 1e-6;

/**
 * The rim, sampled at 16 points around `centre`. Raw sin/cos here is circle
 * sampling in local space, not a compass-bearing conversion — `bearingVector`
 * encodes the compass convention (0 = N, clockwise) and would be the wrong
 * tool for "walk evenly around a circle."
 */
function probeRing(centre: Point, radiusM: number): Point[] {
  const probes: Point[] = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    probes.push(new Point(centre.x + radiusM * Math.cos(a), centre.y + radiusM * Math.sin(a)));
  }
  return probes;
}

/** True when any point on the green's rim, or its centre, is in water. */
export function waterClips(centre: Point, radiusM: number, water: Point[][]): boolean {
  if (water.length === 0) return false;
  const probes: Point[] = [centre, ...probeRing(centre, radiusM)];
  return probes.some((p) => inAnyWater(p, water));
}

/**
 * R9: the push direction derives from the water, not from a road arm.
 * Ruling: sample the rim; for each wet probe, take the unit vector from
 * `centre` to it; sum and normalise for the mean "wet" direction; push
 * along its negation, away from the water's centre of mass.
 *
 * Falls back to due south — deterministic, and honest as a last resort —
 * when no rim probe is wet (the centre alone is enclosed, e.g. a lake
 * island) or when the wet vectors cancel to near-zero (water on opposite
 * sides of the rim).
 */
function awayFromWater(centre: Point, radiusM: number, water: Point[][]): Point {
  const wet = probeRing(centre, radiusM).filter((p) => inAnyWater(p, water));
  if (wet.length === 0) return new Point(0, 1);

  let sx = 0;
  let sy = 0;
  for (const p of wet) {
    const v = unit(p.x - centre.x, p.y - centre.y);
    sx += v.x;
    sy += v.y;
  }
  if (dist(new Point(0, 0), new Point(sx, sy)) < WET_VECTOR_EPSILON) return new Point(0, 1);

  const mean = unit(sx, sy);
  return new Point(-mean.x, -mean.y);
}

/**
 * Order within pass 2: shape → size → position. Position is last because
 * the push-away-from-water step needs the radius.
 *
 * FMG gives bearings, not geometry — every incoming route already radiates
 * from the burg origin, so the confluence IS the origin. The green starts
 * there; if water intrudes, it is pushed clear along the direction away
 * from the water itself (see `awayFromWater`) until the rim, plus margin,
 * is dry.
 */
/**
 * `origin` walked clear of water in `PUSH_STEP_M` increments, re-steering
 * away from the wet side each step, until a disc of `clearRadiusM` around
 * it is dry (or the step budget runs out).
 *
 * Task 4b (finding F11) extracted this from `siteGreen`'s body so the trunk
 * network's AIM POINT can be pushed by exactly the same rule. Before that
 * the two disagreed: `synthesizeTrunks` aimed every road at a hard-coded
 * origin while `siteGreen` pushed the green off it by up to 34 m on a wet
 * site, so the roads converged on the one point the green had just been
 * rejected from — measured at 118-283 lane metres of open water. The green
 * now starts its own push FROM the aim, so the two can only ever coincide
 * or differ by the extra clearance the green itself needs.
 */
export function waterPushedCentre(
  origin: Point, clearRadiusM: number, water: Point[][],
): { centre: Point; clipped: boolean; } {
  let centre = origin;
  if (!waterClips(centre, clearRadiusM, water)) return { centre, clipped: false };
  for (let i = 0; i < MAX_PUSH_STEPS; i++) {
    const away = awayFromWater(centre, clearRadiusM, water);
    centre = new Point(centre.x + away.x * PUSH_STEP_M, centre.y + away.y * PUSH_STEP_M);
    if (!waterClips(centre, clearRadiusM, water)) break;
  }
  return { centre, clipped: true };
}

/**
 * `origin` is where the green STARTS its search, not where it lands: the
 * trunk network's aim point (Task 4b), so a village whose roads converged
 * on pushed-clear ground puts its green on that same ground. Defaults to
 * the burg origin, which is what it was before the aim existed.
 */
export function siteGreen(
  site: Site, builtRadiusM: number, rng: SeededRandom, origin: Point = new Point(0, 0),
): Green {
  const arms = roadArms(site);
  const through = arms.find((a) => a.through);

  // Size first — it depends only on class and census.
  const provisionalShape = greenShape(arms, false);
  const diameter = greenDiameter(arms, site.population, builtRadiusM);
  const radius = diameter / 2;
  const clearRadius = radius + GREEN_WATER_MARGIN_M;

  // Position: the aim, then pushed clear of water, re-steering each step.
  const pushed = waterPushedCentre(origin, clearRadius, site.water);
  const centre = pushed.centre;
  const clipped = pushed.clipped;

  const shape = clipped ? 'sm-green-d' : provisionalShape;
  const bearingDeg = through ? through.bearingDeg : 0;
  const variant = rng.bool(0.5) ? 'a' : 'b';

  return { shape, variant, centre, diameter, bearingDeg };
}


/** Public relation vocabulary retains legacy values for older models. */
export type GreenRelation = 'astride' | 'tangent' | 'terminal' | 'enclosed';

/** The network's best-class road, preferring the longest on a tie. */
function spineOf(network: TrunkNetwork): Lane | null {
  const drawn = network.trunks.filter((t) => t.points.length >= 2 && !t.id.startsWith('trunk-loop-') && !isApron(t.id));
  if (drawn.length === 0) return null;
  const lengthOf = (l: Lane): number =>
    l.points.slice(1).reduce((sum, p, i) => sum + dist(l.points[i], p), 0);
  return drawn.reduce((best, l) => {
    const rank = classRank(l.type) - classRank(best.type);
    if (rank !== 0) return rank < 0 ? l : best;
    return lengthOf(l) > lengthOf(best) ? l : best;
  });
}

/**
 * How straight the spine runs near sample `i` -- the cosine of the turn
 * across it, so 1 is dead straight. A green wants a road that is going
 * somewhere past it, not one bending around it.
 */
function straightnessAt(points: Point[], i: number): number {
  if (i <= 0 || i + 1 >= points.length) return 0;
  const a = points[i - 1]; const b = points[i]; const c = points[i + 1];
  const v1 = unit(b.x - a.x, b.y - a.y);
  const v2 = unit(c.x - b.x, c.y - b.y);
  return v1.x * v2.x + v1.y * v2.y;
}

/**
 * A point ON the network to hang the green off: sampled along the best
 * road inside the built radius, scored for closeness to the aim and for
 * local straightness, then drawn from the best three so the choice varies
 * without wandering to a silly place.
 */
function anchorOn(spine: Lane, aim: Point, builtRadiusM: number, rng: SeededRandom): Point {
  const scored: Array<{ p: Point; score: number; }> = [];
  for (let i = 1; i + 1 < spine.points.length; i++) {
    const p = spine.points[i];
    const d = dist(p, aim);
    if (d > builtRadiusM) continue;
    scored.push({ p, score: (1 - d / Math.max(1, builtRadiusM)) + straightnessAt(spine.points, i) });
  }
  if (scored.length === 0) {
    // No sample inside the built radius: take the road's closest approach.
    return closestPointOnPolyline(aim, spine.points).point;
  }
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 3);
  return top[rng.int(0, top.length)].p;
}

/** Site a green where routes actually terminate, pass through or meet. */
export function siteGreenOnNetwork(
  site: Site, network: TrunkNetwork, builtRadiusM: number, rng: SeededRandom,
): { green: Green; relation: GreenRelation; connectors: Lane[]; } {
  const arms = roadArms(site);
  const through = arms.find((a) => a.through);
  const diameter = greenDiameter(arms, site.population, builtRadiusM);
  const radius = diameter / 2;
  const clearRadius = radius + GREEN_WATER_MARGIN_M;

  const spine = spineOf(network);
  // The relation follows actual traffic: a through road widens into a lens;
  // a terminus ends in the green; three road mouths form its three corners.
  const junction = network.junctions.filter(j => j.laneIds.length >= 3
    && dist(j.position, network.aim) <= builtRadiusM)
    .sort((a, b) => dist(a.position, network.aim) - dist(b.position, network.aim))[0];
  let relation: GreenRelation = through ? 'astride' : 'terminal';
  let centre = through && spine ? anchorOn(spine, network.aim, builtRadiusM, rng)
    : junction ? junction.position : network.aim;
  if (!through && junction) relation = 'astride';

  const pushed = waterPushedCentre(centre, clearRadius, site.water);
  centre = pushed.centre;

  const variant = rng.bool(0.5) ? 'a' : 'b';
  const green: Green = { shape: 'sm-green-round', variant, centre, diameter, bearingDeg: 0 };
  const connectors = connectGreen(green, network, builtRadiusM);
  const ports = greenPorts(green, [...network.trunks.filter(t => !isApron(t.id)), ...connectors]);
  if (ports.length === 3) {
    green.shape = 'sm-green-triangle';
    green.outline = ports;
  } else if (ports.length === 2) {
    green.shape = through && classRank(through.type) <= classRank('main') ? 'sm-green-lens-long' : 'sm-green-lens';
    green.bearingDeg = bearingOf(ports[0], ports[1]);
    relation = 'astride';
  } else if (ports.length >= 4) green.shape = 'sm-green-square';
  else relation = 'terminal';
  if (pushed.clipped) { green.shape = 'sm-green-d'; delete green.outline; }
  return { green, relation, connectors };
}

/**
 * A short lane tying a green to the network when it does not already touch
 * it: `green-c0`, class `local`, because a path from a green to the road it
 * serves is a village street and never an inter-settlement route. One
 * connector, to the nearest road — the plural `green-c<k>` the header once
 * promised was never built, and a green needing several connectors would be
 * a siting failure rather than something to paper over with more road.
 */
function connectGreen(green: Green, network: TrunkNetwork, builtRadiusM: number): Lane[] {
  const rim = greenDrawnRadius(green);
  const drawn = network.trunks.filter((t) => t.points.length >= 2 && !isApron(t.id));
  if (drawn.length === 0) return [];
  const nearest = drawn
    .map((t) => ({ t, hit: closestPointOnPolyline(green.centre, t.points) }))
    .sort((a, b) => a.hit.distance - b.hit.distance)[0];
  if (nearest.hit.distance <= rim) return [];

  const maxLen = builtRadiusM * GREEN_CONNECTOR_MAX_SHARE;
  const target = nearest.hit.point;
  const away = unit(target.x - green.centre.x, target.y - green.centre.y);
  const start = new Point(green.centre.x + away.x * rim, green.centre.y + away.y * rim);
  if (dist(start, target) > maxLen) {
    // Too far to be a connector; the siting itself is what would be wrong,
    // so say nothing rather than draw a road across the fields.
    return [];
  }
  return [{
    id: 'green-c0',
    type: 'local',
    points: [start, target],
    widthM: laneWidth('local'),
  }];
}
