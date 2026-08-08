import type { AzgaarBurgInput } from '../input/azgaar-input.js';
import type { RenderTheme } from '../output/render-theme.js';
import { decodeBurgParam, decodeJsonParam } from './codec.js';

export interface ParsedSettlementUrl {
  burg: AzgaarBurgInput;
  seedOverride?: number;
  /** theme= preset name; caller validates against PALETTES. */
  paletteName?: string;
  /** style= decoded overrides, merged over the palette-derived theme. */
  themeOverrides?: Partial<RenderTheme>;
  /** True when no data params were present and a demo burg was synthesized. */
  random: boolean;
}

const HEX_COLOR = /^#[0-9a-fA-F]{3,8}$/;

/** Non-nullable color-string slots on RenderTheme. */
const THEME_COLOR_KEYS = [
  'paper', 'fieldFill', 'fieldFurrow', 'greenFill', 'treeFill',
  'roadCasing', 'roadCore', 'buildingFill', 'buildingStroke',
  'landmarkFill', 'shadowColor',
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
] as const;

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

  return {
    burg,
    ...(seedOverride !== undefined ? { seedOverride } : {}),
    ...(paletteName !== undefined ? { paletteName } : {}),
    ...(themeOverrides !== undefined ? { themeOverrides } : {}),
    random,
  };
}
