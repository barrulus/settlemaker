import type { LocalBounds } from '../generator/bounds.js';

/** Shared broadphase bounds for both mutable placement and immutable rendering.
 * Empty input keeps an empty (infinite/inverted) box and matches no finite query. */
export function boundsOfPoints(points: ReadonlyArray<{ x: number; y: number }>, padding = 0): LocalBounds {
  let min_x = Infinity, min_y = Infinity, max_x = -Infinity, max_y = -Infinity;
  for (const p of points) {
    min_x = Math.min(min_x, p.x); min_y = Math.min(min_y, p.y);
    max_x = Math.max(max_x, p.x); max_y = Math.max(max_y, p.y);
  }
  return { min_x: min_x-padding, min_y: min_y-padding, max_x: max_x+padding, max_y: max_y+padding };
}
