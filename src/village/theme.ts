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
    // FLORA PASS 2026-09-07. The desert deck already draws the right PLANTS
    // (date palm, olive, scrub — not temperate trees recoloured), but they
    // drew at the library's default greens, which are a well-watered green.
    // Olive and scrub go khaki/grey-green and the palm fronds go dusty: a
    // desert village should read as sparse hardy growth on sand, not as a
    // temperate village whose lawn was repainted.
    tokens: {
      '--sm-yard': '#e6d8b4', '--sm-common': '#c9bd83',
      '--sm-olive': '#9a9c72', '--sm-olive-b': '#b6b48c',
      '--sm-dry': '#c2b884', '--sm-dry-b': '#d6cba0',
      '--sm-frond': '#6f8a4f', '--sm-needle': '#5e7452', '--sm-needle-b': '#7a8f68',
      '--sm-leaf': '#6b7a4c',
    },
  },
  // FLORA PASS 2026-09-07: tundra and coastal were LOOKED AT and deliberately
  // left alone. Tundra already draws dark snow-capped conifers and bare snags
  // on ice, which is right; coastal already draws grey-green tamarisk and dune
  // grass on bleached turf, which is also right. Changing them would have been
  // motion, not improvement.
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
    // FLORA PASS 2026-09-07. Tropical read MONOTONE, not wrong: broadleaf and
    // fan palms in the library's default green, scattered on a ground only a
    // little lighter than they are, so the canopy barely separated from the
    // turf. Deepened and saturated so a jungle village reads as dense growth
    // over ground rather than a green field with green marks on it.
    tokens: {
      '--sm-common': '#9ec96a',
      '--sm-leaf': '#1d4f26', '--sm-frond': '#266b2c',
      '--sm-canopy-a': '#2f6b32', '--sm-canopy-b': '#4d8a3a',
      '--sm-tamarisk': '#3d6f3d', '--sm-tamarisk-b': '#5f8a58',
    },
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
 * Azgaar/FMG's biome vocabulary (integer codes 0-12) mapped onto ours.
 *
 * WHY: every per-biome table in this engine — dwelling deck, field deck,
 * canopy deck, plot-edge treatment, theme — is an exact-match lookup on a
 * handful of lowercase keys, and FMG's names are almost entirely different
 * words. Measured on the shipped 2.0.0 bundle: 12 of the 13 fell through to
 * temperate, "tundra" being the only accidental collision, so "hot desert"
 * drew a green temperate village while desert ground, desert dwellings and
 * irrigated fields sat unreachable.
 *
 * The mapping is climate-family, not colour: `savanna` goes to tropical
 * because it IS a tropical biome, and `wetland`/`marine` to coastal because
 * coastal is our "more water about" look. These are judgement calls on a
 * provisional palette set — the owner gated all four non-temperate themes as
 * knowingly first-draft on 2026-09-07, intending to adjust flora later — so
 * changing a destination here is expected, and cheap.
 */
const FMG_BIOME_TO_VILLAGE: Readonly<Record<string, VillageBiome>> = {
  'marine': 'coastal',
  'hot desert': 'desert',
  'cold desert': 'desert',
  'savanna': 'tropical',
  'grassland': 'temperate',
  'tropical seasonal forest': 'tropical',
  'temperate deciduous forest': 'temperate',
  'tropical rainforest': 'tropical',
  'temperate rainforest': 'temperate',
  'taiga': 'tundra',
  'tundra': 'tundra',
  'glacier': 'tundra',
  'wetland': 'coastal',
};

/**
 * Biome keys this engine looks up that are NOT theme biomes. `steppe` has a
 * field deck (`BIOME_FIELD_DECKS`) but no ground of its own; normalising it
 * away to temperate would silently delete that deck, so it passes through.
 */
const EXTRA_CANONICAL_BIOMES = new Set(['steppe']);

/**
 * A caller's biome name → the biome this engine's tables are keyed by.
 *
 * Applied once, at the site boundary (`buildSite`), so the theme, the
 * dwellings, the fields, the canopies and the plot edges cannot disagree
 * about what the village is. Normalising in `villageThemeFor` alone would
 * give a "hot desert" village sand ground under temperate houses.
 *
 * Unknown names fall back to temperate, as they always did.
 */
export function normaliseVillageBiome(biome?: string): string {
  if (biome == null) return 'temperate';
  const key = biome.trim().toLowerCase();
  if (key === '') return 'temperate';
  if ((VILLAGE_BIOMES as readonly string[]).includes(key)) return key;
  if (EXTRA_CANONICAL_BIOMES.has(key)) return key;
  return Object.hasOwn(FMG_BIOME_TO_VILLAGE, key) ? FMG_BIOME_TO_VILLAGE[key] : 'temperate';
}

/**
 * The theme for a biome. Unknown or missing biome falls back to temperate —
 * which is also what `resolveGlyphFor` does with an unknown biome, so the
 * ground and the dwellings always agree about what they are.
 */
export function villageThemeFor(biome?: string): VillageTheme {
  // Normalised here as well as in `buildSite` so the exported helper is
  // correct on its own: a consumer handing it a raw FMG name straight off a
  // map gets the right ground rather than a silent temperate.
  const key = normaliseVillageBiome(biome);
  const over = Object.hasOwn(BIOME_THEMES, key) ? BIOME_THEMES[key] : {};
  return { ...TEMPERATE_THEME, ...over };
}
