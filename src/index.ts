// Public API
export { Model } from './generator/model.js';
export type { GenerationParams, RoadEntry, RouteKind, RouteRelief, DegradedFlag } from './generator/generation-params.js';
export { Patch } from './generator/patch.js';
export { CurtainWall } from './generator/curtain-wall.js';
export type { GateMeta, GateRouteAssignment } from './generator/curtain-wall.js';
export type { OriginShift } from './generator/origin-shift.js';

export type { AzgaarBurgInput, RoadBearingInput } from './input/azgaar-input.js';
export { mapToGenerationParams } from './input/azgaar-input.js';
export { Harbour } from './wards/harbour.js';

export { generateSvg } from './output/svg-builder.js';
export type { SvgOptions } from './output/svg-builder.js';
export {
  generateGeoJson,
  GEOJSON_SCHEMA_VERSION,
  SETTLEMAKER_VERSION,
} from './output/geojson-builder.js';
export type { GenerateGeoJsonOptions } from './output/geojson-builder.js';
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

export { WardType } from './types/interfaces.js';
export type { Palette, Street } from './types/interfaces.js';
export { PALETTES, PALETTE_DEFAULT, paletteForBiome } from './output/palette.js';
export { themeFrom } from './output/render-theme.js';
export type { RenderTheme } from './output/render-theme.js';

export { Point } from './types/point.js';
export { Polygon } from './geom/polygon.js';
export { SeededRandom } from './utils/random.js';

export { computeLocalBounds, computeDiameterLocal } from './generator/bounds.js';
export type { LocalBounds } from './generator/bounds.js';

export type { Poi, PoiKind } from './poi/poi-kinds.js';

export { SCENE_VERSION } from './scene/scene.js';
export type {
  Scene, ScenePoint, WaterLayer, FieldPlot, Furrow, GreenFeature,
  VegetationInstance, RoadFeature, BuildingFeature, PierFeature,
  WallFeature, WallGate,
} from './scene/scene.js';
export { buildScene } from './scene/build-scene.js';
export type { BuildSceneOptions } from './scene/build-scene.js';

export { assembleSvg, themeToCss } from './output/assemble-svg.js';
export type { AssembleOptions } from './output/assemble-svg.js';

export { SCHEMATIC_SET, assetSetFor } from './assets/asset-sets.js';
export type { AssetSet } from './assets/asset-sets.js';

export {
  URL_PAYLOAD_VERSION, UrlCodecError,
  encodeBurgParam, decodeBurgParam, encodeJsonParam, decodeJsonParam,
} from './url/codec.js';
export type { UrlCodecFailure } from './url/codec.js';

export { parseSettlementUrl } from './url/params.js';
export type { ParsedSettlementUrl } from './url/params.js';

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
  const wallRadius = new Model(paramsRadiusProbe).probeWallRadius();

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

  const svg = generateSvg(model, { ...options?.svg, shift });
  const geojson = generateGeoJson(model, { ...options?.geojson, shift });
  const degradedFlags = [...model.degradedFlags].sort() as DegradedFlag[];
  return { model, svg, geojson, degradedFlags, originShift: shift };
}

// ---------------------------------------------------------------------------
// Roads-first village engine — EXPLICIT OPT-IN, not yet wired to any threshold
// ---------------------------------------------------------------------------
//
// The village engine (src/village/) generates hamlets and villages by solving a
// road skeleton and dressing it with parcels, rather than by partitioning
// polygons the way `Model` above does. It is exported here so a caller can
// invoke it deliberately and look at the result.
//
// It is deliberately NOT routed by population yet. `VILLAGE_POP_CEILING`
// records the band it is designed for, but switching burgs onto it
// automatically would hand callers an engine that does not yet emit GeoJSON,
// does not paint through the theme/palette system, and has no pass 5 (crofts,
// fields, vegetation, POIs) — so a village renders as buildings and roads on
// bare ground. Those are missing capabilities, not compatibility concerns.
// Wire the threshold once they exist.
export { generateVillage, VILLAGE_POP_CEILING } from './village/village-model.js';
export { renderVillage } from './village/render.js';
export type {
  Site, SiteRoute, Green, GreenShape, Lane, Lot, Building, Croft, EdgeStyle, EdgeStamp,
  FieldBlock, Vegetation,
  VillageModel,
} from './village/types.js';
// The village's own `Poi` collides with the generator's existing `Poi`
// (./poi/poi-kinds.js) exported above — aliased so both can be named.
export type { Poi as VillagePoi } from './village/types.js';
export type { RouteType } from './village/route-class.js';
export type { DeckEntry } from './village/deck.js';
