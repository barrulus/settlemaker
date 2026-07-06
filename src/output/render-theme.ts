import type { Palette } from '../types/interfaces.js';

/** `0xfff2c8` → `"#fff2c8"`. */
export function cssHex(c: number): string {
  return '#' + c.toString(16).padStart(6, '0');
}

/** Per-channel linear mix of two 0xRRGGBB colors; t clamped to [0,1]. */
export function blend(a: number, b: number, t: number): number {
  const k = Math.min(1, Math.max(0, t));
  const ch = (sa: number, sb: number) => Math.round(sa + (sb - sa) * k);
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  return (ch(ar, br) << 16) | (ch(ag, bg) << 8) | ch(ab, bb);
}

/** Scale each channel toward black by factor f (0 = unchanged, 1 = black). */
export function darken(c: number, f: number): number {
  const k = Math.min(1, Math.max(0, 1 - f));
  const r = Math.round(((c >> 16) & 0xff) * k);
  const g = Math.round(((c >> 8) & 0xff) * k);
  const b = Math.round((c & 0xff) * k);
  return (r << 16) | (g << 8) | b;
}

/**
 * Rendering treatments derived from a Palette. Everything the 6-color
 * palette cannot express: casing, shadows, seam/shore strokes, washes.
 * All slots are plain data so callers can override any subset via
 * `SvgOptions.theme`.
 */
export interface RenderTheme {
  paper: string;
  water: string | null;      // null → water passes are skipped
  waterEdge: string | null;  // shore stroke; null when water is null
  fieldFill: string;         // paper blended 8% toward green
  fieldFurrow: string;       // furrow lines, rendered at 30% opacity
  greenFill: string;         // parks
  roadCasing: string;
  roadCore: string;
  buildingFill: string;
  buildingStroke: string;
  landmarkFill: string;      // castle/cathedral/market highlight
  shadowColor: string;
  shadowOpacity: number;
  shadowOffset: { dx: number; dy: number };
  arteryWidth: number;
  roadWidth: number;
  casingDelta: number;       // casing extends this much per side beyond core
  seamStroke: number;        // same-color stroke on water patches
  shoreWidth: number;
}

export function themeFrom(palette: Palette): RenderTheme {
  const green = palette.green ?? palette.medium;
  const water = palette.water ?? null;
  return {
    paper: cssHex(palette.paper),
    water: water === null ? null : cssHex(water),
    waterEdge: water === null ? null : cssHex(darken(water, 0.2)),
    fieldFill: cssHex(blend(palette.paper, green, 0.08)),
    fieldFurrow: cssHex(green),
    greenFill: cssHex(green),
    roadCasing: cssHex(palette.medium),
    roadCore: cssHex(palette.paper),
    buildingFill: cssHex(palette.light),
    buildingStroke: cssHex(palette.dark),
    landmarkFill: cssHex(blend(palette.light, 0xffffff, 0.45)),
    shadowColor: cssHex(palette.dark),
    shadowOpacity: 0.18,
    shadowOffset: { dx: 0.4, dy: 0.6 },
    arteryWidth: 2.4,
    roadWidth: 1.6,
    casingDelta: 0.3,
    seamStroke: 0.5,
    shoreWidth: 0.6,
  };
}
