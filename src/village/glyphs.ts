import { REFINED_MANIFEST as SYMBOL_MANIFEST } from '../assets/refined-manifest.js';

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
 * RETIRED SHIM (deleted 2026-08-21): while this module read the batch001
 * manifest, every id there — including every dwelling — claimed rotation
 * "invariant", so rotationOf() overrode it to "free" for dwelling glyphs
 * (house/longhouse/inn) to let them face their lane. The manifest now
 * loaded is the refined generation: it carries real per-id rotation values
 * (`sm-house` is genuinely "free", `sm-hut-round` is genuinely "invariant"
 * because a round hut has no front to turn), and 47 of its ids are
 * biome-suffixed, so the override's own gate condition
 * (`MANIFEST_HAS_BIOME_VARIANTS`) would already have disabled it on every
 * call. Deleted rather than left disabled: this module is now hard-wired
 * to the refined manifest, so the batch001 case the shim existed for can
 * no longer occur here.
 */
export function rotationOf(glyph: string): 'invariant' | 'free' | 'locked' | 'snap-cardinal' {
  return SYMBOL_MANIFEST[glyph]?.rotation ?? 'free';
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
