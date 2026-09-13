/** Shared regional defaults for village and city rendering. */
/** Regional surface and shadow colours shared by both renderers. */
export interface BiomeTheme {
  /** The paper the settlement stands on (`data-bg="paper"`'s fill). */
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

export const TEMPERATE_THEME: BiomeTheme = {
  ground: '#a3c98d',
  water: '#85bcb2',
  waterEdge: '#6a968e',
  shadowColor: '#46303c',
  shadowOpacity: 0.2,
};

export const BIOMES = ['temperate', 'desert', 'tundra', 'tropical', 'coastal'] as const;

export type Biome = typeof BIOMES[number];

const BIOME_THEMES: Record<string, Partial<BiomeTheme>> = {
  temperate: {},
  desert: {
    // Sand, and the pale washed-out sky that goes with it. The dwellings
    // already resolve to `--desert` mud-brick variants.
    ground: '#dcc9a0',
    water: '#7fb3ad',
    waterEdge: '#638e89',
    shadowColor: '#6b5136',
    tokens: {
      '--sm-yard': '#e6d8b4', '--sm-common': '#c9bd83',
      '--sm-olive': '#9a9c72', '--sm-olive-b': '#b6b48c',
      '--sm-dry': '#c2b884', '--sm-dry-b': '#d6cba0',
      '--sm-frond': '#6f8a4f', '--sm-needle': '#5e7452', '--sm-needle-b': '#7a8f68',
      '--sm-leaf': '#6b7a4c',
    },
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

const FMG_BIOME_MAP: Readonly<Record<string, Biome>> = {
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

const EXTRA_CANONICAL_BIOMES = new Set(['steppe']);

export function normaliseBiome(biome?: string): string {
  if (biome == null) return 'temperate';
  const key = biome.trim().toLowerCase();
  if (key === '') return 'temperate';
  if ((BIOMES as readonly string[]).includes(key)) return key;
  if (EXTRA_CANONICAL_BIOMES.has(key)) return key;
  return Object.hasOwn(FMG_BIOME_MAP, key) ? FMG_BIOME_MAP[key] : 'temperate';
}

export function biomeThemeFor(biome?: string): BiomeTheme {
  // Normalised here as well as in `buildSite` so the exported helper is
  // correct on its own: a consumer handing it a raw FMG name straight off a
  // map gets the right ground rather than a silent temperate.
  const key = normaliseBiome(biome);
  const over = Object.hasOwn(BIOME_THEMES, key) ? BIOME_THEMES[key] : {};
  return { ...TEMPERATE_THEME, ...over };
}
