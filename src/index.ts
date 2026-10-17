/** Public API: one physical settlement model, renderer and export contract. */
export {
  planSettlement, planSettlement as generateSettlement, createSettlementModel,
} from './settlement/generate.js';
export type {
  SettlementOptions, GenerateSettlementOptions, PlannedSettlement,
  PlannedSettlement as GenerateSettlementResult,
} from './settlement/generate.js';
export { renderSettlement, exportSettlement } from './settlement/output.js';
export type { SettlementGeoJson, SettlementRenderOptions } from './settlement/output.js';
export type { SettlementModel, SettlementBuilding, SettlementDistrict, SettlementPlacement, ResidentAccount } from './settlement/model.js';
export type { DevelopmentOptions, DevelopmentProfile } from './settlement/development.js';

export { BIOMES, normaliseBiome, biomeThemeFor } from './appearance/biomes.js';
export type { Biome, BiomeTheme } from './appearance/biomes.js';
export { paletteForTheme, PALETTES, PALETTE_DEFAULT, paletteForBiome } from './output/palette.js';
export type { ThemeName } from './output/palette.js';
export { themeFrom } from './output/render-theme.js';
export type { RenderTheme } from './output/render-theme.js';
export type { Palette } from './types/interfaces.js';
export { resolveSettlementEngine, SETTLEMENT_ENGINES, VILLAGE_POP_CEILING } from './input/settlement-engine.js';
export type { SettlementEngine } from './input/settlement-engine.js';
export type { AzgaarBurgInput, RoadBearingInput } from './input/azgaar-input.js';
export { seedFromString } from './input/azgaar-input.js';
export type { DegradedFlag } from './generator/generation-params.js';
export { WaterContextError } from './input/water-context.js';
export type { WaterContextV1, WaterContextResult, WaterIssueCode } from './input/water-context.js';
export { ROUTE_CLASS_ORDER } from './village/route-class.js';
export type { RouteType } from './village/route-class.js';

export { createSkin, skinBiomeFor, SKIN_VERSION, SKIN_SLOTS, SKIN_TOKENS } from './assets/skins.js';
export type { SkinDefinition, SkinStyle, SkinBiome, SkinBaseBiome, SkinGlyph, SettlementSkin } from './assets/skins.js';
export { SCHEMATIC_SET, REFINED_SET, SETTLEMENT_SET, assetSetFor } from './assets/asset-sets.js';
export type { AssetSet, GlyphAsset } from './assets/asset-sets.js';
export { ARTWORK_GLYPHS, ARTWORK_MANIFEST, ARTWORK_INK } from './assets/artwork.js';

export { SETTLEMAKER_VERSION } from './version.js';
export {
  parseSvgViewBox, computePhysicalTileInfo as computeTileInfo, cropSvgToTile,
  enumerateTiles, totalTileCount, declaredMetersPerUnit,
} from './output/settlement-tiler.js';
export type { SvgViewBox, TileInfo, TileCoord } from './output/settlement-tiler.js';
export type { LocalBounds } from './generator/bounds.js';
export { Point } from './types/point.js';
export { Polygon } from './geom/polygon.js';
export { SeededRandom } from './utils/random.js';

export { SCENE_VERSION } from './scene/scene.js';
export type {
  Scene, ScenePoint, WaterLayer, FieldPlot, Furrow, GreenFeature, HarbourFeature,
  VegetationInstance, RoadFeature, BuildingFeature, PierFeature,
  WallFeature, WallGate,
} from './scene/scene.js';
export { assembleSvg, themeToCss } from './output/assemble-svg.js';
export type { AssembleOptions } from './output/assemble-svg.js';
export { createSceneIndex } from './scene/spatial-index.js';
export type { SceneIndex } from './scene/spatial-index.js';

export {
  URL_PAYLOAD_VERSION, UrlCodecError,
  encodeBurgParam, decodeBurgParam, encodeJsonParam, decodeJsonParam,
} from './url/codec.js';
export type { UrlCodecFailure } from './url/codec.js';
export { parseSettlementUrl } from './url/params.js';
export type { ParsedSettlementUrl } from './url/params.js';

export { createSettlementSession, BUILD_INFO } from './output/session.js';
export type { SettlementSession, SettlementSessionMetadata, SessionAppearance, SessionViewOptions } from './output/session.js';
export type { GenerationStageTiming, GenerationTimingObserver } from './generator/timing.js';
