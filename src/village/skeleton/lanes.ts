import { Point } from '../../types/point.js';
import { SeededRandom } from '../../utils/random.js';
import { laneWidth } from '../route-class.js';
import { bearingVector } from '../geometry.js';
import { LANE_SAMPLE_STEP_M, LANE_WANDER_M } from '../constants.js';
import { armLaneId, type Green, type Lane, type Site, type SiteRoute } from '../types.js';

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

/**
 * Every incoming route becomes an arm leaving the green at its bearing.
 * A `through` route also leaves on the far side — it passes across the
 * green rather than stopping at it, which is what later makes a single
 * through route swell into the lens-shaped green: the road passes through
 * and the green is a swelling of it.
 */
export function buildArms(
  site: Site, green: Green, extentM: number, rng: SeededRandom,
): Lane[] {
  const lanes: Lane[] = [];
  const emit = (r: SiteRoute, bearingDeg: number): void => {
    lanes.push({
      id: armLaneId(bearingDeg),
      type: r.type,
      points: runArm(green, bearingDeg, extentM, rng),
      widthM: laneWidth(r.type),
    });
  };
  for (const r of site.routes) {
    emit(r, r.bearingDeg);
    if (r.through) emit(r, (r.bearingDeg + 180) % 360);
  }
  return lanes;
}
