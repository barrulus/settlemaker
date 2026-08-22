import { Point } from '../../types/point.js';
import { arcLengths, closestPointOnSegment, dist } from '../geometry.js';
import { inkExtent } from '../glyphs.js';
import {
  RELAX_CLEARANCE_M, RELAX_ITERATIONS, RELAX_MAX_DISPLACEMENT_M, TAIL_STUB_M,
} from '../constants.js';
import type { Building, Lane } from '../types.js';

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
 *  - `arm-*` lanes are FMG's roads — the route to the next town, arriving
 *    at this village. They exist whether or not anyone builds on them
 *    (the empty-site wireframe is precisely an arm with zero buildings), so
 *    housing is irrelevant to their length: an arm is never trimmed, full
 *    stop, whether it has zero buildings or buildings that stop short of
 *    the map edge.
 *  - Everything else — `lane-*` (invented lanes) and any `.../bNN` branch,
 *    including a branch off an arm — was invented by the frontage budget
 *    purely to supply frontage. If it earned no dwelling, it should not be
 *    drawn at all; if it earned some, it is trimmed to the last one plus a
 *    TAIL_STUB_M stub.
 *
 * A branch id such as `arm-090/b50` starts with `arm-` but is NOT exempt —
 * the `/b` marks it as an invented branch, checked before the arm test.
 */
function isFmgArm(laneId: string): boolean {
  return laneId.startsWith('arm-') && !laneId.includes('/b');
}

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
 * monotonically in distance from its own start point. That holds for this
 * engine because every lane — arm or invented — is built outward from the
 * green, so a point further along the array is, by construction, further
 * from the start; a lane that wandered back toward its own beginning would
 * break the assumption, but no pass in this engine produces one.
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

export function trimTails(lanes: Lane[], buildings: Building[]): Lane[] {
  const result: Lane[] = [];
  const connectorParents = new Set(
    lanes.filter((l) => isConnector(l.id) && l.parentId !== undefined).map((l) => l.parentId!),
  );

  for (const lane of lanes) {
    if (isFmgArm(lane.id)) {
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

    const mine = buildingsOf(lane, buildings);
    if (mine.length === 0) {
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
    const cutoff = furthestS + TAIL_STUB_M;
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
