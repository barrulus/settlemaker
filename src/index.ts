// Public API
export { Model } from './generator/model.js';
export { GenerationParams, RoadEntry, RouteKind, DegradedFlag } from './generator/generation-params.js';
export { Patch } from './generator/patch.js';
export { CurtainWall, GateMeta, GateRouteAssignment } from './generator/curtain-wall.js';
export type { OriginShift } from './generator/origin-shift.js';

export { AzgaarBurgInput, RoadBearingInput, mapToGenerationParams } from './input/azgaar-input.js';
export { Harbour } from './wards/harbour.js';

export { generateSvg, SvgOptions } from './output/svg-builder.js';
export {
  generateGeoJson,
  GenerateGeoJsonOptions,
  GEOJSON_SCHEMA_VERSION,
  SETTLEMAKER_VERSION,
} from './output/geojson-builder.js';
export {
  parseSvgViewBox,
  computeSettlementScale,
  computeTileInfo,
  cropSvgToTile,
  enumerateTiles,
  totalTileCount,
} from './output/settlement-tiler.js';
export type {
  SvgViewBox,
  SettlementScale,
  TileInfo,
  TileCoord,
} from './output/settlement-tiler.js';

export { Palette, WardType, Street } from './types/interfaces.js';
export { PALETTES, PALETTE_DEFAULT } from './output/palette.js';

export { Point } from './types/point.js';
export { Polygon } from './geom/polygon.js';
export { SeededRandom } from './utils/random.js';

export { computeLocalBounds, computeDiameterLocal } from './generator/bounds.js';
export type { LocalBounds } from './generator/bounds.js';

export type { Poi, PoiKind } from './poi/poi-kinds.js';

import type { AzgaarBurgInput } from './input/azgaar-input.js';
import type { FeatureCollection } from 'geojson';
import type { DegradedFlag } from './generator/generation-params.js';
import { mapToGenerationParams } from './input/azgaar-input.js';
import { Model } from './generator/model.js';
import { generateSvg, type SvgOptions } from './output/svg-builder.js';
import { generateGeoJson, type GenerateGeoJsonOptions } from './output/geojson-builder.js';
import { Point } from './types/point.js';
import { computeOriginShift, NO_SHIFT, type OriginShift } from './generator/origin-shift.js';

export interface GenerateFromBurgResult {
  model: Model;
  svg: string;
  geojson: FeatureCollection;
  /**
   * Input flags that settlemaker was forced to disable because the requested
   * feature wasn't geometrically feasible (e.g. walls on a population-50
   * hamlet, citadel on a very non-compact patch). Sorted, stable order so
   * consumer persistence is deterministic.
   */
  degradedFlags: DegradedFlag[];
  /**
   * Translation from Model-internal frame → output frame. Always defined;
   * `source === 'none'` with `{dx: 0, dy: 0}` means no shift was applied
   * (inland burg, no coastline, or hysteresis gate not cleared). When
   * `source === 'coast_pull'`, settlemaker has pulled the output toward
   * the caller's coastline to close the wall-to-coast visual gap.
   */
  originShift: OriginShift;
}

/**
 * Convenience function: Azgaar burg data → generated model + SVG + GeoJSON.
 */
export function generateFromBurg(
  burg: AzgaarBurgInput,
  options?: { seed?: number; svg?: SvgOptions; geojson?: GenerateGeoJsonOptions },
): GenerateFromBurgResult {
  const paramsPass1 = mapToGenerationParams(burg, options?.seed);

  // Pass 1: minimal probe for wallRadius. Strip coastlineGeometry + harbourSize
  // so classifyWater and placeHarbour are skipped — neither influences the
  // border radius.
  const paramsRadiusProbe = {
    ...paramsPass1,
    coastlineGeometry: undefined,
    harbourSize: undefined,
  };
  const radiusProbe = new Model(paramsRadiusProbe).generate();
  const wallRadius = radiusProbe.border!.getRadius();

  // Compute shift from ORIGINAL coastline + pass-1 wallRadius.
  const shift: OriginShift =
    computeOriginShift(paramsPass1.coastlineGeometry, wallRadius) ?? NO_SHIFT;

  // Pass 2: apply pre-shift to coastlineGeometry so the Model sees water
  // near origin. Model internals stay (0,0)-centred and untouched.
  // For 'none' (no coast / inside water / close enough) and 'coast_too_far'
  // (polygon beyond MAX_SHIFT_MULTIPLIER, declined) the coastline is passed
  // through unchanged — dx/dy are both 0 so the pre-shift would be a no-op
  // either way, but we skip the allocation for clarity.
  const paramsPass2 = shift.source === 'coast_pull'
    ? {
        ...paramsPass1,
        coastlineGeometry: paramsPass1.coastlineGeometry?.map(ring =>
          ring.map(p => new Point(p.x - shift.dx, p.y - shift.dy)),
        ),
      }
    : paramsPass1;
  const model = new Model(paramsPass2).generate();

  const svg = generateSvg(model, options?.svg);
  const geojson = generateGeoJson(model, { ...options?.geojson, shift });
  const degradedFlags = [...model.degradedFlags].sort() as DegradedFlag[];
  return { model, svg, geojson, degradedFlags, originShift: shift };
}
