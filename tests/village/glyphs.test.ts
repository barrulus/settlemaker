import { describe, it, expect } from 'vitest';
import { SYMBOL_MANIFEST } from '../../src/assets/symbol-manifest.js';
import {
  HOUSE_INK_RATIO, HUT_INK_RATIO, hasGlyph, inkExtent, minScaleOf, nominalFootprint,
  rotationOf,
} from '../../src/village/glyphs.js';

// This repo's src/assets/symbol-manifest.ts is the RETIRED batch001
// generation: 38 ids, no biome variants, no sm-chapel, and every id claims
// rotation "invariant". The newer symbol set the design brief was written
// against has not been ingested here. These tests assert glyphs.ts
// delegates correctly to whatever manifest IS loaded, rather than hard-
// coding values from a manifest generation this repo doesn't have.

describe('glyph lookups', () => {
  it('knows which ids the manifest actually has', () => {
    expect(hasGlyph('sm-house')).toBe(true);
    expect(hasGlyph('sm-not-a-real-symbol')).toBe(false);
  });

  it('reads a footprint in metres from the manifest', () => {
    expect(nominalFootprint('sm-house')).toEqual(SYMBOL_MANIFEST['sm-house'].footprint);
  });

  it('falls back to a house-sized footprint for an unknown id', () => {
    // This fallback constant lives in glyphs.ts, not in the manifest, so it
    // is asserted as a literal.
    expect(nominalFootprint('sm-not-a-real-symbol')).toEqual([8, 6.6]);
  });

  it('reads minScale from the manifest, and the documented default for an unknown id', () => {
    expect(minScaleOf('sm-house')).toBeCloseTo(SYMBOL_MANIFEST['sm-house'].minScale, 5);
    expect(minScaleOf('sm-not-a-real-symbol')).toBeCloseTo(0.35, 5);
  });

  it('shrinks a footprint to its ink extent, by family', () => {
    expect(inkExtent('sm-house', [8, 6.6]).width).toBeCloseTo(8 * HOUSE_INK_RATIO, 5);
    expect(inkExtent('sm-hut-straw', [6.4, 6.4]).width).toBeCloseTo(6.4 * HUT_INK_RATIO, 5);
  });

  it('uses the scaled footprint it is given, not the nominal one', () => {
    expect(inkExtent('sm-house', [12, 10]).width).toBeCloseTo(12 * HOUSE_INK_RATIO, 5);
  });
});

describe('rotation shim (dated 2026-08-20, self-removing)', () => {
  // The manifest currently loaded is batch001, where every id — including
  // every dwelling — is hard-coded "invariant". Taken literally that would
  // stop every dwelling from ever facing its lane, so rotationOf()
  // overrides "invariant" to "free" for dwelling glyphs (house/longhouse)
  // while this manifest generation is loaded. Round huts genuinely cannot
  // face a street, so they keep "invariant" regardless.
  //
  // This pins the shim's behaviour both ways against today's manifest: it
  // fires for a house, and it does not touch a round hut. Once the
  // manifest is regenerated from the refined symbol set (biome variants
  // appear, MANIFEST_HAS_BIOME_VARIANTS flips true), this override
  // disables itself and rotationOf() reports the manifest's raw value
  // unconditionally.
  it('reports a house as free-rotating despite the manifest saying invariant', () => {
    expect(SYMBOL_MANIFEST['sm-house'].rotation).toBe('invariant');
    expect(rotationOf('sm-house')).toBe('free');
  });

  it('leaves a round hut invariant — it genuinely cannot face a street', () => {
    expect(SYMBOL_MANIFEST['sm-hut-round'].rotation).toBe('invariant');
    expect(rotationOf('sm-hut-round')).toBe('invariant');
  });
});

describe('the old engine keeps working', () => {
  it('still exports the ink ratios from village-rows for existing callers', async () => {
    const old = await import('../../src/generator/village-rows.js');
    expect(old.HOUSE_INK_RATIO).toBe(HOUSE_INK_RATIO);
    expect(old.HUT_INK_RATIO).toBe(HUT_INK_RATIO);
  });
});
