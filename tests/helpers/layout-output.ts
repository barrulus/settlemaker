/** Test-only output adapters for detailed regressions in the retained layout algorithms. */
import { createCityModel, createLegacySettlementModel } from '../../src/output/legacy-model.js';
import type { GenerateFromBurgResult, GenerateSettlementOptions } from '../../src/output/legacy-model.js';
export type { GenerateSettlementOptions } from '../../src/output/legacy-model.js';
import { paletteForTheme, type ThemeName } from '../../src/output/palette.js';
import type { RenderTheme } from '../../src/output/render-theme.js';
import type { SettlementSkin } from '../../src/assets/skins.js';
import { resolveSettlementEngine } from '../../src/input/settlement-engine.js';
import { validateWaterContext } from '../../src/input/water-context.js';
import type { AzgaarBurgInput } from '../../src/input/azgaar-input.js';
import { renderVillage } from '../../src/village/render.js';
import { generateVillageGeoJson } from '../../src/village/geojson.js';
import type { VillageModel } from '../../src/village/types.js';
import type { FeatureCollection } from 'geojson';
import type { DegradedFlag } from '../../src/generator/generation-params.js';
import { generateSvg, type SvgOptions } from '../../src/output/svg-builder.js';
import { generateGeoJson, type GenerateGeoJsonOptions } from '../../src/output/geojson-builder.js';
import type { OriginShift } from '../../src/generator/origin-shift.js';
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

export type GenerateSettlementResult =
  | ({ kind: 'village'; model: VillageModel } & {
      waterContextResult?: import('../../src/input/water-context.js').WaterContextResult;
      svg: string;
      geojson: FeatureCollection;
      degradedFlags: DegradedFlag[];
      originShift: OriginShift;
    })
  | ({ kind: 'settlement' } & GenerateFromBurgResult);

export function generateSettlement(
  burg: AzgaarBurgInput,
  options?: GenerateSettlementOptions,
): GenerateSettlementResult {
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
