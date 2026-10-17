import { describe, it, expect } from 'vitest';
import {
  generateSettlement, createSettlementModel, resolveSettlementEngine,
  encodeBurgParam, decodeBurgParam, parseSettlementUrl, type AzgaarBurgInput,
} from '../src/index.js';

const burg: AzgaarBurgInput = {
  name: 'Planner probe', population: 800, biome: 'temperate', roadBearings: [20, 145, 270],
  port: false, citadel: false, walls: false, plaza: true, temple: true, shanty: false, capital: false,
};
const waterContext = {
  version: 1, status: 'measured', coordinateSpace: 'burg-local-metres',
  surveyRadiusM: 3000, geometryErrorM: .5, bodies: [],
} as const;
const measured = { ...waterContext, bodies: [] };

describe('explicit settlement engine', () => {
  it('retains the inclusive automatic boundary', () => {
    expect(resolveSettlementEngine(1000)).toBe('village');
    expect(resolveSettlementEngine(1001, 'auto')).toBe('city');
    expect(resolveSettlementEngine(2000, 'village')).toBe('village');
    expect(resolveSettlementEngine(800, 'city')).toBe('city');
  });

  it('houses 2000 people in a village with measured water and leaves caller input alone', () => {
    const input = { ...burg, population: 2000, waterContext: { ...measured, surveyRadiusM: 6000 } };
    const before = JSON.stringify(input);
    const result = generateSettlement(input, { seed: 2, engine: 'village' });
    expect(result.kind).toBe('planned');
    expect(result.model.development.preset).toBe('village');
    expect(result.model.residents.assigned).toBe(2000);
    expect(result.model.waterContextResult).toEqual({ version: 1, status: 'measured', issues: [] });
    expect(JSON.stringify(input)).toBe(before);
  }, 20000);

  it('generates an 800-person city with the shared physical contract', () => {
    const result = generateSettlement({ ...burg, engine: 'city' }, { seed: 2 });
    expect(result.kind).toBe('planned');
    expect(result.model.development.preset).toBe('city');
    expect(result.model.residents.assigned).toBe(800);
    expect(result.geojson.metadata).toMatchObject({ schema: 'settlemaker/physical-plan', schema_version: 1, coordinate_units: 'metres' });
    const viaOption = generateSettlement({ ...burg, engine: 'auto' }, { seed: 2, engine: 'city' });
    expect(viaOption.svg).toBe(result.svg);
    expect(viaOption.geojson).toEqual(result.geojson);
  });

  it('lets an option override a saved choice and lets auto restore population selection', () => {
    const result = generateSettlement({ ...burg, population: 10, engine: 'city' }, { engine: 'auto', seed: 2 });
    expect(result.kind).toBe('planned');
    expect(result.model.development.preset).toBe('village');
  });

  it('uses an explicit development preset before the engine selector', () => {
    const result = generateSettlement({ ...burg, engine: 'city' }, { seed: 2, engine: 'city', development: { preset: 'village' } });
    expect(result.model.development.preset).toBe('village');
  });

  it.each(['city', 'village'] as const)('accepts measured water for physical %s layouts', engine => {
    const model = createSettlementModel({ ...burg, engine, waterContext: measured }, { seed: 2 });
    expect(model.waterContextResult).toEqual({ version: 1, status: 'measured', issues: [] });
    expect(model.coordinateSystem).toBe('local_metres_y_down');
  });

  it('exports measured city water in the supplied metre coordinate frame', () => {
    const coastlineGeometry = [[{x:180,y:-3000},{x:3000,y:-3000},{x:3000,y:3000},{x:180,y:3000}]];
    const result = generateSettlement({ ...burg, engine: 'city', coastlineGeometry,
      waterContext: { ...measured, bodies: [{kind:'ocean',distanceM:180,bearingDeg:90,polygonIndices:[0]}] } }, {seed:2});
    expect(result.model.waterContextResult).toEqual({version:1,status:'measured',issues:[]});
    const water = result.geojson.features.find(f => f.properties?.layer === 'water');
    expect(water?.geometry.type).toBe('MultiPolygon');
    if (water?.geometry.type !== 'MultiPolygon') throw Error('Missing physical city water');
    const coordinates = water.geometry.coordinates.flat(2);
    expect(Math.min(...coordinates.map(p => p[0]))).toBe(180);
    expect(result.model.scene.layers.water.rings.flat().every(p => p.x >= 180)).toBe(true);
  });

  it('round-trips an explicit large village through the compressed URL contract', async () => {
    const input = { ...burg, population: 2000, engine: 'village' as const, waterContext: measured };
    const packed = await encodeBurgParam(input, 2);
    expect(await decodeBurgParam(packed)).toEqual({ burg: input, seed: 2 });
    const parsed = await parseSettlementUrl(new URLSearchParams({ i: packed, engine: 'city', theme: 'night' }));
    expect(parsed.burg.engine).toBe('village');
    expect(parsed.paletteName).toBe('night');
  });

  it('accepts flat URLs and treats engine as generation data', async () => {
    expect((await parseSettlementUrl(new URLSearchParams('pop=800&engine=city'))).burg.engine).toBe('city');
    expect((await parseSettlementUrl(new URLSearchParams('engine=village'))).random).toBe(false);
  });

  it('rejects invalid choices at direct, flat and compressed boundaries', async () => {
    for (const engine of ['', '__proto__', 'town', null]) {
      expect(() => generateSettlement({ ...burg, engine: engine as any })).toThrow('Unknown settlement engine');
      await expect(parseSettlementUrl(new URLSearchParams(`engine=${engine}`))).rejects.toMatchObject({ reason: 'engine' });
      await expect(decodeBurgParam(await encodeBurgParam({ ...burg, engine: engine as any }))).rejects.toMatchObject({ reason: 'engine' });
    }
  });
});
