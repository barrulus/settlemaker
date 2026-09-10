/** Village themes change materials without changing model geometry. */
import { describe, expect, it } from 'vitest';
import type { AzgaarBurgInput } from '../../src/input/azgaar-input.js';
import { renderVillage } from '../../src/village/render.js';
import { VILLAGE_BIOMES, villageThemeFor } from '../../src/village/theme.js';
import { generateVillage } from '../../src/village/village-model.js';

const base = (biome?: string): AzgaarBurgInput => ({
  name: 'Themed', population: 300, port: false, citadel: false, walls: false,
  plaza: false, temple: false, shanty: false, capital: false,
  roadBearings: [{ bearing_deg: 225, kind: 'road' }],
  ...(biome ? { biome } : {}),
} as AzgaarBurgInput);

describe('village theming', () => {
  it('uses the explicit temperate theme by default', () => {
    const model = generateVillage(base(), 1);
    expect(renderVillage(model)).toBe(renderVillage(model, 4, villageThemeFor('temperate')));
  });

  it('gives every biome the glyph set knows a ground of its own', () => {
    // The five the deck's BIOME_SUFFIX table resolves dwellings for. A biome
    // with sand houses should not stand on a temperate lawn.
    const grounds = new Set(VILLAGE_BIOMES.map((b) => villageThemeFor(b).ground));
    expect(VILLAGE_BIOMES.length).toBeGreaterThanOrEqual(5);
    expect(grounds.size, 'some biomes share a ground colour').toBe(VILLAGE_BIOMES.length);
  });

  it('actually paints the biome ground', () => {
    const temperate = renderVillage(generateVillage(base('temperate'), 1));
    const desert = renderVillage(generateVillage(base('desert'), 1));
    expect(temperate).toContain(villageThemeFor('temperate').ground);
    expect(desert).toContain(villageThemeFor('desert').ground);
    expect(desert).not.toContain(`fill="${villageThemeFor('temperate').ground}"`);
  });

  it('lets a caller override any slot, biome or not', () => {
    const m = generateVillage(base('temperate'), 1);
    const svg = renderVillage(m, 4, { ...villageThemeFor('temperate'), ground: '#123456' });
    expect(svg).toContain('#123456');
  });

  it('themes the symbol library\'s materials too, for snow and night', () => {
    // Ground alone is not enough: snow-covered houses and a night scene need
    // the material tokens the glyphs paint themselves with.
    const m = generateVillage(base('tundra'), 1);
    const svg = renderVillage(m, 4, {
      ...villageThemeFor('tundra'),
      tokens: { '--sm-ink': '#abcdef' },
    });
    expect(svg).toContain('--sm-ink:#abcdef');
  });

  it('falls back to temperate for a biome nobody has themed', () => {
    expect(villageThemeFor('klingon')).toEqual(villageThemeFor('temperate'));
    expect(villageThemeFor(undefined)).toEqual(villageThemeFor('temperate'));
  });
});
