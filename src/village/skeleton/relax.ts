import { Point } from '../../types/point.js';
import { arcLengths, closestPointOnSegment, dist } from '../geometry.js';
import { inkExtent } from '../glyphs.js';
import {
  RELAX_CLEARANCE_M, RELAX_ITERATIONS, RELAX_MAX_DISPLACEMENT_M, TAIL_STUB_M,
} from '../constants.js';
import type { Building, Lane } from '../types.js';
import { isTrunk } from './trunks.js';

/**
 * Lanes bend around the houses they acquired. The skeleton was solved
 * before anyone lived there, so a building can end up sitting on its own
 * lane; relaxation nudges each lane point clear of any building whose ink
 * extent overlaps it. Bounded at RELAX_ITERATIONS iterations and clamped to
 * RELAX_MAX_DISPLACEMENT_M total displacement from its original position so
 * the geometry cannot wander and determinism holds.
 *
 * The 1.5 m cap is a hard ceiling, not a promise of full clearance: for a
 * building close enough that clearing it would need more than 1.5 m of
 * push, the clamp still applies, and the point is left short of the
 * keep-out radius — still intruding on the building's ink extent. That is
 * the accepted trade for a bounded, deterministic pass: bounded beats
 * convergent here.
 *
 * Pure function of its inputs: no RNG, no mutation of the input lanes.
 */
export function relaxLanes(lanes: Lane[], buildings: Building[]): Lane[] {
  return lanes.map((lane) => {
    const origin = lane.points.map((p) => new Point(p.x, p.y));
    const points = lane.points.map((p) => new Point(p.x, p.y));

    for (let iter = 0; iter < RELAX_ITERATIONS; iter++) {
      for (let i = 0; i < points.length; i++) {
        for (const b of buildings) {
          const ink = inkExtent(b.glyph, b.footprint);
          // Gate 3: use the SHORT ink half-axis, matching the seat-time
          // corridor rule. The long-axis radius treated every legally
          // seated house as an intruder and shoved its lane sideways —
          // AFTER the crossing checks had run — quietly re-creating the
          // untidy crossings the growth rules had just eliminated. With
          // seat-time clearance guaranteed, relaxation now only fires for
          // genuine intrusions.
          const keepOut = lane.widthM / 2 + RELAX_CLEARANCE_M + Math.min(ink.width, ink.depth) / 2;
          const dx = points[i].x - b.position.x;
          const dy = points[i].y - b.position.y;
          const d = dist(points[i], b.position);
          if (d === 0 || d >= keepOut) continue;
          const push = (keepOut - d) / RELAX_ITERATIONS;
          points[i] = new Point(points[i].x + (dx / d) * push, points[i].y + (dy / d) * push);
        }
      }
    }

    // Clamp total displacement against the ORIGINAL position, not
    // iteration-to-iteration, so the cap can never be exceeded regardless
    // of how many buildings pushed on a point across the iterations.
    for (let i = 0; i < points.length; i++) {
      const dx = points[i].x - origin[i].x;
      const dy = points[i].y - origin[i].y;
      const d = dist(points[i], origin[i]);
      if (d > RELAX_MAX_DISPLACEMENT_M) {
        points[i] = new Point(
          origin[i].x + (dx / d) * RELAX_MAX_DISPLACEMENT_M,
          origin[i].y + (dy / d) * RELAX_MAX_DISPLACEMENT_M,
        );
      }
    }

    return { ...lane, points };
  });
}

/**
 * Ruling R15: trim by provenance. Lanes in this engine come from two
 * different places, and trimming means something different for each:
 *
 *  - `trunk-*` lanes are FMG's roads made physical — the route to the next
 *    town, arriving at this village (Trunks task 5: previously `arm-*`,
 *    built by the now-retired `buildArms`; now every lane
 *    `synthesizeTrunks` commits, spec 2026-08-25 §5.1/5.2 — a plain root,
 *    a captured/merged sub-trunk, a loop segment, a y-tree connector, or a
 *    main-street spine). They exist whether or not anyone builds on them
 *    (the empty-site wireframe is precisely a trunk with zero buildings),
 *    so housing is irrelevant to their length: a trunk is never trimmed,
 *    full stop, whether it has zero buildings or buildings that stop short
 *    of the contract circle.
 *  - Everything else — `lane-*` (invented lanes) and any `.../bNN` branch,
 *    including a branch off a trunk — was invented by the frontage budget
 *    purely to supply frontage. If it earned no dwelling, it should not be
 *    drawn at all; if it earned some, it is trimmed to the last one plus a
 *    TAIL_STUB_M stub.
 *
 * A branch id such as `trunk-main-r1/b50` starts with `trunk-` but is NOT
 * exempt — the `/b` marks it as an invented branch, checked before the
 * trunk test (`isTrunk`, spec 5.1).
 *
 * `isTrunk` itself is defined once, in `skeleton/trunks.ts` (the module
 * that also builds the ids it recognises — Trunks task 5 moved the single
 * definition there from `lanes.ts`'s now-retired `isFmgArm`), and imported
 * from there.
 */

/**
 * A building belongs to a lane only when its lotId's lane-id segment is an
 * exact match — `arm-090:R3` belongs to `arm-090`, but `arm-090/b50:R3`
 * (a branch lane with its own separate id) must not be claimed by
 * `arm-090`'s prefix test. Matching on `${lane.id}:` rather than a bare
 * `startsWith(lane.id)` is what keeps that boundary honest.
 */
function buildingsOf(lane: Lane, buildings: Building[]): Building[] {
  const prefix = `${lane.id}:`;
  return buildings.filter((b) => b.lotId.startsWith(prefix));
}

/**
 * A lane tail that acquired no dwelling is the straggle at the edge of the
 * fabric: a road running 200 m past the last cottage looks like a mistake,
 * a road stopping dead at the last cottage looks unnatural. Trims invented
 * lanes back to their furthest-out building plus a TAIL_STUB_M stub, drops
 * invented lanes that earned no building at all, and leaves FMG's `arm-`
 * roads untouched regardless of what they did or didn't acquire (R15).
 *
 * The output may contain fewer lanes than the input — a dropped invented
 * lane is simply absent. That is fine: this runs after dwellings are
 * placed, and its output only feeds rendering and the model.
 *
 * The keep-filter below assumes a lane's points increase roughly
 * monotonically in distance from its own start point. That only has to
 * hold for the lanes that reach this code at all -- every trunk lane is
 * exempted above and never gets here (Trunks task 5: `isTrunk`'s early
 * `continue`) -- and it does hold for the rest: every invented lane and
 * every branch off one is built outward from its own anchor (the green, or
 * a slot on its parent), so a point further along the array is, by
 * construction, further from the start; a lane that wandered back toward
 * its own beginning would break the assumption, but no pass in this engine
 * produces one.
 */
/** Arc length along `points` of the position nearest `p` — where a
 * building sits ALONG its lane, as opposed to how far it is from the
 * lane's start as the crow flies. */
function arcLengthOf(p: Point, points: Point[], acc: number[]): number {
  let best = Infinity;
  let bestS = 0;
  for (let i = 1; i < points.length; i++) {
    const q = closestPointOnSegment(p, points[i - 1], points[i]);
    const d = dist(p, q);
    if (d < best) { best = d; bestS = acc[i - 1] + dist(points[i - 1], q); }
  }
  return bestS;
}

/** `<laneId>/c` -- the connector sub-space added by `connectDeadEnds`. */
function isConnector(laneId: string): boolean {
  return laneId.endsWith('/c');
}

// Task 5 (2026-08-24): `connectorParents` above protects only ONE closure
// mechanism -- `connectDeadEnds`'s own `/c` lanes, added AFTER this first
// trim already ran once. Growth itself closes loops too, earlier and far
// more often (measured, task-5-report.md Part A): `growOne`'s rungs (a
// branch whose far end lands on a neighbour via `loopSnap` or
// `truncateAtFirstCrossing`, GATE 6.11's own "rung of a ladder") and
// `seedArcThrough`'s joined arcs both build a real, crossing-free junction
// on another lane -- but nothing marked that junction as anything other
// than an ordinary invented lane. Two failures followed, both silent: a
// rung earning no building of its own was DROPPED outright by the rule
// below (same as any other empty invented lane), and even a rung that
// survived could have its TARGET trimmed back past the exact point it
// welded onto -- the id lives on, the junction does not. Measured directly
// (task-5-report.md): at a failing pop-300 fixture, 4 of 12 growth-time
// rungs were dropped outright and a further 4 of the 8 survivors had a
// broken join, leaving zero of the fabric's real closures intact in the
// shipped geometry despite growth having built them.
//
// The fix generalises the SAME protection `/c` connectors already get to
// every growth-time join, purely from the geometry `trimTails` already has
// -- no new field on `Lane`, nothing growth has to remember to tag. A join
// is any point where one lane's END lands within WELD_EPS_M of ANOTHER
// lane's polyline: exactly the weld `blockAreas` (skeleton/blocks.ts) uses
// to trace enclosed faces in the first place, so a join this misses is a
// join `blockAreas` would not have counted either, and a join this keeps
// is one `blockAreas` can still trace after trimming.
const WELD_EPS_M = 1.5;

/**
 * For every lane, the furthest arc-length ALONG IT where some other lane's
 * FAR END welds on -- the point trimming must never cut shorter than,
 * whatever that lane's own building count says. Also returns the set of
 * lanes that are themselves a join (their OWN far end welds onto another
 * lane): like a `/c` connector, such a lane is structural regardless of
 * whether it earned a dwelling, because dropping it reopens the junction
 * it made.
 *
 * Deliberately the LAST point only, not the first: a branch's first point
 * is its anchor on its parent BY CONSTRUCTION (that is what makes it a
 * branch, not a join), so treating that as a weld would exempt nearly
 * every ordinary invented lane from ever being dropped -- the join this
 * fixes is specifically the one `growOne`'s rung/arc primitives build at a
 * lane's FAR end (via `loopSnap` or `truncateAtFirstCrossing`), which is
 * always that lane's last point by construction.
 *
 * The exemption this produces is broader than "a rung is protected": ANY
 * lane whose last point lands within `WELD_EPS_M` of ANOTHER lane's
 * polyline is protected (added to `joiners`, exempt from the
 * zero-buildings drop below), and the lane it lands on gets a trim floor
 * at that point, regardless of which lane grew first or which one the
 * caller thinks of as "the rung." This includes a MUTUAL pair: two lanes
 * whose tips both happen to land near each other (a near-dead-end pair)
 * protect each other symmetrically -- each one's last point is close
 * enough to the other's polyline to count as a weld on it, so both end up
 * in `joiners` and both get a floor, not just whichever one `growOne`
 * happened to build second.
 */
function weldJoins(lanes: Lane[]): { floorS: Map<string, number>; joiners: Set<string> } {
  const floorS = new Map<string, number>();
  const joiners = new Set<string>();
  // F1(a) (final fix wave): `arcLengths(host.points)` is O(host.points) and
  // was recomputed on every (other, host) pair -- O(lanes) times more often
  // than it needs to be, since it depends only on `host`. Hoisted to once
  // per host, computed before the `other` loop even starts. This is what
  // makes running `weldJoins` (and therefore `weld: true`) affordable at the
  // mid-loop TRIAL call site in `village-model.ts` -- see that call's
  // comment.
  const hostArcs = new Map<string, number[]>();
  for (const host of lanes) hostArcs.set(host.id, arcLengths(host.points));
  for (const other of lanes) {
    if (other.points.length < 2) continue;
    const end = other.points[other.points.length - 1];
    for (const host of lanes) {
      if (host.id === other.id) continue;
      const acc = hostArcs.get(host.id)!;
      let bestD = WELD_EPS_M;
      let bestS = -1;
      for (let i = 1; i < host.points.length; i++) {
        const q = closestPointOnSegment(end, host.points[i - 1], host.points[i]);
        const d = dist(end, q);
        if (d < bestD) { bestD = d; bestS = acc[i - 1] + dist(host.points[i - 1], q); }
      }
      if (bestS >= 0) {
        floorS.set(host.id, Math.max(floorS.get(host.id) ?? 0, bestS));
        joiners.add(other.id);
      }
    }
  }
  return { floorS, joiners };
}

/**
 * `weld` defaults true. `village-model.ts`'s round loop also runs
 * `trimTails` a THIRD time, every round, purely as a read-only TRIAL to
 * estimate whether blocks already clear the population's floor (that
 * call's own comment already documents it as "not a guarantee... but
 * close enough" -- an approximation, not the shipped truth).
 *
 * F1 (final fix wave): this trial used to pass `{ weld: false }`, on the
 * measured grounds that `weldJoins`'s O(lanes^2) cost, paid on top of
 * `blockAreas`'s own weld pass right after it, blew a large-population
 * stress fixture past a 120s test timeout. That measurement was real, but
 * the trial it was protecting was itself broken by the same omission:
 * without weld protection the trial under-reads blocks 3-5x relative to
 * the weld-protected (shipped) truth (measured, tri 900 s1: 14 blocks
 * weld-protected vs 3 without, against a floor of 6) -- so the trial's own
 * `blocksNow >= blockFloor` check was very rarely true, the block chase
 * fired on nearly every housed round, and the "wasted" chase round's rng
 * draws perturbed every downstream draw even when nothing was actually
 * short. `weldJoins` itself is now the O(lanes) cost the hoisted
 * `hostArcs` precompute makes it (see that function's comment) rather than
 * the O(lanes^2) cost it used to be recomputing `arcLengths` per pair, so
 * the trial can afford to weld-protect too: `weld: false` is no longer
 * passed anywhere, and the option exists only in case a future caller
 * needs the cheaper, less accurate form for some other reason.
 */
export function trimTails(
  lanes: Lane[], buildings: Building[], opts: { weld?: boolean } = {},
): Lane[] {
  const { weld = true } = opts;
  const result: Lane[] = [];
  const connectorParents = new Set(
    lanes.filter((l) => isConnector(l.id) && l.parentId !== undefined).map((l) => l.parentId!),
  );
  const { floorS: weldFloorS, joiners } = weld
    ? weldJoins(lanes) : { floorS: new Map<string, number>(), joiners: new Set<string>() };

  for (const lane of lanes) {
    if (isTrunk(lane.id)) {
      result.push(lane);
      continue;
    }

    // Gate 6.3: a CONNECTOR is structural, not frontage-driven. Both its
    // ends are junctions on other lanes -- that is its entire purpose --
    // so trimming it back to its last house would sever the link and
    // re-open the dead end it was added to close, and dropping it for
    // earning no dwelling would do the same. Connectors pass through
    // untouched.
    if (isConnector(lane.id)) {
      result.push(lane);
      continue;
    }

    // Gate 6.3: a lane with a CONNECTOR on it passes through whole, houses
    // or not. Two reasons, both measured:
    //  - dropping it (no houses) leaves the connector linking from nowhere,
    //    and dropping the connector in turn orphans the lots cut along it,
    //    a cascade that broke §2's stable-id invariant both ways round;
    //  - TRIMMING it detaches the connector, which was built to meet this
    //    lane's END. Trim the end away and the connector now starts out in
    //    space and its straight run back can cut across the shortened
    //    parent -- seen as exactly one lane crossing at pop 900 seed 2.
    // A lane carrying part of the web is structural, like a connector.
    if (connectorParents.has(lane.id)) {
      result.push(lane);
      continue;
    }

    // Task 5: a GROWTH-TIME join is structural for the identical reason a
    // `/c` connector is -- see `weldJoins`'s comment. Its far end already
    // IS the junction, so (unlike a connector) there is no separate host
    // to detach from by trimming; passing it through whole just keeps that
    // junction rather than deleting the lane that makes it.
    if (joiners.has(lane.id)) {
      result.push(lane);
      continue;
    }

    const mine = buildingsOf(lane, buildings);
    // Task 5: a lane earning no dwelling of its own is still kept if it is
    // the HOST of a growth-time join -- some other (surviving, per the
    // `joiners` check above) lane's far end welds onto it. Dropping the
    // host would orphan that join exactly as dropping the joiner itself
    // would; see `weldJoins`'s comment for the full mechanism.
    const weldFloor = weldFloorS.get(lane.id) ?? 0;
    // Task 5 review fix (#2): a HOST welded at arc-length 0 (another lane's
    // far end lands on THIS lane's very first vertex -- what `loopSnap`
    // snapping to a target vertex produces) is a legitimate weld, not "no
    // weld". Testing `weldFloor === 0` conflated the two and dropped a
    // zero-building host that a surviving joiner still depends on,
    // orphaning that joiner into a dangling interior spur -- exactly the
    // defect class this whole mechanism exists to prevent. `.has()` is the
    // correct presence check; `weldFloor` (the `?? 0` fallback) stays for
    // the cutoff arithmetic below, where 0 is the right floor value on a
    // weld-at-start.
    if (mine.length === 0 && !weldFloorS.has(lane.id)) {
      // Invented purely to supply frontage; none was used, so it is not drawn.
      continue;
    }

    // Gate 5.4: measured along the lane, not as the crow flies.
    //
    // This used to be `points.filter(p => dist(p, start) <= cutoff)` — a
    // STRAIGHT-LINE test that also filtered rather than truncated. On a
    // curving lane (gate 5 gave every lane a smooth arc) a later point can
    // sit CLOSER to the start than an earlier one, so the filter dropped a
    // middle point and kept a later one, and the surviving polyline jumped
    // the chord — cutting the corner across ground the lane never ran over,
    // including, in one measured pop-300 fixture, straight under a house.
    // The mesh exposed it by making central lanes shorter and curvier.
    //
    // Arc length fixes both halves: the cutoff is a distance ALONG the
    // lane, and the result is a genuine PREFIX, so the kept geometry is
    // always a leading piece of the original and can never take a new path.
    const acc = arcLengths(lane.points);
    const furthestS = mine.reduce((best, b) => Math.max(best, arcLengthOf(b.position, lane.points, acc)), 0);
    // Task 5: never trim shorter than a point another (surviving) lane
    // welded onto -- see `weldJoins`. A lane may earn its keep from its own
    // buildings alone, from hosting a junction alone, or both; the cutoff
    // is whichever reaches further.
    const cutoff = Math.max(furthestS + TAIL_STUB_M, weldFloor);
    let k = lane.points.length;
    while (k > 2 && acc[k - 1] > cutoff) k -= 1;

    // A lane must always keep at least two points — a single point is not
    // a lane. If the trim window collapsed below that (the last dwelling
    // sits well inside the first segment), fall back to the lane's own
    // first two points, which is the shortest possible stub this lane can
    // honestly offer.
    result.push({ ...lane, points: lane.points.slice(0, Math.max(2, k)) });
  }

  return result;
}
