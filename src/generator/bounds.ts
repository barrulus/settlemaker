import type { Model } from './model.js';
import type { Point } from '../types/point.js';
import type { OriginShift } from './origin-shift.js';
import { Castle } from '../wards/castle.js';
import { Harbour } from '../wards/harbour.js';
import { Farm } from '../wards/farm.js';

/** Axis-aligned bounding box in settlement-local coordinates (y-down). */
export interface LocalBounds {
  min_x: number;
  min_y: number;
  max_x: number;
  max_y: number;
}

/**
 * Compute the AABB of every feature that actually renders visible ink in
 * the model — patches with buildings/fields/greens, harbour piers, walls —
 * plus a uniform padding applied to all four sides.
 *
 * Deliberately EXCLUDED:
 *  - Countryside/wilderness patches carrying a bare `Ward` (or no ward at
 *    all): a plain `Ward.geometry` is empty, so it draws nothing. Their
 *    culled radius was widened (radius*3 -> radius*12, see buildWalls) to
 *    give extramural sprawl room to occupy, which otherwise balloons the
 *    frame around empty space.
 *  - Streets, arteries and roads: they still render and are still allowed
 *    to run to (and past) the frame edge — that's existing, documented
 *    product behaviour for external roads — but they no longer dictate the
 *    frame size. They're clipped by the SVG viewBox instead.
 *  - Water patches: for a coastal burg the ocean's synthesised coastline
 *    ring runs out to the (now much larger, radius*12) mesh edge, so
 *    letting water expand the frame squeezes the settlement into a sliver
 *    against one edge with the sea dominating the image. The owner's rule
 *    is "focus on the landward side, just enough water to show the
 *    coastline" — so water fills whatever part of the frame it reaches and
 *    is clipped by `#frame-clip`, but does not itself set the frame. Piers
 *    are built structures and are the one water-adjacent thing that still
 *    expands the frame — they nudge it just far enough seaward that the
 *    waterline stays visible.
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
    const ward = patch.ward;
    const hasPiers = ward instanceof Harbour && ward.piers.length > 0;
    const hasFields = ward instanceof Farm && ward.subPlots.length > 0;
    const hasGeometry = ward !== null && ward.geometry.length > 0;
    if (!hasGeometry && !hasFields && !hasPiers) continue;

    for (const v of patch.shape.vertices) expand(v);
    if (hasPiers) {
      for (const pier of (ward as Harbour).piers) {
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
