// Public API
export { Model } from './generator/model.js';
export { GenerationParams, RoadEntry, RouteKind } from './generator/generation-params.js';
export { Patch } from './generator/patch.js';
export { CurtainWall, GateMeta, GateRouteAssignment } from './generator/curtain-wall.js';

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
import { mapToGenerationParams } from './input/azgaar-input.js';
import { Model } from './generator/model.js';
import { generateSvg, type SvgOptions } from './output/svg-builder.js';
import { generateGeoJson, type GenerateGeoJsonOptions } from './output/geojson-builder.js';

export interface GenerateFromBurgResult {
  model: Model;
  svg: string;
  geojson: FeatureCollection;
}

/**
 * Convenience function: Azgaar burg data → generated model + SVG + GeoJSON.
 */
export function generateFromBurg(
  burg: AzgaarBurgInput,
  options?: { seed?: number; svg?: SvgOptions; geojson?: GenerateGeoJsonOptions },
): GenerateFromBurgResult {
  const params = mapToGenerationParams(burg, options?.seed);
  const model = new Model(params).generate();
  const svg = generateSvg(model, options?.svg);
  const geojson = generateGeoJson(model, options?.geojson);
  return { model, svg, geojson };
}
