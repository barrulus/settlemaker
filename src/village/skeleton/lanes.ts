import { Point } from '../../types/point.js';
import { SeededRandom } from '../../utils/random.js';
import { classRank, laneWidth, stepDown, type RouteType } from '../route-class.js';
import { angularGap, bearingOf, bearingVector, polylineLength } from '../geometry.js';
import {
  BRANCH_LENGTH_FACTOR, FRONTAGE_MARGIN, INVENTED_LANE_LENGTH_FACTOR, LANE_SAMPLE_STEP_M,
  LANE_WANDER_M, MAX_INVENTED_LANES, MIN_ARM_SEPARATION_DEG,
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

interface ArmEmission {
  route: SiteRoute;
  bearingDeg: number;
  /** True for a `through` route's far-side echo, not the route itself. */
  isFarSide: boolean;
}

/**
 * Every incoming route becomes an arm leaving the green at its bearing.
 * A `through` route also leaves on the far side — it passes across the
 * green rather than stopping at it, which is what later makes a single
 * through route swell into the lens-shaped green: the road passes through
 * and the green is a swelling of it.
 *
 * FINDING 1 fix: `armLaneId` rounds its bearing to the nearest degree, so
 * two routes at nearly the same bearing (e.g. 90.0 and 90.2), or a
 * `through` route's far side landing on a bearing another route already
 * occupies (e.g. a route in at 0° through, another out at 180°), can both
 * want `arm-090` or `arm-180` — and lot ids are built from lane ids, so a
 * collision here becomes a duplicate lot id downstream, breaking the
 * stable-id invariant.
 *
 * Every emission (a route's near side, and a through route's far side) is
 * grouped by its rounded bearing bucket. A bucket with only one member is
 * unaffected. A bucket with more than one is resolved deterministically by
 * CONTENT, never by array position, so the same input always resolves the
 * same way regardless of route ordering:
 *   1. the highest road class present keeps the bare `arm-NNN` id — the
 *      lowest classRank wins, matching the intuition that the more
 *      important road is the "real" one at that bearing;
 *   2. ties (equal class) prefer the near side over a through route's far
 *      side, since an arriving route is more "itself" than an echo of one;
 *   3. every loser gets a suffix built from something stable about IT:
 *      its own `route_id` when FMG supplied one, else its own unrounded
 *      bearing (so `90.2` doesn't collide with `90.0`'s bare id), and a
 *      through route's far side specifically gets a `~far` marker — it is
 *      genuinely a different lane from any route that happens to arrive on
 *      that reciprocal bearing, not a coincidental duplicate of it.
 * All suffixed ids still start with `arm-` and never contain `/b`, so
 * `trimTails`'s `isFmgArm` check (which relies on exactly that) keeps
 * treating them as untrimmed FMG roads, which is what they are.
 */
export function buildArms(
  site: Site, green: Green, extentM: number, rng: SeededRandom,
): Lane[] {
  const emissions: ArmEmission[] = [];
  for (const r of site.routes) {
    emissions.push({ route: r, bearingDeg: r.bearingDeg, isFarSide: false });
    if (r.through) emissions.push({ route: r, bearingDeg: (r.bearingDeg + 180) % 360, isFarSide: true });
  }

  const groups = new Map<string, ArmEmission[]>();
  for (const e of emissions) {
    const base = armLaneId(e.bearingDeg);
    const arr = groups.get(base);
    if (arr) arr.push(e); else groups.set(base, [e]);
  }

  const idOf = new Map<ArmEmission, string>();
  for (const [base, group] of groups) {
    if (group.length === 1) {
      idOf.set(group[0], base);
      continue;
    }
    const sorted = [...group].sort((a, b) => {
      const rankDiff = classRank(a.route.type) - classRank(b.route.type);
      if (rankDiff !== 0) return rankDiff;
      if (a.isFarSide !== b.isFarSide) return a.isFarSide ? 1 : -1;
      const aKey = a.route.routeId ?? String(a.bearingDeg);
      const bKey = b.route.routeId ?? String(b.bearingDeg);
      return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
    });
    idOf.set(sorted[0], base);
    const used = new Set<string>([base]);
    for (let i = 1; i < sorted.length; i++) {
      const e = sorted[i];
      let id = e.isFarSide
        ? `${base}~far`
        : e.route.routeId
          ? `${base}~${e.route.routeId}`
          : `${base}~${e.bearingDeg.toFixed(4)}`;
      // Last-resort dedup for a truly pathological input (e.g. two
      // identical duplicate route records): extend precision
      // deterministically until unique, still content-derived.
      let precision = 5;
      while (used.has(id)) {
        id = `${base}~${e.bearingDeg.toFixed(precision)}`;
        precision++;
      }
      used.add(id);
      idOf.set(e, id);
    }
  }

  return emissions.map((e) => ({
    id: idOf.get(e) as string,
    type: e.route.type,
    points: runArm(green, e.bearingDeg, extentM, rng),
    widthM: laneWidth(e.route.type),
  }));
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
      const length = extentM * BRANCH_LENGTH_FACTOR;
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
      points: runArm(green, bearing, extentM * INVENTED_LANE_LENGTH_FACTOR, rng),
      widthM: laneWidth(inventedType),
    });
  }
  return out;
}
