import { describe, it, expect } from 'vitest';
import { SeededRandom } from '../../src/utils/random.js';
import {
  TEMPERATE_VILLAGE_DECK, deckFor, deckDropped, drawEntry, eligible, meanOccupancy,
} from '../../src/village/deck.js';
import { hasGlyph } from '../../src/village/glyphs.js';
import type { Site } from '../../src/village/types.js';

const site = (over: Partial<Site> = {}): Site => ({
  population: 300, biome: 'temperate', routes: [], water: [],
  flags: { port: false, temple: false, trade: false, walls: false },
  ...over,
});

describe('deck contents', () => {
  it('has a house as its commonest entry', () => {
    const top = [...TEMPERATE_VILLAGE_DECK].sort((a, b) => b.weight - a.weight)[0];
    expect(top.glyph).toBe('sm-house');
  });

  it('carries occupancy on every entry', () => {
    for (const e of TEMPERATE_VILLAGE_DECK) expect(e.occupancy).toBeGreaterThanOrEqual(0);
  });

  // The refined manifest genuinely carries biome-suffixed ids (47 of them),
  // so this now exercises the swap leg of resolveGlyphFor for real, not
  // just its fallback leg: sm-house has a tundra variant, so deckFor
  // resolves to sm-house--tundra and the plain id disappears from the deck.
  it('swaps to a real biome variant when the manifest has one', () => {
    expect(deckFor('tundra').some((e) => e.glyph === 'sm-house--tundra')).toBe(true);
    expect(deckFor('tundra').some((e) => e.glyph === 'sm-house')).toBe(false);
  });

  // sm-house-tiled has no tundra (or any biome) variant, so the temperate
  // id must survive unresolved — the fallback leg this mechanism exists for.
  it('resolves biome suffixes with a temperate fallback when no variant exists', () => {
    expect(deckFor('tundra').some((e) => e.glyph === 'sm-house-tiled')).toBe(true);
  });

  it('averages occupancy for the built-radius prediction', () => {
    expect(meanOccupancy(TEMPERATE_VILLAGE_DECK)).toBeGreaterThan(3);
    expect(meanOccupancy(TEMPERATE_VILLAGE_DECK)).toBeLessThan(8);
  });
});

// R1 (mechanism, now quiet in practice): the refined manifest carries
// sm-chapel, so deckFor no longer drops anything for the temperate deck —
// every entry's glyph resolves. This pins that the "deck dropped"
// diagnostic has gone quiet with real data, while still exercising the
// drop mechanism itself against a glyph that genuinely does not exist.
describe('deckFor (R1)', () => {
  it('does not drop the temperate deck any more — sm-chapel is in the manifest', () => {
    expect(deckFor('temperate').some((e) => e.glyph === 'sm-chapel')).toBe(true);
    expect(deckDropped('temperate')).toEqual([]);
  });

  it('does not drop entries whose glyph exists', () => {
    expect(deckFor('temperate').some((e) => e.glyph === 'sm-house')).toBe(true);
    expect(deckFor('temperate').some((e) => e.glyph === 'sm-inn')).toBe(true);
  });

  it('still drops an entry whose resolved glyph is genuinely absent from the manifest', () => {
    const fixtureDeck = [
      ...TEMPERATE_VILLAGE_DECK,
      { glyph: 'sm-not-a-real-symbol', occupancy: 0, weight: 0, sizeFactor: 1, minFrontage: 1, cap: 'one' as const },
    ];
    const resolved = fixtureDeck.filter((e) => hasGlyph(e.glyph));
    expect(resolved.some((e) => e.glyph === 'sm-not-a-real-symbol')).toBe(false);
  });

  it('dropping a capped entry does not change meanOccupancy', () => {
    expect(meanOccupancy(deckFor('temperate'))).toBe(meanOccupancy(TEMPERATE_VILLAGE_DECK));
  });
});

describe('eligible', () => {
  const inn = TEMPERATE_VILLAGE_DECK.find((e) => e.glyph === 'sm-inn')!;

  it('gates the inn on population', () => {
    expect(eligible(inn, site({ population: 100 }), 30)).toBe(false);
    expect(eligible(inn, site({ population: 400 }), 30)).toBe(true);
  });

  it('rejects an entry that will not fit the frontage', () => {
    const longhouse = TEMPERATE_VILLAGE_DECK.find((e) => e.glyph === 'sm-longhouse')!;
    expect(eligible(longhouse, site(), 6)).toBe(false);
    expect(eligible(longhouse, site(), 30)).toBe(true);
  });
});

describe('drawEntry', () => {
  it('never draws a capped entry twice', () => {
    const placed = new Set<string>(['sm-inn']);
    for (let i = 0; i < 50; i++) {
      const e = drawEntry(TEMPERATE_VILLAGE_DECK, site({ population: 400 }), 40, placed,
        new SeededRandom(i + 1));
      expect(e?.glyph).not.toBe('sm-inn');
    }
  });

  it('returns undefined when nothing fits the lot', () => {
    expect(drawEntry(TEMPERATE_VILLAGE_DECK, site(), 1, new Set(), new SeededRandom(1)))
      .toBeUndefined();
  });

  it('is deterministic for a seed', () => {
    const a = drawEntry(TEMPERATE_VILLAGE_DECK, site(), 20, new Set(), new SeededRandom(3));
    const b = drawEntry(TEMPERATE_VILLAGE_DECK, site(), 20, new Set(), new SeededRandom(3));
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
      { ...TEMPERATE_VILLAGE_DECK.find((e) => e.glyph === 'sm-house')! },
      {
        ...TEMPERATE_VILLAGE_DECK.find((e) => e.glyph === 'sm-inn')!,
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
