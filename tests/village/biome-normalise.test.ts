/**
 * FMG biome names must reach the village biome tables.
 *
 * WHY (found 2026-09-07, owner-gated the same day): every per-biome table in
 * the village engine — the dwelling deck, the field deck, the canopy deck, the
 * plot-edge treatment and the theme — is keyed by `site.biome` and looked up by
 * EXACT match against a handful of lowercase keys. Azgaar's Fantasy Map
 * Generator sends its own biome vocabulary (integer codes 0-12, names taken
 * here from questables' own `terrain-naming.js`), and only one of the thirteen
 * — "tundra" — happens to collide with a key we use.
 *
 * Measured against the shipped 2.0.0 bundle before the fix: 12 of 13 real FMG
 * biome names fell through to temperate, so "hot desert" drew a green temperate
 * village while the desert theme, desert dwellings and irrigated fields all sat
 * there unreachable. The biome parameter looked live and was inert.
 *
 * The normalisation therefore belongs at the SITE boundary, not in the theme:
 * if only `villageThemeFor` normalised, a "hot desert" village would take sand
 * ground while its dwellings and fields stayed temperate, and the ground and
 * the buildings would disagree about what they are.
 */
import { describe, it, expect } from 'vitest';
import { normaliseVillageBiome, VILLAGE_BIOMES, villageThemeFor, TEMPERATE_THEME } from '../../src/village/theme.js';
import { buildSite } from '../../src/village/site.js';
import type { AzgaarBurgInput } from '../../src/input/azgaar-input.js';

/**
 * Azgaar/FMG biome integer codes 0-12, verbatim from questables'
 * `server/llm/context/terrain-naming.js`. This is the real vocabulary the
 * consumer sends; if FMG ever renumbers, this list is the thing to update.
 */
const FMG_BIOME_NAMES = [
  'marine', 'hot desert', 'cold desert', 'savanna', 'grassland',
  'tropical seasonal forest', 'temperate deciduous forest', 'tropical rainforest',
  'temperate rainforest', 'taiga', 'tundra', 'glacier', 'wetland',
];

function burg(biome?: string): AzgaarBurgInput {
  return {
    name: 'Ashford', population: 400, port: false, citadel: false, walls: false,
    plaza: true, temple: true, shanty: false, capital: false,
    ...(biome !== undefined ? { biome } : {}),
  };
}

describe('village biome normalisation', () => {
  it('maps every FMG biome name onto a biome the village tables know', () => {
    for (const name of FMG_BIOME_NAMES) {
      const got = normaliseVillageBiome(name);
      expect(VILLAGE_BIOMES as readonly string[]).toContain(got);
    }
  });

  it('does not collapse the FMG vocabulary onto temperate', () => {
    // The regression this whole change exists for. Before the fix this was
    // 12 of 13; temperate is a legitimate destination for some names, so the
    // bar is "the hot ones and the cold ones get somewhere else", not "none".
    const fellBack = FMG_BIOME_NAMES.filter(n => normaliseVillageBiome(n) === 'temperate');
    expect(fellBack.length).toBeLessThanOrEqual(3);
  });

  it('sends the desert names to desert and the frozen names to tundra', () => {
    expect(normaliseVillageBiome('hot desert')).toBe('desert');
    expect(normaliseVillageBiome('cold desert')).toBe('desert');
    expect(normaliseVillageBiome('taiga')).toBe('tundra');
    expect(normaliseVillageBiome('glacier')).toBe('tundra');
    expect(normaliseVillageBiome('tundra')).toBe('tundra');
    expect(normaliseVillageBiome('tropical rainforest')).toBe('tropical');
    expect(normaliseVillageBiome('temperate deciduous forest')).toBe('temperate');
    expect(normaliseVillageBiome('marine')).toBe('coastal');
  });

  it('passes an already-canonical biome through untouched', () => {
    for (const b of VILLAGE_BIOMES) expect(normaliseVillageBiome(b)).toBe(b);
    // `steppe` has a field deck but no theme; it must stay reachable rather
    // than being normalised away to temperate.
    expect(normaliseVillageBiome('steppe')).toBe('steppe');
  });

  it('is case- and whitespace-insensitive, and falls back to temperate', () => {
    expect(normaliseVillageBiome('Hot Desert')).toBe('desert');
    expect(normaliseVillageBiome('  TUNDRA  ')).toBe('tundra');
    expect(normaliseVillageBiome(undefined)).toBe('temperate');
    expect(normaliseVillageBiome('')).toBe('temperate');
    expect(normaliseVillageBiome('not a biome at all')).toBe('temperate');
  });

  it('normalises at the site boundary, so every per-biome table agrees', () => {
    // The point of doing it here and not in villageThemeFor: site.biome is
    // what the dwelling, field, canopy and edge decks are keyed by too.
    expect(buildSite(burg('hot desert')).biome).toBe('desert');
    expect(buildSite(burg('glacier')).biome).toBe('tundra');
    expect(buildSite(burg()).biome).toBe('temperate');
  });

  it('gives an FMG desert village the desert ground, not temperate', () => {
    const site = buildSite(burg('hot desert'));
    expect(villageThemeFor(site.biome).ground).not.toBe(TEMPERATE_THEME.ground);
    expect(villageThemeFor(site.biome).ground).toBe(villageThemeFor('desert').ground);
  });
});
