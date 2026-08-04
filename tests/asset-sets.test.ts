import { describe, it, expect } from 'vitest';
import { generateFromBurg, WardType, type AzgaarBurgInput } from '../src/index.js';
import { SCHEMATIC_SET, assetSetFor } from '../src/assets/asset-sets.js';

const parky: AzgaarBurgInput = {
  name: 'Parkville',
  population: 2500,
  port: false, citadel: false, walls: true,
  plaza: true, temple: true, shanty: false, capital: false,
};

describe('asset sets', () => {
  it('starter set has a tree symbol and is the default for any biome', () => {
    expect(SCHEMATIC_SET.symbols.tree).toContain('circle');
    expect(assetSetFor(undefined).name).toBe('schematic');
    expect(assetSetFor('desert').name).toBe('schematic');
  });

  it('park groves gain deterministic tree instances rendered as <use>', () => {
    // Pop 2500 with temple+walls reliably rolls Park wards across seeds is
    // NOT guaranteed — find greens first, assert conditionally but strictly.
    const { svg, model } = generateFromBurg(parky);
    const hasPark = model.patches.some(p => p.ward?.type === WardType.Park && p.ward.geometry.length > 0);
    if (!hasPark) {
      // Fixture must produce a park for the test to mean anything — fail loudly
      // so the implementer picks a different name/seed rather than skipping.
      throw new Error('Fixture produced no park ward; adjust the fixture name (new seed) until one exists.');
    }
    expect(svg).toContain('<symbol id="asset-tree"');
    expect(svg.match(/<use href="#asset-tree"/g)!.length).toBeGreaterThan(0);
    expect(svg).toContain('#greens use{fill:');
  });

  it('vegetation is deterministic', () => {
    const a = generateFromBurg(parky).svg;
    const b = generateFromBurg(parky).svg;
    expect(a).toBe(b);
  });
});
