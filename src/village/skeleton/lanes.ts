import { Point } from '../../types/point.js';
import { SeededRandom } from '../../utils/random.js';
import { classRank, laneWidth, stepDown, type RouteType } from '../route-class.js';
import {
  angularGap, arcLengths, bearingOf, bearingVector, closestPointOnSegment, dist,
  polylineLength, sampleAt, segmentIntersection, greenDrawnRadius,
} from '../geometry.js';
import {
  BRANCH_LOTS_TARGET, BRANCH_MAX_M, BRANCH_MIN_M, BRANCH_SPACING_M, FRONTAGE_MARGIN,
  GREEN_ARM_MAX, GREEN_ARM_MIN, GREEN_ARM_SPACING_M, GREEN_UNDERLAP_RATIO,
  GROWTH_RADIUS_STEP, INVENTED_ARM_LENGTH_FACTOR, JUNCTION_CLEAR_M, LANE_SAMPLE_STEP_M,
  CONNECT_MAX_M, CONNECT_MIN_M, LANE_CURVE_MAX_M, LOOP_SNAP_M, MAX_INVENTED_LANES,
  MIN_ARM_SEPARATION_DEG, SATURATION_RING_START_M, SATURATION_RING_STEP_M,
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
 * up off the rim, leaving a visible gap between the green's edge and the
 * road that feeds it. (The curve now starts at zero anyway, but the
 * ordering is kept: it is the rule, not an accident of the shape.)
 */
function runArm(
  green: Green, bearingDeg: number, extentM: number, rng: SeededRandom,
): Point[] {
  const dir = bearingVector(bearingDeg);
  const normal = new Point(-dir.y, dir.x);
  // Gate 2 junction rule: roads go UNDER the green. The lane starts deep
  // inside the green's interior and the green is painted over it, so the
  // road visibly disappears beneath the turf rather than stopping at (or
  // worse, just short of) the rim.
  const start = (green.diameter / 2) * GREEN_UNDERLAP_RATIO;
  const curve = laneCurve(rng);
  const points: Point[] = [];
  for (let d = start; d <= start + extentM; d += LANE_SAMPLE_STEP_M) {
    const offset = curveOffsetM(curve, d - start, extentM);
    points.push(new Point(
      green.centre.x + dir.x * d + normal.x * offset,
      green.centre.y + dir.y * d + normal.y * offset,
    ));
  }
  return points;
}

/**
 * Gate 5: ONE smooth curve per lane, not a random kick per sample.
 *
 * `laneCurve` spends a single rng.float for the whole lane, giving a signed
 * strength in [-1, 1]; `curveOffsetM` turns it into a lateral offset that
 * grows as the SQUARE of the distance travelled, normalised so the offset
 * reaches at most LANE_CURVE_MAX_M at the lane's far end. The lane
 * therefore leaves its junction dead straight -- which is what keeps a
 * T-junction reading as a junction -- and bends away gently after that.
 *
 * The retired per-step random walk accumulated a fresh kink every 12 m, and
 * wandered FURTHER the longer the lane; both are backwards for a road.
 */
function laneCurve(rng: SeededRandom): number {
  return rng.float() * 2 - 1;
}

function curveOffsetM(curve: number, travelledM: number, totalM: number): number {
  if (!(totalM > 0)) return 0;
  const t = Math.min(1, Math.max(0, travelledM / totalM));
  return curve * LANE_CURVE_MAX_M * t * t;
}

/** A gently curving polyline from `from` along `bearingDeg` for `lengthM`. */
function runLine(
  from: Point, bearingDeg: number, lengthM: number, rng: SeededRandom,
): Point[] {
  const dir = bearingVector(bearingDeg);
  const normal = new Point(-dir.y, dir.x);
  const curve = laneCurve(rng);
  const points: Point[] = [];
  for (let d = 0; d <= lengthM; d += LANE_SAMPLE_STEP_M) {
    const offset = curveOffsetM(curve, d, lengthM);
    points.push(new Point(
      from.x + dir.x * d + normal.x * offset,
      from.y + dir.y * d + normal.y * offset,
    ));
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

/**
 * Aim a new radial into the WIDEST angular gap between the lanes already
 * attached to the green, jittered within that gap so consecutive radials
 * never read as an even fan. Gate 4: random bearings left whole quadrants
 * of a big green streetless — growth then had to reach that ground the
 * long way round via branch chains, leaving the void the owner circled.
 */
function widestGapBearing(taken: number[], rng: SeededRandom): number {
  if (taken.length === 0) return rng.int(0, 360);
  const sorted = [...taken].sort((a, b) => a - b);
  let gapStart = sorted[sorted.length - 1];
  let gapSpan = sorted[0] + 360 - gapStart;
  for (let i = 1; i < sorted.length; i++) {
    const span = sorted[i] - sorted[i - 1];
    if (span > gapSpan) { gapSpan = span; gapStart = sorted[i - 1]; }
  }
  const jitter = (rng.float() - 0.5) * gapSpan * 0.5;
  return (gapStart + gapSpan / 2 + jitter + 360) % 360;
}

/**
 * How long a new street needs to be, sized to the dwellings still to be
 * housed THIS ROUND rather than to a fixed target.
 *
 * Gate 5.1: a hamlet was being given the same 14-lot street a pop-900
 * village gets, so its handful of huts strung out along a road instead of
 * gathering at the green -- the owner's "we have ZERO clustering ... they're
 * in a single line away from the green". `remainingDwellings` is derived
 * from the frontage still owed, so it falls as the loop adds lanes and the
 * last spur of a village is short.
 *
 * BRANCH_LOTS_TARGET survives as the CAP: one street never tries to host
 * more than that many lots, however big the shortfall, so a big village
 * grows several streets rather than one enormous one. Floored at two lots
 * so a spur is never a single plot.
 */
function branchLengthM(meanFrontageM: number): number {
  // Gate 6.2: ONE short size everywhere. The need-derived sizing this
  // replaces is precisely what let growth escape the interior -- a large
  // remaining shortfall bought a long street, which supplied its frontage
  // far from the green and satisfied the budget before the wedges filled.
  return Math.min(
    BRANCH_MAX_M,
    Math.max(BRANCH_MIN_M, (BRANCH_LOTS_TARGET / 2) * meanFrontageM),
  );
}

/**
 * Both sides of every lane are frontage -- but only the stretch that
 * actually carries lots. Gate 5.1 stopped the cutter placing lots beyond
 * the cluster (`subdivideLane`'s `maxDistanceM`), so counting a trunk
 * road's whole run to the map edge would tell the escalation loop it had
 * frontage it will never use, and the census would go unhoused. Segments
 * are counted whole when both ends are inside the radius, half when one
 * is, and not at all when neither is -- enough precision for an estimate
 * the loop only uses to decide whether to grow again.
 */
export function availableFrontage(
  lanes: Lane[], green?: Green, maxDistanceM: number = Infinity,
): number {
  if (!green || !Number.isFinite(maxDistanceM)) {
    return lanes.reduce((sum, l) => sum + polylineLength(l.points) * 2, 0);
  }
  let total = 0;
  for (const lane of lanes) {
    for (let i = 1; i < lane.points.length; i++) {
      const a = lane.points[i - 1];
      const b = lane.points[i];
      const inA = dist(a, green.centre) <= maxDistanceM;
      const inB = dist(b, green.centre) <= maxDistanceM;
      if (!inA && !inB) continue;
      total += dist(a, b) * (inA && inB ? 1 : 0.5) * 2;
    }
  }
  return total;
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
function branchSlots(
  out: Lane[], green: Green, growthRadiusM: number,
): BranchSlot[] {
  const slots: BranchSlot[] = [];
  for (const parent of out) {
    const acc = arcLengths(parent.points);
    const total = acc[acc.length - 1];
    if (total < BRANCH_SPACING_M * 1.25) continue;
    // Gate 6.2: one pitch everywhere -- the whole fabric is mesh now.
    let s = BRANCH_SPACING_M;
    while (s <= total - BRANCH_SPACING_M * 0.5) {
      const { p, dirDeg } = sampleAt(parent.points, acc, s);
      const distToGreen = dist(p, green.centre);
      const pitch = BRANCH_SPACING_M;
      // Gate 3: "sprawl should be clustered around the green" — a slot
      // outside the growth circle never spawns a branch, so a long FMG
      // road cannot sprout satellite webs half a map away.
      if (distToGreen <= growthRadiusM
        && !out.some((l) => dist(l.points[0], p) < pitch * 0.45)) {
        slots.push({ parent, at: s / total, anchor: p, dirDeg, distToGreen });
      }
      s += pitch;
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
  out: Lane[], end: Point, excludeIds: Set<string>, radiusM: number = LOOP_SNAP_M,
): Point | null {
  let best: Point | null = null;
  let bestD = radiusM;
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

/**
 * Gate 2: "too chaotic, many roads crossing over each other in nonsensical
 * manners". A growing lane's BODY may not cross an existing lane: it is cut
 * at the first intersection and joined there, turning a paint-over into a
 * T-junction. (loopSnap already handled the near-miss END; this handles the
 * genuine crossing.) The caller decides whether a cut implies a class drop.
 */
function truncateAtFirstCrossing(
  points: Point[], out: Lane[], green: Green, parentId?: string,
): Point[] {
  // Gate 3 closed two loopholes here (parent no longer blanket-exempt;
  // the fully assembled polyline including any loop-snap tail is checked),
  // and gate 4 closed a third: the old rule ignored EVERY intersection
  // within JUNCTION_CLEAR_M of the new lane's start, which let a branch
  // starting near some unrelated lane paint straight over it. Only two
  // exemptions remain, each a genuine junction rather than a crossing:
  //  - the branch's own PARENT, within JUNCTION_CLEAR_M of the start
  //    (that is the junction the branch exists to make);
  //  - anything under the green's turf, where the radial streets all share
  //    the painted-over ground and no crossing is ever visible.
  const start = points[0];
  for (let i = 1; i < points.length; i++) {
    let best: { q: Point; t: number } | null = null;
    for (const lane of out) {
      for (let j = 1; j < lane.points.length; j++) {
        const q = segmentIntersection(points[i - 1], points[i], lane.points[j - 1], lane.points[j]);
        if (!q) continue;
        if (lane.id === parentId && dist(start, q) <= JUNCTION_CLEAR_M) continue;
        if (dist(q, green.centre) <= green.diameter / 2) continue;
        const t = dist(points[i - 1], q);
        if (!best || t < best.t) best = { q, t };
      }
    }
    if (best) return [...points.slice(0, i), best.q];
  }
  return points;
}

/**
 * Gate 5.4: the last word on crossings. `truncateAtFirstCrossing` exempts
 * the branch's own PARENT within JUNCTION_CLEAR_M of the start -- that
 * exemption exists for the junction the branch is there to make. But it is
 * written as a DISTANCE from the start, so a curving parent that loops back
 * within that distance gets a free crossing too. The mesh makes this
 * likelier (shorter streets, denser slots, curvier parents), and it showed
 * up as exactly one crossing in a pop-900 fixture: a branch crossing its
 * own parent a second time, 109 m out.
 *
 * So the assembled polyline is checked once more against the parent alone
 * -- every other lane was already truncated against without exemption --
 * and more than one intersection with it means this is not a junction, it
 * is a crossing. The caller rejects the slot and tries the next.
 */
function crossesParentTwice(points: Point[], parent: Lane | undefined): boolean {
  if (!parent) return false;
  let hits = 0;
  for (let i = 1; i < points.length; i++) {
    for (let j = 1; j < parent.points.length; j++) {
      if (segmentIntersection(points[i - 1], points[i], parent.points[j - 1], parent.points[j])) {
        hits += 1;
        if (hits > 1) return true;
      }
    }
  }
  return false;
}

/** Truncated and loop-snapped lanes END on another lane — that end is a
 * junction, and a street that ends at a junction never grows through it.
 * The tolerance is an identity epsilon (cut and snap points sit exactly ON
 * the other centreline), not a tunable. */
export const JOINED_END_EPS_M = 1;

function endsOnAnotherLane(lane: Lane, out: Lane[]): boolean {
  const end = lane.points[lane.points.length - 1];
  for (const other of out) {
    if (other.id === lane.id) continue;
    for (let i = 1; i < other.points.length; i++) {
      const q = closestPointOnSegment(end, other.points[i - 1], other.points[i]);
      if (dist(end, q) <= JOINED_END_EPS_M) return true;
    }
  }
  return false;
}

/**
 * Lengthen the shortest extendable street whose length is still under
 * `maxLengthM`, from its end along its end direction. FMG arms are never
 * extended — they already run to the map's edge. Shortest-first keeps the
 * cluster balanced instead of streaming out one long tentacle.
 */
function extendOne(
  out: Lane[], green: Green, meanFrontageM: number, growthRadiusM: number,
  rng: SeededRandom, maxLengthM: number, satRadiusM: number,
): boolean {
  const extendable = out
    .filter((l) => !l.id.startsWith('arm-') && l.points.length >= 2
      && polylineLength(l.points) < maxLengthM
      // Gate 3: extension is confined to the cluster — a street whose end
      // has left the growth circle stops growing outward.
      && dist(l.points[l.points.length - 1], green.centre) <= growthRadiusM
      // Gate 6.2 CONCENTRIC SATURATION: and to the ring currently being
      // filled. An extension's ANCHOR is the end it grows from, so a street
      // already reaching past the saturation radius is not the place to add
      // more length -- the interior has first call on every metre.
      && dist(l.points[l.points.length - 1], green.centre) <= satRadiusM
      // Gate 4: a truncated or loop-snapped lane ENDS at a junction on
      // another lane. Extending it from there walks straight across that
      // lane — segmentIntersection's endpoint-touch exclusion cannot even
      // see the hop — which is precisely the untidy crossing the growth
      // rules exist to prevent. A street that ends at a junction is done.
      && !endsOnAnotherLane(l, out))
    .sort((a, b) => (polylineLength(a.points) - polylineLength(b.points))
      || a.id.localeCompare(b.id));
  for (const lane of extendable) {
    const n = lane.points.length;
    const endDir = bearingOf(lane.points[n - 2], lane.points[n - 1]);
    const extension = truncateAtFirstCrossing(
      runLine(lane.points[n - 1], endDir, branchLengthM(meanFrontageM), rng),
      out.filter((l) => l.id !== lane.id), green);
    if (extension.length < 2) continue;
    // Gate 5.4: an extension leaves from the lane's OLD END -- which is
    // exactly where a child branch may also leave. segmentIntersection
    // ignores crossings at a shared endpoint (by design: a branch starting
    // on its parent must not read as crossing it), so truncation cannot
    // see the extension running straight through that child. Measured as
    // one crossing in a pop-900 fixture, parent through its own child.
    // Re-test with the origin nudged forward, where the exclusion no
    // longer hides anything, and abandon the extension if it crosses.
    const probe = [...extension];
    probe[0] = new Point(
      extension[0].x + (extension[1].x - extension[0].x) * 0.05,
      extension[0].y + (extension[1].y - extension[0].y) * 0.05,
    );
    const crosses = out.some((other) => {
      if (other.id === lane.id) return false;
      for (let i = 1; i < probe.length; i++) {
        for (let j = 1; j < other.points.length; j++) {
          if (segmentIntersection(probe[i - 1], probe[i], other.points[j - 1], other.points[j])) {
            return true;
          }
        }
      }
      return false;
    });
    if (crosses) continue;
    lane.points = [...lane.points, ...extension.slice(1)];
    return true;
  }
  return false;
}

/** One growth step. Returns false when there is nowhere left to grow. */
function growOne(
  out: Lane[], green: Green, meanFrontageM: number, growthRadiusM: number,
  rng: SeededRandom, satRadiusM: number,
): boolean {
  // 1. The green may still host a street of its own: an invented arm, up
  //    to the circumference-derived cap, at a bearing clear of every
  //    existing green-attached lane. Class is `local` — wagons reach the
  //    green — and it is street-length, not a road to the horizon.
  // The cap governs what the village ADDS: only invented radials (their
  // ids live in the `lane-` space, R10) count against it. Gate 4: counting
  // FMG's own arms let two incoming routes eat a cap of 3, leaving a
  // pop-900 green a single radial and a dead quadrant.
  if (out.filter((l) => isGreenAttached(l) && l.id.startsWith('lane-')).length
      < greenArmCap(green)) {
    const taken = out.filter(isGreenAttached).map((l) => laneBearing(green, l));
    for (let attempt = 0; attempt < 36; attempt++) {
      const candidate = Math.round(widestGapBearing(taken, rng)) % 360;
      const collides = taken.some((t) => angularGap(candidate, t) < MIN_ARM_SEPARATION_DEG)
        || out.some((l) => l.id === armLaneId(candidate) || l.id === inventedLaneId(candidate));
      if (collides) continue;
      const dir = bearingVector(candidate);
      // Under-green join, as for FMG arms: start inside the turf.
      const start = new Point(
        green.centre.x + dir.x * (green.diameter / 2) * GREEN_UNDERLAP_RATIO,
        green.centre.y + dir.y * (green.diameter / 2) * GREEN_UNDERLAP_RATIO,
      );
      // Vary the street length (gate 2: identical radials read as
      // contrived) — 0.7x to 1.3x around the nominal factor.
      const lengthJitter = 0.7 + rng.float() * 0.6;
      const points = truncateAtFirstCrossing(
        runLine(start, candidate,
          branchLengthM(meanFrontageM) * INVENTED_ARM_LENGTH_FACTOR * lengthJitter, rng),
        out, green);
      out.push({
        id: inventedLaneId(candidate),
        type: 'local',
        points,
        widthM: laneWidth('local'),
      });
      return true;
    }
    // No free bearing: fall through to branching.
  }

  // Gate 6.2 CONCENTRIC SATURATION: only slots whose ANCHOR lies inside the
  // ring currently being filled are candidates. Growth reticulates there
  // until nothing more can be done, and only then does the caller widen the
  // ring. No ring is left until it is genuinely full.
  const slots = branchSlots(out, green, growthRadiusM)
    .filter((sl) => sl.distToGreen <= satRadiusM);

  /** Try each candidate slot in order; returns true once one takes. */
  const tryBranch = (candidates: BranchSlot[]): boolean => {
    for (const slot of candidates) {
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
      // Gate 6.2: 60-110 deg off the parent -> 45-135. The narrow forward
      // fan could only rake alongside its parent; the wider range lets a
      // branch turn far enough to strike into a wedge's interior, which is
      // where the empty land was. One rng.int as before, wider range.
      const branchBearing = (slot.dirDeg + side * (70 + rng.int(0, 31)) + 360) % 360;
      let cls = inventedChildClass(slot.parent.type);
      let points = runLine(slot.anchor, branchBearing, branchLengthM(meanFrontageM), rng);
      // Loop rule first: an end passing near another lane joins it. Then ONE
      // crossing pass over the fully assembled polyline — snap tail included —
      // so no segment of the final lane crosses anything. Either cut means the
      // lane meets another lane, and a connector runs one class lower.
      //
      // Gate 6.2: one generous snap radius everywhere (LOOP_SNAP_M is 18 m
      // now), so a short street reaching for its neighbour joins it and
      // closes a block rather than stopping short as a dead end. The
      // class-drop is unchanged — a snapped lane is still a connector.
      const snap = loopSnap(out, points[points.length - 1], new Set([slot.parent.id]));
      if (snap) points = [...points, snap];
      const assembled = points.length;
      points = truncateAtFirstCrossing(points, out, green, slot.parent.id);
      if (snap || points.length < assembled) {
        cls = stepDown(cls, 'footpath');
      }
      // Gate 5: a branch cut down to a stub is not a street. Truncation at a
      // crossing (or a loop snap that lands almost at once) can leave a few
      // metres of road going nowhere, which is exactly the litter the owner
      // saw. Reject it and try the next slot rather than keeping it.
      if (points.length < 2 || polylineLength(points) < BRANCH_MIN_M) continue;
      if (crossesParentTwice(points, slot.parent)) continue;
      out.push({
        id,
        type: cls,
        points,
        widthM: laneWidth(cls),
        parentId: slot.parent.id,
      });
      return true;
    }
    return false;
  };

  // 2. RETICULATE: open another short street inside the ring.
  if (tryBranch(slots)) return true;

  // 3. Nothing new to open in this ring, so lengthen what is here -- still
  //    only streets whose end lies inside it.
  if (extendOne(out, green, meanFrontageM, growthRadiusM, rng,
    branchLengthM(meanFrontageM), satRadiusM)) {
    return true;
  }

  // 4. Last resort WITHIN THIS RING: every slot is taken and every street
  //    is at full length, so lengthen one past its nominal length anyway.
  //    Still ring-bounded -- when this also fails, the caller widens the
  //    ring, which is the only way growth ever moves outward.
  return extendOne(out, green, meanFrontageM, growthRadiusM, rng, Infinity, satRadiusM);
}

/** Nearest point on any lane other than `excludeIds`, with its distance. */
function nearestOnOtherLane(
  from: Point, lanes: Lane[], excludeIds: Set<string>,
): { point: Point; distance: number } | null {
  let best: { point: Point; distance: number } | null = null;
  for (const lane of lanes) {
    if (excludeIds.has(lane.id)) continue;
    for (let i = 1; i < lane.points.length; i++) {
      const q = closestPointOnSegment(from, lane.points[i - 1], lane.points[i]);
      const d = dist(from, q);
      if (!best || d < best.distance) best = { point: q, distance: d };
    }
  }
  return best;
}

/** Does this polyline cross any lane anywhere? Endpoint touches do not
 * count -- `segmentIntersection` already excludes them, which is what lets
 * a connector start ON its own lane and end ON its target. */
function crossesAnyLane(points: Point[], lanes: Lane[]): boolean {
  for (const lane of lanes) {
    for (let i = 1; i < points.length; i++) {
      for (let j = 1; j < lane.points.length; j++) {
        if (segmentIntersection(points[i - 1], points[i], lane.points[j - 1], lane.points[j])) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Gate 6.3: turn the growth TREE into a WEB.
 *
 * Growth hangs every new lane off exactly one parent, so the result is a
 * tree -- dead-ended except where the loop-snap happened to catch a
 * neighbour. The owner drew the missing half in red: short links from
 * branch ends to the lanes beside them, leaving essentially no dead ends
 * inside the fabric.
 *
 * For each invented lane that dead-ends, the nearest point on any other
 * lane within CONNECT_MAX_M is taken as the target, and a straight run to
 * it is accepted only if it crosses nothing. REJECTED, not truncated: a
 * connector that cannot reach cleanly would leave a new dead end, which is
 * exactly what this is removing.
 *
 * Deterministic and rng-free -- connectors are pure geometry, so they can
 * be added between growth and lot-cutting without shifting a single draw.
 * Walked in id order, and each accepted connector joins the set the next
 * candidate is tested against, so two connectors can never cross either.
 *
 * Ids are `<laneId>/c`, a stable sub-space of the lane that grew the dead
 * end. A connector is footpath class -- the owner's standing rule that a
 * loop is made at a lower class than the lanes it joins.
 */
export function connectDeadEnds(lanes: Lane[], green: Green): Lane[] {
  const out = [...lanes];
  const candidates = lanes
    .filter((l) => !l.id.startsWith('arm-') && l.points.length >= 2)
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id));

  for (const lane of candidates) {
    if (endsOnAnotherLane(lane, out)) continue;
    const end = lane.points[lane.points.length - 1];
    const target = nearestOnOtherLane(end, out, new Set([lane.id]));
    if (!target) continue;
    if (target.distance > CONNECT_MAX_M || target.distance < CONNECT_MIN_M) continue;

    const points = [end, target.point];
    // Everything except this lane and the connector itself: the connector
    // legitimately touches its own lane at the start and its target at the
    // end, and `segmentIntersection` ignores both as endpoint touches.
    if (crossesAnyLane(points, out.filter((l) => l.id !== lane.id))) continue;
    // Under the green's turf every radial shares the ground and no crossing
    // is visible; a connector there would be invisible clutter.
    if (dist(target.point, green.centre) <= green.diameter / 2) continue;

    out.push({
      id: `${lane.id}/c`,
      type: 'footpath',
      points,
      widthM: laneWidth('footpath'),
      parentId: lane.id,
    });
  }
  return out;
}

/**
 * Lanes are invented only when frontage runs out, and growth is
 * CLUSTER-FIRST (2026-08-21 gate rework): a handful of streets at the
 * green, then short branches attaching near the centre, branching again,
 * occasionally looping — never the radial spoke fan the first gate
 * rejected. `meanFrontageM` sizes each branch to the lots it must host.
 */
export function addInventedLanes(
  lanes: Lane[], green: Green, requiredM: number, meanFrontageM: number,
  growthRadiusM: number, rng: SeededRandom,
): { lanes: Lane[]; radiusM: number } {
  const out = [...lanes];
  let guard = 0;
  let radiusM = growthRadiusM;
  // Gate 6.2 CONCENTRIC SATURATION. The ring being filled starts just
  // outside the green and only ever widens when nothing can be done inside
  // it. This is the whole fix for "houses closer together but along LONG
  // streets that leave 90% of the available land empty": the mesh changed
  // local texture, but growth could still escape outward, because a long
  // arm or extension supplied frontage cheaply far from the green and the
  // budget was met before the interior wedges filled.
  let satRadiusM = greenDrawnRadius(green) + SATURATION_RING_START_M;
  // Only frontage inside the SATURATED disc counts. Counting lane length
  // the cutter will not use is exactly how distant frontage used to pay for
  // the census; the cutter is handed this same radius below.
  const reachM = (): number => Math.min(satRadiusM, radiusM);
  const owed = (): number => requiredM * FRONTAGE_MARGIN
    - availableFrontage(out, green, reachM());
  while (owed() > 0 && guard < MAX_INVENTED_LANES) {
    guard++;
    if (growOne(out, green, meanFrontageM, radiusM, rng, reachM())) continue;
    // Nothing left to do inside this ring. Widen it -- and only then, once
    // the ring has caught up with the outer growth circle, widen that too.
    // The outer circle and its stepping remain the ultimate bound; the ring
    // is a stricter one layered inside it.
    if (satRadiusM < radiusM) {
      satRadiusM = Math.min(radiusM, satRadiusM + SATURATION_RING_STEP_M);
    } else {
      radiusM *= GROWTH_RADIUS_STEP;
      satRadiusM += SATURATION_RING_STEP_M;
    }
  }
  // The FINAL saturated radius is returned, not the growth circle: the lot
  // cutter must use the same disc, or it cuts plots along stretches the
  // budget never counted (and the far reaches of an FMG arm sprout houses
  // while the interior is still empty).
  return { lanes: out, radiusM: reachM() };
}
