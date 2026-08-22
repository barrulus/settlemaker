import { SeededRandom } from '../utils/random.js';
import { hasGlyph, nominalFootprint } from './glyphs.js';
import {
  DECK_GAP_M, F0_WEIGHT_SHARE_MIN, FAMILY_HUT_MAX_POP, LONGHOUSE_MIN_POP,
} from './constants.js';
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
 * One dwelling family per village — the village-rows rule, restored at the
 * 2026-08-21 gate ("I thought we agreed one home type per village"): a
 * settlement never mixes hut and house families, and within the family it
 * draws exactly ONE ordinary dwelling glyph, chosen per village. The
 * longhouse is the only in-family variation and only above
 * LONGHOUSE_MIN_POP; everything else is a capped POI.
 *
 * The raw declaration can name glyphs not (yet) in the manifest —
 * `buildDeck` filters to what can actually be placed and reports what it
 * dropped, so a village missing its chapel is explainable at a gate.
 */
export function baseDeck(population: number, rng: SeededRandom): DeckEntry[] {
  // The LCG's FIRST draw from a small seed is tiny (~seed * 2.2e-5), so a
  // per-village choice made on it would land the same way for every seed a
  // human is likely to type. One discarded draw decorrelates it. This is a
  // deck-local warm-up, not a fix to SeededRandom — the old engine pins the
  // raw sequence and must not change.
  rng.float();
  const hutFamily = population < FAMILY_HUT_MAX_POP;
  // Exactly one ordinary dwelling glyph, chosen per village (seeded): the
  // variety between villages that the old mixed deck wrongly put INSIDE
  // one village.
  const dwelling = hutFamily
    ? (rng.bool(0.5) ? 'sm-hut-straw' : 'sm-hut-round')
    : (rng.bool(0.7) ? 'sm-house' : 'sm-house-tiled');
  // Gate 5.1: a hut houses a FAMILY, 6, not 3 -- the owner's "3 people per
  // house is completely unrealistic". A pop-60 hamlet therefore needs ~10
  // huts rather than 20, which is what lets them all fit around the green.
  const occupancy = hutFamily ? 6 : 5;

  const entries: DeckEntry[] = [entry(dwelling, occupancy, 100)];
  if (!hutFamily && population >= LONGHOUSE_MIN_POP) {
    entries.push(entry('sm-longhouse', 12, 8));
  }
  entries.push(
    // No sizeFactor on the landmarks: the batch001 era scaled a 7 m inn up
    // by 1.5 because the art was house-sized; the refined glyphs bake their
    // semantic size into the footprint itself (inn 17x15, chapel 14x16).
    // Keeping the old multiplier double-scaled the inn to a 27 m frontage
    // demand no village lot could meet — it silently never placed.
    entry('sm-house-large-tiled', 6, 0, { cap: 'one', requires: { minPop: 250 } }),
    entry('sm-inn', 6, 0, { cap: 'one', requires: { minPop: 180 } }),
    entry('sm-chapel', 0, 0, { cap: 'one', requires: { minPop: 300 } }),
  );
  return entries;
}

const BIOME_SUFFIX: Record<string, string> = {
  temperate: '', desert: '--desert', tundra: '--tundra',
  tropical: '--tropical', coastal: '--coastal',
};

/**
 * Resolve one entry's glyph for a biome: try the suffixed id, fall back to
 * the plain (temperate) id when the manifest doesn't carry a variant.
 * Whether a suffixed id exists is a manifest question, so glyphs.ts answers
 * it via hasGlyph. Biome sets are deliberately partial — the refined set
 * covers dwellings and wells per biome but not every id — so the fallback
 * leg is ordinary behaviour, not an error path.
 */
export function resolveGlyphFor(biome: string, glyph: string): string {
  const suffix = BIOME_SUFFIX[biome] ?? '';
  if (suffix === '') return glyph;
  const suffixed = `${glyph}${suffix}`;
  // Both legs are live since the refined 91-symbol ingest (2026-08-21):
  // the house family resolves to real --tundra/--desert/... variants, and
  // ids without a variant (the huts' base ids, the landmark set) take the
  // temperate fallback. deck.test.ts pins one of each.
  return hasGlyph(suffixed) ? suffixed : glyph;
}

/**
 * A deck is per biome AND per village: biome resolution stops a settlement
 * mixing biome sets, and the seeded family/glyph choice gives each village
 * exactly one dwelling type.
 *
 * R1: any entry whose resolved glyph is absent from the manifest is
 * dropped rather than placed at a fabricated size; `dropped` reports the
 * ids so the caller can record a diagnostic.
 */
export function buildDeck(
  biome: string, population: number, rng: SeededRandom,
): { entries: DeckEntry[]; dropped: string[] } {
  const resolved = baseDeck(population, rng)
    .map((e) => ({ ...e, glyph: resolveGlyphFor(biome, e.glyph) }));
  return {
    entries: resolved.filter((e) => hasGlyph(e.glyph)),
    dropped: resolved.filter((e) => !hasGlyph(e.glyph)).map((e) => e.glyph),
  };
}

/** Convenience wrapper where the drop report is not needed (tests). */
export function deckFor(biome: string, population: number, rng: SeededRandom): DeckEntry[] {
  return buildDeck(biome, population, rng).entries;
}

/**
 * Spec §5.2: `f0` (the frontage cut width) is "the widest common dwelling
 * in the deck" plus a gap term. "Common" means an uncapped entry — the
 * ordinary draw, not a one-off landmark such as the chapel or inn — AND
 * one that actually gets drawn often: R21 reads "common" as carrying at
 * least F0_WEIGHT_SHARE_MIN of the uncapped pool's total weight. Without
 * that second filter a rare-but-wide outlier (the refined manifest's
 * sm-longhouse: weight 6 of 98, ~6% of draws, but 16 m wide) sets f0 for
 * every lot in the village — 94% of lots pay for a dwelling that will
 * essentially never land there. The outlier does not need f0 to widen
 * every lot on its behalf: drawEntry already filters by minFrontage, so a
 * narrow lot simply declines to place it. "widest" is the qualifying
 * entry's resolved footprint width times its size factor. Finding 5: this
 * used to be a bare literal `8` in village-model.ts, unrelated to the deck
 * it claimed to describe (sm-house is 6 wide, sm-longhouse is 10) — that
 * batch001 gap is long since closed, but the "unrelated to what most lots
 * actually need" failure mode is exactly what R21 addresses again here.
 *
 * Degenerate case: if nothing clears the weight-share threshold (e.g. a
 * deck of a single rare glyph), fall back to the widest uncapped entry
 * regardless of share, so f0 is never zero or undefined.
 */
export function widestDwellingWidthM(deck: DeckEntry[]): number {
  const pool = deck.filter((e) => !e.cap && e.weight > 0);
  if (pool.length === 0) return 8;
  const totalWeight = pool.reduce((s, e) => s + e.weight, 0);
  const common = totalWeight > 0
    ? pool.filter((e) => e.weight / totalWeight >= F0_WEIGHT_SHARE_MIN)
    : [];
  const qualifying = common.length > 0 ? common : pool;
  return Math.max(...qualifying.map((e) => nominalFootprint(e.glyph)[0] * e.sizeFactor));
}

/**
 * The narrowest frontage at which the ordinary draw can still place
 * SOMETHING. Lots cut below this are dead on arrival — eligible() rejects
 * every uncapped entry — so the parcel cutter uses it as a hard floor.
 */
export function minDwellingFrontageM(deck: DeckEntry[]): number {
  const pool = deck.filter((e) => !e.cap && e.weight > 0);
  if (pool.length === 0) return 8;
  return Math.min(...pool.map((e) => e.minFrontage));
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
