import { describe, it, expect } from 'vitest';
import { cssHex, blend, darken, themeFrom } from '../src/output/render-theme.js';
import { PALETTE_DEFAULT } from '../src/output/palette.js';
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
    expect(t.fieldFill).toBe(cssHex(blend(PALETTE_DEFAULT.paper, PALETTE_DEFAULT.green!, 0.08)));
    expect(t.buildingFill).toBe(cssHex(PALETTE_DEFAULT.light));
    expect(t.buildingStroke).toBe(cssHex(PALETTE_DEFAULT.dark));
    expect(t.landmarkFill).toBe(cssHex(blend(PALETTE_DEFAULT.light, 0xffffff, 0.45)));
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
    expect(t.fieldFill).toBe(cssHex(blend(0xffffff, 0x888888, 0.08)));
  });
});
