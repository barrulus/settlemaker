import { validateWaterContext } from './input/water-context.js';
export { WaterContextError } from './input/water-context.js';
export type { WaterContextV1, WaterContextResult, WaterIssueCode } from './input/water-context.js';
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
export { declaredMetersPerUnit } from './output/settlement-tiler.js';
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

export { SCHEMATIC_SET, REFINED_SET, SETTLEMENT_SET, assetSetFor } from './assets/asset-sets.js';
export type { AssetSet } from './assets/asset-sets.js';

export {
  URL_PAYLOAD_VERSION, UrlCodecError,
  encodeBurgParam, decodeBurgParam, encodeJsonParam, decodeJsonParam,
} from './url/codec.js';
export type { UrlCodecFailure } from './url/codec.js';

export { parseSettlementUrl } from './url/params.js';
export type { ParsedSettlementUrl } from './url/params.js';

import type { AzgaarBurgInput } from './input/azgaar-input.js';

// Phase 5: the village engine, imported (not merely re-exported) so
// `generateSettlement` below can call it.
import { generateVillage, VILLAGE_POP_CEILING } from './village/village-model.js';
import { renderVillage } from './village/render.js';
import { generateVillageGeoJson } from './village/geojson.js';
import type { VillageModel } from './village/types.js';
import type { VillageTheme } from './village/theme.js';
import type { FeatureCollection } from 'geojson';
import type { DegradedFlag } from './generator/generation-params.js';
import { mapToGenerationParams } from './input/azgaar-input.js';
import { Model } from './generator/model.js';
import { generateSvg, type SvgOptions } from './output/svg-builder.js';
import { generateGeoJson, type GenerateGeoJsonOptions } from './output/geojson-builder.js';
import { Point } from './types/point.js';
import { computeOriginShift, NO_SHIFT, type OriginShift } from './generator/origin-shift.js';

export interface GenerateFromBurgResult {
  waterContextResult?: import('./input/water-context.js').WaterContextResult;
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
  if (Object.hasOwn(burg, 'waterContext')) {
    validateWaterContext({ ...burg, population: 1001 });
  }
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
// Roads-first village engine.
//
// Small settlements are generated by `src/village/`, which solves lanes,
// parcels and dwellings directly rather than partitioning a disc into wards.
// It is NO LONGER opt-in: `generateSettlement` below routes to it by
// population at `VILLAGE_POP_CEILING`, and it emits both outputs the
// consumers speak (themed SVG and GeoJSON at the shared schema version).
// The individual pieces stay exported for callers that want one engine
// explicitly.
export { generateVillage, VILLAGE_POP_CEILING };

/**
 * Ship plan Phase 5 — the ONE entry point.
 *
 * Two engines now exist: the village engine for the small end and the
 * original settlement generator above it. A caller should not have to know
 * that. They hand over a burg and get a settlement back; which engine ran is
 * reported on `kind` for diagnostics, but it is never something they choose.
 *
 * The boundary is `VILLAGE_POP_CEILING`, INCLUSIVE — a population of exactly
 * 1000 is the top of the band the village engine serves, which is what
 * "ceiling" means. The plan's prose ("below -> village, above -> existing")
 * leaves the boundary value itself unsaid, so it is pinned here and in the
 * test rather than left to whoever reads it next.
 */
export type GenerateSettlementResult =
  | ({ kind: 'village'; model: VillageModel } & {
      waterContextResult?: import('./input/water-context.js').WaterContextResult;
      svg: string;
      geojson: FeatureCollection;
      degradedFlags: DegradedFlag[];
      originShift: OriginShift;
    })
  | ({ kind: 'settlement' } & GenerateFromBurgResult);

export function generateSettlement(
  burg: AzgaarBurgInput,
  options?: {
    seed?: number;
    /** Settlement branch only — `SvgOptions` describes the city renderer's
     * palette/symbol pipeline, which the village renderer does not share. */
    svg?: SvgOptions;
    /** Settlement branch only. */
    geojson?: GenerateGeoJsonOptions;
    /** Village branch only. Named separately rather than folded into `svg`
     * so the compiler rejects an option the chosen engine cannot honour,
     * instead of the option being silently dropped. */
    village?: { pxPerMetre?: number; theme?: VillageTheme };
  },
): GenerateSettlementResult {
  validateWaterContext(burg);
  if ((burg.population ?? 0) <= VILLAGE_POP_CEILING) {
    // The seed default MUST match the settlement branch's, which is
    // `hashString(burg.name)` inside `mapToGenerationParams`. Hard-coding 1
    // here made every unseeded village with the same route/population shape
    // the SAME village, and no amount of regenerating an FMG map could
    // change it. Derived through `mapToGenerationParams` rather than
    // re-implementing the hash, so the two branches cannot drift apart.
    const seed = options?.seed ?? mapToGenerationParams(burg).seed;
    const model = generateVillage(burg, seed);
    return {
      kind: 'village',
      model,
      ...(model.site.waterContextResult ? { waterContextResult: model.site.waterContextResult } : {}),
      // A caller's theme is honoured here exactly as `svg.palette`/`theme`
      // are on the settlement branch; without this the same option was
      // silently obeyed for a town and dropped for a village.
      svg: renderVillage(model, options?.village?.pxPerMetre, options?.village?.theme),
      geojson: generateVillageGeoJson(model),
      // The village engine degrades nothing: it has no walls or citadel to
      // drop. Present and empty so a consumer reads it the same either way.
      degradedFlags: [],
      // The village never pre-shifts a coast toward the origin, but the field
      // is always defined on the settlement branch — so define it here too
      // rather than make callers test for its absence.
      originShift: NO_SHIFT,
    };
  }
  return { kind: 'settlement', ...generateFromBurg(burg, options) };
}
export { renderVillage };
// Phase 4 (output parity): the village's GeoJSON, in the same
// `layer`-discriminated schema and at the same `schema_version` as the city
// builder's, so an existing consumer needs no new branch to read a village.
export { generateVillageGeoJson };
// Phase 4 (theming): a village's ground follows its biome, because the glyph
// set already resolves desert/tundra/tropical/coastal dwellings. Consumers can
// pass their own theme to `renderVillage` for a night scene or a snow one.
export {
  villageThemeFor, normaliseVillageBiome,
  TEMPERATE_THEME, VILLAGE_BIOMES, type VillageTheme, type VillageBiome,
} from './village/theme.js';
// Exported so a consumer that builds a VillageTheme from its own untrusted
// input can apply the same gate the renderer does. Callers do NOT need to
// call it — `renderVillage` sanitizes what it is given regardless.
export { sanitizeVillageTokens } from './village/render.js';
export type {
  Site, SiteRoute, Green, GreenShape, Lane, Lot, Building, Croft, EdgeStyle, EdgeStamp,
  FieldBlock, Vegetation,
  VillageModel,
} from './village/types.js';
// The village's own `Poi` collides with the generator's existing `Poi`
// (./poi/poi-kinds.js) exported above — aliased so both can be named.
export type { Poi as VillagePoi } from './village/types.js';
// ROUTE_CLASS_ORDER is exported as a VALUE, not just a type: it is exactly
// what `roads=` validates against, and a consumer building a road picker had
// to hardcode the seven classes without it. Same reason VILLAGE_BIOMES is
// exported — the builder page reads both rather than keeping its own copy.
export { ROUTE_CLASS_ORDER } from './village/route-class.js';
export type { RouteType } from './village/route-class.js';
export type { DeckEntry } from './village/deck.js';

export { ARTWORK_GLYPHS, ARTWORK_MANIFEST, ARTWORK_INK } from './assets/artwork.js';
