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

const FLAT_DATA_PARAMS = [
  'name', 'pop', 'seed', 'port', 'citadel', 'walls', 'plaza', 'temple',
  'shanty', 'capital', 'trade', 'oceanBearing', 'harbourSize', 'biome', 'urbanDensity',
] as const;

function bool(params: URLSearchParams, key: string): boolean {
  const v = params.get(key);
  return v === '1' || v === 'true';
}

function num(params: URLSearchParams, key: string): number | undefined {
  const v = params.get(key);
  if (v === null) return undefined;
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
    ? (await decodeJsonParam(style)) as Partial<RenderTheme>
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
