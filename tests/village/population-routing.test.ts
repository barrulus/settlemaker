import { describe, expect, it } from 'vitest';
import { generateSettlement } from '../../src/index.js';
import type { AzgaarBurgInput } from '../../src/input/azgaar-input.js';

const burg = (population: number): AzgaarBurgInput => ({
  name: 'Boundary', population, port: false, citadel: false, walls: false,
  plaza: false, temple: false, shanty: false, capital: false,
  roadBearings: [
    { bearing_deg: 40, kind: 'main', through: true, route_id: 'r-main' },
    { bearing_deg: 165, kind: 'town', route_id: 'r-town' },
  ],
} as AzgaarBurgInput);

describe('physical planning selected by population', () => {
  it.each([[999, 'village'], [1000, 'village'], [1001, 'city']] as const)('selects the %s-person physical layout', (population, preset) => {
    const result = generateSettlement(burg(population), { seed: 1 });
    expect(result.kind).toBe('planned');
    expect(result.model.development.preset).toBe(preset);
  });

  it('gives a consumer the same shape on both sides of the boundary', () => {
    // The acceptance bar: sweep the boundary, and nothing a consumer reads
    // should tell them which engine ran unless they look at `kind`.
    for (const population of [200, 600, 999, 1000, 1001, 1400, 4000]) {
      const r = generateSettlement(burg(population), { seed: 1 });
      expect(typeof r.svg, `pop ${population}: svg`).toBe('string');
      expect(r.svg.startsWith('<svg'), `pop ${population}: svg is not an svg`).toBe(true);
      expect(r.svg, `pop ${population}: tiler crop contract`).toContain('data-bg="paper"');
      expect(r.geojson.type, `pop ${population}: geojson`).toBe('FeatureCollection');
      expect(r.geojson.features.length, `pop ${population}: no features`).toBeGreaterThan(0);
      expect(Array.isArray(r.model.degradedFlags), `pop ${population}: degradedFlags`).toBe(true);
    }
  });

  it('exports the same metre schema and resident accounting on both sides', () => {
    for (const population of [400, 4000]) {
      const result = generateSettlement(burg(population), { seed: 1 });
      expect(result.geojson.metadata).toMatchObject({
        schema: 'settlemaker/physical-plan', schema_version: 1,
        coordinate_system: 'local_metres_y_down', coordinate_units: 'metres',
        scale: { meters_per_unit: 1 }, residents: { requested: population, assigned: population },
      });
      const buildings = result.geojson.features.filter(f => f.properties?.layer === 'building');
      expect(buildings.reduce((total, f) => total + Number(f.properties?.residents), 0)).toBe(population);
      expect(buildings.every(f => f.geometry.type === 'Polygon')).toBe(true);
    }
  });

  it('gives two differently-named burgs different villages with NO seed', () => {
    // C1 (whole-branch review): the village branch hard-coded `seed ?? 1`
    // while the settlement branch defaults to a hash of the burg name. Every
    // unseeded village on an FMG map with the same route/population shape
    // was therefore the SAME village, and regenerating the map could not
    // change it. The Phase 5 grid missed it because every call in it passes
    // an explicit seed -- so this one deliberately passes none.
    for (const population of [400, 4000]) {
      const a = generateSettlement({ ...burg(population), name: 'Ashford' });
      const b = generateSettlement({ ...burg(population), name: 'Bexley' });
      expect(a.svg, `pop ${population}: two burgs generated the same settlement`).not.toBe(b.svg);
    }
    // ...and the same name still gives the same settlement, on both sides.
    for (const population of [400, 4000]) {
      expect(generateSettlement({ ...burg(population), name: 'Ashford' }).svg)
        .toBe(generateSettlement({ ...burg(population), name: 'Ashford' }).svg);
    }
  });

  it('is deterministic, and honours the seed on both sides', () => {
    for (const population of [400, 4000]) {
      const a = generateSettlement(burg(population), { seed: 7 });
      const b = generateSettlement(burg(population), { seed: 7 });
      expect(a.svg, `pop ${population}`).toBe(b.svg);
      const c = generateSettlement(burg(population), { seed: 8 });
      expect(c.svg, `pop ${population}: seed 8 matched seed 7`).not.toBe(a.svg);
    }
  });

  it('returns the same retained physical model shape for both layouts', () => {
    for (const population of [400, 4000]) {
      const result = generateSettlement(burg(population), { seed: 1 });
      expect(result.model.buildings.length).toBeGreaterThan(0);
      expect(result.model.scene.layers.roads.length).toBeGreaterThan(0);
      expect(result.model.districts.length).toBeGreaterThan(0);
      expect(result.model).not.toHaveProperty('patches');
      expect(result.model).not.toHaveProperty('lanes');
    }
  });
});
