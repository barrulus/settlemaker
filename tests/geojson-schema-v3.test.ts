import { describe, it, expect } from 'vitest';
import {
  generateFromBurg, GEOJSON_SCHEMA_VERSION, SETTLEMAKER_VERSION,
  type AzgaarBurgInput,
} from '../src/index.js';
import type { Feature, FeatureCollection } from 'geojson';

function makeBurg(overrides: Partial<AzgaarBurgInput> = {}): AzgaarBurgInput {
  return {
    name: 'V3', population: 5000, port: false, citadel: false,
    walls: true, plaza: true, temple: true, shanty: false, capital: false,
    ...overrides,
  };
}

function metadata(fc: FeatureCollection): Record<string, unknown> {
  return (fc as unknown as { metadata: Record<string, unknown> }).metadata;
}

function layer(fc: FeatureCollection, name: string): Feature[] {
  return fc.features.filter(f => f.properties?.['layer'] === name);
}

describe('GeoJSON schema v3 — metadata', () => {
  it('emits schema_version 3 and version 0.4.0', () => {
    const { geojson } = generateFromBurg(makeBurg(), { seed: 1 });
    expect(GEOJSON_SCHEMA_VERSION).toBe(3);
    expect(SETTLEMAKER_VERSION).toBe('0.4.0');
    expect(metadata(geojson).schema_version).toBe(3);
    expect(metadata(geojson).settlemaker_version).toBe('0.4.0');
  });

  it('emits stable_ids.prefixes with exactly four entries', () => {
    const { geojson } = generateFromBurg(makeBurg(), { seed: 1 });
    const m = metadata(geojson);
    expect(m.stable_ids).toEqual({
      prefixes: { entrance: 'g', poi: 'p', street: 's', building: 'b' },
    });
  });

  it('emits poi_density=town for P>=300 and hamlet for P<300', () => {
    const big = generateFromBurg(makeBurg({ population: 5000 }), { seed: 1 });
    expect(metadata(big.geojson).poi_density).toBe('town');
    const small = generateFromBurg(makeBurg({ population: 100, walls: false, plaza: false }), { seed: 1 });
    expect(metadata(small.geojson).poi_density).toBe('hamlet');
  });

  it('flips poi_density at the exact P=299/300 boundary', () => {
    const hamlet = generateFromBurg(
      makeBurg({ population: 299, walls: false, plaza: false }),
      { seed: 1 },
    );
    const town = generateFromBurg(
      makeBurg({ population: 300 }),
      { seed: 1 },
    );
    expect(metadata(hamlet.geojson).poi_density).toBe('hamlet');
    expect(metadata(town.geojson).poi_density).toBe('town');
  });
});

describe('GeoJSON schema v3 — feature IDs', () => {
  it('every building has a unique building_id matching /^b\\d+$/', () => {
    const { geojson } = generateFromBurg(makeBurg(), { seed: 1 });
    const ids = layer(geojson, 'building').map(f => f.properties!['building_id'] as string);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(id).toMatch(/^b\d+$/);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every street has a unique street_id matching /^s\\d+$/', () => {
    const { geojson } = generateFromBurg(makeBurg(), { seed: 1 });
    const ids = layer(geojson, 'street').map(f => f.properties!['street_id'] as string);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(id).toMatch(/^s\d+$/);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every POI has a unique poi_id matching /^p\\d+$/', () => {
    const { geojson } = generateFromBurg(makeBurg(), { seed: 1 });
    const pois = layer(geojson, 'poi');
    expect(pois.length).toBeGreaterThan(0);
    const ids = pois.map(f => f.properties!['poi_id'] as string);
    for (const id of ids) expect(id).toMatch(/^p\d+$/);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('POIs with non-null building_id reference a real building', () => {
    const { geojson } = generateFromBurg(makeBurg(), { seed: 1 });
    const buildingIds = new Set(
      layer(geojson, 'building').map(f => f.properties!['building_id'] as string),
    );
    const poiLinks = layer(geojson, 'poi')
      .map(f => f.properties!['building_id'] as string | null)
      .filter((id): id is string => id !== null);
    for (const id of poiLinks) expect(buildingIds.has(id)).toBe(true);
  });

  it('floating POIs (pier, well) have building_id=null and all others have non-null', () => {
    const { geojson } = generateFromBurg(makeBurg({ port: true }), { seed: 1 });
    for (const f of layer(geojson, 'poi')) {
      const kind = f.properties!['kind'] as string;
      const bid = f.properties!['building_id'];
      if (kind === 'pier' || kind === 'well') expect(bid).toBeNull();
      else expect(bid).not.toBeNull();
    }
  });

  it('no POI feature has a name property', () => {
    const { geojson } = generateFromBurg(makeBurg(), { seed: 1 });
    for (const f of layer(geojson, 'poi')) {
      expect(f.properties).not.toHaveProperty('name');
    }
  });

  it('determinism: same seed + burg produces identical feature IDs', () => {
    const burg = makeBurg();
    const a = generateFromBurg(burg, { seed: 42 });
    const b = generateFromBurg(burg, { seed: 42 });
    const idsOf = (fc: FeatureCollection, name: string, key: string) =>
      layer(fc, name).map(f => f.properties![key]);
    expect(idsOf(a.geojson, 'building', 'building_id')).toEqual(
      idsOf(b.geojson, 'building', 'building_id'),
    );
    expect(idsOf(a.geojson, 'street', 'street_id')).toEqual(
      idsOf(b.geojson, 'street', 'street_id'),
    );
    expect(idsOf(a.geojson, 'poi', 'poi_id')).toEqual(
      idsOf(b.geojson, 'poi', 'poi_id'),
    );
  });
});

describe('GeoJSON schema v3 — unchanged layers', () => {
  it('wall / tower / ward / pier keep their v2 property keysets', () => {
    // Entrance properties vary based on optional fields; covered elsewhere in entrance-output.test.ts. Water features are not currently emitted.
    const { geojson } = generateFromBurg(makeBurg({ port: true }), { seed: 1 });
    const expectedKeys: Record<string, Set<string>> = {
      wall: new Set(['layer', 'wallType']),
      tower: new Set(['layer', 'wallType']),
      ward: new Set(['layer', 'wardType', 'label', 'withinCity', 'withinWalls']),
      pier: new Set(['layer', 'wardType']),
    };
    for (const [name, keys] of Object.entries(expectedKeys)) {
      for (const f of layer(geojson, name)) {
        expect(new Set(Object.keys(f.properties ?? {}))).toEqual(keys);
      }
    }
  });
});
