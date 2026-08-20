import { Point } from '../../types/point.js';
import { SeededRandom } from '../../utils/random.js';
import { classRank, laneWidth, stepDown, type RouteType } from '../route-class.js';
import { angularGap, bearingOf, bearingVector, polylineLength } from '../geometry.js';
import {
  FRONTAGE_MARGIN, LANE_SAMPLE_STEP_M, LANE_WANDER_M, MAX_INVENTED_LANES, MIN_ARM_SEPARATION_DEG,
} from '../constants.js';
import {
  armLaneId, branchLaneId, inventedLaneId, type Green, type Lane, type Site, type SiteRoute,
} from '../types.js';

// geometry.ts owns polylineLength; re-exported here since Task 8's tests
// import it from this module alongside the frontage helpers that use it.
export { polylineLength };

/**
 * One arm: a polyline from the green's rim outward along `bearingDeg`,
 * wandering sideways a little so it never reads as surveyed.
 *
 * R4: the point is pushed BEFORE the drift accumulates for next time, so
 * the first sample lands exactly on the green's rim. Accumulating drift
 * before the first push (as the brief originally had it) starts the arm
 * up to LANE_WANDER_M off the rim, leaving a visible gap between the
 * green's edge and the road that feeds it.
 */
function runArm(
  green: Green, bearingDeg: number, extentM: number, rng: SeededRandom,
): Point[] {
  const dir = bearingVector(bearingDeg);
  const normal = new Point(-dir.y, dir.x);
  const start = green.diameter / 2;
  const points: Point[] = [];
  let drift = 0;
  for (let d = start; d <= start + extentM; d += LANE_SAMPLE_STEP_M) {
    points.push(new Point(
      green.centre.x + dir.x * d + normal.x * drift,
      green.centre.y + dir.y * d + normal.y * drift,
    ));
    drift += (rng.float() - 0.5) * 2 * LANE_WANDER_M;
  }
  return points;
}

/**
 * Every incoming route becomes an arm leaving the green at its bearing.
 * A `through` route also leaves on the far side — it passes across the
 * green rather than stopping at it, which is what later makes a single
 * through route swell into the lens-shaped green: the road passes through
 * and the green is a swelling of it.
 */
export function buildArms(
  site: Site, green: Green, extentM: number, rng: SeededRandom,
): Lane[] {
  const lanes: Lane[] = [];
  const emit = (r: SiteRoute, bearingDeg: number): void => {
    lanes.push({
      id: armLaneId(bearingDeg),
      type: r.type,
      points: runArm(green, bearingDeg, extentM, rng),
      widthM: laneWidth(r.type),
    });
  };
  for (const r of site.routes) {
    emit(r, r.bearingDeg);
    if (r.through) emit(r, (r.bearingDeg + 180) % 360);
  }
  return lanes;
}

/** Both sides of every lane are frontage. */
export function availableFrontage(lanes: Lane[]): number {
  return lanes.reduce((sum, l) => sum + polylineLength(l.points) * 2, 0);
}

export function requiredFrontage(
  population: number, meanOccupancy: number, meanFrontageM: number,
): number {
  return (population / meanOccupancy) * meanFrontageM;
}

/** Which way a lane leaves the green — geometry.ts owns the trigonometry. */
function laneBearing(green: Green, lane: Lane): number {
  return bearingOf(green.centre, lane.points[0]);
}

/**
 * Lanes are invented only when frontage runs out. A new lane leaves the
 * green at a free bearing, at least MIN_ARM_SEPARATION_DEG from every
 * existing one (arms included); its class is one step below the best arm
 * present, floored at `local` so wagons always reach the green.
 *
 * The bearing search also rejects any candidate whose rounded armLaneId or
 * inventedLaneId would collide with a lane already present — the 35°
 * separation rule alone doesn't guarantee that against an existing *arm*
 * sitting at the same rounded bearing, and lot ids are built from lane ids
 * downstream. Green-attached invented lanes get their own `lane-` id space
 * (ruling R10) so a lane's identity can't silently change meaning if FMG
 * later adds a real route at the same bearing a budget lane once used.
 */
export function addInventedLanes(
  lanes: Lane[], green: Green, requiredM: number, extentM: number, rng: SeededRandom,
): Lane[] {
  const out = [...lanes];
  const best = out.length
    ? out.reduce((a, b) => (classRank(a.type) <= classRank(b.type) ? a : b)).type
    : ('local' as RouteType);
  const inventedType = stepDown(best, 'local');

  let guard = 0;
  while (availableFrontage(out) < requiredM * FRONTAGE_MARGIN && guard < MAX_INVENTED_LANES) {
    guard++;
    const taken = out.map((l) => laneBearing(green, l));
    let bearing = -1;
    for (let attempt = 0; attempt < 36; attempt++) {
      const candidate = rng.int(0, 360);
      const collides = taken.some((t) => angularGap(candidate, t) < MIN_ARM_SEPARATION_DEG)
        || out.some((l) => l.id === armLaneId(candidate) || l.id === inventedLaneId(candidate));
      if (!collides) {
        bearing = candidate;
        break;
      }
    }
    // No free bearing left at the green: branch off an existing lane
    // instead. Prefer longer lanes first, but `branchLaneId` only has ~35
    // percentage buckets per parent (it formats `at` as a 2-digit percent),
    // and once the green's bearings are full, every remaining iteration
    // takes this path on a shrinking set of parents — repeated draws from
    // 35 buckets collide well before MAX_INVENTED_LANES by the birthday
    // paradox. So: draw `at` once from the RNG (preserves seeded variation),
    // and if its bucket on the longest parent is taken, probe the rest of
    // that parent's buckets deterministically before moving to the
    // next-longest parent — no extra RNG draws, so same seed → same result.
    if (bearing < 0) {
      const parents = [...out].sort(
        (a, b) => polylineLength(b.points) - polylineLength(a.points),
      );
      // at stays within [0.33, 0.67] — branchLaneId formats it as a 2-digit
      // percentage; a value rounding to >= 1.0 would overflow that format.
      // Widen this range only alongside a clamp in branchLaneId itself.
      const seedAt = 0.33 + rng.float() * 0.34;
      const seedPct = Math.round(seedAt * 100);
      let chosen: { parent: Lane; at: number } | undefined;
      for (const parent of parents) {
        for (let step = 0; step < 35 && !chosen; step++) {
          const pct = 33 + ((seedPct - 33 + step + 35) % 35);
          const candidateAt = pct / 100;
          if (!out.some((l) => l.id === branchLaneId(parent.id, candidateAt))) {
            chosen = { parent, at: candidateAt };
          }
        }
        if (chosen) break;
      }
      // Every bucket on every lane is taken: an honest give-up, same as
      // the MAX_INVENTED_LANES cap.
      if (!chosen) break;
      const { parent, at } = chosen;
      const idx = Math.max(1, Math.floor(parent.points.length * at));
      const anchor = parent.points[Math.min(idx, parent.points.length - 1)];
      const parentBearing = laneBearing(green, parent);
      const side = rng.bool(0.5) ? 1 : -1;
      const branchBearing = (parentBearing + side * (60 + rng.int(0, 51)) + 360) % 360;
      const dir = bearingVector(branchBearing);
      const length = extentM * 0.5;
      const points: Point[] = [];
      for (let d = 0; d <= length; d += LANE_SAMPLE_STEP_M) {
        points.push(new Point(anchor.x + dir.x * d, anchor.y + dir.y * d));
      }
      out.push({
        id: branchLaneId(parent.id, at),
        type: stepDown(parent.type, 'footpath'),
        points,
        widthM: laneWidth(stepDown(parent.type, 'footpath')),
        parentId: parent.id,
      });
      continue;
    }
    out.push({
      id: inventedLaneId(bearing),
      type: inventedType,
      points: runArm(green, bearing, extentM * 0.6, rng),
      widthM: laneWidth(inventedType),
    });
  }
  return out;
}
