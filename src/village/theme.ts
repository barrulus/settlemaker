/** Compatibility names for the shared regional appearance API. */
export {
  BIOMES as VILLAGE_BIOMES, TEMPERATE_THEME,
  normaliseBiome as normaliseVillageBiome, biomeThemeFor as villageThemeFor,
} from '../appearance/biomes.js';
export type { Biome as VillageBiome, BiomeTheme as VillageTheme } from '../appearance/biomes.js';
