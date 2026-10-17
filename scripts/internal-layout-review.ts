/** Internal layout diagnostics only. Application code uses src/index.ts. */
import { createCityModel, createLegacySettlementModel, type GenerateSettlementOptions } from '../src/output/legacy-model.js';
import { generateSvg } from '../src/output/svg-builder.js';
import { generateGeoJson } from '../src/output/geojson-builder.js';
import { renderVillage } from '../src/village/render.js';
import { generateVillageGeoJson } from '../src/village/geojson.js';
import type { AzgaarBurgInput } from '../src/input/azgaar-input.js';
export { buildScene } from '../src/scene/build-scene.js';
export { assembleSvg } from '../src/output/assemble-svg.js';

export function generateFromBurg(input: AzgaarBurgInput, options: GenerateSettlementOptions = {}) {
  const retained = createCityModel(input, options);
  return { ...retained,
    svg: generateSvg(retained.model, { ...options.svg, shift: retained.originShift }),
    geojson: generateGeoJson(retained.model, { ...options.geojson, shift: retained.originShift }),
  };
}
export function generateSettlement(input: AzgaarBurgInput, options: GenerateSettlementOptions = {}) {
  const retained = createLegacySettlementModel(input, options);
  if (retained.kind === 'village') return { ...retained,
    svg: renderVillage(retained.model), geojson: generateVillageGeoJson(retained.model) };
  return { ...retained,
    svg: generateSvg(retained.model, { shift: retained.originShift }),
    geojson: generateGeoJson(retained.model, { shift: retained.originShift }),
  };
}
export type GenerateSettlementResult = ReturnType<typeof generateSettlement>;
