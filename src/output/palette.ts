import type { Palette } from '../types/interfaces.js';

export const PALETTE_DEFAULT: Palette  = { paper: 0xccc5b8, light: 0x99948a, medium: 0x67635c, dark: 0x1a1917 };
export const PALETTE_BLUEPRINT: Palette = { paper: 0x455b8d, light: 0x7383aa, medium: 0xa1abc6, dark: 0xfcfbff };
export const PALETTE_BW: Palette        = { paper: 0xffffff, light: 0xcccccc, medium: 0x888888, dark: 0x000000 };
export const PALETTE_INK: Palette       = { paper: 0xcccac2, light: 0x9a979b, medium: 0x6c6974, dark: 0x130f26 };
export const PALETTE_NIGHT: Palette     = { paper: 0x000000, light: 0x402306, medium: 0x674b14, dark: 0x99913d };
export const PALETTE_ANCIENT: Palette   = { paper: 0xccc5a3, light: 0xa69974, medium: 0x806f4d, dark: 0x342414 };
export const PALETTE_COLOUR: Palette    = { paper: 0xfff2c8, light: 0xd6a36e, medium: 0x869a81, dark: 0x4c5950 };
export const PALETTE_SIMPLE: Palette    = { paper: 0xffffff, light: 0x000000, medium: 0x000000, dark: 0x000000 };

export const PALETTES: Record<string, Palette> = {
  default: PALETTE_DEFAULT,
  blueprint: PALETTE_BLUEPRINT,
  bw: PALETTE_BW,
  ink: PALETTE_INK,
  night: PALETTE_NIGHT,
  ancient: PALETTE_ANCIENT,
  colour: PALETTE_COLOUR,
  simple: PALETTE_SIMPLE,
};
