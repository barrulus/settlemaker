/**
 * Village theming (ship plan Phase 4, owner's ruling 2026-09-06).
 *
 * The symbol library already carries per-biome dwellings — the deck's
 * `BIOME_SUFFIX` resolves `--desert`, `--tundra`, `--tropical` and
 * `--coastal` variants, and the refined set ships snow, mud, sand and dry
 * materials. Before this, a desert village drew sand houses on a temperate
 * green lawn, because the renderer's ground was a constant. The ground has
 * to be able to follow the biome the glyphs already follow.
 *
 * THE TEMPERATE THEME IS THE APPROVED LOOK. Its values are exactly the
 * constants the renderer carried before theming existed, so a temperate
 * village is byte-identical to what the owner signed off at every gate. Every
 * other biome is a starting point for his eye, not a finished palette.
 */

/** Slots the village renderer paints from. */
export interface VillageTheme {
  /** The paper the whole village stands on (`data-bg="paper"`'s fill). */
  ground: string;
  water: string;
  waterEdge: string;
  shadowColor: string;
  shadowOpacity: number;
  /**
   * Overrides for the refined symbol library's material tokens — the colours
   * the GLYPHS paint themselves with (`--sm-ink`, `--sm-snow`, `--sm-stone`
   * and the rest). Ground alone cannot express a night scene or snow-covered
   * roofs; those live here. Merged over the library's own values, so a theme
   * names only what it changes.
   */
  tokens?: Record<string, string | number>;
}

/**
 * The approved temperate look, value for value as the renderer carried it
 * before theming. Do not "tidy" these numbers: they are a gate verdict.
 */
export const TEMPERATE_THEME: VillageTheme = {
  ground: '#a3c98d',
  water: '#85bcb2',
  waterEdge: '#6a968e',
  shadowColor: '#46303c',
  shadowOpacity: 0.2,
};

/**
 * The biomes the glyph set resolves dwellings for (`deck.ts`'s
 * `BIOME_SUFFIX`). Kept in step with that table: a biome with its own houses
 * should have its own ground, or the houses stand on the wrong colour.
 */
export const VILLAGE_BIOMES = ['temperate', 'desert', 'tundra', 'tropical', 'coastal'] as const;

export type VillageBiome = typeof VILLAGE_BIOMES[number];

/**
 * Starting palettes, one per biome the glyphs know. Each names only what it
 * changes from temperate.
 *
 * These are FIRST DRAFTS for the owner's eye — the temperate one is the only
 * gate-approved palette here. Water darkens with latitude, ground follows the
 * material the dwellings are made of, and shadow warms or cools with the
 * light the scene implies.
 */
const BIOME_THEMES: Record<string, Partial<VillageTheme>> = {
  temperate: {},
  desert: {
    // Sand, and the pale washed-out sky that goes with it. The dwellings
    // already resolve to `--desert` mud-brick variants.
    ground: '#dcc9a0',
    water: '#7fb3ad',
    waterEdge: '#638e89',
    shadowColor: '#6b5136',
    tokens: { '--sm-yard': '#e6d8b4', '--sm-common': '#c9bd83' },
  },
  tundra: {
    // Snow. The library ships `--sm-snow` for the roofs; the ground has to
    // agree with them or the houses float on grass.
    ground: '#e4eaee',
    water: '#9fc0cc',
    waterEdge: '#7b98a3',
    shadowColor: '#4a5566',
    tokens: { '--sm-common': '#cfd9de', '--sm-crop': '#d8dee2' },
  },
  tropical: {
    // Wetter, greener, and darker under canopy.
    ground: '#8ec27c',
    water: '#6fb5a8',
    waterEdge: '#568e84',
    shadowColor: '#3a4a33',
    tokens: { '--sm-common': '#9ec96a' },
  },
  coastal: {
    // Temperate, but bleached toward the sea and with more of it about.
    ground: '#a8c795',
    water: '#8bc0bb',
    waterEdge: '#6d9995',
    shadowColor: '#41414a',
  },
};

/**
 * The theme for a biome. Unknown or missing biome falls back to temperate —
 * which is also what `resolveGlyphFor` does with an unknown biome, so the
 * ground and the dwellings always agree about what they are.
 */
export function villageThemeFor(biome?: string): VillageTheme {
  const over = (biome != null && Object.hasOwn(BIOME_THEMES, biome))
    ? BIOME_THEMES[biome] : {};
  return { ...TEMPERATE_THEME, ...over };
}
