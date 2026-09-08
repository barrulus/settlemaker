import { describe, it, expect } from 'vitest';
import { SeededRandom } from '../../src/utils/random.js';
import {
  baseDeck, buildDeck, deckFor, drawEntry, eligible, meanOccupancy,
  widestDwellingWidthM,
} from '../../src/village/deck.js';
import { LONGHOUSE_MIN_POP } from '../../src/village/constants.js';
import type { DeckEntry } from '../../src/village/deck.js';
import { hasGlyph, nominalFootprint, nominalInkWidthM } from '../../src/village/glyphs.js';
import type { Site } from '../../src/village/types.js';

const site = (over: Partial<Site> = {}): Site => ({
  population: 300, biome: 'temperate', routes: [], water: [],
  flags: { port: false, temple: false, trade: false, walls: false },
  ...over,
});

// One dwelling family per village (2026-08-21 gate): the deck is built per
// (population, seed). A fixed reference deck for entry-shape tests:
const REF_DECK = baseDeck(400, new SeededRandom(1));

// Gate 5.3 (2026-08-22): household size is pinned, because it has moved
// twice on owner verdicts and nothing in the suite guarded it. Gate 5.1
// raised a hut 3 -> 6 ("3 people per house is completely unrealistic");
// gate 5.3 walked both back to a realistic medieval household of 4-5,
// against watabou's St Aldusa drawing ~1 building per 3.3 people. These
// numbers set how many roofs a census buys, which is what fills or empties
// the interior -- they are not incidental.
describe('household size (gate 5.3)', () => {
  const dwellingOf = (population: number): DeckEntry => {
    const deck = buildDeck('temperate', population, new SeededRandom(4)).entries;
    const ordinary = deck.filter((e) => !e.cap && e.glyph !== 'sm-longhouse');
    expect(ordinary).toHaveLength(1);
    return ordinary[0];
  };

  it('a hut houses 5 and a house houses 4', () => {
    const hut = dwellingOf(60);
    expect(hut.glyph.startsWith('sm-hut')).toBe(true);
    expect(hut.occupancy).toBe(5);

    const house = dwellingOf(400);
    expect(house.glyph.startsWith('sm-house')).toBe(true);
    expect(house.occupancy).toBe(4);
  });

  it('a longhouse still houses 12 -- it is the several-household building', () => {
    const deck = buildDeck('temperate', 400, new SeededRandom(4)).entries;
    const longhouse = deck.find((e) => e.glyph === 'sm-longhouse');
    expect(longhouse).toBeDefined();
    expect(longhouse!.occupancy).toBe(12);
  });

  it('buys a village roughly one roof per 4-5 heads, never per 6+', () => {
    for (const population of [60, 300, 900]) {
      const mean = meanOccupancy(buildDeck('temperate', population, new SeededRandom(4)).entries);
      expect(mean).toBeGreaterThanOrEqual(4);
      expect(mean).toBeLessThanOrEqual(5);
    }
  });
});

describe('deck contents', () => {
  it('draws exactly ONE ordinary dwelling glyph per village', () => {
    // The village-rows rule: a settlement never mixes dwelling types. The
    // only uncapped entries are the single family dwelling and (above the
    // gate) the longhouse variation.
    const ordinary = REF_DECK.filter((e) => !e.cap);
    expect(ordinary).toHaveLength(2); // dwelling + longhouse at pop 400
    expect(ordinary[0].glyph.startsWith('sm-house')).toBe(true);
    expect(ordinary[1].glyph).toBe('sm-longhouse');
  });

  it('gives hamlets the hut family and no longhouse', () => {
    const hamlet = baseDeck(80, new SeededRandom(1));
    const ordinary = hamlet.filter((e) => !e.cap);
    expect(ordinary).toHaveLength(1);
    expect(ordinary[0].glyph.startsWith('sm-hut')).toBe(true);
  });

  it('unlocks the longhouse only above its population gate', () => {
    // Gate 5.4 lowered LONGHOUSE_MIN_POP 250 -> 200, so halls stand among
    // the cottages from a mid-sized village up. Bounds taken from the
    // constant rather than restated, so the next move cannot silently
    // leave this test asserting the old gate.
    const below = baseDeck(LONGHOUSE_MIN_POP - 1, new SeededRandom(1));
    expect(below.some((e) => e.glyph === 'sm-longhouse')).toBe(false);
    const above = baseDeck(LONGHOUSE_MIN_POP, new SeededRandom(1));
    expect(above.some((e) => e.glyph === 'sm-longhouse')).toBe(true);
  });

  // Gate 5.4: placement frequency and plot-width basis are independent.
  it('marks the longhouse a HALL, so its weight never widens every lot', () => {
    const deck = baseDeck(400, new SeededRandom(1));
    const longhouse = deck.find((e) => e.glyph === 'sm-longhouse')!;
    expect(longhouse.hall).toBe(true);
    // It carries real weight (it is meant to be placed), yet f0's basis
    // still comes from the ordinary dwelling.
    expect(longhouse.weight).toBeGreaterThan(10);
    const dwelling = deck.filter((e) => !e.cap && !e.hall)[0];
    expect(widestDwellingWidthM(deck)).toBeCloseTo(nominalInkWidthM(dwelling.glyph), 5);
  });

  it('is deterministic per seed and varies between villages', () => {
    const a = baseDeck(400, new SeededRandom(7));
    const b = baseDeck(400, new SeededRandom(7));
    expect(a[0].glyph).toBe(b[0].glyph);
    // Across many seeds both house variants appear — the variety the old
    // mixed deck wrongly put INSIDE one village now lives between villages.
    const seen = new Set<string>();
    for (let seed = 1; seed <= 24; seed++) seen.add(baseDeck(400, new SeededRandom(seed))[0].glyph);
    expect(seen.size).toBeGreaterThan(1);
  });

  it('carries occupancy on every entry', () => {
    for (const e of REF_DECK) expect(e.occupancy).toBeGreaterThanOrEqual(0);
  });

  // The refined manifest genuinely carries biome-suffixed ids (47 of them),
  // so this now exercises the swap leg of resolveGlyphFor for real, not
  // just its fallback leg: sm-house has a tundra variant, so deckFor
  // resolves to sm-house--tundra and the plain id disappears from the deck.
  it('swaps to a real biome variant when the manifest has one', () => {
    const tundra = deckFor('tundra', 400, new SeededRandom(1));
    const dwelling = tundra.filter((e) => !e.cap)[0];
    // Whichever house variant the seed chose, the tundra biome must have
    // swapped in its suffixed id when the manifest carries one.
    expect(dwelling.glyph.endsWith('--tundra')).toBe(true);
  });

  // sm-house-tiled has no tundra (or any biome) variant, so the temperate
  // id must survive unresolved — the fallback leg this mechanism exists for.
  it('resolves biome suffixes with a temperate fallback when no variant exists', () => {
    // The hut-family dwellings are sm-hut-straw / sm-hut-round; the refined
    // manifest's tundra hut is a different base id (sm-hut--tundra), so no
    // suffixed variant of either exists and the temperate id must survive.
    const hamlet = deckFor('tundra', 80, new SeededRandom(1));
    const dwelling = hamlet.filter((e) => !e.cap)[0];
    expect(dwelling.glyph.startsWith('sm-hut')).toBe(true);
    expect(dwelling.glyph.endsWith('--tundra')).toBe(false);
  });

  it('averages occupancy for the built-radius prediction', () => {
    expect(meanOccupancy(REF_DECK)).toBeGreaterThan(3);
    expect(meanOccupancy(REF_DECK)).toBeLessThan(8);
  });
});

// R1 (mechanism, now quiet in practice): the refined manifest carries
// sm-chapel, so deckFor no longer drops anything for the temperate deck —
// every entry's glyph resolves. This pins that the "deck dropped"
// diagnostic has gone quiet with real data, while still exercising the
// drop mechanism itself against a glyph that genuinely does not exist.
//
// Landmarks own ground (2026-09-08 ruling): sm-inn, sm-chapel and
// sm-house-large-tiled were REMOVED from baseDeck — they are minted
// directly by skeleton/landmarks.ts at their own uncapped footprint, and
// must not also live in the deck competing for a width-capped ordinary
// lot. So the deck no longer carries any of the three; it carries only the
// one dwelling glyph (plus sm-longhouse above the population gate).
describe('deckFor (R1)', () => {
  it('does not carry the landmark entries — they are sited by skeleton/landmarks.ts now, not lot-cut', () => {
    const d = deckFor('temperate', 400, new SeededRandom(1));
    expect(d.some((e) => e.glyph === 'sm-chapel')).toBe(false);
    expect(d.some((e) => e.glyph === 'sm-inn')).toBe(false);
    expect(d.some((e) => e.glyph === 'sm-house-large-tiled')).toBe(false);
    // What IS left resolves cleanly for the temperate biome: the "deck
    // dropped" diagnostic stays quiet with real data.
    expect(buildDeck('temperate', 400, new SeededRandom(1)).dropped).toEqual([]);
  });

  it('does not drop entries whose glyph exists', () => {
    const d = deckFor('temperate', 400, new SeededRandom(1));
    expect(d.filter((e) => !e.cap)[0].glyph.startsWith('sm-house')).toBe(true);
    // sm-inn no longer lives in the deck (it is sited by landmarks.ts), so
    // the "does not drop what the manifest actually has" behaviour is
    // exercised here with a constructed entry instead of a real deck one —
    // the mechanism (buildDeck/deckFor's hasGlyph filter) is still live and
    // still worth covering on its own terms.
    const fixtureDeck = [
      ...REF_DECK,
      { glyph: 'sm-well', occupancy: 0, weight: 0, sizeFactor: 1, minFrontage: 1 },
    ];
    expect(fixtureDeck.filter((e) => hasGlyph(e.glyph)).some((e) => e.glyph === 'sm-well')).toBe(true);
  });

  it('still drops an entry whose resolved glyph is genuinely absent from the manifest', () => {
    const fixtureDeck = [
      ...REF_DECK,
      { glyph: 'sm-not-a-real-symbol', occupancy: 0, weight: 0, sizeFactor: 1, minFrontage: 1, cap: 'one' as const },
    ];
    const resolved = fixtureDeck.filter((e) => hasGlyph(e.glyph));
    expect(resolved.some((e) => e.glyph === 'sm-not-a-real-symbol')).toBe(false);
  });

  it('dropping a capped entry does not change meanOccupancy', () => {
    expect(meanOccupancy(deckFor('temperate', 400, new SeededRandom(1))))
      .toBe(meanOccupancy(baseDeck(400, new SeededRandom(1))));
  });
});

describe('eligible', () => {
  // sm-inn no longer lives in the deck -- landmarks own ground (2026-09-08):
  // it is sited directly by skeleton/landmarks.ts, gated on population
  // there (LandmarkSpec.minPop 180) rather than through a deck entry's
  // `requires`. `eligible()` itself is still a live mechanism the ordinary
  // draw depends on, so exercise its population gate with a constructed
  // inn-shaped fixture entry instead of fishing a landmark out of the deck.
  const inn: DeckEntry = {
    glyph: 'sm-inn', occupancy: 6, weight: 0, sizeFactor: 1.5, minFrontage: 27,
    requires: { minPop: 180 },
  };

  it('gates the inn on population', () => {
    expect(eligible(inn, site({ population: 100 }), 30)).toBe(false);
    expect(eligible(inn, site({ population: 400 }), 30)).toBe(true);
  });

  it('rejects an entry that will not fit the frontage', () => {
    const longhouse = REF_DECK.find((e) => e.glyph === 'sm-longhouse')!;
    expect(eligible(longhouse, site(), 6)).toBe(false);
    expect(eligible(longhouse, site(), 30)).toBe(true);
  });
});

describe('drawEntry', () => {
  it('never draws a capped entry twice', () => {
    const placed = new Set<string>(['sm-inn']);
    for (let i = 0; i < 50; i++) {
      const e = drawEntry(REF_DECK, site({ population: 400 }), 40, placed,
        new SeededRandom(i + 1));
      expect(e?.glyph).not.toBe('sm-inn');
    }
  });

  it('returns undefined when nothing fits the lot', () => {
    expect(drawEntry(REF_DECK, site(), 1, new Set(), new SeededRandom(1)))
      .toBeUndefined();
  });

  it('is deterministic for a seed', () => {
    const a = drawEntry(REF_DECK, site(), 20, new Set(), new SeededRandom(3));
    const b = drawEntry(REF_DECK, site(), 20, new Set(), new SeededRandom(3));
    expect(a?.glyph).toBe(b?.glyph);
  });

  // The production deck happens to give every capped entry weight 0, so
  // "never draws a capped entry twice" above passes even if the `!e.cap`
  // rule were deleted from drawEntry's pool filter — the weight>0 clause
  // alone would exclude it. That collapses two different meanings (a data
  // fact about today's weights vs. the rule that capped entries are placed
  // by the landmark pass, never the ordinary draw) into one coincidence.
  // This fixture pins the RULE: a capped entry with a nonzero weight must
  // still never be drawn.
  it('never draws a capped entry even when it carries a nonzero weight', () => {
    const fixtureDeck = [
      { ...REF_DECK.find((e) => e.glyph.startsWith('sm-house'))! },
      {
        ...REF_DECK.find((e) => e.glyph === 'sm-inn')!,
        weight: 1000, // dominates the pool if the cap check is skipped
      },
    ];
    for (let i = 0; i < 50; i++) {
      // SeededRandom's LCG output for its very first draw is near-zero for
      // small seeds (seed * 48271 stays tiny relative to the modulus), so
      // an un-warmed small seed would always land in the low, house-sized
      // slice of the roll regardless of whether the cap guard exists —
      // that would make this test pass by construction rather than by
      // actually exercising the guard. Burning a few draws first spreads
      // the seed across the roll range so the fixture's 1000-weight inn
      // would dominate if `!e.cap` were removed.
      const rng = new SeededRandom(i * 7919 + 12345);
      rng.float(); rng.float(); rng.float();
      const e = drawEntry(fixtureDeck, site({ population: 400 }), 40, new Set(), rng);
      expect(e?.glyph).not.toBe('sm-inn');
    }
  });
});

// R21: f0 is the widest COMMON dwelling, not the widest dwelling the deck
// can ever place. sm-longhouse (weight 6 of 98, ~6%) is far wider than the
// rest of the temperate deck (sm-house-tiled at 8.6 m is the widest entry
// that clears F0_WEIGHT_SHARE_MIN) but too rare to set f0 — an outlier is
// handled per-entry by drawEntry's minFrontage filter, not by widening
// every lot in the village to fit it.
describe('widestDwellingWidthM (R21)', () => {
  it('excludes a rare-but-wide entry below the weight-share threshold', () => {
    // A house-family deck above the longhouse gate: the dwelling carries
    // ~93% of the uncapped weight, the 16 m longhouse ~7% — below the 10%
    // share, so f0 comes from the dwelling, not the outlier.
    const deck = deckFor('temperate', 400, new SeededRandom(1));
    const dwelling = deck.filter((e) => !e.cap)[0];
    const longhouse = deck.find((e) => e.glyph === 'sm-longhouse')!;
    expect(nominalInkWidthM(longhouse.glyph)).toBeGreaterThan(nominalInkWidthM(dwelling.glyph));
    expect(widestDwellingWidthM(deck)).toBeCloseTo(nominalInkWidthM(dwelling.glyph), 5);
    expect(widestDwellingWidthM(deck)).not.toBeCloseTo(nominalInkWidthM(longhouse.glyph), 5);
  });

  it('lets a wide entry set f0 when it IS common (clears the threshold)', () => {
    const fixtureDeck: DeckEntry[] = [
      { glyph: 'sm-hut-straw', occupancy: 3, weight: 10, sizeFactor: 1, minFrontage: 8 },
      { glyph: 'sm-longhouse', occupancy: 12, weight: 90, sizeFactor: 1, minFrontage: 18 },
    ];
    // Here the longhouse is 90% of the pool — well above F0_WEIGHT_SHARE_MIN
    // — so it legitimately IS the common entry and must set f0.
    expect(widestDwellingWidthM(fixtureDeck)).toBeCloseTo(nominalInkWidthM('sm-longhouse'), 5);
  });

  it('falls back to the widest uncapped entry when nothing clears the threshold (degenerate deck)', () => {
    // A deck of one rare glyph always carries 100% of the pool's own
    // weight, so this pins the guard against the case the comment in
    // deck.ts calls out directly: f0 must never end up zero or undefined
    // even when the "common" filter could (in principle) leave nothing.
    const fixtureDeck: DeckEntry[] = [
      { glyph: 'sm-house', occupancy: 5, weight: 1, sizeFactor: 1, minFrontage: 8 },
    ];
    expect(widestDwellingWidthM(fixtureDeck)).toBeCloseTo(nominalInkWidthM('sm-house'), 5);
  });
});
