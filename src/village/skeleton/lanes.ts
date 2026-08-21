import { Point } from '../../types/point.js';
import { SeededRandom } from '../../utils/random.js';
import { classRank, laneWidth, stepDown, type RouteType } from '../route-class.js';
import {
  angularGap, arcLengths, bearingOf, bearingVector, closestPointOnSegment, dist,
  polylineLength, sampleAt,
} from '../geometry.js';
import {
  BRANCH_LOTS_TARGET, BRANCH_MAX_M, BRANCH_MIN_M, BRANCH_SPACING_M, FRONTAGE_MARGIN,
  GREEN_ARM_MAX, GREEN_ARM_MIN, GREEN_ARM_SPACING_M, GREEN_JOIN_RATIO,
  INVENTED_ARM_LENGTH_FACTOR, LANE_SAMPLE_STEP_M, LANE_WANDER_M, LOOP_SNAP_M,
  MAX_INVENTED_LANES, MIN_ARM_SEPARATION_DEG,
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
  // Junction rule: overshoot to the green's DRAWN edge, not its nominal
  // radius — the green art fills ~87% of its box, so a lane aimed at the
  // nominal rim stops ~1.4 m short of visible turf and the road appears
  // to end before the green it feeds.
  const start = (green.diameter / 2) * GREEN_JOIN_RATIO;
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

/** A wandering polyline from `from` along `bearingDeg` for `lengthM`. */
function runLine(
  from: Point, bearingDeg: number, lengthM: number, rng: SeededRandom,
): Point[] {
  const dir = bearingVector(bearingDeg);
  const normal = new Point(-dir.y, dir.x);
  const points: Point[] = [];
  let drift = 0;
  for (let d = 0; d <= lengthM; d += LANE_SAMPLE_STEP_M) {
    points.push(new Point(
      from.x + dir.x * d + normal.x * drift,
      from.y + dir.y * d + normal.y * drift,
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

/** Which way a lane leaves the green — geometry.ts owns the trigonometry. */
function laneBearing(green: Green, lane: Lane): number {
  return bearingOf(green.centre, lane.points[0]);
}

/**
 * The class an invented lane takes when it branches off `parent`.
 *
 * Owner ruling (2026-08-21 gate): royal/main/market/town are
 * INTER-SETTLEMENT classes — FMG's business. "Market lanes connect market
 * towns, NOT suburban routes." Settlemaker's own lanes live entirely in
 * the village band: local cart lanes, trails, footpaths. So a branch off
 * a `main` road is a `local` street (never `market`), a branch off a
 * `local` street is a `trail`, and a branch off a `trail` is a
 * `footpath` threading between the houses.
 */
function inventedChildClass(parent: RouteType): RouteType {
  const stepped = stepDown(parent, 'footpath');
  return classRank(stepped) < classRank('local') ? 'local' : stepped;
}

/** Lanes attached to the green: FMG arms plus the village's own streets. */
function isGreenAttached(lane: Lane): boolean {
  return lane.parentId === undefined;
}

/**
 * How many lanes the green can host, derived from the green itself: one
 * per GREEN_ARM_SPACING_M of circumference, clamped to [GREEN_ARM_MIN,
 * GREEN_ARM_MAX] — "never more than a handful". A crossroads green whose
 * FMG routes alone exceed the cap keeps them all (FMG arms always join);
 * the cap only limits what the village may ADD.
 */
function greenArmCap(green: Green): number {
  const circumference = Math.PI * green.diameter;
  return Math.min(GREEN_ARM_MAX,
    Math.max(GREEN_ARM_MIN, Math.round(circumference / GREEN_ARM_SPACING_M)));
}

/** A branch hosts BRANCH_LOTS_TARGET lots across its two sides. */
function branchLengthM(meanFrontageM: number): number {
  return Math.min(BRANCH_MAX_M,
    Math.max(BRANCH_MIN_M, (BRANCH_LOTS_TARGET / 2) * meanFrontageM));
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

interface BranchSlot {
  parent: Lane;
  at: number;
  anchor: Point;
  dirDeg: number;
  distToGreen: number;
}

/**
 * Every lane — arm, street, branch — offers an attach point every
 * BRANCH_SPACING_M along it, and the nearest-the-green free slot is taken
 * first. This is the heart of the cluster rework: the old rule branched
 * once, far out, off the longest lane, and produced a starburst; slots
 * make branches branch again, near the centre, until the wedges fill.
 * A slot is occupied if any existing lane already starts nearby.
 */
function branchSlots(out: Lane[], green: Green): BranchSlot[] {
  const slots: BranchSlot[] = [];
  for (const parent of out) {
    const acc = arcLengths(parent.points);
    const total = acc[acc.length - 1];
    if (total < BRANCH_SPACING_M * 1.25) continue;
    for (let s = BRANCH_SPACING_M; s <= total - BRANCH_SPACING_M * 0.5; s += BRANCH_SPACING_M) {
      const { p, dirDeg } = sampleAt(parent.points, acc, s);
      if (out.some((l) => dist(l.points[0], p) < BRANCH_SPACING_M * 0.45)) continue;
      slots.push({ parent, at: s / total, anchor: p, dirDeg, distToGreen: dist(p, green.centre) });
    }
  }
  // Nearest the green first; ties broken structurally so the order can
  // never depend on array position.
  slots.sort((a, b) => (a.distToGreen - b.distToGreen)
    || a.parent.id.localeCompare(b.parent.id) || (a.at - b.at));
  return slots;
}

/** End of a candidate branch near another lane? Return the join point. */
function loopSnap(
  out: Lane[], end: Point, excludeIds: Set<string>,
): Point | null {
  let best: Point | null = null;
  let bestD = LOOP_SNAP_M;
  for (const lane of out) {
    if (excludeIds.has(lane.id)) continue;
    for (let i = 1; i < lane.points.length; i++) {
      const q = closestPointOnSegment(end, lane.points[i - 1], lane.points[i]);
      const d = dist(end, q);
      if (d < bestD) { bestD = d; best = q; }
    }
  }
  return best;
}

/** One growth step. Returns false when there is nowhere left to grow. */
function growOne(
  out: Lane[], green: Green, meanFrontageM: number, rng: SeededRandom,
): boolean {
  // 1. The green may still host a street of its own: an invented arm, up
  //    to the circumference-derived cap, at a bearing clear of every
  //    existing green-attached lane. Class is `local` — wagons reach the
  //    green — and it is street-length, not a road to the horizon.
  if (out.filter(isGreenAttached).length < greenArmCap(green)) {
    const taken = out.filter(isGreenAttached).map((l) => laneBearing(green, l));
    for (let attempt = 0; attempt < 36; attempt++) {
      const candidate = rng.int(0, 360);
      const collides = taken.some((t) => angularGap(candidate, t) < MIN_ARM_SEPARATION_DEG)
        || out.some((l) => l.id === armLaneId(candidate) || l.id === inventedLaneId(candidate));
      if (collides) continue;
      const dir = bearingVector(candidate);
      const start = new Point(
        green.centre.x + dir.x * (green.diameter / 2) * GREEN_JOIN_RATIO,
        green.centre.y + dir.y * (green.diameter / 2) * GREEN_JOIN_RATIO,
      );
      out.push({
        id: inventedLaneId(candidate),
        type: 'local',
        points: runLine(start, candidate,
          branchLengthM(meanFrontageM) * INVENTED_ARM_LENGTH_FACTOR, rng),
        widthM: laneWidth('local'),
      });
      return true;
    }
    // No free bearing: fall through to branching.
  }

  // 2. Branch at the nearest-the-green free slot.
  const slots = branchSlots(out, green);
  for (const slot of slots) {
    // branchLaneId formats `at` as a 2-digit percent (~100 buckets per
    // parent); if this slot's bucket is taken, probe deterministically.
    // The id is identity, the anchor is authoritative for position.
    let id: string | null = null;
    const pct0 = Math.max(1, Math.min(99, Math.round(slot.at * 100)));
    for (let step = 0; step < 99; step++) {
      const pct = 1 + ((pct0 - 1 + step) % 99);
      const candidate = branchLaneId(slot.parent.id, pct / 100);
      if (!out.some((l) => l.id === candidate)) { id = candidate; break; }
    }
    if (!id) continue;
    const side = rng.bool(0.5) ? 1 : -1;
    const branchBearing = (slot.dirDeg + side * (60 + rng.int(0, 51)) + 360) % 360;
    let cls = inventedChildClass(slot.parent.type);
    let points = runLine(slot.anchor, branchBearing, branchLengthM(meanFrontageM), rng);
    // Loop rule: an end passing near another lane joins it, and the
    // connector drops one further class — a path cut between two streets.
    const snap = loopSnap(out, points[points.length - 1], new Set([slot.parent.id]));
    if (snap) {
      points = [...points, snap];
      cls = stepDown(cls, 'footpath');
    }
    out.push({
      id,
      type: cls,
      points,
      widthM: laneWidth(cls),
      parentId: slot.parent.id,
    });
    return true;
  }

  // 3. Every slot is taken: the village grows the way a real one does —
  //    by LENGTHENING its own streets. Extend the shortest invented lane
  //    from its end along its end direction; the new length carries fresh
  //    frontage AND fresh branch slots, so growth cannot deadlock while
  //    the census is unhoused. FMG arms are never extended — they already
  //    run to the map's edge. Shortest-first keeps the cluster balanced
  //    instead of streaming out one long tentacle.
  const extendable = out
    .filter((l) => !l.id.startsWith('arm-') && l.points.length >= 2)
    .sort((a, b) => (polylineLength(a.points) - polylineLength(b.points))
      || a.id.localeCompare(b.id));
  for (const lane of extendable) {
    const n = lane.points.length;
    const endDir = bearingOf(lane.points[n - 2], lane.points[n - 1]);
    const extension = runLine(lane.points[n - 1], endDir, branchLengthM(meanFrontageM), rng);
    lane.points = [...lane.points, ...extension.slice(1)];
    return true;
  }
  return false;
}

/**
 * Lanes are invented only when frontage runs out, and growth is
 * CLUSTER-FIRST (2026-08-21 gate rework): a handful of streets at the
 * green, then short branches attaching near the centre, branching again,
 * occasionally looping — never the radial spoke fan the first gate
 * rejected. `meanFrontageM` sizes each branch to the lots it must host.
 */
export function addInventedLanes(
  lanes: Lane[], green: Green, requiredM: number, meanFrontageM: number, rng: SeededRandom,
): Lane[] {
  const out = [...lanes];
  let guard = 0;
  while (availableFrontage(out) < requiredM * FRONTAGE_MARGIN && guard < MAX_INVENTED_LANES) {
    guard++;
    if (!growOne(out, green, meanFrontageM, rng)) break;
  }
  return out;
}
