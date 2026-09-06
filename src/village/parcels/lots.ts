import { SeededRandom } from '../../utils/random.js';
import { offsetPolyline } from './strip.js';
import {
  arcLengths, bearingOf, dist, inAnyWater, sampleAt, segmentIntersection, signedTurnDeg,
} from '../geometry.js';
import {
  CLAIM_TOUCH_EPS_M, F0_FLOOR_RATIO, FRONTAGE_JITTER, GAP_LOOSE_M, GAP_POP_HIGH, GAP_POP_LOW, GAP_TIGHT_M,
  GRADIENT_EXPONENT, GRADIENT_K, GRADIENT_RATIO_CAP, GREEN_JOIN_RATIO, LANE_SETBACK_M,
  RING_MOUTH_CLEAR_FACTOR, RING_SETBACK_M,
  SCORE_BASE, SCORE_CLASS_WEIGHT, SCORE_DISTANCE_PENALTY_PER_M, SCORE_RING_BONUS,
} from '../constants.js';
import { Point } from '../../types/point.js';
import { lotObb } from './overlap.js';
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
 *
 * `maxFrontageM` caps every lot regardless of distance (gate 5.1's
 * one-house-width gap rule); `maxDistanceM` stops the lane carrying lots
 * beyond the cluster, without shortening the lane itself.
 *
 * GATE 8: `maxDistanceM` may be a FUNCTION of the position being cut, not
 * only a number. The cluster is no longer a disc -- it is the radius
 * profile's body -- so how far out a lane may carry lots depends on which
 * way it runs. A plain number still means the old circular limit.
 */
export function subdivideLane(
  lane: Lane, green: Green, builtRadiusM: number, f0: number, depthM: number,
  rng: SeededRandom, floorM: number = 0,
  maxFrontageM: number = Infinity,
  maxDistanceM: number | ((p: Point) => number) = Infinity,
): Lot[] {
  const reachAt = typeof maxDistanceM === 'function' ? maxDistanceM : () => maxDistanceM;
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
      // Gate 5.1: the CAP, applied after jitter and independent of `d`.
      // A lot is a dwelling plus its gap, so capping the lot caps the gap
      // -- the owner's rule that no two neighbours may sit more than about
      // one house width apart. `floorM` still wins if the two ever cross,
      // because a lot narrower than the deck's narrowest dwelling is dead
      // on arrival and cutting it just burns frontage the census needed.
      const cap = Math.max(floorM, maxFrontageM);
      const frontage = Math.min(cap, Math.max(floorM, f0 * F0_FLOOR_RATIO,
        frontageAt(d, builtRadiusM, f0) * jitter));
      if (s + frontage > edgeTotal) break;
      const mid = sampleAt(edge, edgeAcc, s + frontage / 2);
      // Inward normal: the lot faces back across the strip to its lane.
      // side=1 (right of travel) offsets to +y (south, since north=-y);
      // rotating the edge's direction of travel by -90 turns it to face
      // north, back toward the lane. side=-1 mirrors it: +90, facing south.
      const bearingDeg = (mid.dirDeg + (side === 1 ? -90 : 90) + 360) % 360;
      // Gate 5.1: lots are cut only within the CLUSTER. An FMG arm is
      // still DRAWN to the map's edge (R15) -- it just stops carrying
      // plots once it leaves the growth circle, so a hamlet no longer
      // grows a line of huts marching out along a trunk road. The ordinal
      // still advances for a skipped position, so a lot nearer the green
      // never renumbers because something further out was dropped (ids may
      // therefore skip, the same convention `EdgeStamp` uses).
      if (d > reachAt(p)) {
        s += frontage;
        ordinal++;
        continue;
      }
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
      // Gate 6.6, CONVERGENCE PITCH. A claim is a RECTANGLE `depthM` deep,
      // squared to the local bearing at its own midpoint. Two neighbours on
      // the INSIDE of a bend therefore converge behind their fronts, however
      // neatly those fronts abut -- and no amount of depth truncation
      // separates them (they meet at the shared front corner and only
      // diverge going forward), so resolveInnerCurves had no option but to
      // DROP the later one. Measured at pop 300: 34 of 109 lots, every
      // second lot along a curving lane, including 0.3 m overlaps on a lane
      // curving barely 1 degree per plot -- a third of the whole village's
      // frontage thrown away as an artefact of the rectangle model.
      //
      // The cure belongs here, not in resolution: on the converging side,
      // advance by the extra pitch the convergence costs (depth x the turn
      // across the plot), so the claims are disjoint as CUT. The outer side
      // of the same bend needs nothing -- it fans open by itself.
      const turnDeg = signedTurnDeg(
        sampleAt(edge, edgeAcc, s).dirDeg,
        sampleAt(edge, edgeAcc, Math.min(edgeTotal, s + frontage)).dirDeg,
      );
      const converging = side === 1 ? turnDeg > 0 : turnDeg < 0;
      const convergePitch = converging
        ? depthM * Math.abs((turnDeg * Math.PI) / 180)
        : 0;
      // Plus a hair, so two claims that abut EXACTLY are not read as
      // overlapping by float noise: nine such drops in the same fixture.
      s += frontage + convergePitch + CLAIM_TOUCH_EPS_M;
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
  green: Green, f0: number, depthM: number, rng: SeededRandom, lanes: Lane[] = [],
): Lot[] {
  // Gate 2: green frontage means RIGHT AT the green — the ring's fronts
  // sit on the drawn edge (art fills ~87% of the box) plus a sliver, not
  // metres of empty grass out.
  const radius = (green.diameter / 2) * GREEN_JOIN_RATIO + RING_SETBACK_M;
  const circumference = 2 * Math.PI * radius;
  const TAU = Math.PI * 2;
  // Rotate the ring by a seeded offset so two villages do not share a seam.
  const phase = rng.float() * (TAU / Math.max(4, Math.floor(circumference / f0)));

  // Gate 4 (owner: "lots of missing coverage on the housing front of the
  // greens"): the ring used to be cut blind to the roads piercing it, so
  // every lot straddling a road mouth died on the corridor test at seat
  // time — and a big green's five or six mouths tiled the entire circle,
  // seating NOTHING on the most valuable frontage in the settlement. Find
  // each mouth's bearing and cut lots only in the free arcs between them,
  // the way a real green fills: houses shoulder to shoulder BETWEEN the
  // roads, a gap where each road leaves.
  // A lane blocks every bearing its path sweeps while inside the ring
  // BAND (ring radius out to where the ring buildings' ink ends, ~one
  // frontage further) — not just the bearing where it first pierces the
  // ring: lanes wander, and a radial curving past its mouth sweeps
  // sideways through the neighbouring arc's building band. Sampled every
  // couple of metres; the windows merge below.
  const blocked: Array<[number, number]> = [];
  const bandOuter = radius + f0;
  for (const lane of lanes) {
    const halfAng = (lane.widthM / 2 + f0 * RING_MOUTH_CLEAR_FACTOR) / radius;
    for (let i = 1; i < lane.points.length; i++) {
      const a = lane.points[i - 1];
      const b = lane.points[i];
      const segLen = dist(a, b);
      const steps = Math.max(1, Math.ceil(segLen / 2));
      for (let k = 0; k <= steps; k++) {
        const p = new Point(
          a.x + ((b.x - a.x) * k) / steps,
          a.y + ((b.y - a.y) * k) / steps,
        );
        if (dist(p, green.centre) > bandOuter) continue;
        // Same bearing convention as the fronts below: 0 = north (-y),
        // clockwise, via atan2(dx, -dy).
        const mouth = Math.atan2(p.x - green.centre.x, -(p.y - green.centre.y));
        blocked.push([mouth - halfAng, mouth + halfAng]);
      }
    }
  }

  // Free arcs = the gaps between merged blocked windows. With no lanes the
  // whole circle is one arc and this reduces to the old even ring.
  let arcs: Array<[number, number]>;
  if (blocked.length === 0) {
    arcs = [[phase, phase + TAU]];
  } else {
    const merged: Array<[number, number]> = blocked
      .map(([s, e]) => [((s % TAU) + TAU) % TAU, e - s] as const)
      .map(([s, span]) => [s, s + span] as [number, number])
      .sort((a, b) => a[0] - b[0])
      .reduce<Array<[number, number]>>((acc, [s, e]) => {
        const last = acc[acc.length - 1];
        if (last && s <= last[1]) last[1] = Math.max(last[1], e);
        else acc.push([s, e]);
        return acc;
      }, []);
    arcs = [];
    for (let i = 0; i < merged.length; i++) {
      const gapStart = merged[i][1];
      const gapEnd = i === merged.length - 1 ? merged[0][0] + TAU : merged[i + 1][0];
      // A wrap-overlapping pair yields gapEnd <= gapStart and is skipped.
      if (gapEnd > gapStart) arcs.push([gapStart, gapEnd]);
    }
  }

  const lots: Lot[] = [];
  let ordinal = 0;
  for (const [s, e] of arcs) {
    const arcM = (e - s) * radius;
    // With no mouths at all (a green nothing pierces yet), keep the old
    // guarantee of at least 4 ring lots however tiny the green.
    const n = blocked.length === 0
      ? Math.max(4, Math.floor(arcM / f0))
      : Math.floor(arcM / f0);
    if (n < 1) continue;
    const step = (e - s) / n;
    for (let j = 0; j < n; j++) {
      const a = s + (j + 0.5) * step;
      const front = new Point(
        green.centre.x + radius * Math.sin(a),
        green.centre.y - radius * Math.cos(a),
      );
      // Face back at the centre.
      const bearingDeg = bearingOf(front, green.centre);
      lots.push({
        id: lotId('green', 1, ordinal),
        laneId: 'green',
        side: 1,
        front,
        bearingDeg,
        frontageM: arcM / n,
        depthM,
        score: 0,
      });
      ordinal++;
    }
  }
  return lots;
}

/** Water first, then the green. Anything left too narrow was never cut. */
/**
 * True when any part of the lot's claim rectangle stands in water.
 *
 * Two tests, because either alone misses a real case:
 *  - any claim CORNER (or its centre) inside water — catches a claim that
 *    reaches into a sea or lake;
 *  - any claim EDGE crossing a water outline — catches narrow water, which
 *    point sampling cannot see at all. A 4 m stream can pass clean through
 *    the middle of a lot without putting any corner or the centre wet, and
 *    that is precisely the brook case this phase exists for.
 *
 * `lotObb` is the same claim geometry the overlap resolution uses, so a lot
 * is judged on the ground it actually takes.
 */
function claimTouchesWater(lot: Lot, water: Point[][]): boolean {
  if (water.length === 0) return false;
  const obb = lotObb(lot);
  const t = obb.tangent;
  const nrm = obb.normal;
  const corner = (sw: number, sd: number): Point => new Point(
    obb.center.x + t.x * sw * obb.halfW + nrm.x * sd * obb.halfD,
    obb.center.y + t.y * sw * obb.halfW + nrm.y * sd * obb.halfD,
  );
  const corners = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
  if (inAnyWater(obb.center, water)) return true;
  if (corners.some((p) => inAnyWater(p, water))) return true;

  for (let i = 0; i < corners.length; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % corners.length];
    for (const ring of water) {
      for (let j = 0; j < ring.length; j++) {
        const c = ring[j];
        const d = ring[(j + 1) % ring.length];
        if (segmentIntersection(a, b, c, d)) return true;
      }
    }
  }
  return false;
}

export function clipLots(lots: Lot[], green: Green, water: Point[][]): Lot[] {
  const greenRadius = green.diameter / 2;
  return lots.filter((l) => {
    // Phase 3: the WHOLE claim, not just the frontage midpoint. Testing the
    // midpoint alone let a lot whose ground was mostly river survive as long
    // as its front point happened to be dry, and a house was then seated on
    // it -- measured, 11 of 225 houses standing in the stream at brook pop
    // 900 seed 1, only 3 of which had a wet CENTRE. A centre test cannot see
    // this defect, which is exactly why it went unnoticed.
    if (claimTouchesWater(l, water)) return false;
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
