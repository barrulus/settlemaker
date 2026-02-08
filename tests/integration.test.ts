import { describe, it, expect } from 'vitest';
import { generateFromBurg, type AzgaarBurgInput } from '../src/index.js';

function makeBurg(overrides: Partial<AzgaarBurgInput> = {}): AzgaarBurgInput {
  return {
    name: 'TestBurg',
    population: 5000,
    port: false,
    citadel: true,
    walls: true,
    plaza: true,
    temple: true,
    shanty: false,
    capital: false,
    ...overrides,
  };
}

describe('Integration: generateFromBurg', () => {
  it('generates a walled town with citadel', () => {
    const result = generateFromBurg(makeBurg(), { seed: 42 });
    expect(result.model.patches.length).toBeGreaterThan(0);
    expect(result.model.inner.length).toBeGreaterThan(0);
    expect(result.model.wall).not.toBeNull();
    expect(result.model.citadel).not.toBeNull();
    expect(result.model.plaza).not.toBeNull();
    expect(result.model.gates.length).toBeGreaterThan(0);
    expect(result.model.arteries.length).toBeGreaterThan(0);
  });

  it('generates valid SVG', () => {
    const result = generateFromBurg(makeBurg(), { seed: 42 });
    expect(result.svg).toMatch(/^<svg xmlns/);
    expect(result.svg).toMatch(/<\/svg>$/);
    expect(result.svg.length).toBeGreaterThan(1000);
  });

  it('generates valid GeoJSON', () => {
    const result = generateFromBurg(makeBurg(), { seed: 42 });
    expect(result.geojson.type).toBe('FeatureCollection');
    expect(result.geojson.features.length).toBeGreaterThan(0);

    // Check feature types
    const layers = new Set(result.geojson.features.map(f => f.properties!['layer']));
    expect(layers.has('ward')).toBe(true);
    expect(layers.has('building')).toBe(true);
    expect(layers.has('street')).toBe(true);
    expect(layers.has('wall')).toBe(true);
    expect(layers.has('gate')).toBe(true);
  });

  it('is deterministic', () => {
    const r1 = generateFromBurg(makeBurg(), { seed: 12345 });
    const r2 = generateFromBurg(makeBurg(), { seed: 12345 });
    expect(r1.svg).toBe(r2.svg);
    expect(r1.geojson.features.length).toBe(r2.geojson.features.length);
  });

  it('produces different output for different seeds', () => {
    const r1 = generateFromBurg(makeBurg(), { seed: 1 });
    const r2 = generateFromBurg(makeBurg(), { seed: 2 });
    expect(r1.svg).not.toBe(r2.svg);
  });

  it('generates a hamlet (tiny population)', () => {
    const result = generateFromBurg(makeBurg({
      population: 30,
      citadel: false, walls: false, plaza: false, temple: false,
    }), { seed: 42 });
    expect(result.model.patches.length).toBeGreaterThan(0);
    expect(result.model.wall).toBeNull();
    expect(result.model.citadel).toBeNull();
    expect(result.svg.length).toBeGreaterThan(100);
  });

  it('generates an unwalled village', () => {
    const result = generateFromBurg(makeBurg({
      population: 500,
      walls: false, citadel: false,
    }), { seed: 42 });
    expect(result.model.wall).toBeNull();
    expect(result.model.citadel).toBeNull();
    expect(result.model.patches.length).toBeGreaterThan(0);
  });

  it('generates a large city', () => {
    const result = generateFromBurg(makeBurg({
      population: 50000,
      capital: true, shanty: true,
    }), { seed: 42 });
    expect(result.model.inner.length).toBeGreaterThan(20);
    expect(result.model.gates.length).toBeGreaterThan(0);
  });
});
