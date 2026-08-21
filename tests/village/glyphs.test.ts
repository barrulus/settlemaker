import { describe, it, expect } from 'vitest';
import { REFINED_MANIFEST as SYMBOL_MANIFEST } from '../../src/assets/refined-manifest.js';
import {
  HOUSE_INK_RATIO, HUT_INK_RATIO, hasGlyph, inkExtent, minScaleOf, nominalFootprint,
  rotationOf,
} from '../../src/village/glyphs.js';

// src/village/ is repointed at the refined 91-symbol manifest
// (src/assets/refined-manifest.ts): 47 biome variants, real per-id
// rotation values, sm-chapel included. The retired batch001 manifest
// (src/assets/symbol-manifest.ts) still serves the OLD engine only.

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

// The dated rotation shim (glyphs.ts, deleted 2026-08-21) existed only to
// paper over batch001's every-id-"invariant" data while this module read
// that manifest. It is gone now that glyphs.ts is hard-wired to the
// refined manifest — rotationOf() reports the manifest's own per-id value
// unconditionally. These pin the REAL data, not an override.
describe('rotation reads the manifest directly (shim retired)', () => {
  it('reports sm-house as free-rotating because the manifest genuinely says so', () => {
    expect(SYMBOL_MANIFEST['sm-house'].rotation).toBe('free');
    expect(rotationOf('sm-house')).toBe('free');
  });

  it('reports a round hut as invariant because it genuinely cannot face a street', () => {
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
