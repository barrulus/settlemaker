import { describe, it, expect } from 'vitest';
import {
  generateVillage, renderVillage, VILLAGE_POP_CEILING, Model, mapToGenerationParams,
  type AzgaarBurgInput, type VillageModel,
} from '../../src/index.js';

const burg: AzgaarBurgInput = {
  name: 'Optin', population: 300, port: false, citadel: false, walls: false,
  plaza: false, temple: false, shanty: false, capital: false,
  roadBearings: [{ bearing_deg: 225, kind: 'road' }],
};

describe('village engine is reachable from the public API', () => {
  it('exports generateVillage and produces a model', () => {
    const m: VillageModel = generateVillage(burg, 1);
    expect(m.buildings.length).toBeGreaterThan(0);
    expect(m.lanes.length).toBeGreaterThan(0);
  });

  it('exports renderVillage and produces an svg', () => {
    const svg = renderVillage(generateVillage(burg, 1));
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('data-bg="paper"');
  });

  it('declares the band it serves without routing to it', () => {
    expect(VILLAGE_POP_CEILING).toBe(1000);
  });
});

describe('the opt-in does not change default behaviour', () => {
  it('mapToGenerationParams still targets the existing engine', () => {
    // A burg well inside the village band must still map to the old engine's
    // params, because nothing routes by population yet. If this ever fails,
    // routing was wired without the capabilities that must precede it —
    // GeoJSON, themed SVG, and pass 5.
    const params = mapToGenerationParams(burg);
    expect(params).toBeDefined();
    const model = new Model(params).generate();
    expect(model.patches.length).toBeGreaterThan(0);
  });
});
