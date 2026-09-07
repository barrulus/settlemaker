/**
 * The APRON (spec 2026-09-07 §5): a trunk's continuation past its contract
 * entry, out to the edge of the drawn tile.
 *
 * Roads used to stop dead on the contract circle -- measured, the furthest
 * trunk point equalled `contractRadiusM` to the metre on every seed -- while
 * fields ran 70 m further and vegetation 150 m further still. This module
 * draws the missing road.
 *
 * Two rules from five failed attempts, both structural:
 *  - it APPENDS beyond the trunk's outer vertex and never moves it, because
 *    that vertex IS the boundary contract (`trunks-structural.test.ts` (b)
 *    allows 8 m; overwriting it measured 10.4 m);
 *  - it takes NO `SeededRandom`. Every apron is a pure function of geometry
 *    already fixed, so adding aprons cannot re-roll an existing village's
 *    fabric. Any future jitter takes a DERIVED stream (the
 *    `PROFILE_SEED_MULTIPLIER` pattern), never the shared one.
 *
 * The length drawn here is an OVERSHOOT. `frame.ts` clips it to the tile.
 */
import { Point } from '../../types/point.js';
import {
  APRON_CURVATURE_DAMP, APRON_MAX_TOTAL_TURN_DEG, APRON_MAX_TURN_PER_STEP_DEG,
  APRON_REACH_FACTOR, APRON_REACH_FLOOR_M, APRON_SAMPLE_STEP_M, MERGE_CAPTURE_M,
} from '../constants.js';
import { closestPointOnPolyline, dist, signedTurnDeg } from '../geometry.js';
import { apronLaneId, type Lane } from '../types.js';
// Type-only, so there is no runtime cycle with `trunks.ts`, which imports
// `growAprons` from here.
import type { TrunkEntry, TrunkJunction } from './trunks.js';

/** How long an apron is drawn before clipping (spec §5.3.3). */
export function apronReachM(contractRadiusM: number): number {
  return Math.max(contractRadiusM * APRON_REACH_FACTOR, APRON_REACH_FLOOR_M);
}

/** Bearing, in degrees, of the segment `a` -> `b`. */
function segBearingDeg(a: Point, b: Point): number {
  return (Math.atan2(b.x - a.x, -(b.y - a.y)) * 180) / Math.PI;
}

/**
 * The continuation of `lane` past its OUTER end (the last point -- lanes run
 * inner-first), `reachM` metres long, sampled every `APRON_SAMPLE_STEP_M`.
 *
 * `[0]` is the lane's own outer vertex, shared rather than copied-and-moved,
 * so the trunk and its apron are geometrically continuous and the contract
 * point is untouched.
 *
 * The heading continues the lane's terminal curvature, damped and clamped:
 * a road that was bending goes on bending gently, a straight one stays
 * straight, and nothing spirals.
 */
export function growApronPath(lane: Lane, reachM: number): Point[] {
  const pts = lane.points;
  if (pts.length < 2 || reachM <= 0) return [];

  const tip = pts[pts.length - 1];
  let headingDeg = segBearingDeg(pts[pts.length - 2], tip);

  // The turn the road was already making, per step, damped and clamped.
  let turnPerStepDeg = 0;
  if (pts.length >= 3) {
    const previous = segBearingDeg(pts[pts.length - 3], pts[pts.length - 2]);
    const raw = signedTurnDeg(previous, headingDeg) * APRON_CURVATURE_DAMP;
    turnPerStepDeg = Math.max(
      -APRON_MAX_TURN_PER_STEP_DEG, Math.min(APRON_MAX_TURN_PER_STEP_DEG, raw),
    );
  }

  const out: Point[] = [tip.clone()];
  let cursor = tip;
  let travelled = 0;
  let turnedDeg = 0;

  while (travelled < reachM) {
    const step = Math.min(APRON_SAMPLE_STEP_M, reachM - travelled);
    if (Math.abs(turnedDeg) < APRON_MAX_TOTAL_TURN_DEG) {
      headingDeg += turnPerStepDeg;
      turnedDeg += turnPerStepDeg;
    }
    const rad = (headingDeg * Math.PI) / 180;
    cursor = new Point(
      cursor.x + Math.sin(rad) * step,
      cursor.y - Math.cos(rad) * step,
    );
    out.push(cursor);
    travelled += step;
  }

  return out;
}

/** A lane end counts as sitting on an entry within this — one apron sample
 * step, the same slack `trunks-structural.test.ts` (b) allows. */
const ON_ENTRY_M = 8;

/** `growAprons`'s result: the apron lanes, any junctions where two aprons
 * converged, and a diagnostics channel a later task will fill. */
export interface GrownAprons {
  lanes: Lane[];
  junctions: TrunkJunction[];
  diagnostics: string[];
}

/**
 * One apron per lane whose OUTER end sits on a contract entry (spec §5.2).
 *
 * Identification is by proximity to an ENTRY POINT, never by radius from the
 * origin: the fourth failed attempt identified arms by radius and got it
 * wrong in both directions -- `trimTails` cut arms back inside the circle at
 * pop 300, and at pop 40 arms ran past the fabric.
 *
 * Two FMG routes close in bearing can survive as distinct trunks (they were
 * far enough apart AT the contract circle) yet run near-parallel once their
 * aprons continue outward in roughly straight lines -- exactly the
 * `fan` fixture case `trunks-structure.test.ts`'s near-parallel bar exists
 * for, just discovered a stage later. So each apron, as it grows, is
 * checked against every apron ALREADY EMITTED (in id order): the first
 * point that lands within `MERGE_CAPTURE_M` of an earlier apron's polyline
 * truncates this one there and records a junction, exactly as `mergeTrunks`
 * already does for trunks proper. This is not the boundary merge spec 5.1
 * forbids -- every route still gets its own entry point on the circle, at
 * its exact bearing, untouched. The convergence happens OUTSIDE, in the
 * apron, where two routes that close would genuinely meet.
 *
 * Returns only the new lanes (plus any junctions among them). The caller
 * concatenates.
 */
export function growAprons(
  lanes: Lane[], entries: TrunkEntry[], contractRadiusM: number,
): GrownAprons {
  const reachM = apronReachM(contractRadiusM);
  const out: Lane[] = [];
  const junctions: TrunkJunction[] = [];
  // Sorted by id so the outcome can never depend on array position -- the
  // same discipline `rehomeOrphans` and `resolveCrossings` keep.
  for (const lane of [...lanes].sort((a, b) => a.id.localeCompare(b.id))) {
    if (lane.points.length < 2) continue;
    const tip = lane.points[lane.points.length - 1];
    if (!entries.some((e) => dist(e.point, tip) <= ON_ENTRY_M)) continue;
    let points = growApronPath(lane, reachM);
    if (points.length < 2) continue;

    const laneId = apronLaneId(lane.id);
    const captureM = MERGE_CAPTURE_M[lane.type];
    // `[0]` is the lane's own outer vertex -- shared with the trunk, and
    // typically nowhere near another apron -- so the walk starts at [1].
    for (let i = 1; i < points.length; i++) {
      let bestOther: Lane | null = null;
      let bestDistance = Infinity;
      let bestPoint = points[i];
      for (const other of out) {
        const hit = closestPointOnPolyline(points[i], other.points);
        if (hit.distance <= captureM && hit.distance < bestDistance) {
          bestOther = other;
          bestDistance = hit.distance;
          bestPoint = hit.point;
        }
      }
      if (bestOther) {
        points = [...points.slice(0, i), bestPoint];
        const laneIds = [laneId, bestOther.id].sort();
        junctions.push({ id: `j:${laneIds.join('+')}`, position: bestPoint, laneIds });
        break;
      }
    }

    out.push({
      id: laneId,
      type: lane.type,
      widthM: lane.widthM,
      points,
      // Deliberately no parentId: `dressing/fields.ts`'s `exitRoads` skips
      // any lane that has one, and the apron IS the road that leaves the
      // village now, so it is the road the field ring must open for.
      ...(lane.sourceRouteIds ? { sourceRouteIds: lane.sourceRouteIds } : {}),
    });
  }
  return { lanes: out, junctions, diagnostics: [] };
}
