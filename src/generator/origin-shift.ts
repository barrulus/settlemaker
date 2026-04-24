import { Point } from '../types/point.js';
import { pointInPolygon } from '../geom/point-in-polygon.js';

export const SHIFT_FACTOR = 0.4;
export const SHIFT_HYSTERESIS = 0.1;

export type OriginShiftSource = 'coast_pull' | 'none';

export interface OriginShift {
  dx: number;
  dy: number;
  source: OriginShiftSource;
}

export const NO_SHIFT: OriginShift = { dx: 0, dy: 0, source: 'none' };

export interface NearestEdge {
  distance: number;
  /** Unit vector from origin toward the closest coastline point. */
  bearing: Point;
}

/**
 * Find the closest point on any coastline edge to local origin (0,0).
 * Returns `{ distance: 0, bearing: (0,0) }` when origin is inside a polygon.
 * Returns `null` when the coastline is empty.
 */
export function nearestCoastEdge(coastline: Point[][] | undefined): NearestEdge | null {
  if (!coastline || coastline.length === 0) return null;

  const origin = new Point(0, 0);
  for (const ring of coastline) {
    if (ring.length >= 3 && pointInPolygon(origin, ring)) {
      return { distance: 0, bearing: new Point(0, 0) };
    }
  }

  let bestDistSq = Infinity;
  let bestPoint: Point | null = null;
  for (const ring of coastline) {
    const n = ring.length;
    if (n < 2) continue;
    for (let i = 0; i < n; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % n];
      const p = closestPointOnSegment(a, b);
      const dSq = p.x * p.x + p.y * p.y;
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        bestPoint = p;
      }
    }
  }
  if (bestPoint === null) return null;
  const distance = Math.sqrt(bestDistSq);
  const bearing = distance === 0
    ? new Point(0, 0)
    : new Point(bestPoint.x / distance, bestPoint.y / distance);
  return { distance, bearing };
}

/**
 * Compute the origin shift needed to pull the wall toward the coast.
 * Returns null when no shift should be applied (no coastline, origin in
 * water, or hysteresis gate not cleared).
 */
export function computeOriginShift(
  coastline: Point[][] | undefined,
  wallRadius: number,
): OriginShift | null {
  const edge = nearestCoastEdge(coastline);
  if (edge === null) return null;
  if (edge.distance === 0) return null;
  const gate = wallRadius * SHIFT_FACTOR * (1 + SHIFT_HYSTERESIS);
  if (edge.distance <= gate) return null;
  const magnitude = edge.distance - wallRadius * SHIFT_FACTOR;
  return {
    dx: edge.bearing.x * magnitude,
    dy: edge.bearing.y * magnitude,
    source: 'coast_pull',
  };
}

/**
 * Translate a Model-frame point into the output frame. Centralises every
 * coord emission so "forgot to shift" becomes a grep-able omission rather
 * than a silent rendering bug.
 */
export function applyOutputShift(x: number, y: number, shift: OriginShift): [number, number] {
  return [x + shift.dx, y + shift.dy];
}

function closestPointOnSegment(a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return new Point(a.x, a.y);
  const t = Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / lenSq));
  return new Point(a.x + t * dx, a.y + t * dy);
}
