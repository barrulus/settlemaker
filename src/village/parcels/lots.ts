import { SeededRandom } from '../../utils/random.js';
import { offsetPolyline } from './strip.js';
import { arcLengths, bearingOf, dist, inAnyWater, sampleAt } from '../geometry.js';
import {
  F0_FLOOR_RATIO, FRONTAGE_JITTER, GAP_LOOSE_M, GAP_POP_HIGH, GAP_POP_LOW, GAP_TIGHT_M,
  GRADIENT_EXPONENT, GRADIENT_K, GRADIENT_RATIO_CAP, GREEN_JOIN_RATIO, LANE_SETBACK_M, RING_SETBACK_M,
  SCORE_BASE, SCORE_CLASS_WEIGHT, SCORE_DISTANCE_PENALTY_PER_M, SCORE_RING_BONUS,
} from '../constants.js';
import { Point } from '../../types/point.js';
import { lotId, type Green, type Lane, type Lot } from '../types.js';
import { classRank, type RouteType } from '../route-class.js';

/**
 * The gap between neighbouring plots, in metres. Loose in a hamlet
 * (GAP_LOOSE_M around a population of GAP_POP_LOW or below), tightening
 * linearly to GAP_TIGHT_M at GAP_POP_HIGH and beyond. Feeds into `f0`
 * (widest common dwelling + this gap) wherever a caller builds it.
 */
export function gapForPopulation(population: number): number {
  const t = Math.min(1, Math.max(0, (population - GAP_POP_LOW) / (GAP_POP_HIGH - GAP_POP_LOW)));
  return GAP_LOOSE_M + (GAP_TIGHT_M - GAP_LOOSE_M) * t;
}

/**
 * frontage(d) = f0 x (1 + k(d/R)^1.5). The whole density gradient: plots
 * are f0 wide at the green and widen outward as the crowd thins. The
 * dwelling does not shrink; the plot grows. `f0` is a hard floor enforced
 * by the caller (subdivideLane), not by this function.
 */
export function frontageAt(distanceM: number, builtRadiusM: number, f0: number): number {
  const ratio = builtRadiusM <= 0 ? 0 : Math.min(GRADIENT_RATIO_CAP, distanceM / builtRadiusM);
  return f0 * (1 + GRADIENT_K * Math.pow(ratio, GRADIENT_EXPONENT));
}

// Arc-length walking and sampling come from geometry.ts. This pass samples
// the same edge repeatedly, so it computes the cumulative walk once with
// arcLengths() and passes it to every sampleAt() call.

/**
 * Cut one lane's two frontage strips into lots. Ordinals count from the
 * green end, which is what makes a lot id survive a change further out:
 * lanes are built green-outward (Task 7), so walking the offset edge from
 * its start (s=0, which sits at lane.points[0], the green end) numbers
 * lots 0, 1, 2... green-outward too. Adding a lot further out only appends
 * a higher ordinal; it never renumbers the ones already nearer the green.
 */
export function subdivideLane(
  lane: Lane, green: Green, builtRadiusM: number, f0: number, depthM: number,
  rng: SeededRandom, floorM: number = 0,
): Lot[] {
  const lots: Lot[] = [];
  const setback = lane.widthM / 2 + (LANE_SETBACK_M[lane.type] ?? 2);

  for (const side of [1, -1] as const) {
    const edge = offsetPolyline(lane.points, setback, side);
    if (edge.length < 2) continue;
    const edgeAcc = arcLengths(edge);
    const edgeTotal = edgeAcc[edgeAcc.length - 1];

    let s = 0;
    let ordinal = 0;
    while (s < edgeTotal) {
      const { p } = sampleAt(edge, edgeAcc, s);
      const d = dist(p, green.centre);
      const jitter = 1 + (rng.float() - 0.5) * 2 * FRONTAGE_JITTER;
      // Floor at F0_FLOOR_RATIO x f0, not f0 itself: with fit-sizing able
      // to grow a dwelling into its lot, a slightly-tight cut is what lets
      // neighbours actually TOUCH — the owner's density rule ("not
      // everything uniformly separated; touching is ok"). The rectangle
      // overlap test keeps touching from becoming interpenetration.
      // `floorM` (the deck's narrowest usable dwelling frontage, when the
      // caller knows it) is the harder floor: below it a lot is dead on
      // arrival — no deck entry can ever seat there, so cutting it just
      // burns frontage the census needed.
      const frontage = Math.max(floorM, f0 * F0_FLOOR_RATIO,
        frontageAt(d, builtRadiusM, f0) * jitter);
      if (s + frontage > edgeTotal) break;
      const mid = sampleAt(edge, edgeAcc, s + frontage / 2);
      // Inward normal: the lot faces back across the strip to its lane.
      // side=1 (right of travel) offsets to +y (south, since north=-y);
      // rotating the edge's direction of travel by -90 turns it to face
      // north, back toward the lane. side=-1 mirrors it: +90, facing south.
      const bearingDeg = (mid.dirDeg + (side === 1 ? -90 : 90) + 360) % 360;
      lots.push({
        id: lotId(lane.id, side, ordinal),
        laneId: lane.id,
        side,
        front: mid.p,
        bearingDeg,
        frontageM: frontage,
        depthM,
        score: 0,
      });
      s += frontage;
      ordinal++;
    }
  }
  return lots;
}

/**
 * The green's perimeter is frontage too — the most valuable in the
 * settlement, so it takes the tightest frontages. The ring of buildings
 * around the green is this subdivision, not a placement rule.
 */
export function subdivideGreen(
  green: Green, f0: number, depthM: number, rng: SeededRandom,
): Lot[] {
  // Gate 2: green frontage means RIGHT AT the green — the ring's fronts
  // sit on the drawn edge (art fills ~87% of the box) plus a sliver, not
  // metres of empty grass out.
  const radius = (green.diameter / 2) * GREEN_JOIN_RATIO + RING_SETBACK_M;
  const circumference = 2 * Math.PI * radius;
  const count = Math.max(4, Math.floor(circumference / f0));
  const step = (Math.PI * 2) / count;
  // Rotate the ring by a seeded offset so two villages do not share a seam.
  const phase = rng.float() * step;

  const lots: Lot[] = [];
  for (let i = 0; i < count; i++) {
    const a = phase + i * step;
    const front = new Point(
      green.centre.x + radius * Math.sin(a),
      green.centre.y - radius * Math.cos(a),
    );
    // Face back at the centre.
    const bearingDeg = bearingOf(front, green.centre);
    lots.push({
      id: lotId('green', 1, i),
      laneId: 'green',
      side: 1,
      front,
      bearingDeg,
      frontageM: circumference / count,
      depthM,
      score: 0,
    });
  }
  return lots;
}

/** Water first, then the green. Anything left too narrow was never cut. */
export function clipLots(lots: Lot[], green: Green, water: Point[][]): Lot[] {
  const greenRadius = green.diameter / 2;
  return lots.filter((l) => {
    if (inAnyWater(l.front, water)) return false;
    const d = dist(l.front, green.centre);
    if (l.laneId !== 'green' && d < greenRadius) return false;
    return true;
  });
}

/**
 * Nearer the green is better; a higher lane class is better; the green's
 * own ring beats everything. Pass 4 fills the best first, so an
 * under-populated village fills inward-out and the fringe stays empty.
 */
export function scoreLots(
  lots: Lot[], green: Green, laneTypeById: Map<string, RouteType>,
): Lot[] {
  return lots.map((l) => {
    const d = dist(l.front, green.centre);
    const type = laneTypeById.get(l.laneId);
    const classBonus = type ? (7 - classRank(type)) * SCORE_CLASS_WEIGHT : 0;
    const ring = l.laneId === 'green' ? SCORE_RING_BONUS : 0;
    return { ...l, score: SCORE_BASE - d * SCORE_DISTANCE_PENALTY_PER_M + classBonus + ring };
  });
}

/** Deterministic fill order: score descending, ties broken by id. */
export function orderLots(lots: Lot[]): Lot[] {
  return [...lots].sort((a, b) => (b.score - a.score) || a.id.localeCompare(b.id));
}
