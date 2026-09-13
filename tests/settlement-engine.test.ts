import { describe, it, expect } from 'vitest';
import {
  generateSettlement, generateFromBurg, generateVillage, resolveSettlementEngine,
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
    expect(result.kind).toBe('village');
    if (result.kind !== 'village') throw Error('wrong planner');
    expect(result.model.buildings.reduce((sum, b) => sum + b.occupancy, 0)).toBeGreaterThanOrEqual(2000);
    expect(result.waterContextResult).toEqual({ version: 1, status: 'measured', issues: [] });
    expect(JSON.stringify(input)).toBe(before);
  }, 20000);

  it('generates an 800-person city, preserving the existing result discriminator', () => {
    const result = generateSettlement({ ...burg, engine: 'city' }, { seed: 2 });
    expect(result.kind).toBe('settlement');
    expect(result.degradedFlags).toEqual([]);
    expect(result.svg.includes('glyph-sm-city-row-house')).toBe(true);
    expect((result.geojson as typeof result.geojson & { metadata: { building_capacity?: unknown } }).metadata.building_capacity).toBeDefined();
    expect(result.svg === generateFromBurg({ ...burg, engine: 'city' }, { seed: 2 }).svg).toBe(true);
    const viaOption = generateSettlement({ ...burg, engine: 'auto' }, { seed: 2, engine: 'city' });
    expect(viaOption.svg === result.svg).toBe(true);
    const metadata = (geojson: typeof result.geojson) => (geojson as typeof geojson & { metadata: { settlement_generation_version: string } }).metadata;
    expect(metadata(result.geojson).settlement_generation_version).not.toBe(metadata(generateFromBurg(burg, { seed: 2 }).geojson).settlement_generation_version);
  });

  it('lets an option override a saved choice and lets auto restore population selection', () => {
    const result = generateSettlement({ ...burg, population: 10, engine: 'city' }, { engine: 'auto', seed: 2 });
    expect(result.kind).toBe('village');
  });

  it('rejects measured water in every city entry point even below the automatic boundary', () => {
    expect(() => generateSettlement({ ...burg, engine: 'city', waterContext: measured })).toThrow('water-context-unsupported-engine');
    expect(() => generateSettlement({ ...burg, engine: 'village', waterContext: measured }, { engine: 'city' })).toThrow('water-context-unsupported-engine');
    expect(() => generateFromBurg({ ...burg, engine: 'village', waterContext: measured })).toThrow('water-context-unsupported-engine');
    expect(() => generateVillage({ ...burg, population: 10, engine: 'city', waterContext: measured }, 2)).not.toThrow();
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
