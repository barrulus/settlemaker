import { Point } from '../../types/point.js';
import { SeededRandom } from '../../utils/random.js';
import { classRank, laneWidth, stepDown, type RouteType } from '../route-class.js';
import { intrudesOnLane } from '../dwellings.js';
import {
  angularGap, arcLengths, bearingOf, bearingVector, closestPointOnSegment, dist,
  polylineLength, sampleAt, segmentIntersection, greenDrawnRadius,
} from '../geometry.js';
import {
  BRANCH_LOTS_TARGET, BRANCH_MAX_M, BRANCH_MIN_M, BRANCH_SPACING_M, DISC_MARGIN,
  GREEN_ARM_MAX, GREEN_ARM_MIN, GREEN_ARM_SPACING_M, GREEN_UNDERLAP_RATIO,
  INVENTED_ARM_LENGTH_FACTOR, JUNCTION_CLEAR_M, LANE_MIN_SPACING_M, LANE_SAMPLE_STEP_M,
  ARM_LOT_RADIUS_SHARE, CONNECT_MAX_M, CONNECT_MIN_M, HAMLET_RIBBON_POP, LANE_CURVE_MAX_M,
  LOOP_SNAP_M, MAX_INVENTED_LANES, MIN_ARM_SEPARATION_DEG, SATURATION_RING_START_M,
  SATURATION_RING_STEP_M, SECTOR_COVERAGE_DEG, SECTOR_SAMPLE_DEG,
  VOID_SCAN_STEP_M, VOID_SPACING_M,
} from '../constants.js';
import {
  armLaneId, branchLaneId, inventedLaneId,
  type Building, type Green, type Lane, type Site, type SiteRoute,
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

/**
 * GATE 6.7, STREETS RATHER THAN STUBS -- how far a new invented street runs
 * before anything else gets a say.
 *
 * Growth used to give every branch one `branchLengthM` (24-30 m as measured
 * at gate 6.7) whatever lay in front of it, so the fabric filled with short
 * stubs hanging off stubs: measured junction pitch 17-19 m at pop 900,
 * against the 24 m the slot pitch nominally sets. That matters because the
 * lot-death histogram put 19-29% of every lot the village cuts -- the
 * largest single cause by five to ten times -- on cross-strip collisions at
 * a JUNCTION MOUTH, where two lanes' claims fight over the same corner. The
 * sterile ground is per junction, so a mesh of stubs is self-defeating: it
 * adds junctions faster than frontage.
 *
 * A street now runs to the EDGE OF THE RING BEING SATURATED, and stops
 * earlier only for a reason: `truncateAtFirstCrossing` cuts it at the first
 * lane it meets (turning a crossing into a T-junction) and `loopSnap` joins
 * it to a neighbour it passes close to. So it runs until it joins something
 * or leaves the ring -- which is what makes the streets long, the junctions
 * few, and the ground between them read as blocks.
 *
 * Ring-bounded, not disc-bounded, so concentric saturation still holds: the
 * interior fills before growth moves outward, and a street laid in an early
 * ring is lengthened by `extendOne` as the rings widen.
 */
function streetRunM(from: Point, bearingDeg: number, green: Green, ringRadiusM: number): number {
  // Ray/circle intersection: how far along `bearingDeg` from `from` the ring
  // boundary lies. `from` is inside the ring in every caller here.
  const dir = bearingVector(bearingDeg);
  const cx = from.x - green.centre.x;
  const cy = from.y - green.centre.y;
  const b = cx * dir.x + cy * dir.y;
  const c = cx * cx + cy * cy - ringRadiusM * ringRadiusM;
  const disc = b * b - c;
  const reach = disc <= 0 ? 0 : -b + Math.sqrt(disc);
  return Math.min(BRANCH_MAX_M, Math.max(BRANCH_MIN_M, reach));
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
/**
 * Gate 6.3: how far out along a given lane lots may be cut.
 *
 * A TRUNK-class lane -- royal/main/market/town, i.e. one of FMG's own arms,
 * drawn to the map edge and never grown -- carries lots only within
 * ARM_LOT_RADIUS_SHARE of the saturated disc. Beyond that it is a plain
 * road leaving the village, which is what the owner drew: "no isolated long
 * roads leading away from the core", the arm bare past the cluster body.
 *
 * The village's own invented streets (local/trail/footpath) keep the whole
 * disc -- they ARE the cluster.
 *
 * Below HAMLET_RIBBON_POP the cap lifts entirely: "only in tiny hamlets is
 * stretch on the road fine."
 */
export function lotReachFor(
  lane: Lane, saturatedRadiusM: number, population: number,
): number {
  if (population < HAMLET_RIBBON_POP) return saturatedRadiusM;
  const isTrunk = classRank(lane.type) <= classRank('town');
  return isTrunk ? saturatedRadiusM * ARM_LOT_RADIUS_SHARE : saturatedRadiusM;
}


/**
 * Both sides of every lane are frontage -- but only the stretch that will
 * actually be CUT into lots. Two limits apply, and both must be here or the
 * growth budget buys frontage it can never use:
 *  - the saturated disc (gate 5.1/6.2): nothing outside it is cut;
 *  - the TRUNK CAP (gate 6.3): a trunk-class arm is cut only within
 *    ARM_LOT_RADIUS_SHARE of that disc.
 *
 * Gate 6.4 fixes the second. 6.3 stopped CUTTING beyond the trunk cap but
 * went on COUNTING that length, so the budget was satisfied by frontage
 * that could never carry a house -- growth then under-built the web by
 * exactly that amount, which is a direct cause of the sparse, gappy fabric
 * the owner rejected.
 *
 * Segments are counted whole when both ends are inside the limit, half when
 * one is, and not at all when neither is -- enough for an estimate the loop
 * only uses to decide whether to grow again.
 */
export function availableFrontage(
  lanes: Lane[], green?: Green, maxDistanceM: number = Infinity,
  population: number = 0,
): number {
  if (!green || !Number.isFinite(maxDistanceM)) {
    return lanes.reduce((sum, l) => sum + polylineLength(l.points) * 2, 0);
  }
  let total = 0;
  for (const lane of lanes) {
    const reach = lotReachFor(lane, maxDistanceM, population);
    for (let i = 1; i < lane.points.length; i++) {
      const a = lane.points[i - 1];
      const b = lane.points[i];
      const inA = dist(a, green.centre) <= reach;
      const inB = dist(b, green.centre) <= reach;
      if (!inA && !inB) continue;
      total += dist(a, b) * (inA && inB ? 1 : 0.5) * 2;
    }
  }
  return total;
}

/**
 * Gate 6.6, AREA-FIRST DISC SIZING -- the radius the census actually needs.
 *
 *   laneLength = dwellings x meanLotFrontageM / 2   (both sides carry lots)
 *   area       = laneLength x VOID_SPACING_M        (the plane-spacing rule
 *                                                    growth tiles the disc to)
 *   R          = sqrt(area / PI) x DISC_MARGIN
 *
 * This replaces the frontage BUDGET the growth loop used to bargain over.
 * That budget fed back on itself through `seatEfficiency` and demanded
 * roughly three times the frontage the census could fill, so the disc came
 * out ~1.4x too wide and every row was two-thirds empty (see
 * DISC_MARGIN's note). A closed form cannot spiral: the house count and the
 * cut width are both known before a single lane exists.
 *
 * `meanLotFrontageM` is f0 -- the ink-economy cut width, jitter-neutral --
 * not the measured mean of an earlier round's lots, which would reintroduce
 * exactly the round-to-round feedback this removes.
 */
export function discRadiusFor(dwellings: number, meanLotFrontageM: number): number {
  const laneLengthM = (Math.max(1, dwellings) * meanLotFrontageM) / 2;
  return Math.sqrt((laneLengthM * VOID_SPACING_M) / Math.PI) * DISC_MARGIN;
}

/**
 * The same closed form read the other way: how much lane tiles a disc of
 * `radiusM` at VOID_SPACING_M. Growth spends against this, so widening the
 * disc buys more road at ONE density instead of meshing the same ground
 * ever finer. Inverse of `discRadiusFor` by construction.
 */
export function laneBudgetFor(radiusM: number): number {
  return (Math.PI * radiusM * radiusM) / (VOID_SPACING_M * DISC_MARGIN * DISC_MARGIN);
}

/** Lane length inside `radiusM` of the green, segment by segment. */
function laneLengthWithin(lanes: Lane[], green: Green, radiusM: number): number {
  let total = 0;
  for (const lane of lanes) {
    for (let i = 1; i < lane.points.length; i++) {
      const a = lane.points[i - 1];
      const b = lane.points[i];
      const inA = dist(a, green.centre) <= radiusM;
      const inB = dist(b, green.centre) <= radiusM;
      if (!inA && !inB) continue;
      total += dist(a, b) * (inA && inB ? 1 : 0.5);
    }
  }
  return total;
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
 * Gate 6.6: the MINIMUM half of the plane-spacing rule -- does this lane
 * open ground no existing lane can already reach?
 *
 * Gate 6.5 fixed the maximum (`seedVoidLane`: nowhere further than
 * VOID_SPACING_M from a lane) but left the minimum unbounded, and growth
 * duly packed lanes at a measured ~19 m mean spacing. Lots are LOT_DEPTH_M
 * deep on both sides of a lane, so at that spacing the facing strips of
 * neighbouring lanes overlap and `resolveConvergingLots` drops one of every
 * pair: measured at gate 6.5, only ~31% of the lots cut survived to be
 * offered, the census then needed three times the frontage, and the disc
 * ballooned. Over-tiling with lanes does not house more people -- it houses
 * fewer, and spreads them wider.
 *
 * So a new lane must get at least LANE_MIN_SPACING_M clear of every
 * existing lane SOMEWHERE along its length. It may leave its parent's side,
 * thread past a neighbour, or run a while alongside one; what it may not do
 * is exist entirely inside ground the lanes already serve.
 */
function earnsItsSpace(points: Point[], out: Lane[], parentId?: string): boolean {
  const others = out.filter((l) => l.id !== parentId);
  if (others.length === 0) return true;
  const acc = arcLengths(points);
  const total = acc[acc.length - 1];
  const gaps: number[] = [];
  for (let s = 0; s <= total; s += LANE_SAMPLE_STEP_M) {
    const { p } = sampleAt(points, acc, s);
    let nearest = Infinity;
    for (const lane of others) {
      for (let i = 1; i < lane.points.length; i++) {
        nearest = Math.min(
          nearest, dist(p, closestPointOnSegment(p, lane.points[i - 1], lane.points[i])),
        );
      }
    }
    gaps.push(nearest);
  }
  if (gaps.length === 0) return true;
  // The MEDIAN, not the best point: a lane that hugs a neighbour for most of
  // its length and only escapes at the tip splits one street's frontage in
  // two instead of opening new ground, and every lot along the shared
  // stretch dies in resolution.
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)] >= LANE_MIN_SPACING_M;
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
      runLine(lane.points[n - 1], endDir,
        streetRunM(lane.points[n - 1], endDir, green, satRadiusM), rng),
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
          streetRunM(start, candidate, green, satRadiusM) * lengthJitter, rng),
        out, green);
      // Gate 6.6: a radial that never leaves its neighbours' ground only
      // splits the same frontage in two -- see `earnsItsSpace`.
      if (points.length < 2 || !earnsItsSpace(points, out)) continue;
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
      // Gate 6.7: to the ring's edge, not one stub length -- see `streetRunM`.
      let points = runLine(
        slot.anchor, branchBearing, streetRunM(slot.anchor, branchBearing, green, satRadiusM), rng,
      );
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
      // Gate 6.6: and it must open ground the existing lanes cannot reach.
      if (!earnsItsSpace(points, out, slot.parent.id)) continue;
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
    satRadiusM * 2, satRadiusM)) {
    return true;
  }

  // 4. Last resort WITHIN THIS RING: every slot is taken and every street
  //    is at full length, so lengthen one past its nominal length anyway.
  //    Still ring-bounded -- when this also fails, the caller widens the
  //    ring, which is the only way growth ever moves outward.
  return extendOne(out, green, meanFrontageM, growthRadiusM, rng, Infinity, satRadiusM);
}

/**
 * Every lane's nearest point to `from`, nearest first -- one candidate per
 * lane, so a dead end can try its second and third choice.
 *
 * Gate 6.4: this used to return only the single nearest point. Once
 * connectors had to clear BUILDINGS as well as lanes, one blocked target
 * abandoned the dead end entirely, and the closed-web count collapsed (7 of
 * 10 interior lanes dead-ended again at pop 300). A neighbour that cannot
 * be reached is a reason to try the next neighbour, not to give up.
 */
function nearestOnOtherLanes(
  from: Point, lanes: Lane[], excludeIds: Set<string>,
): Array<{ point: Point; distance: number }> {
  const out: Array<{ point: Point; distance: number }> = [];
  for (const lane of lanes) {
    if (excludeIds.has(lane.id)) continue;
    let best: { point: Point; distance: number } | null = null;
    for (let i = 1; i < lane.points.length; i++) {
      const q = closestPointOnSegment(from, lane.points[i - 1], lane.points[i]);
      const d = dist(from, q);
      if (!best || d < best.distance) best = { point: q, distance: d };
    }
    if (best) out.push(best);
  }
  return out.sort((a, b) => a.distance - b.distance);
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
export function connectDeadEnds(
  lanes: Lane[], green: Green, buildings: Building[] = [],
): Lane[] {
  const out = [...lanes];
  const candidates = lanes
    .filter((l) => !l.id.startsWith('arm-') && l.points.length >= 2)
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id));

  for (const lane of candidates) {
    if (endsOnAnotherLane(lane, out)) continue;
    const end = lane.points[lane.points.length - 1];
    for (const target of nearestOnOtherLanes(end, out, new Set([lane.id]))) {
      if (target.distance > CONNECT_MAX_M) break; // sorted: the rest are further
      if (target.distance < CONNECT_MIN_M) continue;

      const points = [end, target.point];
      // Tested against EVERY lane including its own parent. The connector
      // legitimately touches its parent at the start and its target at the
      // end, and `segmentIntersection` ignores both as endpoint touches --
      // so no lane needs excluding, and excluding the parent (as this first
      // did) lets a connector curl back and cut across the very lane it
      // grew from. Measured as one crossing at pop 900 seed 2.
      if (crossesAnyLane(points, out)) continue;
      // Under the green's turf every radial shares the ground and no
      // crossing is visible; a connector there would be invisible clutter.
      if (dist(target.point, green.centre) <= green.diameter / 2) continue;

      const connector: Lane = {
        id: `${lane.id}/c`,
        type: 'footpath',
        points,
        widthM: laneWidth('footpath'),
        parentId: lane.id,
      };
      // Gate 6.4: and it must not run through a HOUSE. Connectors are
      // placed after seating, so unlike every other lane they meet a
      // fabric that is already built -- and nothing else in this pass
      // would notice. Missing this put buildings in the road once
      // connectors were adopted whether or not a re-seat followed.
      if (buildings.some((b) => intrudesOnLane(b, [connector]))) continue;
      out.push(connector);
      break; // this dead end is closed; on to the next
    }
  }
  return out;
}

/**
 * Gate 6.4: which bearings from the green have ANY lane in them, inside
 * `radiusM`. Buckets are SECTOR_SAMPLE_DEG wide; segments are walked, not
 * just their vertices, so a long lane crossing a sector marks it covered
 * even when neither endpoint sits there.
 */
function angularCoverage(lanes: Lane[], green: Green, radiusM: number): boolean[] {
  const buckets = Math.round(360 / SECTOR_SAMPLE_DEG);
  const covered = new Array<boolean>(buckets).fill(false);
  const mark = (p: Point): void => {
    const d = dist(p, green.centre);
    if (d > radiusM || d < 1) return;
    covered[Math.floor(bearingOf(green.centre, p) / SECTOR_SAMPLE_DEG) % buckets] = true;
  };
  for (const lane of lanes) {
    for (let i = 0; i < lane.points.length; i++) {
      mark(lane.points[i]);
      if (i === 0) continue;
      const a = lane.points[i - 1];
      const b = lane.points[i];
      const steps = Math.max(1, Math.ceil(dist(a, b) / 4));
      for (let k = 1; k < steps; k++) {
        mark(new Point(a.x + ((b.x - a.x) * k) / steps, a.y + ((b.y - a.y) * k) / steps));
      }
    }
  }
  return covered;
}

/** The widest run of uncovered buckets, as {bisectorDeg, widthDeg}. */
function widestGap(covered: boolean[]): { bisectorDeg: number; widthDeg: number } {
  const n = covered.length;
  if (covered.every((c) => !c)) return { bisectorDeg: 0, widthDeg: 360 };
  let best = { start: 0, len: 0 };
  let i = 0;
  // Walk twice round so a run spanning bearing 0 is measured whole.
  while (i < n * 2) {
    if (covered[i % n]) { i += 1; continue; }
    const start = i;
    let len = 0;
    while (len < n && !covered[(start + len) % n]) len += 1;
    if (len > best.len) best = { start: start % n, len };
    i = start + len;
  }
  return {
    bisectorDeg: ((best.start + best.len / 2) * SECTOR_SAMPLE_DEG) % 360,
    widthDeg: best.len * SECTOR_SAMPLE_DEG,
  };
}

/**
 * Gate 6.5: the emptiest point in the disc, and the lane nearest it.
 *
 * Scanned on a fixed VOID_SCAN_STEP_M grid so the result cannot depend on
 * iteration order, and ordered by distance descending with x then y
 * breaking ties -- two voids of equal size must always be filled in the
 * same order for the same seed.
 */
function widestVoid(
  lanes: Lane[], green: Green, satRadiusM: number,
): { point: Point; junction: Point; parent: Lane; distance: number } | null {
  let best: { point: Point; junction: Point; parent: Lane; distance: number } | null = null;
  for (let x = -satRadiusM; x <= satRadiusM; x += VOID_SCAN_STEP_M) {
    for (let y = -satRadiusM; y <= satRadiusM; y += VOID_SCAN_STEP_M) {
      const p = new Point(green.centre.x + x, green.centre.y + y);
      if (dist(p, green.centre) > satRadiusM) continue;
      let nearest: { point: Point; parent: Lane; distance: number } | null = null;
      for (const lane of lanes) {
        for (let i = 1; i < lane.points.length; i++) {
          const q = closestPointOnSegment(p, lane.points[i - 1], lane.points[i]);
          const d = dist(p, q);
          if (!nearest || d < nearest.distance) nearest = { point: q, parent: lane, distance: d };
        }
      }
      if (!nearest) continue;
      const better = !best || nearest.distance > best.distance
        || (nearest.distance === best.distance
          && (p.x < best.point.x || (p.x === best.point.x && p.y < best.point.y)));
      if (better) {
        best = {
          point: p, junction: nearest.point, parent: nearest.parent, distance: nearest.distance,
        };
      }
    }
  }
  return best;
}

/**
 * Gate 6.5: seed a lane INTO the emptiest place in the disc.
 *
 * This is the plane-spacing rule the spider needed. Everything before it
 * measures the network against ITSELF -- slots per metre of lane, coverage
 * per bearing -- and a radial tree satisfies all of those while leaving
 * widening wedges of untouched ground between its tendrils. This measures
 * the GROUND instead: if any point of the disc is further than
 * VOID_SPACING_M from a lane, that ground cannot be reached by lots from
 * either side, so a lane goes there.
 *
 * The junction is the nearest point on the nearest lane, WHEREVER that
 * falls. Branch slots exist at BRANCH_SPACING_M pitch for texture -- to
 * keep junctions evenly spaced along a street -- and that is a rule about
 * how a street reads, not a constraint on where a road may physically
 * meet another. The void rule supersedes it: a junction may form anywhere.
 *
 * Returns true if it seeded a lane. Called before any ring widening, after
 * slots, extensions and sector coverage are exhausted.
 */
function seedVoidLane(
  out: Lane[], green: Green, meanFrontageM: number, satRadiusM: number, rng: SeededRandom,
): boolean {
  const void_ = widestVoid(out, green, satRadiusM);
  if (!void_ || void_.distance <= VOID_SPACING_M) return false;

  const bearing = Math.round(bearingOf(void_.junction, void_.point)) % 360;
  // Long enough to run THROUGH the void rather than stop at its near edge,
  // then the ordinary clamp.
  const nominal = Math.min(
    BRANCH_MAX_M,
    Math.max(BRANCH_MIN_M, void_.distance + branchLengthM(meanFrontageM) / 2),
  );

  const atFraction = (() => {
    const acc = arcLengths(void_.parent.points);
    const total = acc[acc.length - 1];
    if (!(total > 0)) return 0.5;
    let travelled = 0;
    for (let i = 1; i < void_.parent.points.length; i++) {
      const a = void_.parent.points[i - 1];
      const b = void_.parent.points[i];
      const q = closestPointOnSegment(void_.junction, a, b);
      if (dist(void_.junction, q) < 1e-6) { travelled = acc[i - 1] + dist(a, q); break; }
    }
    return Math.min(0.99, Math.max(0.01, travelled / total));
  })();

  let id: string | null = null;
  const pct0 = Math.max(1, Math.min(99, Math.round(atFraction * 100)));
  for (let step = 0; step < 99; step++) {
    const pct = 1 + ((pct0 - 1 + step) % 99);
    const candidate = branchLaneId(void_.parent.id, pct / 100);
    if (!out.some((l) => l.id === candidate)) { id = candidate; break; }
  }
  if (!id) return false;

  let cls = inventedChildClass(void_.parent.type);
  let points = runLine(void_.junction, bearing, nominal, rng);
  const snap = loopSnap(out, points[points.length - 1], new Set([void_.parent.id]));
  if (snap) points = [...points, snap];
  const assembled = points.length;
  points = truncateAtFirstCrossing(points, out, green, void_.parent.id);
  if (snap || points.length < assembled) cls = stepDown(cls, 'footpath');
  if (points.length < 2 || polylineLength(points) < BRANCH_MIN_M) return false;
  if (crossesParentTwice(points, void_.parent)) return false;

  out.push({
    id, type: cls, points, widthM: laneWidth(cls), parentId: void_.parent.id,
  });
  return true;
}

/**
 * Gate 6.4: fill the biggest hole in the ring's angular coverage.
 *
 * Growth is otherwise sector-blind -- branch slots exist only ON lanes, so
 * a sector no lane ever entered offers nothing to do and the ring reports
 * itself full while empty. This is what the owner saw as a laneless western
 * half. Called before any ring widening; returns true if it seeded a lane.
 *
 * The seed starts at the GREEN's ring, because an uncovered sector by
 * definition has no lane anywhere along that bearing -- including next to
 * the green -- so the green's edge is both the nearest available start and
 * the one that fills the sector from the centre outward.
 *
 * Deliberately NOT subject to `greenArmCap`: that cap governs how the
 * green's own ring LOOKS, and a village with an empty quadrant needs a lane
 * there whatever the green already carries. See the note at GREEN_ARM_MAX.
 */
function seedCoverageLane(
  out: Lane[], green: Green, meanFrontageM: number, satRadiusM: number, rng: SeededRandom,
): boolean {
  const gap = widestGap(angularCoverage(out, green, satRadiusM));
  if (gap.widthDeg <= SECTOR_COVERAGE_DEG) return false;

  const reach = Math.max(0, satRadiusM - greenDrawnRadius(green));
  if (reach < BRANCH_MIN_M) return false;
  const nominal = Math.min(reach, branchLengthM(meanFrontageM) * INVENTED_ARM_LENGTH_FACTOR);

  // Probe outward from the bisector so a taken id or a blocked bearing does
  // not abandon the whole sector.
  for (const offset of [0, 6, -6, 12, -12, 18, -18]) {
    const bearing = Math.round(gap.bisectorDeg + offset + 360) % 360;
    const id = inventedLaneId(bearing);
    if (out.some((l) => l.id === id || l.id === armLaneId(bearing))) continue;
    const dir = bearingVector(bearing);
    const start = new Point(
      green.centre.x + dir.x * (green.diameter / 2) * GREEN_UNDERLAP_RATIO,
      green.centre.y + dir.y * (green.diameter / 2) * GREEN_UNDERLAP_RATIO,
    );
    const points = truncateAtFirstCrossing(runLine(start, bearing, nominal, rng), out, green);
    if (points.length < 2 || polylineLength(points) < BRANCH_MIN_M) continue;
    out.push({
      id, type: 'local', points, widthM: laneWidth('local'),
    });
    return true;
  }
  return false;
}

/**
 * Grow the village's own streets until the disc of radius `targetRadiusM`
 * is SATURATED, and no further.
 *
 * Growth is cluster-first (2026-08-21 gate rework): a handful of streets at
 * the green, then short branches attaching near the centre, branching
 * again, occasionally looping — never the radial spoke fan the first gate
 * rejected. `meanFrontageM` sizes each branch to the lots it must host.
 *
 * Gate 6.6 changed only WHERE IT STOPS. It used to run until a frontage
 * budget was met, with the disc widening by a growth factor whenever the
 * budget was still owed — a loop that fed back on itself and over-tiled the
 * ground (see DISC_MARGIN). The disc is now handed in, sized in closed form
 * from the census by `discRadiusFor`, and this function's only job is to
 * fill it: rings widen by SATURATION_RING_STEP_M up to the target and stop
 * there. The caller widens the target if the census still comes up short.
 */
export function saturateDisc(
  lanes: Lane[], green: Green, meanFrontageM: number,
  targetRadiusM: number, rng: SeededRandom,
): { lanes: Lane[]; radiusM: number } {
  const out = [...lanes];
  let guard = 0;
  // Gate 6.2 CONCENTRIC SATURATION. The ring being filled starts just
  // outside the green and only ever widens when nothing can be done inside
  // it. This is the whole fix for "houses closer together but along LONG
  // streets that leave 90% of the available land empty": the mesh changed
  // local texture, but growth could still escape outward, because a long
  // arm or extension supplied frontage cheaply far from the green.
  let satRadiusM = Math.min(
    targetRadiusM, greenDrawnRadius(green) + SATURATION_RING_START_M,
  );
  // Gate 6.6: the disc's LANE BUDGET, from the same closed form as its
  // radius -- the length of road that tiles this much ground at
  // VOID_SPACING_M, which is the density the census was sized against.
  // Without it, growth keeps meshing a disc it has already filled: branch
  // slots exist every BRANCH_SPACING_M along every lane, so junctions
  // multiply, and a junction sterilises frontage on BOTH lanes (the claims
  // round it collide and §5.4 resolution drops them). Measured at gate 6.5,
  // that is where two thirds of every village's cut frontage went.
  const budgetM = laneBudgetFor(targetRadiusM);
  while (guard < MAX_INVENTED_LANES && laneLengthWithin(out, green, targetRadiusM) < budgetM) {
    guard++;
    // Gate 6.7: coverage comes FIRST, not last. Gate 6.4 added this check
    // as a last resort before widening, which was enough while every street
    // was a 24 m stub and the budget bought dozens of them. Streets that run
    // to the ring's edge spend the same budget on far fewer lanes, so the
    // budget can now run out while a whole sector is still empty -- measured
    // as a 66 deg laneless sector at pop 300, over the 60 deg bar. Coverage
    // is a hard constraint on the shape; meshing an already-covered ring is
    // discretionary, so the constraint goes first.
    if (seedCoverageLane(out, green, meanFrontageM, satRadiusM, rng)) continue;
    if (growOne(out, green, meanFrontageM, targetRadiusM, rng, satRadiusM)) continue;
    // Gate 6.5: and even with every bearing covered, a RADIAL tree leaves
    // widening wedges of untouched ground between its tendrils -- the
    // spider. Measure the GROUND, not the network: if anywhere in the disc
    // is further than VOID_SPACING_M from a lane, put a lane there.
    if (seedVoidLane(out, green, meanFrontageM, satRadiusM, rng)) continue;
    // This ring is genuinely full. Widen it -- or, at the target, stop:
    // the disc is saturated and growing past it is exactly the over-tiling
    // gate 6.6 removed.
    if (satRadiusM >= targetRadiusM) break;
    satRadiusM = Math.min(targetRadiusM, satRadiusM + SATURATION_RING_STEP_M);
  }
  // The radius actually saturated is returned: the lot cutter must use the
  // same disc, or it cuts plots along stretches growth never reached (and
  // the far reaches of an FMG arm sprout houses while the interior is still
  // empty).
  return { lanes: out, radiusM: satRadiusM };
}
