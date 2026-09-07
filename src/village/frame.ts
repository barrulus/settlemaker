/**
 * THE DRAWN TILE (spec 2026-09-07 §7).
 *
 * `render.ts` used to bound-box everything it was handed, lanes included,
 * and add a 40 m pad. That made "run the roads to the edge" impossible: every
 * metre of extension pushed the frame one metre further ahead of the road.
 *
 * The resolution is to make the apron the one thing EXCLUDED from the box
 * and the one thing CLIPPED to it. There is no fixed point to chase, and the
 * frame of a village that gains nothing else is unchanged.
 */
import { Point } from '../types/point.js';
import { FRAME_PAD_M } from './constants.js';
import { clipPolylineToRect } from './geometry.js';
import { isApron, type Frame, type Lane } from './types.js';

export interface FrameParts {
  lanes: Lane[];
  buildings: Point[];
  greenCentre: Point;
  /** Field vertices, edge stamps, vegetation and POI positions. */
  dressing: Point[];
}

/** The tile: everything that paints, EXCEPT aprons, padded by
 * `FRAME_PAD_M`. */
export function computeFrame(parts: FrameParts): Frame {
  const xs: number[] = [parts.greenCentre.x];
  const ys: number[] = [parts.greenCentre.y];
  const take = (p: Point): void => { xs.push(p.x); ys.push(p.y); };
  for (const b of parts.buildings) take(b);
  for (const p of parts.dressing) take(p);
  for (const lane of parts.lanes) {
    if (isApron(lane.id)) continue;
    for (const p of lane.points) take(p);
  }
  return {
    minX: Math.min(...xs) - FRAME_PAD_M,
    minY: Math.min(...ys) - FRAME_PAD_M,
    maxX: Math.max(...xs) + FRAME_PAD_M,
    maxY: Math.max(...ys) + FRAME_PAD_M,
  };
}

/**
 * Every apron cut to the frame; every other lane untouched.
 *
 * An apron whose first point is already outside the frame cannot happen
 * while the fabric reaches past the contract circle -- which it does on every
 * measured seed -- and is dropped rather than shipped as a road that starts
 * off-picture. `generateVillage` records a diagnostic when it does.
 */
export function clipApronsToFrame(lanes: Lane[], frame: Frame): Lane[] {
  const out: Lane[] = [];
  for (const lane of lanes) {
    if (!isApron(lane.id)) { out.push(lane); continue; }
    const points = clipPolylineToRect(lane.points, frame);
    if (points.length >= 2) out.push({ ...lane, points });
  }
  return out;
}
