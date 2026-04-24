import type { Model } from './model.js';
import type { Point } from '../types/point.js';
import type { OriginShift } from './origin-shift.js';
import { Castle } from '../wards/castle.js';
import { Harbour } from '../wards/harbour.js';

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
export function computeLocalBounds(model: Model, padding = 20, shift?: OriginShift): LocalBounds {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  const expand = (p: Point) => {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  };

  for (const patch of model.patches) {
    for (const v of patch.shape.vertices) expand(v);
    if (patch.ward instanceof Harbour) {
      for (const pier of patch.ward.piers) {
        for (const v of pier.vertices) expand(v);
      }
    }
  }
  if (model.wall !== null) {
    for (const v of model.wall.shape.vertices) expand(v);
  }
  if (model.border !== null) {
    for (const v of model.border.shape.vertices) expand(v);
  }
  if (model.citadel !== null && model.citadel.ward instanceof Castle) {
    for (const v of model.citadel.ward.wall.shape.vertices) expand(v);
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

  const raw: LocalBounds = {
    min_x: minX - padding,
    min_y: minY - padding,
    max_x: maxX + padding,
    max_y: maxY + padding,
  };
  if (shift && (shift.dx !== 0 || shift.dy !== 0)) {
    return {
      min_x: raw.min_x + shift.dx,
      min_y: raw.min_y + shift.dy,
      max_x: raw.max_x + shift.dx,
      max_y: raw.max_y + shift.dy,
    };
  }
  return raw;
}

/**
 * Diameter (in local units) of the smallest origin-centred circle enclosing
 * the settlement's outer perimeter. Divided into `diameter_meters` (from the
 * population heuristic) this yields a tile-geometry-independent
 * `meters_per_unit` ratio.
 *
 * `model.border` always exists post-`buildWalls()`, for both walled and
 * unwalled burgs. Throws if called before generation completes.
 */
export function computeDiameterLocal(model: Model): number {
  if (model.border === null) {
    throw new Error('computeDiameterLocal called before buildWalls()');
  }
  let maxR = 0;
  for (const v of model.border.shape.vertices) {
    if (v.length > maxR) maxR = v.length;
  }
  return maxR * 2;
}
