import { createCityModel, createLegacySettlementModel } from './output/legacy-model.js';
import type { GenerateFromBurgResult, GenerateSettlementOptions } from './output/legacy-model.js';
export { createCityModel, createLegacySettlementModel } from './output/legacy-model.js';
export type { GenerateFromBurgResult, GenerateSettlementOptions } from './output/legacy-model.js';
import { planSettlement, type SettlementOptions, type PlannedSettlement } from './settlement/generate.js';
export { planSettlement, createSettlementModel, type SettlementOptions, type PlannedSettlement } from './settlement/generate.js';
export { renderSettlement, exportSettlement, type SettlementGeoJson, type SettlementRenderOptions } from './settlement/output.js';
export type { SettlementModel, SettlementBuilding, SettlementDistrict, ResidentAccount } from './settlement/model.js';
export type { DevelopmentOptions, DevelopmentProfile } from './settlement/development.js';
import { paletteForTheme, type ThemeName } from './output/palette.js';
import type { RenderTheme } from './output/render-theme.js';
export { BIOMES, normaliseBiome, biomeThemeFor } from './appearance/biomes.js';
export type { Biome, BiomeTheme } from './appearance/biomes.js';
export { paletteForTheme } from './output/palette.js';
export type { ThemeName } from './output/palette.js';
import { resolveSettlementEngine } from './input/settlement-engine.js';
export { resolveSettlementEngine, SETTLEMENT_ENGINES } from './input/settlement-engine.js';
export type { SettlementEngine } from './input/settlement-engine.js';
import type { SettlementSkin } from './assets/skins.js';
export { createSkin, skinBiomeFor, SKIN_VERSION, SKIN_SLOTS, SKIN_TOKENS } from './assets/skins.js';
export type { SkinDefinition, SkinStyle, SkinBiome, SkinBaseBiome, SkinGlyph, SettlementSkin } from './assets/skins.js';
export type { VillageRenderOptions } from './village/render.js';
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
export type { AssetSet, GlyphAsset } from './assets/asset-sets.js';

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
import type { FeatureCollection } from 'geojson';
import type { DegradedFlag } from './generator/generation-params.js';
import { generateSvg, type SvgOptions } from './output/svg-builder.js';
import { generateGeoJson, type GenerateGeoJsonOptions } from './output/geojson-builder.js';
import type { OriginShift } from './generator/origin-shift.js';

/**
 * Convenience function: Azgaar burg data → generated model + SVG + GeoJSON.
 */
export function generateFromBurg(
  burg: AzgaarBurgInput,
  options?: { seed?: number; skin?: SettlementSkin; theme?: ThemeName; style?: Partial<RenderTheme>; svg?: SvgOptions; geojson?: GenerateGeoJsonOptions },
): GenerateFromBurgResult {
  const { model, degradedFlags, originShift: shift } = createCityModel(burg, options);
  const skin = options?.skin ?? options?.svg?.skin;
  const skinBiome = options?.svg?.skinBiome ?? burg.biome;
  const svg = generateSvg(model, {
    ...options?.svg, skin, skinBiome, shift,
    palette: options?.svg?.palette ?? (options?.theme !== undefined ? paletteForTheme(options.theme) : undefined),
    theme: { ...options?.svg?.theme, ...options?.style },
  });
  const geojson = generateGeoJson(model, { ...options?.geojson, shift });
  return { model, svg, geojson, degradedFlags, originShift: shift };
}

// ---------------------------------------------------------------------------
// Roads-first village engine. Automatic selection uses VILLAGE_POP_CEILING;
// explicit selection may use either planner at any positive population.
export { generateVillage, VILLAGE_POP_CEILING };

/** Shared result. The city discriminator remains 'settlement' for compatibility. */
export type GenerateSettlementResult =
  | ({ kind: 'village'; model: VillageModel } & {
      waterContextResult?: import('./input/water-context.js').WaterContextResult;
      svg: string;
      geojson: FeatureCollection;
      degradedFlags: DegradedFlag[];
      originShift: OriginShift;
    })
  | ({ kind: 'settlement' } & GenerateFromBurgResult);

export function generateSettlement(burg: AzgaarBurgInput, options: SettlementOptions): PlannedSettlement;
export function generateSettlement(burg: AzgaarBurgInput, options?: GenerateSettlementOptions): GenerateSettlementResult;
export function generateSettlement(
  burg: AzgaarBurgInput,
  options?: GenerateSettlementOptions | SettlementOptions,
): GenerateSettlementResult | PlannedSettlement {
  if (options && 'development' in options) return planSettlement(burg, options);
  if (options?.theme !== undefined) paletteForTheme(options.theme);
  const requestedEngine = options?.engine ?? burg.engine;
  const engine = resolveSettlementEngine(burg.population, requestedEngine);
  validateWaterContext(burg, engine);
  if (engine === 'village') {
    const retained = createLegacySettlementModel(burg, options);
    if (retained.kind !== 'village') throw new Error('Inconsistent village planner selection');
    const { model } = retained;
    const skin = options?.skin ?? options?.svg?.skin;
    const skinBiome = options?.svg?.skinBiome ?? burg.biome;
    return {
      ...retained,
      // A caller's theme is honoured here exactly as `svg.palette`/`theme`
      // are on the settlement branch; without this the same option was
      // silently obeyed for a town and dropped for a village.
      svg: renderVillage(model, options?.village?.pxPerMetre, options?.village?.theme, {
        skin, skinBiome,
        palette: options?.svg?.palette ?? (options?.theme !== undefined ? paletteForTheme(options.theme) : undefined),
        style: { ...options?.svg?.theme, ...options?.style },
      }),
      geojson: generateVillageGeoJson(model),
    };
  }
  return { kind: 'settlement', ...generateFromBurg({ ...burg, engine: requestedEngine }, options) };
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

export { createSettlementSession, BUILD_INFO } from './output/session.js';
export type { SettlementSession, SettlementSessionMetadata, SessionAppearance, SessionViewOptions } from './output/session.js';
export { createSceneIndex } from './scene/spatial-index.js';
export type { SceneIndex } from './scene/spatial-index.js';

export type { GenerationStageTiming, GenerationTimingObserver } from './generator/timing.js';
