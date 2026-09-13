import type { AzgaarBurgInput } from '../input/azgaar-input.js';
import { mapToGenerationParams } from '../input/azgaar-input.js';
import { paletteForTheme, type ThemeName } from '../output/palette.js';
import type { RenderTheme } from '../output/render-theme.js';
import type { SettlementSkin } from '../assets/skins.js';
import { skinBiomeFor } from '../assets/skins.js';
import { resolveDevelopment, type DevelopmentOptions } from './development.js';
import { allocateResidents, type SettlementModel } from './model.js';
import { blockLayout, frontageLayout } from './layouts.js';
import { dressSettlement } from './landscape.js';
import { exportSettlement, renderSettlement, type SettlementGeoJson, type SettlementRenderOptions } from './output.js';

export interface SettlementOptions {
  development: DevelopmentOptions;
  seed?: number;
  theme?: ThemeName;
  style?: Partial<RenderTheme>;
  skin?: SettlementSkin;
  render?: Pick<SettlementRenderOptions, 'width' | 'bounds' | 'detail'>;
}
export interface PlannedSettlement {
  kind: 'planned';
  model: SettlementModel;
  svg: string;
  geojson: SettlementGeoJson;
}

/** One physical planning pipeline. The development preset selects a layout
 * technique, followed by common resident, landscape, rendering and export stages. */
export function createSettlementModel(input: AzgaarBurgInput, options: SettlementOptions): SettlementModel {
  const development = resolveDevelopment(input.population, input.walls, options.development);
  if (options.theme !== undefined) paletteForTheme(options.theme);
  const seed = options.seed ?? mapToGenerationParams(input).seed;
  if (!Number.isSafeInteger(seed)) throw new RangeError('seed must be a safe integer');
  const effective = options.skin ? { ...input, biome: skinBiomeFor(options.skin, input.biome).base } : input;
  let layout = development.preset === 'village' ? frontageLayout(effective, seed, development) : blockLayout(effective, seed, development);
  let residents = allocateResidents(layout.buildings, input.population, development.corePopulation);
  // Supply and land are increased before acceptance. Existing capacities are
  // never inflated to hide under-production or a constrained site.
  const supply = { core: 1, outer: 1 };
  let land = 1;
  for (let attempt = 0; development.preset === 'city' && residents.unassigned > 0 && attempt < 4; attempt++) {
    for (const [key, account] of [['core', residents.insideWalls], ['outer', residents.outsideWalls]] as const) {
      if (account.unassigned) supply[key] *= Math.min(2, Math.max(1.08, account.requested / Math.max(1, account.capacity) * 1.04));
    }
    land *= 1.12;
    layout = blockLayout(effective, seed, development, supply, land);
    residents = allocateResidents(layout.buildings, input.population, development.corePopulation);
  }
  dressSettlement(layout, seed);
  const diagnostics = [...layout.diagnostics];
  if (residents.unassigned) diagnostics.push(`${residents.unassigned} residents could not be accommodated within the requested enclosure and available land`);
  const model: SettlementModel = { version: 1, name: input.name, seed, development, coordinateSystem: 'local_metres_y_down',
    scene: layout.scene, buildings: layout.buildings, districts: layout.districts, residents, diagnostics };
  return model;
}

/** Convenience outputs; use createSettlementModel when exports are not needed. */
export function planSettlement(input: AzgaarBurgInput, options: SettlementOptions): PlannedSettlement {
  const model = createSettlementModel(input, options);
  const palette = options.theme === undefined ? undefined : paletteForTheme(options.theme);
  return { kind: 'planned', model, svg: renderSettlement(model, { ...options.render, palette, theme: options.style, skin: options.skin, skinBiome: input.biome }), geojson: exportSettlement(model) };
}
