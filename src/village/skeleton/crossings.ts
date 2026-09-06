/**
 * Phase 3: where lanes cross water.
 *
 * The village is now free to sit ON a stream rather than being shoved aside
 * by it (see `NARROW_WATER_M`), which is what a real village does — so its
 * roads cross the water, and each crossing must be a recorded fact on the
 * model instead of a silent overlap. Full bridge geometry is the parked
 * rivers work's job; this only says where one would go.
 */
import { Point } from '../../types/point.js';
import { NARROW_WATER_M } from '../constants.js';
import { bearingOf, dist, inAnyWater } from '../geometry.js';
import type { Lane, WaterCrossing } from '../types.js';

/** Metres between samples when walking a lane looking for water. Fine
 * enough that a 4 m stream cannot be stepped over unnoticed. */
const WALK_STEP_M = 1;

export function findWaterCrossings(lanes: Lane[], water: Point[][]): WaterCrossing[] {
  if (water.length === 0) return [];
  const out: WaterCrossing[] = [];

  for (const lane of [...lanes].sort((a, b) => a.id.localeCompare(b.id))) {
    if (lane.points.length < 2) continue;
    let k = 0;
    let runStart: Point | null = null;
    let runEnd: Point | null = null;

    const close = (): void => {
      if (!runStart || !runEnd) return;
      const spanM = dist(runStart, runEnd);
      if (spanM > 0) {
        out.push({
          id: `bridge:${lane.id}:${k}`,
          laneId: lane.id,
          position: new Point((runStart.x + runEnd.x) / 2, (runStart.y + runEnd.y) / 2),
          bearingDeg: bearingOf(runStart, runEnd),
          spanM,
          narrow: spanM <= NARROW_WATER_M,
        });
        k += 1;
      }
      runStart = null;
      runEnd = null;
    };

    for (let i = 1; i < lane.points.length; i++) {
      const a = lane.points[i - 1];
      const b = lane.points[i];
      const steps = Math.max(1, Math.ceil(dist(a, b) / WALK_STEP_M));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const p = new Point(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
        if (inAnyWater(p, water)) {
          if (!runStart) runStart = p;
          runEnd = p;
        } else {
          close();
        }
      }
    }
    close();
  }
  return out;
}
