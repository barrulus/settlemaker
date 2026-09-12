import { SETTLEMENT_SET, type AssetSet } from './asset-sets.js';
import { ARTWORK_MANIFEST, ART_TOKENS } from './artwork.js';
import { SM_TOKENS } from './refined-style.js';
import { skinSvg } from './skin-svg.js';
import { normaliseVillageBiome, villageThemeFor, VILLAGE_BIOMES, TEMPERATE_THEME, type VillageTheme } from '../village/theme.js';
import { themeFrom, type RenderTheme } from '../output/render-theme.js';
import { PALETTES } from '../output/palette.js';

export const SKIN_VERSION = 1 as const;
export type SkinBaseBiome = typeof VILLAGE_BIOMES[number] | 'steppe';
export interface SkinGlyph { body: string; sil?: string }
export interface SkinStyle {
  glyphs?: Record<string, SkinGlyph>;
  tokens?: Record<string, string | number>;
  village?: Partial<Omit<VillageTheme, 'tokens'>>;
  city?: Partial<RenderTheme>;
}
export interface SkinBiome extends SkinStyle {
  /** Existing terrain behaviour used for generation, independently of the artwork. */
  base: SkinBaseBiome;
  aliases?: string[];
}
/** JSON-serializable authoring format. Omitted artwork inherits the bundled set. */
export interface SkinDefinition extends SkinStyle {
  version: typeof SKIN_VERSION;
  id: string;
  name: string;
  biomes?: Record<string, SkinBiome>;
}

declare const validatedSkin: unique symbol;
/** Created by createSkin; immutable and safe to reuse across requests. */
export interface SettlementSkin {
  readonly id: string;
  readonly name: string;
  readonly version: typeof SKIN_VERSION;
  readonly [validatedSkin]: true;
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Placement contracts for authoring replacements; never modify engine metadata. */
export const SKIN_SLOTS = freeze(JSON.parse(JSON.stringify(ARTWORK_MANIFEST))) as Readonly<typeof ARTWORK_MANIFEST>;
export const SKIN_TOKENS = freeze({ ...SM_TOKENS, ...ART_TOKENS });
const definitions = new WeakMap<SettlementSkin, SkinDefinition>();
const ID = /^[a-z][a-z0-9-]*$/;
const COLOR = /^(?:#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})|none|transparent|currentColor)$/i;

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path}: expected an object`);
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[], path: string): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`${path}.${key}: unknown property`);
}
function theme(value: unknown, template: object, path: string): void {
  const obj = record(value, path);
  keys(obj, Object.keys(template), path);
  for (const [key, val] of Object.entries(obj)) {
    if (key === 'shadowOffset') {
      const offset = record(val, `${path}.${key}`);
      keys(offset, ['dx', 'dy'], `${path}.${key}`);
      if (![offset.dx, offset.dy].every(n => typeof n === 'number' && Number.isFinite(n))) throw new Error(`${path}.${key}: expected finite dx and dy`);
    } else if (typeof (template as Record<string, unknown>)[key] === 'number') {
      if (typeof val !== 'number' || !Number.isFinite(val) || val < 0 || (key === 'shadowOpacity' && val > 1)) throw new Error(`${path}.${key}: invalid number`);
    } else if (!(val === null && (key === 'water' || key === 'waterEdge') && path.endsWith('.city')) && (typeof val !== 'string' || !COLOR.test(val))) {
      throw new Error(`${path}.${key}: expected a hex colour or paint keyword`);
    }
  }
}

function style(obj: Record<string, unknown>, path: string, prefix: string): void {
  if (obj.tokens !== undefined) {
    for (const [key, val] of Object.entries(record(obj.tokens, `${path}.tokens`))) {
      if (!/^--[a-z0-9-]+$/.test(key) || !(typeof val === 'number' ? Number.isFinite(val) && val >= 0 : typeof val === 'string' && COLOR.test(val))) throw new Error(`${path}.tokens.${key}: invalid token`);
    }
  }
  if (obj.village !== undefined) theme(obj.village, TEMPERATE_THEME, `${path}.village`);
  if (obj.city !== undefined) theme(obj.city, themeFrom(PALETTES.default), `${path}.city`);
  if (obj.glyphs !== undefined) {
    for (const [id, raw] of Object.entries(record(obj.glyphs, `${path}.glyphs`))) {
      if (!Object.hasOwn(SKIN_SLOTS, id)) throw new Error(`${path}.glyphs.${id}: unknown artwork slot; see SKIN_SLOTS`);
      const glyph = record(raw, `${path}.glyphs.${id}`);
      keys(glyph, ['body', 'sil'], `${path}.glyphs.${id}`);
      if (typeof glyph.body !== 'string' || !glyph.body.trim()) throw new Error(`${path}.glyphs.${id}.body: artwork is required`);
      glyph.body = skinSvg(glyph.body, `${path}.glyphs.${id}.body`, `${prefix}-${id}-body`);
      if (glyph.sil !== undefined) glyph.sil = skinSvg(glyph.sil, `${path}.glyphs.${id}.sil`, `${prefix}-${id}-sil`);
    }
  }
}

/** Validate and compile a JSON object. Errors identify the invalid property. */
export function createSkin(input: unknown): SettlementSkin {
  // Copy before compilation; the caller's source JSON remains reusable and editable.
  const source = record(input, 'skin');
  const obj = record(structuredClone(source), 'skin');
  const styleKeys = ['glyphs', 'tokens', 'village', 'city'];
  keys(obj, ['version', 'id', 'name', 'biomes', ...styleKeys], 'skin');
  if (obj.version !== SKIN_VERSION) throw new Error(`skin.version: expected ${SKIN_VERSION}`);
  if (typeof obj.id !== 'string' || !ID.test(obj.id)) throw new Error('skin.id: expected a lowercase slug');
  if (typeof obj.name !== 'string' || !obj.name.trim()) throw new Error('skin.name: expected a display name');
  style(obj, 'skin', `skin-${obj.id}`);
  if (obj.biomes !== undefined) {
    const biomes = record(obj.biomes, 'skin.biomes');
    const names = new Set(Object.keys(biomes));
    for (const [key, raw] of Object.entries(biomes)) {
      if (!ID.test(key)) throw new Error(`skin.biomes.${key}: expected a lowercase slug`);
      const biome = record(raw, `skin.biomes.${key}`);
      keys(biome, ['base', 'aliases', ...styleKeys], `skin.biomes.${key}`);
      if (![...VILLAGE_BIOMES, 'steppe'].includes(biome.base as SkinBaseBiome)) throw new Error(`skin.biomes.${key}.base: unknown terrain behaviour`);
      if (biome.aliases !== undefined) {
        if (!Array.isArray(biome.aliases)) throw new Error(`skin.biomes.${key}.aliases: expected an array`);
        for (const alias of biome.aliases) {
          if (typeof alias !== 'string' || !alias.trim() || names.has(alias.trim().toLowerCase())) throw new Error(`skin.biomes.${key}.aliases: empty or duplicate alias`);
          names.add(alias.trim().toLowerCase());
        }
      }
      style(biome, `skin.biomes.${key}`, `skin-${obj.id}-${key}`);
    }
  }
  const skin = Object.freeze({ id: obj.id, name: obj.name, version: SKIN_VERSION }) as SettlementSkin;
  definitions.set(skin, freeze(obj) as unknown as SkinDefinition);
  return skin;
}

function definition(skin: SettlementSkin): SkinDefinition {
  const def = definitions.get(skin);
  if (!def) throw new Error('Invalid skin: use createSkin to load a skin definition');
  return def;
}

/** Resolve custom names/aliases first, then the existing FMG biome vocabulary. */
export function skinBiomeFor(skin: SettlementSkin, biome?: string): { name: string; base: SkinBaseBiome } {
  const def = definition(skin);
  const key = biome?.trim().toLowerCase() || 'temperate';
  const name = Object.hasOwn(def.biomes ?? {}, key) ? key
    : Object.entries(def.biomes ?? {}).find(([, b]) => b.aliases?.some(a => a.trim().toLowerCase() === key))?.[0]
      ?? normaliseVillageBiome(key);
  const preset = Object.hasOwn(def.biomes ?? {}, name) ? def.biomes![name] : undefined;
  return { name, base: preset?.base ?? normaliseVillageBiome(name) as SkinBaseBiome };
}

/** Internal render context, built without global registration or mutable defaults. */
export function resolveSkin(skin: SettlementSkin, biome?: string): {
  assets: AssetSet; overrides: Set<string>; village: VillageTheme; city: Partial<RenderTheme>; tokens: Record<string, string | number>;
} {
  const def = definition(skin);
  const { name, base } = skinBiomeFor(skin, biome);
  const preset = Object.hasOwn(def.biomes ?? {}, name) ? def.biomes![name] : undefined;
  const tokens = { ...villageThemeFor(base).tokens, ...def.tokens, ...preset?.tokens };
  const glyphs = { ...SETTLEMENT_SET.glyphs };
  const replacements = { ...def.glyphs, ...preset?.glyphs };
  for (const [id, art] of Object.entries(replacements)) {
    glyphs[id] = { ...glyphs[id], body: art.body, sil: art.sil ?? '' };
  }
  return {
    assets: { ...SETTLEMENT_SET, glyphs },
    overrides: new Set(Object.keys(replacements)),
    village: { ...villageThemeFor(base), ...def.village, ...preset?.village, tokens },
    city: { ...def.city, ...preset?.city }, tokens,
  };
}
