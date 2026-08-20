import { SYMBOL_MANIFEST } from '../assets/symbol-manifest.js';

/**
 * The ONLY module that reads SYMBOL_MANIFEST. Everything that needs a
 * glyph dimension asks here, so there is one lookup and one fallback.
 */

/** Used when a glyph is missing from the manifest — a plain house. */
const FALLBACK_FOOTPRINT: [number, number] = [8, 6.6];

/**
 * Painted extent as a fraction of the art box, per family. A house's
 * transparent margin may overhang a neighbour; its WALLS may not.
 * Moved here from src/generator/village-rows.ts so the new engine does not
 * depend on the old one; village-rows re-exports them for its own callers.
 */
export const HOUSE_INK_RATIO = 0.68;
export const HUT_INK_RATIO = 0.85;

/** Whether the manifest carries this id at all — the biome-fallback test. */
export function hasGlyph(glyph: string): boolean {
  return Object.prototype.hasOwnProperty.call(SYMBOL_MANIFEST, glyph);
}

export function nominalFootprint(glyph: string): [number, number] {
  const fp = SYMBOL_MANIFEST[glyph]?.footprint;
  return fp ? [fp[0], fp[1]] : [...FALLBACK_FOOTPRINT];
}

/**
 * DATED SHIM (2026-08-20): the manifest currently loaded is the retired
 * batch001 generation, where every single id — including every dwelling —
 * claims rotation "invariant". Taken at face value that would stop every
 * dwelling from facing its lane, which is the central rule of this whole
 * feature, for a data-generation reason rather than a real one (round huts
 * genuinely cannot face a street; houses and longhouses can and should).
 *
 * MANIFEST_HAS_BIOME_VARIANTS detects which manifest generation is loaded:
 * only the newer, refined symbol set (not yet ingested into this library)
 * has biome-suffixed ids such as "sm-house--tundra". While it is false —
 * i.e. while this is still the batch001 manifest — rotationOf() overrides
 * "invariant" to "free" for dwelling glyphs only.
 *
 * Removal condition: this disables itself automatically once the manifest
 * is regenerated from the refined symbol set (MANIFEST_HAS_BIOME_VARIANTS
 * becomes true), at which point the manifest's own per-id rotation value is
 * trusted unconditionally and this override becomes dead code worth
 * deleting outright.
 */
export const MANIFEST_HAS_BIOME_VARIANTS = Object.keys(SYMBOL_MANIFEST).some((id) => id.includes('--'));

/** Dwelling glyphs are the ones the rotation shim may override. */
export function isDwellingGlyph(glyph: string): boolean {
  return glyph.includes('house') || glyph.includes('longhouse');
}

export function rotationOf(glyph: string): 'invariant' | 'free' | 'locked' | 'snap-cardinal' {
  const rotation = SYMBOL_MANIFEST[glyph]?.rotation ?? 'free';
  if (!MANIFEST_HAS_BIOME_VARIANTS && rotation === 'invariant' && isDwellingGlyph(glyph)) {
    return 'free';
  }
  return rotation;
}

export function minScaleOf(glyph: string): number {
  return SYMBOL_MANIFEST[glyph]?.minScale ?? 0.35;
}

/**
 * Ink extent of an ALREADY-SCALED footprint. Callers pass the building's
 * final footprint, not the nominal one, because every size multiplier has
 * already been applied by then.
 */
export function inkExtent(
  glyph: string, footprint: [number, number],
): { width: number; depth: number } {
  const ratio = glyph.includes('hut') ? HUT_INK_RATIO : HOUSE_INK_RATIO;
  return { width: footprint[0] * ratio, depth: footprint[1] * ratio };
}
