import { Point } from '../../types/point.js';
import {
  RELAX_CLEARANCE_M, RELAX_ITERATIONS, RELAX_MAX_DISPLACEMENT_M, TAIL_STUB_M,
} from '../constants.js';
import { arcLengths, closestPointOnSegment, dist, sampleAt } from '../geometry.js';
import { inkExtent } from '../glyphs.js';
import type { Building, Lane, Lot } from '../types.js';
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
  const attachments = lanes.flatMap(l => [l.points[0], l.points[l.points.length - 1]].map(p => ({ p, laneId: l.id })));
  return lanes.map((lane) => {
    if (isTrunk(lane.id)) return lane;
    const origin = lane.points.map((p) => new Point(p.x, p.y));
    const points = lane.points.map((p) => new Point(p.x, p.y));

    for (let iter = 0; iter < RELAX_ITERATIONS; iter++) {
      for (let i = 1; i < points.length - 1; i++) {
        if (attachments.some(({ p, laneId }) => laneId !== lane.id && (dist(p, closestPointOnSegment(p, origin[i - 1], origin[i])) < 0.15
          || dist(p, closestPointOnSegment(p, origin[i], origin[i + 1])) < 0.15))) continue;
        for (const b of buildings) {
          const ink = inkExtent(b.glyph, b.footprint);

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

function buildingsOf(lane: Lane, buildings: Building[], lotLanes: Map<string, string>): Building[] {
  const prefix = `${lane.id}:`;
  return buildings.filter((b) => lotLanes.has(b.lotId) ? lotLanes.get(b.lotId) === lane.id : b.lotId.startsWith(prefix));
}

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

// Preserve surviving joins while trimming. Graph pruning removes redundancy first.
const WELD_EPS_M = 1.5;

/** Both ends of a surviving child protect their host's attachment position.
 * Only a far-end join protects the child itself. Redundant loops have already
 * been removed by graph connectivity, before trimming starts. */
function weldJoins(lanes: Lane[]): { floorS: Map<string, number>; joiners: Set<string>; } {
  const floorS = new Map<string, number>();
  const joiners = new Set<string>();
  // Share arc lengths across all attachment queries for each host.
  const hostArcs = new Map<string, number[]>();
  for (const host of lanes) hostArcs.set(host.id, arcLengths(host.points));
  for (const other of lanes) {
    if (other.points.length < 2) continue;
    for (const [index, end] of [other.points[0], other.points[other.points.length - 1]].entries()) {
      for (const host of lanes) {
        if (host.id === other.id) continue;
        const acc = hostArcs.get(host.id)!;
        let bestD = WELD_EPS_M, bestS = -1;
        for (let i = 1; i < host.points.length; i++) {
          const q = closestPointOnSegment(end, host.points[i - 1], host.points[i]);
          const d = dist(end, q);
          if (d < bestD) { bestD = d; bestS = acc[i - 1] + dist(host.points[i - 1], q); }
        }
        if (bestS >= 0) {
          floorS.set(host.id, Math.max(floorS.get(host.id) ?? 0, bestS));
          if (index === 1) joiners.add(other.id);
        }
      }
    }
  }
  return { floorS, joiners };
}

/** Trim unoccupied tails to the last house plus a short stub, preserving
 * required routes and attachments between surviving streets. Run graph pruning
 * first: this local geometric pass cannot decide whether a loop is useful.
 */
export function trimTails(
  lanes: Lane[], buildings: Building[], opts: { weld?: boolean; lots?: Lot[]; } = {},
): Lane[] {
  const { weld = true } = opts;
  const lotLanes = new Map(opts.lots?.map(l => [l.id, l.laneId]) ?? []);
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

    const mine = buildingsOf(lane, buildings, lotLanes);
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
    const cutoff = Math.min(acc[acc.length - 1], Math.max(furthestS + TAIL_STUB_M, weldFloor));
    const points = lane.points.filter((_, i) => acc[i] < cutoff);
    const end = sampleAt(lane.points, acc, cutoff).p;
    if (points.length === 0) points.push(lane.points[0]);
    if (dist(points[points.length - 1], end) > 1e-6) points.push(end);
    result.push({ ...lane, points: points.length >= 2 ? points : lane.points.slice(0, 2) });
  }

  return result;
}
