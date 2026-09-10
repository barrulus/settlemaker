import { SeededRandom } from '../utils/random.js';
import { hasGlyph, nominalInkWidthM } from './glyphs.js';
import {
  DECK_GAP_M, F0_WEIGHT_SHARE_MIN, FAMILY_HUT_MAX_POP, LONGHOUSE_MIN_POP, LONGHOUSE_WEIGHT,
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
  /**
   * Gate 5.4: a HALL -- a longhouse or barn, not an ordinary dwelling.
   * Halls are placed by the ordinary draw like anything else, but they are
   * excluded from `widestDwellingWidthM`, which is R21's "widest COMMON
   * dwelling" and sets f0 (and with it every lot's width and the owner's
   * one-house-width gap rule).
   *
   * Before this flag, "is it an outlier?" was inferred from deck WEIGHT
   * alone. That conflated two independent things: how OFTEN a building is
   * placed, and whether it is the size the ordinary plot is cut for.
   * Raising the longhouse's weight to put more halls among the cottages
   * pushed it over F0_WEIGHT_SHARE_MIN and doubled f0 -- widening every lot
   * in the village to fit a building that drawEntry's own minFrontage
   * filter already declines to place on a narrow one.
   */
  hall?: true;
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
    hall: extra.hall,
    minFrontage: extra.minFrontage
      ?? nominalInkWidthM(glyph) * (extra.sizeFactor ?? 1) + DECK_GAP_M,
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
  // Household size, twice corrected. Gate 5.1 raised a hut from 3 ("3
  // people per house is completely unrealistic") to 6. Gate 5.3 walks it
  // back one: the objection was to an unrealistically SMALL household, not
  // a plea for a large one, and the reference village (watabou's St
  // Aldusa, pop 400, dense/organic) draws about one building per 3.3
  // people. A medieval household is 4-5, so a house takes 4 and a hut 5 --
  // a hut is one family in one room, a house is a family with more of its
  // floor given to living than to storage.
  //
  // The point is not the arithmetic: fewer heads per roof means MORE
  // roofs, the frontage demand rises, the escalation loop grows more lane,
  // and the interior fills instead of reading as meadow with a few houses
  // dropped on it.
  const occupancy = hutFamily ? 5 : 4;

  const entries: DeckEntry[] = [entry(dwelling, occupancy, 100)];
  if (!hutFamily && population >= LONGHOUSE_MIN_POP) {
    entries.push(entry('sm-longhouse', 12, LONGHOUSE_WEIGHT, { hall: true }));
  }
  // sm-house-large-tiled, sm-inn and sm-chapel used to live here as capped
  // one-off entries, lot-cut like any dwelling. Owner's ruling 2026-09-08:
  // "landmarks get their own ground, like the green does" -- they are now
  // sited directly by `skeleton/landmarks.ts` (siteLandmarks), on ground
  // minted at their own uncapped footprint, and must not also compete for a
  // width-capped ordinary lot here.
  return entries;
}

const BIOME_SUFFIX: Record<string, string> = {
  temperate: '', desert: '--desert', tundra: '--tundra',
  tropical: '--tropical', coastal: '--coastal',
};

/** Prefer the exact biome variant, then a native dwelling in the same
 * family, and only then the temperate fallback for an incomplete asset set. */
export function resolveGlyphFor(biome: string, glyph: string): string {
  const suffix = BIOME_SUFFIX[biome] ?? '';
  if (suffix === '') return glyph;
  const suffixed = `${glyph}${suffix}`;
  if (hasGlyph(suffixed)) return suffixed;
  // Prefer a native dwelling in the same family over a bare temperate roof.
  // The tundra set has house/hut/longhouse, not every material variant.
  const family = glyph === 'sm-house-tiled' ? 'sm-house'
    : glyph === 'sm-hut-straw' || glyph === 'sm-hut-round' ? 'sm-hut'
      : glyph === 'sm-house-large-tiled' ? 'sm-longhouse' : undefined;
  return family && hasGlyph(`${family}${suffix}`) ? `${family}${suffix}` : glyph;
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
  // Halls are excluded outright (gate 5.4): a longhouse is not the size the
  // ordinary plot is cut for, however often the deck places one.
  const pool = deck.filter((e) => !e.cap && e.weight > 0 && !e.hall);
  if (pool.length === 0) return 8;
  const totalWeight = pool.reduce((s, e) => s + e.weight, 0);
  const common = totalWeight > 0
    ? pool.filter((e) => e.weight / totalWeight >= F0_WEIGHT_SHARE_MIN)
    : [];
  const qualifying = common.length > 0 ? common : pool;
  return Math.max(...qualifying.map((e) => nominalInkWidthM(e.glyph) * e.sizeFactor));
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

/**
 * Gate 6.6: people per ORDINARY house -- the occupancy the disc is sized
 * from. `meanOccupancy` weights the longhouse's 12 heads into the mean, but
 * a longhouse needs an 11 m lot and the fabric rarely offers one, so the
 * mean over-states how many people a plot actually houses: measured at pop
 * 300, meanOccupancy says 4.98 while the finished village houses 4.0 per
 * building, and the disc came out a sixth too small before it escalated.
 * Halls and capped landmarks are excluded; the heaviest ordinary dwelling
 * entry is the village's one house type.
 */
export function ordinaryOccupancy(deck: DeckEntry[]): number {
  const pool = deck.filter((e) => !e.cap && e.weight > 0 && !e.hall);
  if (pool.length === 0) return meanOccupancy(deck);
  return pool.reduce((best, e) => (e.weight > best.weight ? e : best), pool[0]).occupancy;
}

/** Weighted mean occupancy over the uncapped entries. */
export function meanOccupancy(deck: DeckEntry[]): number {
  const pool = deck.filter((e) => !e.cap);
  const total = pool.reduce((s, e) => s + e.weight, 0);
  if (total === 0) return 5;
  return pool.reduce((s, e) => s + e.occupancy * e.weight, 0) / total;
}

/**
 * GATE 6.9. The same deck with `tightenM` shaved off every entry's frontage
 * demand, bounded below by the entry's own painted INK width.
 *
 * This exists because the escalation ladder's first rung is meaningless
 * without it. `DECK_GAP_M` (0.5) is baked into every `minFrontage`, and the
 * lot cutter floors at `minDwellingFrontageM` — so measured, the deck floor,
 * not `gapForPopulation`, is what decides how wide a lot comes out (5.94 m
 * against f0's 5.69 at pop 900). Tightening the gap term alone changed
 * nothing at all. Tightening BOTH is what "one notch tighter" actually
 * means, and the ink width is the floor it cannot pass: at zero gap two
 * neighbours' painted walls touch, which is the terrace the owner's
 * reference maps draw, and one centimetre further would be overlap.
 *
 * A pure transform — no `SeededRandom` is touched, so escalating cannot
 * shift the draw sequence that chose the village's dwelling family.
 */
export function tightenDeck(deck: DeckEntry[], tightenM: number): DeckEntry[] {
  if (tightenM <= 0) return deck;
  return deck.map((e) => ({
    ...e,
    minFrontage: Math.max(
      nominalInkWidthM(e.glyph) * e.sizeFactor,
      e.minFrontage - tightenM,
    ),
  }));
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
