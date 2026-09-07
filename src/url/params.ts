import type { AzgaarBurgInput } from '../input/azgaar-input.js';
import type { RenderTheme } from '../output/render-theme.js';
import { decodeBurgParam, decodeJsonParam, UrlCodecError } from './codec.js';
import { VILLAGE_BIOMES } from '../village/theme.js';
import { ROUTE_CLASS_ORDER, type RouteType } from '../village/route-class.js';

export interface ParsedSettlementUrl {
  burg: AzgaarBurgInput;
  seedOverride?: number;
  /** theme= preset name; caller validates against PALETTES. */
  paletteName?: string;
  /** style= decoded overrides, merged over the palette-derived theme. */
  themeOverrides?: Partial<RenderTheme>;
  /**
   * villageTheme= an explicit village look, e.g. 'desert'. Village branch
   * only: pass it through `villageThemeFor` into `generateSettlement`'s
   * `village.theme`. Deliberately distinct from `biome=`, which also picks
   * the dwelling/field/canopy decks, and from `theme=`, which is the city
   * palette. Parsed for both branches so a caller need not know which engine
   * will run; ignored by the settlement branch. Left UNDEFINED when absent so
   * the renderer's own `villageThemeFor(site.biome)` default still applies.
   */
  villageThemeName?: string;
  /** True when no data params were present and a demo burg was synthesized. */
  random: boolean;
}

const HEX_COLOR = /^#[0-9a-fA-F]{3,8}$/;

/** Non-nullable color-string slots on RenderTheme. */
const THEME_COLOR_KEYS = [
  'paper', 'fieldFill', 'fieldFurrow', 'greenFill', 'treeFill',
  'roadCasing', 'roadCore', 'buildingFill', 'buildingStroke',
  'landmarkFill', 'shadowColor',
  'smInk', 'smStone', 'smTimber', 'smVoid', 'smCanopy1', 'smCanopy2',
] as const;

/** Nullable color-string slots on RenderTheme (also accept `null`). */
const THEME_NULLABLE_COLOR_KEYS = ['water', 'waterEdge'] as const;

/** Finite-number slots on RenderTheme. */
const THEME_NUMBER_KEYS = [
  'shadowOpacity', 'arteryWidth', 'roadWidth', 'casingDelta', 'seamStroke', 'shoreWidth',
] as const;

function isHexColor(v: unknown): v is string {
  return typeof v === 'string' && HEX_COLOR.test(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Whitelist-validates a decoded `style=` payload against the real
 * `RenderTheme` shape. Every value is untrusted attacker-controlled input
 * (it flows raw into SVG `style` rules and attribute values via
 * `themeToCss`/`assembleSvg`), so unknown keys and values of the wrong
 * shape are dropped silently rather than passed through — this is the only
 * gate between a `style=` URL param and injected SVG/CSS.
 */
export function sanitizeThemeOverrides(value: unknown): Partial<RenderTheme> {
  const out: Partial<RenderTheme> = {};
  if (value === null || typeof value !== 'object') return out;
  const src = value as Record<string, unknown>;

  for (const key of THEME_COLOR_KEYS) {
    const v = src[key];
    if (isHexColor(v)) out[key] = v;
  }
  for (const key of THEME_NULLABLE_COLOR_KEYS) {
    const v = src[key];
    if (v === null || isHexColor(v)) out[key] = v === null ? null : v;
  }
  for (const key of THEME_NUMBER_KEYS) {
    const v = src[key];
    if (isFiniteNumber(v)) out[key] = v;
  }
  const offset = src.shadowOffset;
  if (offset !== null && typeof offset === 'object') {
    const { dx, dy } = offset as Record<string, unknown>;
    if (isFiniteNumber(dx) && isFiniteNumber(dy)) out.shadowOffset = { dx, dy };
  }

  return out;
}

const FLAT_DATA_PARAMS = [
  'name', 'pop', 'seed', 'port', 'citadel', 'walls', 'plaza', 'temple',
  'shanty', 'capital', 'trade', 'oceanBearing', 'harbourSize', 'biome', 'urbanDensity', 'coreCapacity',
  'roads',
] as const;

/**
 * `roads=` — approach roads in the flat tier.
 *
 * WHY: `roadBearings` was reachable only through the compressed `i=`
 * envelope, so a hand-built link or the builder page produced a village with
 * NOTHING connecting it to the outside. For a city that is cosmetic; for a
 * village it is structural, because the engine synthesises its whole road
 * network inward from bearings on the contract circle. Measured before this
 * existed: no bearings meant no main roads at all and no lane reaching the
 * village's own boundary.
 *
 * Syntax: comma-separated `bearing[:class[:through]]`, e.g.
 *   roads=45,170,290                 three terminating main roads
 *   roads=45:trail,170:royal         explicit classes
 *   roads=45:main:through            a road that passes through
 *
 * Bearings are normalised into 0..359 so -90 and 450 are both legal. An
 * unrecognised class is a hard error rather than a silent fall back to
 * `main`, for the same reason `villageTheme=` is: a typo that quietly works
 * is indistinguishable from the feature not working.
 */
function parseRoads(raw: string): AzgaarBurgInput['roadBearings'] {
  const out: { bearing_deg: number; kind: RouteType; through: boolean }[] = [];
  for (const entry of raw.split(',')) {
    const piece = entry.trim();
    if (piece === '') continue;
    const [bearingRaw, kindRaw, throughRaw] = piece.split(':').map(s => s.trim());
    const bearing = Number(bearingRaw);
    if (!Number.isFinite(bearing)) {
      throw new UrlCodecError('roads',
        `roads="${piece}" — bearing must be a number, e.g. roads=45 or roads=45:main:through`);
    }
    const kind = (kindRaw === undefined || kindRaw === '') ? 'main' : kindRaw;
    if (!(ROUTE_CLASS_ORDER as readonly string[]).includes(kind)) {
      throw new UrlCodecError('roads',
        `roads="${piece}" — unknown class "${kind}"; known classes: ${ROUTE_CLASS_ORDER.join(', ')}`);
    }
    if (throughRaw !== undefined && throughRaw !== '' && throughRaw !== 'through') {
      throw new UrlCodecError('roads',
        `roads="${piece}" — third field may only be "through"`);
    }
    out.push({
      bearing_deg: ((bearing % 360) + 360) % 360,
      kind: kind as RouteType,
      through: throughRaw === 'through',
    });
  }
  return out;
}

function bool(params: URLSearchParams, key: string): boolean {
  const v = params.get(key);
  return v === '1' || v === 'true';
}

function num(params: URLSearchParams, key: string): number | undefined {
  const v = params.get(key);
  if (v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Default demo burg: everything derives from one seed so the bare URL
 * self-demos deterministically per draw. Feature flags switch on with
 * population so small draws read as hamlets and large ones as towns.
 */
function demoBurg(seed: number): AzgaarBurgInput {
  const population = 200 + (Math.abs(seed) % 4800);
  return {
    name: `Burg ${Math.abs(seed) % 10000}`,
    population,
    port: false,
    citadel: population > 3500,
    walls: population > 1500,
    plaza: population > 800,
    temple: population > 2000,
    shanty: false,
    capital: false,
  };
}

/**
 * URL → generation inputs. Tiers per the spec: `i=` (compressed envelope)
 * wins over every flat data param; `theme=`/`style=` are presentation and
 * apply in both tiers; no data params at all → random demo burg.
 * Throws UrlCodecError on malformed `i=`/`style=` — callers show it, they
 * never swallow it into a blank page.
 */
export async function parseSettlementUrl(
  params: URLSearchParams,
  opts: { randomSeed?: () => number } = {},
): Promise<ParsedSettlementUrl> {
  let burg: AzgaarBurgInput;
  let seedOverride: number | undefined;
  let random = false;

  const i = params.get('i');
  if (i !== null) {
    const decoded = await decodeBurgParam(i);
    burg = decoded.burg;
    seedOverride = decoded.seed;
  } else if (FLAT_DATA_PARAMS.some(k => params.has(k))) {
    const name = params.get('name') ?? `Burg ${num(params, 'seed') ?? num(params, 'pop') ?? 0}`;
    const roadsRaw = params.get('roads');
    const harbourSizeRaw = params.get('harbourSize');
    const urbanDensity = num(params, 'urbanDensity');
    const coreCapacity = num(params, 'coreCapacity');
    const oceanBearing = num(params, 'oceanBearing');
    burg = {
      name,
      population: num(params, 'pop') ?? 300,
      port: bool(params, 'port'),
      citadel: bool(params, 'citadel'),
      walls: bool(params, 'walls'),
      plaza: bool(params, 'plaza'),
      temple: bool(params, 'temple'),
      shanty: bool(params, 'shanty'),
      capital: bool(params, 'capital'),
      ...(bool(params, 'trade') ? { trade: true } : {}),
      ...(oceanBearing !== undefined ? { oceanBearing } : {}),
      ...(harbourSizeRaw === 'large' || harbourSizeRaw === 'small' ? { harbourSize: harbourSizeRaw } : {}),
      ...(params.get('biome') !== null ? { biome: params.get('biome')! } : {}),
      ...(roadsRaw !== null ? { roadBearings: parseRoads(roadsRaw) } : {}),
      ...(urbanDensity !== undefined && urbanDensity > 0 ? { urbanDensity } : {}),
      ...(coreCapacity !== undefined && coreCapacity > 0 ? { coreCapacity } : {}),
    };
    seedOverride = num(params, 'seed');
  } else {
    const seed = (opts.randomSeed ?? (() => Math.floor(Math.random() * 2 ** 31)))();
    burg = demoBurg(seed);
    seedOverride = seed;
    random = true;
  }

  const style = params.get('style');
  const themeOverrides = style !== null
    ? sanitizeThemeOverrides(await decodeJsonParam(style))
    : undefined;
  const paletteName = params.get('theme') ?? undefined;
  const villageThemeName = params.get('villageTheme') ?? undefined;
  // Validated HERE, not left to each consumer (ruling 2026-09-07). An unknown
  // name that quietly rendered temperate would be indistinguishable from
  // passing nothing — the exact "looks live, does nothing" failure the biome
  // normalisation in this release exists to remove. Throwing means every
  // consumer, including ones that have not migrated yet, gets the error free
  // and none of them can forget to look. The legal set is the shipped themes.
  if (villageThemeName !== undefined
      && !(VILLAGE_BIOMES as readonly string[]).includes(villageThemeName)) {
    throw new UrlCodecError('villageTheme',
      `villageTheme="${villageThemeName}" — known village themes: ${VILLAGE_BIOMES.join(', ')}`);
  }

  return {
    burg,
    ...(seedOverride !== undefined ? { seedOverride } : {}),
    ...(paletteName !== undefined ? { paletteName } : {}),
    ...(themeOverrides !== undefined ? { themeOverrides } : {}),
    ...(villageThemeName !== undefined ? { villageThemeName } : {}),
    random,
  };
}
