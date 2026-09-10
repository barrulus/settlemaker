import { validWaterRoute } from './water-routing.js';
import { usefulShortcut } from './network.js';
import { forwardJoin, smoothLane } from './curves.js';
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
  GREEN_UNDERLAP_RATIO, RIB_COUNT_MAX, RIB_COUNT_MIN, RIB_SPACING_M, SLOT_PITCH_MIN_M,
  INVENTED_ARM_LENGTH_FACTOR, JUNCTION_CLEAR_M, LANE_MIN_SPACING_M, LANE_SAMPLE_STEP_M,
  ARM_LOT_RADIUS_SHARE, CONNECT_MAX_M, CONNECT_MIN_M, HAMLET_RIBBON_POP, LANE_CURVE_MAX_M,
  LOOP_SNAP_M, MAX_INVENTED_LANES, MIN_ARM_SEPARATION_DEG, SATURATION_RING_START_M,
  SATURATION_RING_STEP_M, SECTOR_SAMPLE_DEG,
  VOID_SCAN_STEP_M, VOID_SPACING_M, LANE_SEATING_YIELD, LANE_TILE_SPACING_M,
  ARC_MAX_SWEEP_DEG, ARC_NEIGHBOURHOOD_M, ARC_RADIAL_TOL_DEG, LANE_PARALLEL_TOL_DEG,
  PROFILE_SHAPE_MAX,
} from '../constants.js';
import { type RadiusProfile } from './profile.js';
import { isTrunk } from './trunks.js';
import {
  armLaneId, branchLaneId, inventedLaneId, isApron,
  type Building, type Green, type Lane, type Lot,
} from '../types.js';

// geometry.ts owns polylineLength; re-exported here since Task 8's tests
// import it from this module alongside the frontage helpers that use it.
export { polylineLength };

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
function streetRunM(
  from: Point, bearingDeg: number, green: Green, profile: RadiusProfile,
  ringRadiusM: number,
): number {
  // GATE 8: the ring is a BODY of the profile's shape, not a circle, so the
  // closed-form ray/circle intersection this used is gone: the boundary is
  // marched for instead. The march is deterministic (fixed step, fixed
  // cap) and costs a handful of table lookups.
  const dir = bearingVector(bearingDeg);
  let reach = 0;
  for (let d = 0; d <= BRANCH_MAX_M; d += LANE_SAMPLE_STEP_M) {
    const p = new Point(from.x + dir.x * d, from.y + dir.y * d);
    if (!insideRing(green, profile, ringRadiusM, p)) break;
    reach = d;
  }
  return Math.min(BRANCH_MAX_M, Math.max(BRANCH_MIN_M, reach));
}

/**
 * GATE 8: is `p` inside the ring of nominal radius `nominalRadiusM`? The
 * ring follows the profile — `nominalRadiusM` is its AREA-EQUIVALENT
 * radius, and its actual radius at any bearing is the profile's shape
 * there. Every "inside the disc / inside the ring" test in this file goes
 * through here; there is no circle left in growth.
 */
function insideRing(
  green: Green, profile: RadiusProfile, nominalRadiusM: number, p: Point,
): boolean {
  const d = dist(p, green.centre);
  if (d < 1e-9) return true;
  return d <= profile.ringAt(nominalRadiusM, bearingOf(green.centre, p));
}

// Trunks task 5: `buildArms`, `mergeIncomingRoutes`, `MergedRoute` and
// `ArmEmission` are retired -- the pipeline now seeds growth with
// `synthesizeTrunks`'s output (`skeleton/trunks.ts`, spec 2026-08-25 §5).
// That module owns the entire boundary-to-junction pipeline `buildArms`
// used to (contract-circle entries, near-duplicate handling -- now a
// deliberate NON-merge at the boundary, spec 5.1 -- staggered merges deeper
// in, and the convergence-pattern palette), so there is no direct
// replacement function here: `village-model.ts` calls `synthesizeTrunks`
// itself. `armLaneId` (`types.ts`) and the `arm-` id space survive only as
// a still-tested, otherwise-unused naming utility (see `ids.test.ts`);
// nothing in this file emits an `arm-` id any more.

/**
 * Trunks task 5 audit finding: every OTHER lane in this engine (an
 * invented radial, a branch, or -- before this task -- an FMG arm) is
 * built outward from the green, so its `points[0]` IS its nearest point to
 * the green by construction. A trunk lane is not guaranteed that:
 * `synthesizeTrunks` (spec 5.2) is inner-first for a plain root (so
 * `points[0]` is still the green-nearest sample there), but a captured/
 * merged trunk's remaining polyline starts at its merge JUNCTION --
 * mid-network, not the green -- and a loop segment or a main-street spine
 * can have NEITHER end anywhere near the green at all. Scanning the whole
 * polyline for its nearest sample is the only assumption-free way to ask
 * "where does this lane meet the green, if it does at all", and it costs
 * nothing extra for the ordinary case (`points[0]` still wins the scan).
 */
function nearestToGreen(green: Green, lane: Lane): Point {
  let best = lane.points[0];
  let bestD = dist(best, green.centre);
  for (const p of lane.points) {
    const d = dist(p, green.centre);
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}

/**
 * How far a lane's green-nearest sample (see `nearestToGreen`) may sit
 * from the green's own drawn rim and still count as reaching it, as a
 * multiple of `greenDrawnRadius`. Generous rather than tight: a genuinely
 * green-attached lane (an invented rib, or a trunk root/y-tree landing)
 * starts well UNDER the rim, at `GREEN_UNDERLAP_RATIO` of the nominal
 * radius -- comfortably inside 1x `greenDrawnRadius` already -- while
 * anything that is NOT green-attached (a loop segment at the built edge, a
 * captured trunk's mid-network merge point) sits many multiples of the
 * green's own size further out. The exact factor is not gate-tuned; it
 * only has to separate those two regimes, which it does by a wide margin
 * on every scale this engine builds.
 */
const GREEN_ATTACH_SLACK_FACTOR = 1.5;

/** Which way a lane leaves the green — geometry.ts owns the trigonometry.
 * Bearing is taken at the lane's green-NEAREST sample, not blindly
 * `points[0]` -- see `nearestToGreen`. */
function laneBearing(green: Green, lane: Lane): number {
  return bearingOf(green.centre, nearestToGreen(green, lane));
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

/**
 * Lanes attached to the green: trunk roots/landings plus the village's own
 * first-ring streets. `parentId === undefined` alone used to be sufficient
 * -- every un-parented lane (an FMG arm, or a green-seeded invented rib)
 * genuinely started at the green. Trunks task 5 breaks that: a captured/
 * merged trunk, a loop segment or a y-tree connector can also come out of
 * `synthesizeTrunks` without a `parentId`, even though its polyline may
 * never come near the green at all (see `nearestToGreen`'s comment). Being
 * un-parented is still NECESSARY -- a branch off any lane never counts,
 * wherever its parent attaches -- it is just no longer sufficient on its
 * own, so it is joined by an actual distance check against the green.
 */
function isGreenAttached(green: Green, lane: Lane): boolean {
  if (lane.parentId !== undefined) return false;
  return dist(nearestToGreen(green, lane), green.centre)
    <= greenDrawnRadius(green) * GREEN_ATTACH_SLACK_FACTOR;
}

/**
 * GATE 6.11: HOW MANY RIBS A DISC WANTS — one number, used by both rules
 * that were quietly deciding it.
 *
 * The rib count used to be settled twice and never on purpose. `greenArmCap`
 * derived it from the GREEN's own circumference (one per 30 m, capped at 4),
 * which is a fact about the turf and says nothing about the village; and the
 * coverage rule derived it from a flat 50 deg threshold, which forces about
 * eight radials whatever the disc's size. Eight is right for a pop-900 disc
 * and absurd for a pop-300 one: measured at gate 6.10, eight ribs converging
 * inside a 51 m disc spend the whole capped lane budget, leave wedges too
 * narrow for an arc to cross with lots on both sides, and add sixteen
 * junction mouths — which is the whole of that gate's converging-claim
 * regression.
 *
 * So: one rib per RIB_SPACING_M of circumference AT MID-RADIUS, the radius
 * where ribs sit as far apart as they will average, clamped to
 * [RIB_COUNT_MIN, RIB_COUNT_MAX]. A 51 m disc asks for three, an 87 m disc
 * for five.
 *
 * A crossroads green whose FMG routes alone exceed the count keeps them all
 * (FMG arms always join); the count only limits what the village may ADD.
 */
export function ribCountFor(radiusM: number): number {
  const midCircumference = Math.PI * Math.max(0, radiusM);
  return Math.min(RIB_COUNT_MAX,
    Math.max(RIB_COUNT_MIN, Math.round(midCircumference / RIB_SPACING_M)));
}

/**
 * GATE 6.11: the coverage threshold, derived from the same count. A disc
 * that wants three ribs is covered when no sector wider than 120 deg is
 * empty — and it will not stay that way, because an ARC sweeping across a
 * sector serves it too (see `angularCoverage`), so the fabric ends up with
 * a few ribs and a ring rather than eight ribs and nothing.
 */
export function coverageThresholdDeg(radiusM: number): number {
  return 360 / ribCountFor(radiusM);
}

/**
 * GATE 6.11: the branch-slot pitch, likewise scaled to the disc.
 *
 * A flat BRANCH_SPACING_M (24 m) gives a pop-300 rib — which runs from the
 * green's rim at ~8 m out to ~51 m — EXACTLY ONE usable slot ring, at r=28,
 * and every arc such a village could ever offer had to start there, packed
 * between converging ribs. Gate 6.10's concern 3. A rib now always offers at
 * least three slots along its reach, so a small disc gets two or more slot
 * rings; BRANCH_SPACING_M survives as the MAXIMUM, which is what it has
 * always really been (the pitch a big village settles at).
 */
function slotPitchFor(green: Green, radiusM: number): number {
  const reach = Math.max(0, radiusM - greenDrawnRadius(green));
  return Math.min(BRANCH_SPACING_M, Math.max(SLOT_PITCH_MIN_M, reach / 3));
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
  // Trunks task 5 audit: this is a ROUTE-CLASS check (royal/main/market/
  // town, i.e. an inter-settlement class per the owner's ruling above) --
  // unrelated to, and named before, `skeleton/trunks.ts`'s `isTrunk(laneId)`
  // lane-ID predicate this file now also imports. `isTrunkClass` so the two
  // never read as the same test: a `local` branch grown off a `trunk-*`
  // lane is trunk-CLASS false but lane-ID `isTrunk` false too (it has a
  // `/b` suffix), while a captured `trunk-footpath-...` sub-trunk is
  // lane-ID `isTrunk` true but trunk-CLASS false (footpath outranks town).
  const isTrunkClass = classRank(lane.type) <= classRank('town');
  return isTrunkClass ? saturatedRadiusM * ARM_LOT_RADIUS_SHARE : saturatedRadiusM;
}

/**
 * GATE 8: the same rule, read off the BODY rather than a circle. The reach
 * is a function of the point being judged, because the saturated fabric
 * reaches further along the village's long axis than across it -- and a
 * trunk cap measured against a mean radius would cut the ribbon short on
 * one side and let it run on the other.
 */
export function lotReachAt(
  lane: Lane, green: Green, profile: RadiusProfile, population: number,
): (p: Point) => number {
  return (p: Point) => lotReachFor(
    lane, profile.at(bearingOf(green.centre, p)), population,
  );
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
  return Math.sqrt((laneLengthNeededM(dwellings, meanLotFrontageM)
    * LANE_TILE_SPACING_M) / Math.PI) * DISC_MARGIN;
}

/**
 * GATE 6.10: how much LANE a census needs, yield included.
 *
 * `dwellings x frontage / 2` is the frontage the houses stand on. It is not
 * the road that has to be laid to supply it, because only
 * LANE_SEATING_YIELD of what a village cuts is ever seated -- see that
 * constant. Gate 6.9's budget omitted the term, bought half the road, and
 * the escalation ladder made up the difference by widening the disc.
 */
export function laneLengthNeededM(dwellings: number, meanLotFrontageM: number): number {
  return (Math.max(1, dwellings) * meanLotFrontageM) / (2 * LANE_SEATING_YIELD);
}

/**
 * The same closed form read the other way: how much lane tiles a disc of
 * `radiusM` at VOID_SPACING_M. Growth spends against this, so widening the
 * disc buys more road at ONE density instead of meshing the same ground
 * ever finer. Inverse of `discRadiusFor` by construction.
 */
export function laneBudgetFor(radiusM: number): number {
  return (Math.PI * radiusM * radiusM) / (LANE_TILE_SPACING_M * DISC_MARGIN * DISC_MARGIN);
}

// Trunks task 5: `isFmgArm` (the `arm-`-prefix, no-`/b` test that used to
// live here and be imported into `relax.ts`) is retired. Its two call
// sites -- the invented-lane growth budget below, and `relax.ts`'s
// `trimTails` exemption -- now both import `isTrunk` from
// `skeleton/trunks.ts` directly (spec 2026-08-25 §5.1: `trunk-` prefix, no
// `/b` branch suffix), so there is still exactly one definition, just owned
// by the module that also builds the ids it recognises.

/** Lane length inside the profile BODY, segment by segment (gate 8: the
 * budget is spent on ground inside the village, and the village is not a
 * circle). */
function laneLengthWithin(lanes: Lane[], green: Green, profile: RadiusProfile): number {
  let total = 0;
  for (const lane of lanes) {
    for (let i = 1; i < lane.points.length; i++) {
      const a = lane.points[i - 1];
      const b = lane.points[i];
      const inA = insideRing(green, profile, profile.radiusM, a);
      const inB = insideRing(green, profile, profile.radiusM, b);
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
 * `slotPitchFor` metres along it, and the nearest-the-green free slot is
 * taken first. This is the heart of the cluster rework: the old rule branched
 * once, far out, off the longest lane, and produced a starburst; slots
 * make branches branch again, near the centre, until the wedges fill.
 * A slot is occupied if any existing lane already starts nearby.
 */
function branchSlots(
  out: Lane[], green: Green, profile: RadiusProfile, pitch: number,
): BranchSlot[] {
  const slots: BranchSlot[] = [];
  for (const parent of out) {
    const acc = arcLengths(parent.points);
    const total = acc[acc.length - 1];
    if (total < pitch * 1.25) continue;
    // Gate 6.2: one pitch everywhere -- the whole fabric is mesh now.
    // Gate 6.11: and that one pitch is scaled to the disc, not fixed.
    let s = pitch;
    while (s <= total - pitch * 0.5) {
      const { p, dirDeg } = sampleAt(parent.points, acc, s);
      const distToGreen = dist(p, green.centre);
      // Gate 3: "sprawl should be clustered around the green" — a slot
      // outside the growth BODY never spawns a branch, so a long FMG
      // road cannot sprout satellite webs half a map away. (Gate 8: the
      // body, not a circle -- a slot on the village's short side is
      // outside at a distance a slot on its long side is still inside at.)
      if (distToGreen <= profile.at(bearingOf(green.centre, p))
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
  out: Lane[], end: Point, excludeIds: Set<string>, radiusM: number = LOOP_SNAP_M, previous?: Point,
): Point | null {
  let best: Point | null = null;
  let bestD = radiusM;
  for (const lane of out) {
    if (excludeIds.has(lane.id)) continue;
    for (let i = 1; i < lane.points.length; i++) {
      const q = closestPointOnSegment(end, lane.points[i - 1], lane.points[i]);
      const d = dist(end, q);
      if (d < bestD && (!previous || forwardJoin(previous, end, q))) { bestD = d; best = q; }
    }
  }
  return best;
}

/**
 * The lane list a crossing check is run against: everything growth has laid
 * so far, plus the CROSSING-ONLY OBSTACLES the caller handed in.
 *
 * Owner ruling 2026-09-07, correcting the earlier one that took aprons out
 * of growth wholesale: those were two questions collapsed into one. An
 * apron must not make a sector look covered, buy frontage, open a branch
 * slot or spend the budget -- growth still cannot see it for any of that --
 * but a lane growth is about to lay must not be allowed to CROSS one. The
 * guard for that was `trunks-structural.test.ts` (c), and it fired: a
 * growth branch crossed a coast apron with no junction on the coastal
 * fixture at pop 40 (the coast bend runs a road laterally past the fabric,
 * where a radial apron never went).
 *
 * So the obstacles reach `truncateAtFirstCrossing` and `extendOne`'s
 * crossing probe, and nothing else. `out` itself is never widened, so no
 * budget, coverage, void, branch-slot, loop-snap or earns-its-space
 * decision can see them -- verified by running the whole dry panel with
 * this function forced to ignore its obstacles: byte-identical, so the
 * plumbing itself decides nothing.
 *
 * It does NOT leave landlocked villages untouched, and the expectation
 * that it would was wrong: growth reaches PAST the contract circle at pop
 * 40 (the block chase escalates the disc; `apron.ts` records the same
 * finding as "at pop 40 arms ran past the fabric"), so a radial apron is
 * in growth's way there too. Measured over 60 dry villages -- 3-route and
 * 4-route fixtures, pops 40..1000, 5 seeds -- growth crossed a radial
 * apron twice, both at pop 40, and both are gone. Four of those villages
 * change as a result, all pop 40.
 */
function withObstacles(out: Lane[], obstacles: Lane[]): Lane[] {
  return obstacles.length > 0 ? [...out, ...obstacles] : out;
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
  //    (that is the junction the branch exists to make).
  //
  // GATE 6.11 REMOVED THE SECOND EXEMPTION. It forgave any crossing within
  // `green.diameter / 2` of the centre, on the grounds that the radials all
  // share the painted-over ground there and no crossing is visible. Two
  // things were wrong with it. The turf is DRAWN at GREEN_JOIN_RATIO of the
  // nominal radius, so the exemption reached past the paint; and once arcs
  // and rungs exist, lanes that are not radials pass through that annulus --
  // measured, two visible crossings at pop 600 seed 2, at r = 11.5 and 12.9
  // against a painted radius of 10.7. The radials do not need the exemption
  // anyway: they leave the centre at different bearings and diverge.
  const start = points[0];
  for (let i = 1; i < points.length; i++) {
    let best: { q: Point; t: number; } | null = null;
    for (const lane of out) {
      for (let j = 1; j < lane.points.length; j++) {
        const q = segmentIntersection(points[i - 1], points[i], lane.points[j - 1], lane.points[j]);
        if (!q) continue;
        if (lane.id === parentId && dist(start, q) <= JUNCTION_CLEAR_M) continue;
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
/** Do these two polylines properly cross anywhere? Endpoint touches are
 * junctions and `segmentIntersection` already excludes them. */
function crossesLanePoints(a: Point[], b: Point[]): boolean {
  for (let i = 1; i < a.length; i++) {
    for (let j = 1; j < b.length; j++) {
      if (segmentIntersection(a[i - 1], a[i], b[j - 1], b[j])) return true;
    }
  }
  return false;
}

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
/**
 * How far apart two UNDIRECTED headings are, in [0, 90]. A road has no
 * forward and back: two lanes at 10 deg and 190 deg run alongside each
 * other, and every angle comparison in this file that is about ALIGNMENT
 * rather than direction of travel folds through here.
 */
function foldedGap(a: number, b: number): number {
  const g = angularGap(a, b);
  return Math.min(g, 180 - g);
}

/**
 * GATE 6.10: only lanes running ALONGSIDE the candidate count against it
 * -- see LANE_PARALLEL_TOL_DEG. The clearance this guards is a LOT-STRIP
 * clearance: two lanes closer than the spacing and pointing the same way
 * have facing rows that fight, and one of every pair dies in §5.4
 * resolution. Two lanes that MEET at an angle share no strip except at the
 * mouth. Measuring against every lane regardless of heading made the rule
 * forbid, by construction, every street whose whole purpose is to tie two
 * others together -- arcs, cross-links, block ends.
 *
 * GATE 6.11 tried and REJECTED a polar version of this floor -- ribs spaced
 * at RIB_SPACING_M, rings at LANE_MIN_SPACING_M, blended by how
 * circumferentially the candidate runs. It works, in the sense that it does
 * what it says: measured, it took the converging-claim death share from
 * 39-46% to 29-33%, because a rib is a strip neighbour not of the rib beside
 * it but of the ring it CROSSES, and what it costs that ring is a junction
 * mouth. It also thinned the fabric to 11-21 lanes, took land use to 58-69%,
 * turned pop 900 into concentric onion rings with grass bands between them,
 * and lost half the enclosed blocks. The exchange rate between claim deaths
 * and filled ground is roughly constant across every configuration measured
 * this gate, and the owner judges the filled ground. The experiment is
 * preserved on branch `gate-6.11-wip` rather than described.
 *
 * `spacingScale` is the half of that work which SHIPPED: growth relaxes this
 * floor as a ladder rung before the disc is allowed to widen, so a village
 * that cannot house its census meshes tighter rather than spreading thinner.
 */
function earnsItsSpace(
  points: Point[], out: Lane[], spacingScale: number,
  parentId?: string, alongsideOnly = false,
): boolean {
  const others = out.filter((l) => l.id !== parentId);
  if (others.length === 0) return true;
  const acc = arcLengths(points);
  const total = acc[acc.length - 1];
  const gaps: number[] = [];
  for (let s = 0; s <= total; s += LANE_SAMPLE_STEP_M) {
    const { p, dirDeg } = sampleAt(points, acc, s);
    let nearest = Infinity;
    for (const lane of others) {
      for (let i = 1; i < lane.points.length; i++) {
        if (alongsideOnly && foldedGap(dirDeg, bearingOf(lane.points[i - 1], lane.points[i]))
          > LANE_PARALLEL_TOL_DEG) continue;
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
  // stretch dies in resolution. The floor is taken at the median too, so a
  // lane that is a rib for half its length is judged as one.
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)] >= LANE_MIN_SPACING_M * spacingScale;
}

/**
 * Lengthen the shortest extendable street whose length is still under
 * `maxLengthM`, from its end along its end direction. Trunk lanes are
 * never extended — they already run to the contract circle (`drawTrunkPath`,
 * spec 5.1) or to whatever junction/loop/spine point pattern-application
 * landed them on (spec 5.2); either way, growth does not own their far end.
 * Shortest-first keeps the cluster balanced instead of streaming out one
 * long tentacle.
 */
function extendOne(
  out: Lane[], green: Green, meanFrontageM: number, profile: RadiusProfile,
  rng: SeededRandom, maxLengthM: number, satRadiusM: number,
  obstacles: Lane[] = [],
): boolean {
  const blockers = withObstacles(out, obstacles);
  const extendable = out
    .filter((l) => !isTrunk(l.id) && l.points.length >= 2
      && polylineLength(l.points) < maxLengthM
      // Gate 3: extension is confined to the cluster — a street whose end
      // has left the growth circle stops growing outward.
      && insideRing(green, profile, profile.radiusM, l.points[l.points.length - 1])
      // Gate 6.2 CONCENTRIC SATURATION: and to the ring currently being
      // filled. An extension's ANCHOR is the end it grows from, so a street
      // already reaching past the saturation radius is not the place to add
      // more length -- the interior has first call on every metre.
      && insideRing(green, profile, satRadiusM, l.points[l.points.length - 1])
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
        streetRunM(lane.points[n - 1], endDir, green, profile, satRadiusM), rng),
      blockers.filter((l) => l.id !== lane.id), green);
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
    const crosses = blockers.some((other) => {
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
  out: Lane[], green: Green, meanFrontageM: number, profile: RadiusProfile,
  rng: SeededRandom, satRadiusM: number, spacingScale: number,
  obstacles: Lane[] = [],
): boolean {
  const blockers = withObstacles(out, obstacles);
  // 1. The green may still host a street of its own: an invented rib, up
  //    to the DISC-derived rib count (gate 6.11 -- see `ribCountFor`; it
  //    used to come off the green's own circumference, which says nothing
  //    about the village the rib has to serve), at a bearing clear of every
  //    existing green-attached lane. Class is `local` — wagons reach the
  //    green — and it is street-length, not a road to the horizon.
  // The count governs what the village ADDS: only invented radials (their
  // ids live in the `lane-` space, R10) count against it. Gate 4: counting
  // FMG's own arms let two incoming routes eat a cap of 3, leaving a
  // pop-900 green a single radial and a dead quadrant.
  if (out.filter((l) => isGreenAttached(green, l) && l.id.startsWith('lane-')).length
    < ribCountFor(profile.radiusM)) {
    // Task 4b (F15). `taken` is the bearing-collision list the
    // MIN_ARM_SEPARATION_DEG check below tests a candidate rib against, and
    // it must contain every road already occupying a bearing -- which is
    // every UN-PARENTED lane, exactly as it was before Task 5 narrowed
    // `isGreenAttached` with a distance test. Under the loop pattern no
    // trunk sits within that distance of the green, so `taken` came back
    // empty and the separation check had nothing to compare against: growth
    // seeded an invented rib at the very bearing a trunk already ran along.
    // The narrowed predicate still governs the rib COUNT above (that cap is
    // about the green's own ring), just not this.
    const taken = out.filter((l) => l.parentId === undefined).map((l) => laneBearing(green, l));
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
          streetRunM(start, candidate, green, profile, satRadiusM) * lengthJitter, rng),
        blockers, green);
      // Gate 6.6: a radial that never leaves its neighbours' ground only
      // splits the same frontage in two -- see `earnsItsSpace`.
      if (points.length < 2 || !earnsItsSpace(points, out, spacingScale)) continue;
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
  const slots = branchSlots(out, green, profile,
    slotPitchFor(green, profile.radiusM))
    .filter((sl) => insideRing(green, profile, satRadiusM, sl.anchor));

  /** Try each candidate slot in order; returns true once one takes. */
  const tryBranch = (candidates: BranchSlot[]): boolean => {
    for (const slot of candidates) {
      // GATE 6.10: where the fabric around this slot is a set of RIBS, the
      // street it wants is the one that ties them — an arc at this slot's
      // radius, sweeping to the neighbouring rib on each side. Tried first
      // because a radial-ish branch into a radial fabric is what built the
      // starfish; where the fabric is not radial `seedArcThrough` declines
      // and the ordinary branch below is unchanged.
      if (seedArcThrough(out, green, profile, slot.anchor, slot.parent, spacingScale,
        obstacles)) return true;
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
        slot.anchor, branchBearing,
        streetRunM(slot.anchor, branchBearing, green, profile, satRadiusM), rng,
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
      const snap = loopSnap(out, points[points.length - 1], new Set([slot.parent.id]), LOOP_SNAP_M, points[points.length - 2]);
      if (snap) points = [...points, snap];
      const assembled = points.length;
      points = truncateAtFirstCrossing(points, blockers, green, slot.parent.id);
      if (snap || points.length < assembled) {
        cls = stepDown(cls, 'footpath');
      }
      // Gate 5: a branch cut down to a stub is not a street. Truncation at a
      // crossing (or a loop snap that lands almost at once) can leave a few
      // metres of road going nowhere, which is exactly the litter the owner
      // saw. Reject it and try the next slot rather than keeping it.
      //
      // GATE 6.11 SPLITS THE FLOOR, and this is what turns concentric rings
      // into blocks. A stub is a road going NOWHERE; a short run that JOINS
      // two streets is the RUNG of a ladder, and once the fabric is rings
      // the rungs between them are exactly `VOID_SPACING_M`-ish long — some
      // 20 m, under BRANCH_MIN_M's 24. So no rung between two adjacent rings
      // could EVER be built, and pop 900 came out as an onion: five or six
      // concentric streets with grass bands between them and nothing tying
      // them. (Gate 6.8 found the same thing about block ends and the
      // finding was lost with that revert.) A run that ends ON another lane
      // is floored at CONNECT_MIN_M instead; one that ends in open ground
      // still has to be a street.
      const joinsAtBothEnds = snap !== null || points.length < assembled;
      const floorM = joinsAtBothEnds ? CONNECT_MIN_M : BRANCH_MIN_M;
      if (points.length < 2 || polylineLength(points) < floorM) continue;
      // GATE 6.11: a run that JOINS at both ends takes no mouth exemption.
      // `truncateAtFirstCrossing` forgives one crossing of the parent within
      // JUNCTION_CLEAR_M of the start -- that is the junction an ordinary
      // branch exists to make -- and `crossesParentTwice` then allows
      // exactly one. A rung is SHORT, so its whole length can sit inside
      // that tolerance and it crosses its parent for free: measured as one
      // crossing at pop 900 seed 1 the moment the rung floor let short runs
      // through. A rung meets its lanes at its ENDS, which
      // `segmentIntersection` excludes anyway, so for it a single
      // registered intersection with the parent is one too many. Same
      // reasoning, and the same rule, as gate 6.10 applied to the arc.
      if (joinsAtBothEnds
        ? crossesLanePoints(points, slot.parent.points)
        : crossesParentTwice(points, slot.parent)) continue;
      // Gate 6.6: and it must open ground the existing lanes cannot reach.
      // GATE 6.11: a run that JOINS at both ends is judged by the same
      // alongside-only rule an arc gets, and for the identical reason — a
      // rung between two rings is a block's side, not a competitor for
      // either ring's lot strip, and the direction-blind form of the rule
      // forbids it by construction. Without this the polar floor rejects
      // every rung and the fabric stays an onion however short a rung is
      // allowed to be.
      if (!earnsItsSpace(points, out, spacingScale, slot.parent.id,
        joinsAtBothEnds)) continue;
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
  if (extendOne(out, green, meanFrontageM, profile, rng,
    satRadiusM * 2, satRadiusM, obstacles)) {
    return true;
  }

  // 4. Last resort WITHIN THIS RING: every slot is taken and every street
  //    is at full length, so lengthen one past its nominal length anyway.
  //    Still ring-bounded -- when this also fails, the caller widens the
  //    ring, which is the only way growth ever moves outward.
  return extendOne(out, green, meanFrontageM, profile, rng, Infinity, satRadiusM, obstacles);
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
): Array<{ point: Point; distance: number; }> {
  const out: Array<{ point: Point; distance: number; }> = [];
  for (const lane of lanes) {
    if (excludeIds.has(lane.id)) continue;
    let best: { point: Point; distance: number; } | null = null;
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
  lanes: Lane[], green: Green, buildings: Building[] = [], lots?: Lot[], water: Point[][] = [],
): Lane[] {
  const out = [...lanes];
  const candidates = lanes
    .filter((l) => !isTrunk(l.id) && l.points.length >= 2)
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id));

  for (const lane of candidates) {
    if (endsOnAnotherLane(lane, out)) continue;
    const end = lane.points[lane.points.length - 1];
    for (const target of nearestOnOtherLanes(end, out, new Set([lane.id]))) {
      if (target.distance > CONNECT_MAX_M) break; // sorted: the rest are further
      if (target.distance < CONNECT_MIN_M) continue;

      const previous = lane.points[lane.points.length - 2];
      const continuing = forwardJoin(previous, end, target.point);
      // A separate footpath can leave a street at a T. It need not pretend
      // to continue the street's heading; reject only a backward hook.
      if (!continuing && angularGap(bearingOf(previous, end), bearingOf(end, target.point)) > 100) continue;
      const tangent = bearingVector(bearingOf(previous, end));
      const reach = Math.min(6, target.distance / 3);
      const guide = new Point(end.x + tangent.x * reach, end.y + tangent.y * reach);
      const points = continuing ? smoothLane([end, guide, target.point]) : [end, target.point];
      if (!points || !validWaterRoute(points, water)) continue;
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
      if (lots && !usefulShortcut(out, connector, green, buildings, lots)) continue;
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
function angularCoverage(
  lanes: Lane[], green: Green, profile: RadiusProfile, radiusM: number,
): boolean[] {
  const buckets = Math.round(360 / SECTOR_SAMPLE_DEG);
  const covered = new Array<boolean>(buckets).fill(false);
  const mark = (p: Point): void => {
    const d = dist(p, green.centre);
    // GATE 8: inside the BODY at this bearing, not inside a circle.
    if (d < 1 || d > profile.ringAt(radiusM, bearingOf(green.centre, p))) return;
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
function widestGap(covered: boolean[]): { bisectorDeg: number; widthDeg: number; } {
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
  lanes: Lane[], green: Green, profile: RadiusProfile, satRadiusM: number,
): { point: Point; junction: Point; parent: Lane; distance: number; } | null {
  let best: { point: Point; junction: Point; parent: Lane; distance: number; } | null = null;
  // GATE 8: the scan BOX is the profile's widest reach; the membership test
  // inside it is the profile itself, so the ground scanned is the body.
  const boxM = satRadiusM * PROFILE_SHAPE_MAX;
  for (let x = -boxM; x <= boxM; x += VOID_SCAN_STEP_M) {
    for (let y = -boxM; y <= boxM; y += VOID_SCAN_STEP_M) {
      const p = new Point(green.centre.x + x, green.centre.y + y);
      if (!insideRing(green, profile, satRadiusM, p)) continue;
      let nearest: { point: Point; parent: Lane; distance: number; } | null = null;
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

/** The nearest point on one lane to `p`, with that lane's LOCAL heading
 * there — enough to ask which way the fabric runs near a point. */
function nearestWithHeading(
  p: Point, lane: Lane,
): { point: Point; distance: number; dirDeg: number; } | null {
  let best: { point: Point; distance: number; dirDeg: number; } | null = null;
  for (let i = 1; i < lane.points.length; i++) {
    const q = closestPointOnSegment(p, lane.points[i - 1], lane.points[i]);
    const d = dist(p, q);
    if (!best || d < best.distance) {
      best = { point: q, distance: d, dirDeg: bearingOf(lane.points[i - 1], lane.points[i]) };
    }
  }
  return best;
}

/**
 * GATE 6.10: do the lanes near `p` run RADIALLY?
 *
 * A lane is radial where its local heading sits within ARC_RADIAL_TOL_DEG
 * of the bearing out of the green at that point. `p` is called radial when
 * at least two lanes lie within ARC_NEIGHBOURHOOD_M of it and at least half
 * of them are ribs — one rib is a street, two or more with nothing crossing
 * them is a starfish, and that is the shape an arc exists to break.
 *
 * Fewer than two neighbours means there is nothing to tie together, so the
 * ordinary radial-ish primitives keep the ground.
 */
function locallyRadial(lanes: Lane[], p: Point, green: Green): boolean {
  let radial = 0;
  let total = 0;
  for (const lane of lanes) {
    const near = nearestWithHeading(p, lane);
    if (!near || near.distance > ARC_NEIGHBOURHOOD_M) continue;
    if (dist(near.point, green.centre) < greenDrawnRadius(green)) continue;
    total += 1;
    if (foldedGap(near.dirDeg, bearingOf(green.centre, near.point)) <= ARC_RADIAL_TOL_DEG) {
      radial += 1;
    }
  }
  return total >= 2 && radial * 2 >= total;
}

/**
 * GATE 6.10: the arc itself — a street at constant radius through `through`,
 * sweeping BOTH ways until it meets a lane, and joining it.
 *
 * Sampled at LANE_SAMPLE_STEP_M of ARC LENGTH, so it is an ordinary
 * polyline in every respect the rest of the engine cares about: lots are
 * cut along it, branch slots open on it, `truncateAtFirstCrossing` and
 * `earnsItsSpace` judge it, and it curves gently by construction rather
 * than by `laneCurve` (an arc's whole identity is its curvature, so it
 * spends no rng at all — which is also why adding one shifts no draw
 * downstream of it).
 *
 * JOIN, NEVER CROSS. Each sweep stops at the first intersection with an
 * existing lane and ENDS on it, or short of one it passes within
 * LOOP_SNAP_M of. The zero-crossing invariant is therefore satisfied by
 * construction, and `segmentIntersection`'s endpoint exclusion is what lets
 * the join read as a junction rather than a crossing.
 *
 * Returns the assembled polyline and how many of its two ends found a lane.
 */
function buildArc(
  out: Lane[], green: Green, profile: RadiusProfile, through: Point,
  snapExclude: Set<string>,
): { points: Point[]; joinedEnds: number; } | null {
  const radiusM = dist(through, green.centre);
  if (radiusM < greenDrawnRadius(green) + LANE_SAMPLE_STEP_M) return null;
  const stepDeg = (LANE_SAMPLE_STEP_M / radiusM) * (180 / Math.PI);
  const theta0 = bearingOf(green.centre, through);
  // GATE 8: AN ARC IS NO LONGER A CIRCLE. It runs at a constant FRACTION of
  // the radius profile rather than a constant radius, so a ring street
  // bulges where the village bulges and pulls in where it pulls in. This is
  // the single most visible consequence of the profile: constant-radius
  // arcs were drawing true circles through the fabric, and once the fabric
  // grew rings (gate 6.11) the picture was concentric by construction.
  const share = radiusM / Math.max(1e-6, profile.at(theta0));
  const at = (deg: number): Point => {
    const d = bearingVector(deg);
    const r = profile.at(deg) * share;
    return new Point(green.centre.x + d.x * r, green.centre.y + d.y * r);
  };

  const sweep = (sign: 1 | -1): { pts: Point[]; joined: boolean; } => {
    const pts: Point[] = [];
    let prev = through;
    for (let k = 1; k * stepDeg <= ARC_MAX_SWEEP_DEG / 2; k++) {
      const cur = at(theta0 + sign * k * stepDeg);
      let hit: Point | null = null;
      let hitD = Infinity;
      for (const lane of out) {
        for (let i = 1; i < lane.points.length; i++) {
          const q = segmentIntersection(prev, cur, lane.points[i - 1], lane.points[i]);
          if (!q) continue;
          const d = dist(prev, q);
          if (d < hitD) { hitD = d; hit = q; }
        }
      }
      if (hit) { pts.push(hit); return { pts, joined: true }; }
      pts.push(cur);
      prev = cur;
      // A near miss counts as a join too, once the sweep is clear of
      // whatever lane `through` may itself be sitting on: an arc that
      // stopped a metre short of its neighbour would be a dead end where a
      // junction is the whole point.
      if ((k * stepDeg * Math.PI) / 180 * radiusM >= CONNECT_MIN_M) {
        const snap = loopSnap(out, cur, snapExclude, LOOP_SNAP_M, pts.length > 1 ? pts[pts.length - 2] : through);
        if (snap) { pts.push(snap); return { pts, joined: true }; }
      }
    }
    return { pts, joined: false };
  };

  const back = sweep(-1);
  const fwd = sweep(1);
  const points = [...back.pts.slice().reverse(), through, ...fwd.pts];
  if (points.length < 2) return null;
  return { points, joinedEnds: (back.joined ? 1 : 0) + (fwd.joined ? 1 : 0) };
}

/**
 * GATE 6.10: try to answer a demand for a street at `through` with an ARC.
 *
 * Returns false — and the caller falls back to its ordinary radial-ish
 * primitive — unless the fabric there is genuinely radial, the arc reaches
 * a lane on at least one side, and it passes every rule an ordinary street
 * passes: stub floor, zero crossings, `earnsItsSpace`.
 *
 * At least ONE joined end is required rather than two. A one-ended arc is
 * still a real street that turns the fabric, and its free end is offered to
 * `connectDeadEnds` like any other; an arc that joins NOTHING is a floating
 * ring segment, which is litter.
 *
 * Ids live in the parent's branch space (`<parent>/b<pct>`) with the parent
 * being the lane the arc's FIRST end lands on, so an arc has an ordinary
 * lane's identity and its lots have ordinary lot ids.
 */
function seedArcThrough(
  out: Lane[], green: Green, profile: RadiusProfile, through: Point,
  parent: Lane | undefined, spacingScale: number, obstacles: Lane[] = [],
): boolean {
  if (!locallyRadial(out, through, green)) return false;
  const snapExclude = new Set<string>(parent ? [parent.id] : []);
  const arc = buildArc(out, green, profile, through, snapExclude);
  if (!arc || arc.joinedEnds === 0) return false;
  let { points } = arc;
  if (polylineLength(points) < BRANCH_MIN_M) return false;

  // The arc was built to stop at its joins, so this can only bite on a lane
  // the sweep's straight chords clipped between samples. NO parent
  // exemption is passed: that exemption exists because an ordinary branch
  // leaves its parent AT a point on it and may formally cross the parent's
  // polyline right at the junction, whereas an arc only ever TOUCHES a lane
  // at an endpoint, which `segmentIntersection` excludes anyway. Passing
  // the host here let an arc whose back sweep joined its own host cross
  // that host for free near the join — measured as the one crossing at pop
  // 300 seed 1, which is how this was found.
  points = truncateAtFirstCrossing(points, withObstacles(out, obstacles), green);
  if (points.length < 2 || polylineLength(points) < BRANCH_MIN_M) return false;

  // Whose branch space? The lane the arc was seeded from, or — for an arc
  // seeded into open ground — the nearest lane to the point it runs
  // through, by distance then id so array order can never decide it.
  const host = parent ?? (() => {
    const cands = out
      .map((l) => ({ l, d: nearestWithHeading(through, l)?.distance ?? Infinity }))
      .sort((a, b) => (a.d - b.d) || a.l.id.localeCompare(b.l.id));
    return cands.length > 0 && Number.isFinite(cands[0].d) ? cands[0].l : undefined;
  })();
  if (!host) return false;
  // Not `crossesParentTwice`: an arc meets its host at an ENDPOINT, so a
  // single properly-registered intersection with it is already one too many.
  if (crossesLanePoints(points, host.points)) return false;
  // ALONGSIDE ONLY. An arc crosses the ribs it ties at nearly a right
  // angle, so it is a block's width from each of them by construction and
  // can never "open new ground" as the unconditional rule means it — which
  // is exactly how that rule forbade every ring, block and cross-link this
  // engine has ever tried to grow (gate 6.8 measured 61 of 64 candidates
  // rejected at pop 300). What an arc must still clear is another lane
  // running THE SAME WAY, since that is the one whose lot strip it would
  // take. The exemption is deliberately arc-only: applied to every branch
  // it let the fabric pack to a 18 m junction pitch and pushed the
  // converging-claim death share from 31% to 44%.
  if (!earnsItsSpace(points, out, spacingScale, host.id, true)) return false;
  {
    const acc = arcLengths(points);
    const total = acc[acc.length - 1];
    let widest = 0;
    for (let s = 0; s <= total; s += LANE_SAMPLE_STEP_M) {
      const { p } = sampleAt(points, acc, s);
      let nearest = Infinity;
      for (const lane of out) {
        for (let i = 1; i < lane.points.length; i++) {
          nearest = Math.min(nearest,
            dist(p, closestPointOnSegment(p, lane.points[i - 1], lane.points[i])));
        }
      }
      widest = Math.max(widest, nearest);
    }
    if (widest < LANE_MIN_SPACING_M * spacingScale) return false;
  }

  const acc = arcLengths(host.points);
  const totalHost = acc[acc.length - 1];
  const near = nearestWithHeading(through, host);
  let travelled = 0;
  if (near && totalHost > 0) {
    for (let i = 1; i < host.points.length; i++) {
      const q = closestPointOnSegment(near.point, host.points[i - 1], host.points[i]);
      if (dist(near.point, q) < 1e-6) { travelled = acc[i - 1] + dist(host.points[i - 1], q); break; }
    }
  }
  const atFraction = totalHost > 0
    ? Math.min(0.99, Math.max(0.01, travelled / totalHost)) : 0.5;

  let id: string | null = null;
  const pct0 = Math.max(1, Math.min(99, Math.round(atFraction * 100)));
  for (let step = 0; step < 99; step++) {
    const pct = 1 + ((pct0 - 1 + step) % 99);
    const candidate = branchLaneId(host.id, pct / 100);
    if (!out.some((l) => l.id === candidate)) { id = candidate; break; }
  }
  if (!id) return false;

  // An arc MEETS the lanes it ties, so it is a connector by the standing
  // rule and runs one class below the child class its host would give it.
  const cls = stepDown(inventedChildClass(host.type), 'footpath');
  out.push({
    id, type: cls, points, widthM: laneWidth(cls), parentId: host.id,
  });
  return true;
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
  out: Lane[], green: Green, meanFrontageM: number, profile: RadiusProfile,
  satRadiusM: number, rng: SeededRandom, spacingScale: number,
  obstacles: Lane[] = [],
): boolean {
  const void_ = widestVoid(out, green, profile, satRadiusM);
  if (!void_ || void_.distance <= VOID_SPACING_M) return false;

  // GATE 6.10: a void between two RIBS is a wedge, and the street that
  // fills a wedge runs across it, not out of it. No parent is handed to the
  // arc here: the void point is in open ground, so every lane around it —
  // the nearest one included — is a candidate to join.
  if (seedArcThrough(out, green, profile, void_.point, undefined, spacingScale,
    obstacles)) return true;

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
  const snap = loopSnap(out, points[points.length - 1], new Set([void_.parent.id]), LOOP_SNAP_M, points[points.length - 2]);
  if (snap) points = [...points, snap];
  const assembled = points.length;
  points = truncateAtFirstCrossing(
    points, withObstacles(out, obstacles), green, void_.parent.id,
  );
  if (snap || points.length < assembled) cls = stepDown(cls, 'footpath');
  if (points.length < 2 || polylineLength(points) < BRANCH_MIN_M) return false;
  if (crossesParentTwice(points, void_.parent)) return false;

  out.push({
    id, type: cls, points, widthM: laneWidth(cls), parentId: void_.parent.id,
  });
  return true;
}

/**
 * GATE 6.11: the mean radius at which a lane runs, weighted by length --
 * an arc's ring radius, and a rib's midpoint. Used to CONTINUE a ring:
 * a new arc seeded at the radius of the ring already there extends it round
 * the next sector instead of starting a second, concentric one.
 */
function meanRadiusOf(lane: Lane, green: Green): number {
  let sum = 0;
  let weight = 0;
  for (let i = 1; i < lane.points.length; i++) {
    const a = lane.points[i - 1];
    const b = lane.points[i];
    const w = dist(a, b);
    sum += ((dist(a, green.centre) + dist(b, green.centre)) / 2) * w;
    weight += w;
  }
  return weight === 0 ? dist(lane.points[0], green.centre) : sum / weight;
}

/** GATE 6.11: how far a lane runs ACROSS the radius rather than along it,
 * length-weighted and folded to [0, 90] -- 0 is a rib, 90 is a ring. */
function circumferentialityDeg(lane: Lane, green: Green): number {
  let sum = 0;
  let weight = 0;
  for (let i = 1; i < lane.points.length; i++) {
    const a = lane.points[i - 1];
    const b = lane.points[i];
    const mid = new Point((a.x + b.x) / 2, (a.y + b.y) / 2);
    const w = dist(a, b);
    sum += foldedGap(bearingOf(a, b), bearingOf(green.centre, mid)) * w;
    weight += w;
  }
  return weight === 0 ? 0 : sum / weight;
}

/**
 * Gate 6.4: fill the biggest hole in the ring's angular coverage.
 *
 * Growth is otherwise sector-blind -- branch slots exist only ON lanes, so
 * a sector no lane ever entered offers nothing to do and the ring reports
 * itself full while empty. This is what the owner saw as a laneless western
 * half. Called before any ring widening; returns true if it seeded a lane.
 *
 * GATE 6.11: AN ARC MAY PAY FOR COVERAGE, AND IS ASKED FIRST.
 *
 * The old rule could only answer an empty sector with another RIB out of the
 * green, so the threshold alone decided the rib count -- eight of them at a
 * flat 50 deg, converging inside a pop-300 disc, spending the whole capped
 * budget and adding sixteen junction mouths. But a sector is not asking for
 * a RADIAL, it is asking to be SERVED: lots hang off both sides of a
 * circumferential street exactly as they do off a radial one, and an arc
 * sweeping across a sector covers every bearing in it at once.
 *
 * So the gap is offered to `seedArcThrough` before any rib is seeded, at a
 * point on the gap's bisector. Candidate radii, in order:
 *  1. the radius of any RING already near this gap -- which CONTINUES that
 *     ring round the next sector rather than starting a concentric second
 *     one, and is what closes the ring toward 360 deg;
 *  2. outer to inner across the saturated ring, because wedges widen
 *     outward, so an arc laid out there has the most room for lots on both
 *     of its sides and the best chance of clearing its neighbours.
 * `seedArcThrough` declines unless the fabric there is genuinely radial and
 * the arc reaches a lane, so a village with nothing to tie still gets its
 * rib. Where an arc takes, the rib is never seeded and never paid for.
 *
 * The threshold itself is now `coverageThresholdDeg(satRadiusM)` -- derived
 * from the disc, see `ribCountFor`.
 */
function seedCoverageLane(
  out: Lane[], green: Green, meanFrontageM: number, profile: RadiusProfile,
  satRadiusM: number, rng: SeededRandom, spacingScale: number,
  obstacles: Lane[] = [],
): boolean {
  const gap = widestGap(angularCoverage(out, green, profile, satRadiusM));
  if (gap.widthDeg <= coverageThresholdDeg(satRadiusM)) return false;

  // GATE 8: every radius below is a fraction of the RING AT THIS BEARING, so
  // a sector on the village's short side is served at the radius its own
  // ground reaches to rather than at the mean.
  const ringHere = profile.ringAt(satRadiusM, gap.bisectorDeg);

  // 1. Serve it circumferentially if anything is there to tie.
  // A ring lane's MEAN radius is its share of the profile (the shape has
  // mean 1 by construction), so continuing that ring round to this sector
  // means seeding at the same share HERE -- `ringAt`, not the bare radius.
  const ringRadii = out
    .filter((l) => circumferentialityDeg(l, green) >= 60)
    .map((l) => meanRadiusOf(l, green))
    .filter((r) => r > greenDrawnRadius(green) && r <= satRadiusM)
    .sort((a, b) => b - a)
    .map((r) => profile.ringAt(r, gap.bisectorDeg));
  const inner = greenDrawnRadius(green) + BRANCH_MIN_M / 2;
  const scanned = [0.9, 0.75, 0.6, 0.45]
    .map((f) => ringHere * f)
    .filter((r) => r > inner);
  for (const radiusM of [...ringRadii, ...scanned]) {
    const dir = bearingVector(gap.bisectorDeg);
    const at = new Point(
      green.centre.x + dir.x * radiusM, green.centre.y + dir.y * radiusM,
    );
    if (seedArcThrough(out, green, profile, at, undefined, spacingScale,
      obstacles)) return true;
  }

  const reach = Math.max(0, ringHere - greenDrawnRadius(green));
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
    const points = truncateAtFirstCrossing(
      runLine(start, bearing, nominal, rng), withObstacles(out, obstacles), green,
    );
    if (points.length < 2 || polylineLength(points) < BRANCH_MIN_M) continue;
    out.push({
      id, type: 'local', points, widthM: laneWidth('local'),
    });
    return true;
  }
  return false;
}

/** Legacy saturation probe retained for lower-level geometry tests. Production
 * generation uses proposeGrowth and accepts roads only on real housing gain.
 * @deprecated This helper's coverage/budget policy is not the village policy.
 */
export function saturateDisc(
  lanes: Lane[], green: Green, meanFrontageM: number,
  target: RadiusProfile, rng: SeededRandom, spacingScale = 1,
  obstacles: Lane[] = [],
): { lanes: Lane[]; radiusM: number; profile: RadiusProfile; } {
  // GATE 8: the disc is a PROFILE. `targetRadiusM` below is its
  // area-equivalent radius -- every ring test in growth goes through
  // `insideRing`, which reads the profile's shape at the bearing of the
  // point being judged, so saturation grows as an irregular body rather
  // than as concentric circles. The AREA is unchanged (the profile is
  // area-normalised), so the lane budget below is the same budget gate 6.6
  // derived and the census arithmetic is untouched.
  const targetRadiusM = target.radiusM;
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
  // Task 2 (2026-08-24): the budget counts only INVENTED lane -- an FMG
  // arm never counted against it, mirroring the invented-rib cap's own
  // distinction (`growOne`'s comment above: "the count governs what the
  // village ADDS: only invented radials... count against it"). Without
  // this, a village with several incoming routes spends its whole budget
  // on arms FMG already drew before growth invents a single street (a
  // 5-route village measured at 115% of round-0 budget spent by arms
  // alone, an 8-route one at 172%) -- the census then starves for want of
  // an interior mesh no matter how many arms it has. The arm length itself
  // was unbounded by design (it was FMG's road, not ours to shorten); what
  // must not shrink is how much the VILLAGE gets to build around it.
  //
  // Trunks task 5: the same exemption, `isTrunk`-keyed. It now also covers
  // every lane `synthesizeTrunks` ever commits, not only a plain root --
  // loop segments, y-tree connectors and captured/merged sub-trunks all
  // carry `trunk-` ids (spec 5.1/5.2) and none of them were laid by the
  // village's own growth budget, so none of them should be able to spend
  // it either.
  const budgetM = laneBudgetFor(targetRadiusM);
  // Hoisted out of the loop condition: this filter allocated a fresh array on
  // every iteration of a loop bounded by MAX_INVENTED_LANES.
  const inventedOnly = (all: Lane[]): Lane[] => all.filter((l) => !isTrunk(l.id));
  while (guard < MAX_INVENTED_LANES
    && laneLengthWithin(inventedOnly(out), green, target) < budgetM) {
    guard++;
    // Gate 6.7: coverage comes FIRST, not last. Gate 6.4 added this check
    // as a last resort before widening, which was enough while every street
    // was a 24 m stub and the budget bought dozens of them. Streets that run
    // to the ring's edge spend the same budget on far fewer lanes, so the
    // budget can now run out while a whole sector is still empty -- measured
    // as a 66 deg laneless sector at pop 300, over the 60 deg bar. Coverage
    // is a hard constraint on the shape; meshing an already-covered ring is
    // discretionary, so the constraint goes first.
    if (seedCoverageLane(out, green, meanFrontageM, target, satRadiusM, rng, spacingScale,
      obstacles)) {
      continue;
    }
    if (growOne(out, green, meanFrontageM, target, rng, satRadiusM, spacingScale,
      obstacles)) continue;
    // Gate 6.5: and even with every bearing covered, a RADIAL tree leaves
    // widening wedges of untouched ground between its tendrils -- the
    // spider. Measure the GROUND, not the network: if anywhere in the disc
    // is further than VOID_SPACING_M from a lane, put a lane there.
    if (seedVoidLane(out, green, meanFrontageM, target, satRadiusM, rng, spacingScale,
      obstacles)) continue;
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
  // The BODY actually saturated: the same shape at the radius growth
  // reached. The lot cutter, the trunk cap and the dressing passes all read
  // this profile, so nothing downstream of growth speaks about a circle.
  return { lanes: out, radiusM: satRadiusM, profile: target.scaled(satRadiusM / targetRadiusM) };
}

/** Propose a bounded set of additions; placement decides which earns frontage.
 * Every trial owns its lanes, including extensions of existing streets. */
export function proposeGrowth(
  lanes: Lane[], green: Green, frontageM: number, profile: RadiusProfile,
  rng: SeededRandom, spacingScale = 1, limit = Infinity,
): Lane[][] {
  const obstacles = lanes.filter(l => isApron(l.id));
  const standing = lanes.filter(l => !isApron(l.id));
  const proposals: Lane[][] = [];
  const offer = (out: Lane[]): void => {
    const prepared: Lane[] = [];
    for (const lane of out) {
      const old = standing.find(l => l.id === lane.id);
      // Existing occupied geometry and its junctions never move during a trial.
      const points = old ? lane.points : smoothLane(lane.points, standing);
      if (!points) return;
      if (!old && out.some(host => host.id !== lane.id && crossesLanePoints(points, host.points))) return;
      prepared.push({ ...lane, points });
    }
    if (prepared.some(l => obstacles.some(o => crossesLanePoints(l.points, o.points)))) return;
    proposals.push([...prepared, ...obstacles]);
  };
  for (let kind = 0; kind < 4; kind++) {
    const out = standing.map(l => ({ ...l, points: [...l.points] }));
    const radius = profile.radiusM;
    const changed = kind === 0
      ? seedCoverageLane(out, green, frontageM, profile, radius, rng, spacingScale, obstacles)
      : kind === 1
        ? seedVoidLane(out, green, frontageM, profile, radius, rng, spacingScale, obstacles)
        : growOne(out, green, frontageM, profile, rng, radius, spacingScale, obstacles);
    if (changed) offer(out);
    if (proposals.length >= limit) return proposals;
  }
  const slots = branchSlots(standing, green, profile, slotPitchFor(green, profile.radiusM));
  // Visit different parts of the existing frontage, rather than always retrying
  // the first valid but unproductive junction. The shuffle has its own stream.
  const ordered = slots.map(slot => ({ slot, key: rng.float() })).sort((a, b) => a.key - b.key);
  for (const { slot } of ordered.slice(0, 6)) for (const side of [-1, 1]) {
    const id = branchLaneId(slot.parent.id, slot.at);
    if (standing.some(l => l.id === id)) continue;
    const bearing = slot.dirDeg + side * 85;
    const length = Math.min(48, Math.max(18, profile.radiusM * 0.65));
    const points = truncateAtFirstCrossing(runLine(slot.anchor, bearing, length, rng), lanes, green, slot.parent.id);
    if (points.length < 2 || polylineLength(points) < 12 || crossesParentTwice(points, slot.parent)) continue;
    if (!earnsItsSpace(points, standing, spacingScale, slot.parent.id)) continue;
    const type = inventedChildClass(slot.parent.type);
    offer([...standing, { id, type, points, widthM: laneWidth(type), parentId: slot.parent.id }]);
    if (proposals.length >= limit) return proposals;
  }
  // Remaining housing demand may need a new approach to a vacant sector even
  // after the old rib quota is reached. These are last-choice candidates, never
  // compulsory coverage: placement still has to show a capacity gain.
  const offset = rng.int(0, 30);
  for (let angle = offset; angle < 360; angle += 30) {
    const id = inventedLaneId(angle);
    if (standing.some(l => l.id === id)) continue;
    const dir = bearingVector(angle);
    const start = new Point(green.centre.x + dir.x * green.diameter * GREEN_UNDERLAP_RATIO / 2,
      green.centre.y + dir.y * green.diameter * GREEN_UNDERLAP_RATIO / 2);
    const points = truncateAtFirstCrossing(runLine(start, angle, profile.at(angle), rng), lanes, green);
    if (points.length < 2 || polylineLength(points) < 12 || !earnsItsSpace(points, standing, spacingScale)) continue;
    offer([...standing, { id, type: 'local', points, widthM: laneWidth('local') }]);
    if (proposals.length >= limit) return proposals;
  }
  return proposals;
}
