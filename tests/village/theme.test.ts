/**
 * Village theming (ship plan Phase 4, bullet 1 — owner's option 1).
 *
 * The owner's reason, which is better than the plan's: the symbol library
 * already carries per-biome dwellings (desert, tundra, tropical, coastal
 * variants, plus snow and mud materials), so a desert village draws sand
 * houses on a green temperate lawn. The GROUND has to be able to follow the
 * biome the glyphs already follow.
 *
 * The hard constraint is that today's temperate look is gate-approved and
 * must not move: a temperate village is byte-identical to what it was before
 * theming existed.
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { generateVillage } from '../../src/village/village-model.js';
import { renderVillage } from '../../src/village/render.js';
import { villageThemeFor, VILLAGE_BIOMES } from '../../src/village/theme.js';
import type { AzgaarBurgInput } from '../../src/input/azgaar-input.js';

const base = (biome?: string): AzgaarBurgInput => ({
  name: 'Themed', population: 300, port: false, citadel: false, walls: false,
  plaza: false, temple: false, shanty: false, capital: false,
  roadBearings: [{ bearing_deg: 225, kind: 'road' }],
  ...(biome ? { biome } : {}),
} as AzgaarBurgInput);

describe('village theming', () => {
  it('leaves a temperate village byte-identical to the approved look', () => {
    // Same hash Phase 2 pinned, taken from the renderer before either the
    // water band or theming existed. Theming must be a no-op by default.
    const svg = renderVillage(generateVillage({
      name: 'Dry', population: 300, port: false, citadel: false, walls: false,
      plaza: false, temple: false, shanty: false, capital: false,
      roadBearings: [{ bearing_deg: 225, kind: 'road' }],
    } as AzgaarBurgInput, 1));
    expect(createHash('sha256').update(svg).digest('hex'))
      .toBe('d0b2f4073d031de40f812f222458f39689ae50e0401c7e5b5b08333cefdf8542');
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
