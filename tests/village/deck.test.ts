import { describe, it, expect } from 'vitest';
import { SeededRandom } from '../../src/utils/random.js';
import {
  TEMPERATE_VILLAGE_DECK, deckFor, deckDropped, drawEntry, eligible, meanOccupancy,
} from '../../src/village/deck.js';
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

  // R1: the manifest currently loaded (batch001) has no biome-suffixed ids
  // at all — no "sm-house--tundra". This test asserts the FALLBACK
  // MECHANISM, not today's data: a biome with no variants for an entry
  // must fall back to the temperate id rather than drop it or crash.
  it('resolves biome suffixes with a temperate fallback', () => {
    expect(deckFor('tundra').some((e) => e.glyph === 'sm-house')).toBe(true);
    // sm-house-tiled has no tundra variant either, so the temperate id survives.
    expect(deckFor('tundra').some((e) => e.glyph === 'sm-house-tiled')).toBe(true);
  });

  it('averages occupancy for the built-radius prediction', () => {
    expect(meanOccupancy(TEMPERATE_VILLAGE_DECK)).toBeGreaterThan(3);
    expect(meanOccupancy(TEMPERATE_VILLAGE_DECK)).toBeLessThan(8);
  });
});

// R1: the manifest has no sm-chapel id. deckFor must drop the chapel entry
// rather than place it at a fabricated size, and must report the drop so a
// village that quietly lost its chapel is explainable at a render gate.
describe('deckFor drops missing glyphs (R1)', () => {
  it('drops an entry whose glyph is absent from the manifest', () => {
    expect(deckFor('temperate').some((e) => e.glyph === 'sm-chapel')).toBe(false);
  });

  it('reports what it dropped', () => {
    expect(deckDropped('temperate')).toContain('sm-chapel');
  });

  it('does not drop entries whose glyph exists', () => {
    expect(deckFor('temperate').some((e) => e.glyph === 'sm-house')).toBe(true);
    expect(deckFor('temperate').some((e) => e.glyph === 'sm-inn')).toBe(true);
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
