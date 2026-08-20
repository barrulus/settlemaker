import { SeededRandom } from '../utils/random.js';
import { hasGlyph, nominalFootprint } from './glyphs.js';
import { DECK_GAP_M } from './constants.js';
import type { Site } from './types.js';

export interface DeckEntry {
  glyph: string;
  /** People per dwelling. 0 for non-residential landmarks. */
  occupancy: number;
  /** Relative frequency among uncapped entries. */
  weight: number;
  /** Semantic size multiplier — scales footprint AND occupancy. */
  sizeFactor: number;
  /** Metres. Defaults to the glyph's footprint width plus a gap. */
  minFrontage: number;
  /** Capped entries are placed once, before the ordinary draw. */
  cap?: 'one';
  requires?: { minPop?: number; flag?: 'temple' | 'trade' | 'port' };
}

// Footprints come from glyphs.ts — this module never touches the manifest.

function entry(
  glyph: string, occupancy: number, weight: number,
  extra: Partial<DeckEntry> = {},
): DeckEntry {
  return {
    glyph,
    occupancy,
    weight,
    sizeFactor: extra.sizeFactor ?? 1,
    minFrontage: extra.minFrontage
      ?? nominalFootprint(glyph)[0] * (extra.sizeFactor ?? 1) + DECK_GAP_M,
    cap: extra.cap,
    requires: extra.requires,
  };
}

/**
 * The raw declaration. This can name glyphs that are not (yet) in the
 * manifest — e.g. sm-chapel, which belongs to a symbol generation not yet
 * ingested here — because the deck's shape should not have to wait on
 * asset production. `deckFor` is what filters this down to what can
 * actually be placed today; consumers should call `deckFor`, not this
 * array, except where they specifically want the unfiltered set (tests).
 */
export const TEMPERATE_VILLAGE_DECK: DeckEntry[] = [
  entry('sm-house', 5, 60),
  entry('sm-hut-straw', 3, 20),
  entry('sm-house-tiled', 5, 12),
  entry('sm-longhouse', 12, 6),
  entry('sm-house-large-tiled', 6, 0, { cap: 'one', requires: { minPop: 250 } }),
  entry('sm-inn', 6, 0, { cap: 'one', sizeFactor: 1.5, requires: { minPop: 180 } }),
  entry('sm-chapel', 0, 0, { cap: 'one', requires: { minPop: 300 } }),
];

const BIOME_SUFFIX: Record<string, string> = {
  temperate: '', desert: '--desert', tundra: '--tundra',
  tropical: '--tropical', coastal: '--coastal',
};

/**
 * Resolve one entry's glyph for a biome: try the suffixed id, fall back to
 * the plain (temperate) id when the manifest doesn't carry a variant.
 * Whether a suffixed id exists is a manifest question, so glyphs.ts answers
 * it via hasGlyph. Biome sets are deliberately partial; today's manifest
 * (batch001) has NO biome-suffixed ids at all, so every biome resolves to
 * the temperate id — that is the fallback leg this function exists to
 * exercise, not a bug.
 */
function resolveGlyphFor(biome: string, glyph: string): string {
  const suffix = BIOME_SUFFIX[biome] ?? '';
  if (suffix === '') return glyph;
  const suffixed = `${glyph}${suffix}`;
  return hasGlyph(suffixed) ? suffixed : glyph;
}

/**
 * A deck is per biome, which is what stops a settlement mixing biome sets:
 * ids are resolved once, here, with the manifest's temperate fallback.
 *
 * R1: any entry whose resolved glyph is absent from the manifest is
 * dropped rather than placed at a fabricated size. Today that silently
 * drops sm-chapel (not yet in the loaded manifest generation) from every
 * biome — call `deckDropped` alongside this for a diagnostic that explains
 * a village missing its chapel.
 */
export function deckFor(biome: string): DeckEntry[] {
  return TEMPERATE_VILLAGE_DECK
    .map((e) => ({ ...e, glyph: resolveGlyphFor(biome, e.glyph) }))
    .filter((e) => hasGlyph(e.glyph));
}

/** The resolved glyph ids that `deckFor(biome)` drops for lacking a manifest entry. */
export function deckDropped(biome: string): string[] {
  return TEMPERATE_VILLAGE_DECK
    .map((e) => resolveGlyphFor(biome, e.glyph))
    .filter((glyph) => !hasGlyph(glyph));
}

/** Weighted mean occupancy over the uncapped entries. */
export function meanOccupancy(deck: DeckEntry[]): number {
  const pool = deck.filter((e) => !e.cap);
  const total = pool.reduce((s, e) => s + e.weight, 0);
  if (total === 0) return 5;
  return pool.reduce((s, e) => s + e.occupancy * e.weight, 0) / total;
}

export function eligible(entryValue: DeckEntry, site: Site, frontageM: number): boolean {
  if (frontageM < entryValue.minFrontage) return false;
  const req = entryValue.requires;
  if (!req) return true;
  if (req.minPop !== undefined && site.population < req.minPop) return false;
  if (req.flag !== undefined && !site.flags[req.flag]) return false;
  return true;
}

/**
 * Draw one ordinary entry. A capped entry leaves the pool once placed, and
 * an entry whose `requires` is unmet never enters it.
 */
export function drawEntry(
  deck: DeckEntry[], site: Site, frontageM: number,
  placed: Set<string>, rng: SeededRandom,
): DeckEntry | undefined {
  const pool = deck.filter((e) =>
    !e.cap && e.weight > 0 && !placed.has(e.glyph) && eligible(e, site, frontageM));
  const total = pool.reduce((s, e) => s + e.weight, 0);
  if (total === 0) return undefined;
  let roll = rng.float() * total;
  for (const e of pool) {
    roll -= e.weight;
    if (roll <= 0) return e;
  }
  return pool[pool.length - 1];
}
