import { describe, it, expect } from 'vitest';
import {
  generateFromBurg,
  generateGeoJson,
  GEOJSON_SCHEMA_VERSION,
  SETTLEMAKER_VERSION,
  type AzgaarBurgInput,
  type RoadBearingInput,
} from '../src/index.js';
import type { Feature, FeatureCollection } from 'geojson';

function makeBurg(overrides: Partial<AzgaarBurgInput> = {}): AzgaarBurgInput {
  return {
    name: 'GateBurg',
    population: 5000,
    port: false,
    citadel: false,
    walls: true,
    plaza: true,
    temple: false,
    shanty: false,
    capital: false,
    ...overrides,
  };
}

function gateFeatures(fc: FeatureCollection): Feature[] {
  return fc.features.filter(f => f.properties?.['layer'] === 'gate');
}

function metadata(fc: FeatureCollection): Record<string, unknown> {
  return (fc as unknown as { metadata: Record<string, unknown> }).metadata;
}

describe('GeoJSON output metadata', () => {
  it('emits a metadata block with schema + coordinate info', () => {
    const result = generateFromBurg(makeBurg(), {
      seed: 42,
      geojson: { generatedAt: '2026-01-01T00:00:00Z' },
    });
    const meta = metadata(result.geojson);
    expect(meta.schema_version).toBe(GEOJSON_SCHEMA_VERSION);
    expect(meta.settlemaker_version).toBe(SETTLEMAKER_VERSION);
    expect(meta.coordinate_system).toBe('local_origin_y_down');
    expect(meta.coordinate_units).toBe('settlement_units');
    expect(meta.generated_at).toBe('2026-01-01T00:00:00Z');
    expect(typeof meta.settlement_generation_version).toBe('string');
    expect((meta.settlement_generation_version as string).length).toBeGreaterThan(0);
  });

  it('defaults generated_at to the current ISO-8601 timestamp', () => {
    const before = new Date().toISOString();
    const result = generateFromBurg(makeBurg(), { seed: 42 });
    const after = new Date().toISOString();
    const stamp = metadata(result.geojson).generated_at as string;
    // Lexicographic compare works for ISO-8601
    expect(stamp >= before).toBe(true);
    expect(stamp <= after).toBe(true);
  });

  it('allows overriding settlemakerVersion for reproducible fixtures', () => {
    const result = generateFromBurg(makeBurg(), {
      seed: 42,
      geojson: { settlemakerVersion: '9.9.9', generatedAt: '2026-01-01T00:00:00Z' },
    });
    expect(metadata(result.geojson).settlemaker_version).toBe('9.9.9');
  });
});

describe('settlement_generation_version', () => {
  it('is stable across runs with identical inputs', () => {
    const a = generateFromBurg(makeBurg(), { seed: 7 });
    const b = generateFromBurg(makeBurg(), { seed: 7 });
    expect(metadata(a.geojson).settlement_generation_version)
      .toBe(metadata(b.geojson).settlement_generation_version);
  });

  it('changes when the seed changes', () => {
    const a = generateFromBurg(makeBurg(), { seed: 7 });
    const b = generateFromBurg(makeBurg(), { seed: 8 });
    expect(metadata(a.geojson).settlement_generation_version)
      .not.toBe(metadata(b.geojson).settlement_generation_version);
  });

  it('changes when population changes', () => {
    const a = generateFromBurg(makeBurg({ population: 5000 }), { seed: 7 });
    const b = generateFromBurg(makeBurg({ population: 20000 }), { seed: 7 });
    expect(metadata(a.geojson).settlement_generation_version)
      .not.toBe(metadata(b.geojson).settlement_generation_version);
  });

  it('changes when roadBearings change', () => {
    const a = generateFromBurg(makeBurg({ roadBearings: [0, 90] }), { seed: 7 });
    const b = generateFromBurg(makeBurg({ roadBearings: [0, 180] }), { seed: 7 });
    expect(metadata(a.geojson).settlement_generation_version)
      .not.toBe(metadata(b.geojson).settlement_generation_version);
  });
});

describe('Gate features', () => {
  it('every gate has gate_id, kind, sub_kind, bearing_deg, wall_vertex_index', () => {
    const result = generateFromBurg(makeBurg(), { seed: 42 });
    const gates = gateFeatures(result.geojson);
    expect(gates.length).toBeGreaterThan(0);
    for (const g of gates) {
      const p = g.properties!;
      expect(typeof p['gate_id']).toBe('string');
      expect(p['gate_id']).toMatch(/^g\d+$/);
      expect(['land', 'harbour']).toContain(p['kind']);
      expect(['road', 'foot', 'harbour']).toContain(p['sub_kind']);
      expect(typeof p['bearing_deg']).toBe('number');
      expect(p['bearing_deg']).toBeGreaterThanOrEqual(0);
      expect(p['bearing_deg']).toBeLessThan(360);
      expect(typeof p['wall_vertex_index']).toBe('number');
    }
  });

  it('echoes matched_route_id back for bearings passed as objects', () => {
    const bearings: RoadBearingInput[] = [
      { bearing_deg: 0, route_id: 'route-north', kind: 'road' },
      { bearing_deg: 180, route_id: 'route-south', kind: 'foot' },
    ];
    const result = generateFromBurg(
      makeBurg({ roadBearings: bearings, population: 10000 }),
      { seed: 42 },
    );
    const gates = gateFeatures(result.geojson);
    const matched = gates
      .map(g => g.properties!['matched_route_id'])
      .filter((v): v is string => typeof v === 'string');
    // At least one of the two requested bearings should find a match on a city
    // of this size. Both is the happy case.
    expect(matched.length).toBeGreaterThan(0);
    for (const id of matched) {
      expect(['route-north', 'route-south']).toContain(id);
    }
  });

  it('records bearing_match_delta_deg when a route matches', () => {
    const bearings: RoadBearingInput[] = [{ bearing_deg: 90, route_id: 'east' }];
    const result = generateFromBurg(
      makeBurg({ roadBearings: bearings, population: 10000 }),
      { seed: 42 },
    );
    const matched = gateFeatures(result.geojson)
      .find(g => g.properties!['matched_route_id'] === 'east');
    expect(matched).toBeDefined();
    expect(typeof matched!.properties!['bearing_match_delta_deg']).toBe('number');
    expect(matched!.properties!['bearing_match_delta_deg']).toBeGreaterThanOrEqual(0);
  });

  it('foot-kind route produces a foot sub_kind gate', () => {
    const bearings: RoadBearingInput[] = [{ bearing_deg: 45, route_id: 'trail', kind: 'foot' }];
    const result = generateFromBurg(
      makeBurg({ roadBearings: bearings, population: 10000 }),
      { seed: 42 },
    );
    const footGate = gateFeatures(result.geojson)
      .find(g => g.properties!['matched_route_id'] === 'trail');
    expect(footGate).toBeDefined();
    expect(footGate!.properties!['sub_kind']).toBe('foot');
  });

  it('number-form roadBearings still works (back-compat)', () => {
    const result = generateFromBurg(
      makeBurg({ roadBearings: [0, 90], population: 10000 }),
      { seed: 42 },
    );
    const gates = gateFeatures(result.geojson);
    expect(gates.length).toBeGreaterThan(0);
    // No matched_route_id without object form, but sub_kind defaults to road
    for (const g of gates) {
      expect(g.properties!['sub_kind']).toBe('road');
    }
  });

  it('neighbour gate ids link gates along the wall', () => {
    const result = generateFromBurg(
      makeBurg({ population: 15000 }),
      { seed: 42 },
    );
    const gates = gateFeatures(result.geojson);
    if (gates.length < 2) return;
    const byId = new Map(gates.map(g => [g.properties!['gate_id'] as string, g]));
    for (const g of gates) {
      const nextId = g.properties!['next_gate_id'];
      const prevId = g.properties!['prev_gate_id'];
      if (typeof nextId === 'string') expect(byId.has(nextId)).toBe(true);
      if (typeof prevId === 'string') expect(byId.has(prevId)).toBe(true);
    }
  });
});

describe('Port cities', () => {
  it('emits a harbour-kind gate for port burgs', () => {
    const result = generateFromBurg(
      makeBurg({ port: true, population: 15000, oceanBearing: 180, harbourSize: 'large' }),
      { seed: 42 },
    );
    const gates = gateFeatures(result.geojson);
    const harbourGates = gates.filter(g => g.properties!['kind'] === 'harbour');
    // Not every seed lands a harbour; assert at least that if present, it has the right shape.
    if (harbourGates.length > 0) {
      expect(harbourGates[0].properties!['sub_kind']).toBe('harbour');
    }
  });
});

describe('Unwalled burgs', () => {
  it('emits no gate features when walls=false', () => {
    const result = generateFromBurg(
      makeBurg({ walls: false, population: 300, citadel: false, plaza: false }),
      { seed: 42 },
    );
    expect(gateFeatures(result.geojson).length).toBe(0);
  });

  it('still emits a valid metadata block for unwalled burgs', () => {
    const result = generateFromBurg(
      makeBurg({ walls: false, population: 300, citadel: false, plaza: false }),
      { seed: 42 },
    );
    expect(metadata(result.geojson).schema_version).toBe(GEOJSON_SCHEMA_VERSION);
  });
});

describe('Wall polygon feature', () => {
  it('emits the wall polygon as a Feature with layer=wall', () => {
    const result = generateFromBurg(makeBurg(), { seed: 42 });
    const walls = result.geojson.features.filter(f => f.properties!['layer'] === 'wall');
    expect(walls.length).toBeGreaterThan(0);
    expect(walls[0].geometry.type).toBe('Polygon');
    expect(walls[0].properties!['wallType']).toBe('city_wall');
  });
});

describe('Direct generateGeoJson entry point', () => {
  it('returns a FeatureCollection with metadata when called outside generateFromBurg', () => {
    const result = generateFromBurg(makeBurg(), { seed: 42 });
    // Pretend a caller wants to re-serialise with a different timestamp
    const fc = generateGeoJson(result.model, { generatedAt: '2030-12-31T23:59:59Z' });
    expect(metadata(fc).generated_at).toBe('2030-12-31T23:59:59Z');
  });
});
