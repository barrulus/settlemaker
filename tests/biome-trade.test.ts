import { describe, it, expect } from 'vitest';
import { generateFromBurg, WardType, type AzgaarBurgInput } from '../src/index.js';
import { buildScene } from '../src/scene/build-scene.js';
import { paletteForBiome } from '../src/output/palette.js';
import { PALETTES } from '../src/output/palette.js';
import { themeFrom } from '../src/output/render-theme.js';

const base: AzgaarBurgInput = {
  name: 'Souktown',
  population: 50,
  port: false, citadel: false, walls: false,
  plaza: false, temple: false, shanty: false, capital: false,
};

describe('biome and trade inputs', () => {
  it('trade guarantees a market ward even without plaza', () => {
    const { model } = generateFromBurg({ ...base, trade: true });
    expect(model.patches.some(p => p.ward?.type === WardType.Market)).toBe(true);
  });

  it('no trade, no plaza — no market', () => {
    const { model } = generateFromBurg(base);
    expect(model.patches.some(p => p.ward?.type === WardType.Market)).toBe(false);
  });

  it('biome reaches the scene', () => {
    const r = generateFromBurg({ ...base, biome: 'desert' });
    const scene = buildScene(r.model, { shift: r.originShift });
    expect(scene.biome).toBe('desert');
  });

  it('paletteForBiome returns a defined palette and defaults sanely', () => {
    expect(paletteForBiome(undefined)).toBe(PALETTES.default);
    expect(paletteForBiome('desert')).toBeDefined();
  });

  it('explicit palette option beats the biome default', () => {
    const a = generateFromBurg({ ...base, biome: 'desert' }, { svg: { palette: PALETTES.classic } });
    const classicPaper = themeFrom(PALETTES.classic).paper;
    expect(a.svg).toContain(`fill="${classicPaper}"`); // data-bg rect carries inline paper fill
    const b = generateFromBurg({ ...base, biome: 'desert' });
    const defaultPaper = themeFrom(PALETTES.default).paper;
    expect(b.svg).toContain(`fill="${defaultPaper}"`);
  });
});
