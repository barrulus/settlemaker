import { describe, it, expect } from 'vitest';
import { Point } from '../../src/types/point.js';
import { SeededRandom } from '../../src/utils/random.js';
import { overlaps, seat, sizeFor } from '../../src/village/dwellings.js';
import { FIT_MAX, FIT_MIN, SIZE_JITTER } from '../../src/village/constants.js';
import { TEMPERATE_VILLAGE_DECK } from '../../src/village/deck.js';
import type { DeckEntry } from '../../src/village/deck.js';
import type { Lot } from '../../src/village/types.js';
import { nominalFootprint } from '../../src/village/glyphs.js';

const house = TEMPERATE_VILLAGE_DECK.find((e) => e.glyph === 'sm-house')!;
const inn = TEMPERATE_VILLAGE_DECK.find((e) => e.glyph === 'sm-inn')!;
// The brief's original draft assumed sm-house's manifest footprint was
// [8, 6.6] (that value is actually FALLBACK_FOOTPRINT, used only when a
// glyph is missing from the manifest). The real, currently-loaded manifest
// gives sm-house a footprint of [6, 6] — see glyphs.test.ts and the
// "ART BOX, not of its painted walls" comment in village-rows.ts. Reading
// it dynamically here keeps these bounds honest against whichever manifest
// is actually loaded, rather than re-hardcoding a stale number.
const houseNominalW = nominalFootprint(house.glyph)[0];

const lot = (frontageM: number, x = 0, y = 0, bearingDeg = 0): Lot => ({
  id: `arm-090:R0`, laneId: 'arm-090', side: 1, front: new Point(x, y),
  bearingDeg, frontageM, depthM: 25, score: 0,
});

describe('sizeFor', () => {
  it('keeps a house near its nominal footprint on a normal lot', () => {
    const [w] = sizeFor(house, lot(12), new SeededRandom(1));
    expect(w).toBeGreaterThan(houseNominalW * 0.85);
    expect(w).toBeLessThan(houseNominalW * 1.25);
  });

  it('makes the inn semantically bigger via sizeFactor', () => {
    const [innW] = sizeFor(inn, lot(30), new SeededRandom(1));
    const [houseW] = sizeFor(house, lot(30), new SeededRandom(1));
    expect(innW).toBeGreaterThan(houseW);
  });

  // Ruling R13: the brief's "total bound 0.85-1.65x nominal" was an
  // arithmetic slip (sizeFactor x jitter, with the fit term dropped) and
  // does not hold for sizeFactor > 1 (an inn at max jitter and max fit
  // reaches ~1.9x). The bound that actually means something is the
  // NON-SEMANTIC factor — jitter x fit, i.e. the variation applied ON TOP
  // OF sizeFactor. For a sizeFactor-1 entry that is exactly footprint /
  // nominal, so this test pins it directly: [FIT_MIN, FIT_MAX] x
  // [1-SIZE_JITTER, 1+SIZE_JITTER] = [0.765, 1.265], across many seeds and
  // a range of lot frontages (narrow, typical, generous — so both the
  // shrink-to-fit and grow-to-fit legs of `fit` get exercised).
  it('keeps the non-semantic (jitter x fit) factor within [0.765, 1.265] for a sizeFactor-1 entry', () => {
    const nonSemanticMin = FIT_MIN * (1 - SIZE_JITTER);
    const nonSemanticMax = FIT_MAX * (1 + SIZE_JITTER);
    expect(nonSemanticMin).toBeCloseTo(0.765, 9);
    expect(nonSemanticMax).toBeCloseTo(1.265, 9);
    for (const frontageM of [4, 8, 40]) {
      for (let s = 1; s < 40; s++) {
        const [w] = sizeFor(house, lot(frontageM), new SeededRandom(s));
        const factor = w / houseNominalW;
        expect(factor).toBeGreaterThanOrEqual(nonSemanticMin - 1e-9);
        expect(factor).toBeLessThanOrEqual(nonSemanticMax + 1e-9);
      }
    }
  });

  // sizeFactor must genuinely carry through rather than being clamped away
  // by fit. Compared as a ratio of (footprint / nominal footprint) rather
  // than of raw footprint widths, because sm-house and sm-inn have
  // different nominal footprints (6 vs 7) — a raw-width comparison would
  // be muddied by that difference and would not isolate sizeFactor. On a
  // lot generous enough that `fit` saturates at FIT_MAX for both entries,
  // and with jitter drawn identically (same seed, same first rng.float()
  // call in sizeFor), the two entries' non-semantic factors are equal, so
  // this isolates sizeFactor cleanly.
  it('carries sizeFactor through to the footprint: an inn scales ~1.5x a house', () => {
    const innW = sizeFor(inn, lot(200), new SeededRandom(3))[0];
    const houseW = sizeFor(house, lot(200), new SeededRandom(3))[0];
    const innNominalW = nominalFootprint(inn.glyph)[0];
    const innFactor = innW / innNominalW;
    const houseFactor = houseW / houseNominalW;
    expect(innFactor / houseFactor).toBeCloseTo(1.5, 5);
  });

  it('grows into a generous fringe lot and shrinks into a tight one', () => {
    const wide = sizeFor(house, lot(40), new SeededRandom(4))[0];
    const tight = sizeFor(house, lot(9), new SeededRandom(4))[0];
    expect(wide).toBeGreaterThan(tight);
    expect(FIT_MAX).toBe(1.15);
  });
});

describe('seat', () => {
  it('faces the dwelling the way its lot faces', () => {
    const b = seat(house, lot(12, 10, 0, 270), new SeededRandom(1));
    expect(b.bearingDeg).toBeCloseTo(270, 5);
  });

  it('derives the building id from the lot id', () => {
    expect(seat(house, lot(12), new SeededRandom(1)).id).toBe('bld:arm-090:R0');
  });

  it('carries occupancy scaled by sizeFactor', () => {
    expect(seat(inn, lot(30), new SeededRandom(1)).occupancy).toBe(Math.round(6 * 1.5));
  });

  it('is deterministic for a seed', () => {
    const mk = () => seat(house, lot(12), new SeededRandom(8));
    expect(JSON.stringify(mk())).toBe(JSON.stringify(mk()));
  });

  it('seats the building at the front of the lot, not out toward the lane', () => {
    // Lot fronts north (bearingDeg 0): the lot's frontage line sits at
    // y = 0, and the interior of the lot runs toward +y (south), away from
    // the lane the building faces. The building must offset that way, not
    // toward -y (which would put it in the lane / the green).
    const b = seat(house, lot(12, 0, 0, 0), new SeededRandom(1));
    expect(b.position.y).toBeGreaterThan(0);
    expect(b.position.x).toBeCloseTo(0, 5);
  });

  describe('R12: rotation class governs bearingDeg', () => {
    it('invariant glyphs are never rotated, regardless of lot bearing', () => {
      const roundHut: DeckEntry = {
        glyph: 'sm-hut-round', occupancy: 3, weight: 1, sizeFactor: 1, minFrontage: 6,
      };
      const b = seat(roundHut, lot(12, 0, 0, 137), new SeededRandom(1));
      expect(b.bearingDeg).toBe(0);
    });

    it('snap-cardinal glyphs snap the lot bearing to the nearest 90 degrees', () => {
      const cross: DeckEntry = {
        glyph: 'sm-market-cross', occupancy: 0, weight: 1, sizeFactor: 1, minFrontage: 8,
      };
      const b = seat(cross, lot(12, 0, 0, 100), new SeededRandom(1));
      expect(b.bearingDeg).toBe(90);
    });

    it('snap-cardinal wraps 350 degrees to 0, not 360', () => {
      const cross: DeckEntry = {
        glyph: 'sm-market-cross', occupancy: 0, weight: 1, sizeFactor: 1, minFrontage: 8,
      };
      const b = seat(cross, lot(12, 0, 0, 350), new SeededRandom(1));
      expect(b.bearingDeg).toBe(0);
    });

    it('free/locked glyphs use the lot bearing unmodified (the normal case)', () => {
      // sm-house resolves to 'free' under the R2 shim (dwelling id, batch001
      // manifest claims invariant). Without honouring the rotation class
      // this would still pass by accident for 'free' glyphs, so this test
      // exists mainly to pin the normal path alongside the two special ones.
      const b = seat(house, lot(12, 0, 0, 137), new SeededRandom(1));
      expect(b.bearingDeg).toBeCloseTo(137, 5);
    });
  });
});

describe('overlaps', () => {
  it('uses ink extents, so glyphs may share their transparent margins', () => {
    const a = seat(house, lot(12, 0, 0), new SeededRandom(1));
    const b = seat(house, lot(12, 6.5, 0), new SeededRandom(1));
    // 6.5 m apart, houses sized near their ~6 m nominal footprint: the
    // full art boxes would be close enough to read as touching, but the
    // ink extent (footprint x HOUSE_INK_RATIO, ~0.68) shrinks each house's
    // collision radius enough that painted walls don't actually meet.
    expect(overlaps(a, b)).toBe(false);
  });

  it('rejects a genuine collision', () => {
    const a = seat(house, lot(12, 0, 0), new SeededRandom(1));
    const b = seat(house, lot(12, 1, 0), new SeededRandom(1));
    expect(overlaps(a, b)).toBe(true);
  });
});
