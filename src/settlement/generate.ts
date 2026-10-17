import type { AzgaarBurgInput } from '../input/azgaar-input.js';
import { seedFromString } from '../input/azgaar-input.js';
import { resolveSettlementEngine, type SettlementEngine } from '../input/settlement-engine.js';
import { paletteForTheme, type ThemeName } from '../output/palette.js';
import type { RenderTheme } from '../output/render-theme.js';
import type { SettlementSkin } from '../assets/skins.js';
import { skinBiomeFor } from '../assets/skins.js';
import { resolveDevelopment, type DevelopmentOptions } from './development.js';
import { allocateResidents, type SettlementModel } from './model.js';
import { blockLayout, frontageLayout } from './layouts.js';
import { dressSettlement } from './landscape.js';
import { addRuralHousing } from './rural.js';
import { pruneUnreachableRural } from './countryside.js';
import { timeGenerationStage, type GenerationTimingObserver } from '../generator/timing.js';
import { exportSettlement, renderSettlement, type SettlementGeoJson, type SettlementRenderOptions } from './output.js';

export interface SettlementOptions {
  /** Physical layout and occupancy controls. Defaults to the selected engine preset. */
  development?: DevelopmentOptions;
  /** Preset shorthand when development is omitted; overrides input.engine. */
  engine?: SettlementEngine;
  seed?: number;
  theme?: ThemeName;
  style?: Partial<RenderTheme>;
  skin?: SettlementSkin;
  render?: Pick<SettlementRenderOptions, 'width' | 'bounds' | 'detail'>;
  /** Optional profiling events, excluded from deterministic model/export data. */
  onStageTiming?: GenerationTimingObserver;
}
export type GenerateSettlementOptions = SettlementOptions;
export interface PlannedSettlement {
  kind: 'planned';
  model: SettlementModel;
  svg: string;
  geojson: SettlementGeoJson;
}

/** One physical planning pipeline. The development preset selects a layout
 * technique, followed by common resident, landscape, rendering and export stages. */
export function createSettlementModel(input: AzgaarBurgInput, options: SettlementOptions = {}): SettlementModel {
  for (const key of ['svg', 'geojson', 'village'] as const) {
    if ((options as Record<string, unknown>)[key] !== undefined) {
      throw new TypeError(`The ${key} generation option is retired. Use theme, style, skin and render for physical output; GeoJSON always uses settlemaker/physical-plan.`);
    }
  }
  const preset = resolveSettlementEngine(input.population, options.engine ?? input.engine);
  const development = resolveDevelopment(input.population, input.walls, options.development ?? { preset });
  if (options.theme !== undefined) paletteForTheme(options.theme);
  const seed = options.seed ?? seedFromString(input.name);
  if (!Number.isSafeInteger(seed)) throw new RangeError('seed must be a safe integer');
  const effective = options.skin ? { ...input, biome: skinBiomeFor(options.skin, input.biome).base } : input;
  const urbanInput = development.ruralPopulation ? { ...effective, population: input.population-development.ruralPopulation } : effective;
  const observe = options.onStageTiming;
  const supply = { core: 1, outer: 1 };
  let land = 1;
  const createLayout = (attempt: number) => timeGenerationStage('layout', observe, () => {
    const layout = development.preset === 'village'
      ? frontageLayout(urbanInput, seed, development) : blockLayout(urbanInput, seed, development, supply, land,
        observe ? timing => observe({ ...timing, attempt }) : undefined);
    // Access pruning may initialize the shared countryside plan. Its demand
    // includes the rural residents who will be placed after the urban layout.
    layout.site.population = input.population;
    pruneUnreachableRural(layout, seed);
    return layout;
  }, attempt);
  let layout = createLayout(0);
  let residents = allocateResidents(layout.buildings, input.population, development.corePopulation, development.ruralPopulation);
  // Supply and land are increased before acceptance. Existing capacities are
  // never inflated to hide under-production or a constrained site.
  for (let attempt = 0; development.preset === 'city' && (residents.urban?.unassigned ?? residents.unassigned) > 0 && attempt < 4; attempt++) {
    for (const [key, account] of [['core', residents.insideWalls], ['outer', residents.outsideWalls]] as const) {
      const requested = account.requested - (key === 'outer' && development.ruralPopulation ? development.ruralPopulation : 0);
      const capacity = account.capacity - (key === 'outer' && development.ruralPopulation ? residents.rural?.capacity ?? 0 : 0);
      if (requested > capacity) supply[key] *= Math.min(2, Math.max(1.08, requested / Math.max(1, capacity) * 1.04));
    }
    land *= 1.12;
    layout = createLayout(attempt+1);
    residents = allocateResidents(layout.buildings, input.population, development.corePopulation, development.ruralPopulation);
  }
  layout.site.population = input.population;
  layout.scene.population = input.population;
  timeGenerationStage('rural', observe, () => addRuralHousing(layout, development, seed));
  residents = timeGenerationStage('residents', observe, () => allocateResidents(layout.buildings, input.population, development.corePopulation, development.ruralPopulation));
  timeGenerationStage('landscape', observe, () => dressSettlement(layout, seed));
  const diagnostics = [...layout.diagnostics];
  if (input.urbanDensity !== undefined) diagnostics.push('urbanDensity is retired and ignored; use development.centreOccupancy and development.edgeOccupancy for physical building capacities.');
  if (input.coreCapacity !== undefined) diagnostics.push('coreCapacity is retired and ignored; use development.corePopulation to request residents inside walls.');
  if (residents.unassigned) diagnostics.push(`${residents.unassigned} residents could not be accommodated within the requested enclosure and available land`);
  const model: SettlementModel = { version: 1, generatorRevision: 'physical-layout-16', name: input.name, seed, development, coordinateSystem: 'local_metres_y_down',
    scene: layout.scene, buildings: layout.buildings, districts: layout.districts, residents, diagnostics,
    ...(layout.placement ? { placement: layout.placement } : {}),
    ...(layout.site.waterContextResult ? { waterContextResult: layout.site.waterContextResult } : {}),
    degradedFlags: layout.degradedFlags ?? [] };
  return model;
}

/** Convenience outputs; use createSettlementModel when exports are not needed. */
export function planSettlement(input: AzgaarBurgInput, options: SettlementOptions = {}): PlannedSettlement {
  const model = createSettlementModel(input, options);
  const palette = options.theme === undefined ? undefined : paletteForTheme(options.theme);
  return { kind: 'planned', model,
    svg: timeGenerationStage('svg', options.onStageTiming, () => renderSettlement(model, { ...options.render, palette, theme: options.style, skin: options.skin, skinBiome: input.biome })),
    geojson: timeGenerationStage('geojson', options.onStageTiming, () => exportSettlement(model)) };
}
