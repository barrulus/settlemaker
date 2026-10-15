import type { AzgaarBurgInput } from '../input/azgaar-input.js';
import { mapToGenerationParams } from '../input/azgaar-input.js';
import { Model } from '../generator/model.js';
import type { DegradedFlag } from '../generator/generation-params.js';
import { Point } from '../types/point.js';
import { computeOriginShift, NO_SHIFT, type OriginShift } from '../generator/origin-shift.js';
import { validateWaterContext } from '../input/water-context.js';
import { resolveSettlementEngine, type SettlementEngine } from '../input/settlement-engine.js';
import { paletteForTheme, type ThemeName } from './palette.js';
import type { RenderTheme } from './render-theme.js';
import { skinBiomeFor, type SettlementSkin } from '../assets/skins.js';
import type { SvgOptions } from './svg-builder.js';
import type { GenerateGeoJsonOptions } from './geojson-builder.js';
import { generateVillage } from '../village/village-model.js';
import type { VillageTheme } from '../village/theme.js';
import type { FeatureCollection } from 'geojson';

export interface GenerateFromBurgResult {
  waterContextResult?: import('../input/water-context.js').WaterContextResult;
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

export function createCityModel(
  burg: AzgaarBurgInput,
  options?: { seed?: number; skin?: SettlementSkin; theme?: ThemeName; style?: Partial<RenderTheme>; svg?: SvgOptions; geojson?: GenerateGeoJsonOptions },
): Omit<GenerateFromBurgResult, 'svg' | 'geojson'> {
  validateWaterContext(burg, 'city');
  if (options?.theme !== undefined) paletteForTheme(options.theme);
  const skin = options?.skin ?? options?.svg?.skin;
  const skinBiome = options?.svg?.skinBiome ?? burg.biome;
  const effectiveBurg = skin ? { ...burg, biome: skinBiomeFor(skin, skinBiome).base } : burg;
  const paramsPass1 = mapToGenerationParams(effectiveBurg, options?.seed);

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

  const degradedFlags = [...model.degradedFlags].sort() as DegradedFlag[];
  return { model, degradedFlags, originShift: shift };
}

export interface GenerateSettlementOptions {
  seed?: number;
  /** Overrides burg.engine; auto retains the population-based selection. */
  engine?: SettlementEngine;
  /** Named colour treatment shared by both engines; omitted uses natural biome colours. */
  theme?: ThemeName;
  /** Shared colour overrides, applied after the palette and skin. */
  style?: Partial<RenderTheme>;
  /** One skin for both village and city generation/rendering. */
  skin?: SettlementSkin;
  /** Palette/theme/skin also apply to villages. Other SVG settings are city-specific. */
  svg?: SvgOptions;
  /** City GeoJSON options; village metadata uses its physical model scale. */
  geojson?: GenerateGeoJsonOptions;
  /** Legacy village appearance overrides take precedence over shared colours. */
  village?: { pxPerMetre?: number; theme?: VillageTheme };
}

/** Model-only legacy entry point. Shares city coastal probing and seed/skin semantics
 * with the convenience API, without allocating either SVG or GeoJSON. */
export function createLegacySettlementModel(burg: AzgaarBurgInput, options: GenerateSettlementOptions = {}) {
  if (options.theme !== undefined) paletteForTheme(options.theme);
  const requestedEngine = options.engine ?? burg.engine;
  const engine = resolveSettlementEngine(burg.population, requestedEngine);
  validateWaterContext(burg, engine);
  if (engine === 'city') return { kind: 'settlement' as const, ...createCityModel({ ...burg, engine: requestedEngine }, options) };
  const seed = options.seed ?? mapToGenerationParams(burg).seed;
  const skin = options.skin ?? options.svg?.skin;
  const skinBiome = options.svg?.skinBiome ?? burg.biome;
  const effective = skin ? { ...burg, biome: skinBiomeFor(skin, skinBiome).base } : burg;
  const model = generateVillage(effective, seed);
  return { kind: 'village' as const, model, originShift: NO_SHIFT, degradedFlags: [] as DegradedFlag[],
    ...(model.site.waterContextResult ? { waterContextResult: model.site.waterContextResult } : {}) };
}

