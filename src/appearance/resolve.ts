import { biomeThemeFor, BIOMES, type BiomeTheme } from './biomes.js';
import { ART_TOKENS } from '../assets/artwork-data.js';
import { SM_TOKENS } from '../assets/refined-style.js';
import type { resolveSkin } from '../assets/skins.js';
import type { Palette } from '../types/interfaces.js';
import { paletteForBiome } from '../output/palette.js';
import { blend, cssHex, themeFrom, type RenderTheme } from '../output/render-theme.js';

/** Map a material's tone onto the selected palette, including reversed palettes. */
export function themedMaterial(color: string, palette: Palette): string {
  if (!/^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(color)) return color;
  const expanded = color.length <= 5 ? [...color.slice(1)].map(c => c + c).join('') : color.slice(1);
  const rgb = parseInt(expanded.slice(0, 6), 16);
  const alpha = expanded.slice(6);
  const tone = (((rgb >> 16) & 255) * .2126 + ((rgb >> 8) & 255) * .7152 + (rgb & 255) * .0722) / 255;
  const stops = [palette.dark, palette.medium, palette.light, palette.paper];
  const position = tone * 3;
  const index = Math.min(2, Math.floor(position));
  return cssHex(blend(stops[index], stops[index + 1], position - index)) + alpha;
}

const SYMBOL_SLOTS = {
  smInk: '--sm-ink', smStone: '--sm-stone', smTimber: '--sm-timber',
  smVoid: '--sm-void', smCanopy1: '--sm-canopy-a', smCanopy2: '--sm-canopy-b',
} as const;

/** One appearance calculation for both renderers. Geometry never enters here. */
export function resolveAppearance(
  biome?: string, palette?: Palette, style: Partial<RenderTheme> = {},
  skin?: ReturnType<typeof resolveSkin>,
): { city: RenderTheme; village: BiomeTheme; tokens: Record<string, string | number> } {
  const regional = biomeThemeFor(biome);
  const overrides = Object.fromEntries(Object.entries(style).filter(([, value]) => value !== undefined));
  const city: RenderTheme = {
    ...themeFrom(palette ?? paletteForBiome(biome)),
    ...(!palette ? {
      waterEdge: regional.waterEdge, shadowColor: regional.shadowColor,
      shadowOpacity: regional.shadowOpacity, roadCore: '#dfd3b3', ...skin?.city,
    } : {}),
    ...overrides,
  };
  const tokens: Record<string, string | number> = {
    ...SM_TOKENS, ...ART_TOKENS, ...regional.tokens, ...skin?.tokens,
  };
  if (palette) {
    for (const [key, value] of Object.entries(tokens)) {
      if (typeof value === 'string') tokens[key] = themedMaterial(value, palette);
    }
  }
  const explicit = { ...(!palette ? skin?.city : {}), ...overrides };
  for (const [key, token] of Object.entries(SYMBOL_SLOTS)) {
    if (palette || Object.hasOwn(explicit, key)) tokens[token] = city[key as keyof typeof SYMBOL_SLOTS];
  }
  // Native artwork uses regional material tokens as well as the legacy symbols.
  // Use the same semantic colours for both building catalogues and for every biome.
  for (const b of BIOMES) {
    for (const family of ['city', 'village']) {
      if (palette || explicit.buildingFill !== undefined) tokens[`--sm-${family}-${b}-roof`] = city.buildingFill;
      if (palette || explicit.smStone !== undefined) tokens[`--sm-${family}-${b}-wall`] = city.smStone;
      if (palette || explicit.smTimber !== undefined) tokens[`--sm-${family}-${b}-wood`] = city.smTimber;
      if (palette || explicit.landmarkFill !== undefined) tokens[`--sm-${family}-${b}-accent`] = city.landmarkFill;
    }
    if (palette || explicit.greenFill !== undefined) tokens[`--sm-green-${b}-turf`] = city.greenFill;
    if (palette || explicit.treeFill !== undefined) tokens[`--sm-landscape-${b}-leaf`] = city.treeFill;
    if (palette || explicit.fieldFill !== undefined) tokens[`--sm-landscape-${b}-soil`] = city.fieldFill;
    if (palette || explicit.water !== undefined) {
      tokens[`--sm-landscape-${b}-water`] = city.water ?? 'none';
      tokens[`--sm-infra-${b}-water`] = city.water ?? 'none';
    }
  }
  tokens['--sm-shadow-color'] = city.shadowColor;
  tokens['--sm-shadow-opacity'] = city.shadowOpacity;
  const village: BiomeTheme = { ...(skin?.village ?? regional), tokens };
  for (const [key, target] of Object.entries({
    paper: 'ground', water: 'water', waterEdge: 'waterEdge',
    shadowColor: 'shadowColor', shadowOpacity: 'shadowOpacity',
  } as const)) {
    if (palette || Object.hasOwn(overrides, key)) {
      Object.assign(village, { [target]: city[key as keyof RenderTheme] ?? 'none' });
    }
  }
  return { city, village, tokens };
}
