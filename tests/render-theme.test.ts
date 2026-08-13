import { describe, it, expect } from 'vitest';
import { cssHex, blend, darken, themeFrom } from '../src/output/render-theme.js';
import { PALETTE_DEFAULT, PALETTES, PALETTE_PARCHMENT } from '../src/output/palette.js';
import { themeToCss } from '../src/output/assemble-svg.js';
import { sanitizeThemeOverrides } from '../src/url/params.js';
import type { Palette } from '../src/types/interfaces.js';

describe('color helpers', () => {
  it('cssHex pads to 6 digits', () => {
    expect(cssHex(0xfff2c8)).toBe('#fff2c8');
    expect(cssHex(0x00ff00)).toBe('#00ff00');
    expect(cssHex(0x000012)).toBe('#000012');
  });

  it('blend mixes per channel', () => {
    expect(blend(0x000000, 0xffffff, 0)).toBe(0x000000);
    expect(blend(0x000000, 0xffffff, 1)).toBe(0xffffff);
    expect(blend(0x000000, 0xffffff, 0.5)).toBe(0x808080);
  });

  it('darken scales channels down', () => {
    expect(darken(0xffffff, 0.2)).toBe(0xcccccc);
    expect(darken(0x000000, 0.5)).toBe(0x000000);
  });
});

describe('themeFrom', () => {
  it('derives all slots from a full palette', () => {
    const t = themeFrom(PALETTE_DEFAULT);
    expect(t.paper).toBe(cssHex(PALETTE_DEFAULT.paper));
    expect(t.water).toBe(cssHex(PALETTE_DEFAULT.water!));
    expect(t.waterEdge).toBe(cssHex(darken(PALETTE_DEFAULT.water!, 0.2)));
    expect(t.fieldFill).toBe(cssHex(blend(PALETTE_DEFAULT.paper, PALETTE_DEFAULT.green!, 0.18)));
    expect(t.buildingFill).toBe(cssHex(PALETTE_DEFAULT.light));
    expect(t.buildingStroke).toBe(cssHex(PALETTE_DEFAULT.dark));
    expect(t.landmarkFill).toBe(cssHex(blend(PALETTE_DEFAULT.light, PALETTE_DEFAULT.dark, 0.3)));
    expect(t.shadowOpacity).toBeCloseTo(0.18);
    expect(t.shadowOffset).toEqual({ dx: 0.4, dy: 0.6 });
    expect(t.arteryWidth).toBe(2.4);
    expect(t.roadWidth).toBe(1.6);
    expect(t.casingDelta).toBe(0.3);
    expect(t.seamStroke).toBe(0.5);
    expect(t.shoreWidth).toBe(0.6);
  });

  it('handles palettes without water (water slots null)', () => {
    const p: Palette = { paper: 0xffffff, light: 0xcccccc, medium: 0x888888, dark: 0x000000 };
    const t = themeFrom(p);
    expect(t.water).toBeNull();
    expect(t.waterEdge).toBeNull();
  });

  it('falls back to medium when green is missing', () => {
    const p: Palette = { paper: 0xffffff, light: 0xcccccc, medium: 0x888888, dark: 0x000000 };
    const t = themeFrom(p);
    expect(t.greenFill).toBe(cssHex(0x888888));
    expect(t.fieldFill).toBe(cssHex(blend(0xffffff, 0x888888, 0.18)));
  });

  it('treeFill darkens tree or falls back to green/medium', () => {
    const p: Palette = { paper: 0xffffff, light: 0xcccccc, medium: 0x888888, dark: 0x000000, tree: 0x228833 };
    const t = themeFrom(p);
    expect(t.treeFill).toBe(cssHex(darken(0x228833, 0.15)));

    const noTree: Palette = { paper: 0xffffff, light: 0xcccccc, medium: 0x888888, dark: 0x000000, green: 0x228833 };
    const t2 = themeFrom(noTree);
    expect(t2.treeFill).toBe(cssHex(darken(0x228833, 0.15)));

    const noGreen: Palette = { paper: 0xffffff, light: 0xcccccc, medium: 0x888888, dark: 0x000000 };
    const t3 = themeFrom(noGreen);
    expect(t3.treeFill).toBe(cssHex(darken(0x888888, 0.15)));
  });
});

describe('parchment palette', () => {
  it('is the new default and keeps the old default as classic', () => {
    expect(PALETTES.default).toBe(PALETTE_PARCHMENT);
    expect(PALETTES.classic).toBe(PALETTE_DEFAULT);
    expect(PALETTES.parchment).toBe(PALETTE_PARCHMENT);
    expect(PALETTE_PARCHMENT.paper).toBe(0xfff2c8);
    expect(PALETTE_PARCHMENT.water).toBe(0x85bcb2);
  });
});

describe('symbol material tokens', () => {
  it('every palette derives all six sm tokens as hex', () => {
    const t = themeFrom(PALETTES.parchment);
    for (const k of ['smInk', 'smStone', 'smTimber', 'smVoid', 'smCanopy1', 'smCanopy2'] as const) {
      expect(t[k]).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('themeToCss emits the authored material classes and shadow color', () => {
    const css = themeToCss(themeFrom(PALETTES.parchment));
    for (const cls of ['.sm-stone', '.sm-timber', '.sm-void', '.sm-mark', '.sm-canopy-a', '.sm-canopy-b', '.sm-ridge', '.sm-hatch', '.sm-sil']) {
      expect(css).toContain(cls);
    }
    expect(css).toMatch(/#shadows\{[^}]*color:#/);
  });

  it('sanitizeThemeOverrides accepts sm tokens, rejects non-hex', () => {
    expect(sanitizeThemeOverrides({ smInk: '#112233' })).toEqual({ smInk: '#112233' });
    expect(sanitizeThemeOverrides({ smInk: 'url(evil)' })).toEqual({});
  });
});
