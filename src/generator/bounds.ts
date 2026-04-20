import type { Model } from './model.js';
import type { Point } from '../types/point.js';

/** Axis-aligned bounding box in settlement-local coordinates (y-down). */
export interface LocalBounds {
  min_x: number;
  min_y: number;
  max_x: number;
  max_y: number;
}

/**
 * Compute the AABB of every geometrically-placed feature in the model —
 * patches, walls, streets/arteries/roads, harbour piers — plus a uniform
 * padding applied to all four sides.
 *
 * Both the SVG viewBox and the GeoJSON `metadata.local_bounds` derive from
 * this so they cannot drift. Pass the same padding to both callers.
 */
export function computeLocalBounds(model: Model, padding = 20): LocalBounds {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  const expand = (p: Point) => {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  };

  for (const patch of model.patches) {
    for (const v of patch.shape.vertices) expand(v);
  }
  if (model.wall !== null) {
    for (const v of model.wall.shape.vertices) expand(v);
  }
  if (model.border !== null) {
    for (const v of model.border.shape.vertices) expand(v);
  }
  for (const artery of model.arteries) {
    for (const v of artery.vertices) expand(v);
  }
  for (const road of model.roads) {
    for (const v of road.vertices) expand(v);
  }
  for (const street of model.streets) {
    for (const v of street.vertices) expand(v);
  }

  return {
    min_x: minX - padding,
    min_y: minY - padding,
    max_x: maxX + padding,
    max_y: maxY + padding,
  };
}
