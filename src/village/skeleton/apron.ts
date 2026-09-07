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
  APRON_REACH_FACTOR, APRON_REACH_FLOOR_M, APRON_SAMPLE_STEP_M,
} from '../constants.js';
import { signedTurnDeg } from '../geometry.js';
import type { Lane } from '../types.js';

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
