import { describe, it, expect } from 'vitest';
import * as api from '../../src/index.js';
import type { AzgaarBurgInput } from '../../src/index.js';

const burg: AzgaarBurgInput = {
  name: 'Physical village', population: 300, port: false, citadel: false, walls: false,
  plaza: false, temple: false, shanty: false, capital: false,
  roadBearings: [{ bearing_deg: 225, kind: 'road' }],
};

describe('physical public API', () => {
  it('does not expose the retired generation or output contracts', () => {
    for (const name of ['generateFromBurg', 'createCityModel', 'createLegacySettlementModel',
      'generateVillage', 'renderVillage', 'generateVillageGeoJson', 'generateGeoJson',
      'generateSvg', 'Model', 'GEOJSON_SCHEMA_VERSION']) {
      expect(api, name).not.toHaveProperty(name);
    }
  });

  it('uses the same physical defaults for all public generation entry points', () => {
    const model = api.createSettlementModel(burg);
    const result = api.generateSettlement(burg);
    const plan = api.planSettlement(burg);
    expect(result.kind).toBe('planned');
    expect(result.model).toEqual(model);
    expect(plan).toEqual(result);
    expect(model.development.preset).toBe('village');
    expect(model.residents.assigned).toBe(burg.population);
    expect(result.geojson).toEqual(api.exportSettlement(model));
    expect(result.svg).toBe(api.renderSettlement(model));
  });

  it.each(['city', 'village'] as const)('applies shared appearance to physical %s output without changing exported geometry', engine => {
    const natural = api.generateSettlement(burg, {seed:2,engine});
    const skin = api.createSkin({version:1,id:'empty',name:'Empty skin'});
    const styled = api.generateSettlement(burg, {seed:2,engine,skin,theme:'night',style:{paper:'#123456',smInk:'#abcdef'}});
    expect(styled.svg).toContain('fill="#123456"');
    expect(styled.svg).toContain('--sm-ink:#abcdef');
    expect(styled.svg === natural.svg).toBe(false);
    expect(styled.geojson).toEqual(natural.geojson);
  });

  it.each([{ urbanDensity: 2 }, { coreCapacity: 400 }])('explains retired tuning fields %o without changing physical geometry', retired => {
    const input = { ...burg, ...retired };
    const baseline = api.createSettlementModel(burg, {seed:2});
    const result = api.generateSettlement(input, {seed:2});
    expect(result.model.buildings).toEqual(baseline.buildings);
    expect(result.model.development).toEqual(baseline.development);
    expect(result.model.diagnostics.join(' ')).toMatch(/urbanDensity|coreCapacity/);
    expect(result.model.diagnostics.join(' ')).toContain('development.');
    expect(api.createSettlementSession(input, {seed:2}).metadata.diagnostics).toEqual(result.model.diagnostics);
  });

  it.each(['svg', 'geojson', 'village'])('rejects obsolete %s output options instead of silently ignoring them', key => {
    const options = { [key]: {} } as unknown as api.SettlementOptions;
    for (const generate of [api.generateSettlement, api.planSettlement, api.createSettlementModel, api.createSettlementSession]) {
      expect(() => generate(burg, options)).toThrow(TypeError);
    }
  });

  it('retains local metre coordinates and physical exports in a default session', () => {
    const session = api.createSettlementSession(burg);
    const result = api.generateSettlement(burg);
    expect(session.scene).toEqual(result.model.scene);
    expect(session.metadata).toMatchObject({ planner: 'physical-village', metersPerUnit: 1,
      coordinateSystem: 'local_metres_y_down', supportsViewport: true });
    expect(session.metadata).not.toHaveProperty('originShift');
    expect(session.metadata).not.toHaveProperty('villageTransform');
    expect(session.exportGeoJson()).toEqual(result.geojson);
  });
});
