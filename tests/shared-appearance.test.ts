import { describe, it, expect } from 'vitest';
import {
  BIOMES, PALETTES, biomeThemeFor, createSkin, generateFromBurg, generateSettlement,
  generateSvg, generateVillage, renderVillage, themeFrom, type AzgaarBurgInput,
} from '../src/index.js';
import { themedMaterial } from '../src/appearance/resolve.js';
import { resolveVarFallbacks } from '../src/assets/refined-style.js';

const burg: AzgaarBurgInput = {
  name: 'Shared appearance', population: 300, roadBearings: [20, 145, 270],
  port: false, citadel: false, walls: false, plaza: true, temple: true, shanty: false, capital: false,
};
const background = (svg: string) => svg.match(/<rect[^>]*data-bg="paper"[^>]*fill="([^"]+)"/)?.[1];
const token = (svg: string, name: string) => svg.match(new RegExp(`${name}:([^;}]+)`))?.[1];
const shape = (svg: string) => [...svg.matchAll(/(?: d| transform|viewBox)="([^"]+)"/g)].map(m => m[0]);

describe('shared appearance', () => {
  for (const biome of BIOMES) {
    it(`${biome}: both engines share natural ground and every named palette`, () => {
      const village = generateVillage({ ...burg, biome }, 2);
      const city = generateFromBurg({ ...burg, population: 800, biome, engine: 'city' }, { seed: 2 }).model;
      const natural = [renderVillage(village), generateSvg(city)];
      expect(natural.map(background)).toEqual([biomeThemeFor(biome).ground, biomeThemeFor(biome).ground]);
      const geometry = natural.map(shape);
      for (const [name, palette] of Object.entries(PALETTES)) {
        const pair = [renderVillage(village, 4, undefined, { palette }), generateSvg(city, { palette })];
        const expected = themeFrom(palette);
        expect(pair.map(background), name).toEqual([expected.paper, expected.paper]);
        for (const svg of pair) {
          expect(token(svg, '--sm-ink'), name).toBe(expected.smInk);
          expect(token(svg, `--sm-village-${biome}-roof`), name).toBe(expected.buildingFill);
          expect(token(svg, `--sm-city-${biome}-roof`), name).toBe(expected.buildingFill);
          expect(token(svg, `--sm-green-${biome}-turf`), name).toBe(expected.greenFill);
          // Both CSS and inline fallbacks must reflect the selected colour.
          const refs = [...svg.matchAll(/var\((--sm-[\w-]+),\s*(#[a-f\d]+)\)/gi)];
          for (const [, key, fallback] of refs) {
            const css = token(svg, key);
            if (css) expect(fallback, `${name} ${key}`).toBe(css);
          }
        }
        expect(pair.map(shape), name).toEqual(geometry);
      }
    });
  }

  it('uses shared options at the high-level entry point and retains the svg palette bridge', () => {
    for (const engine of ['village', 'city'] as const) {
      const input = { ...burg, engine };
      const result = generateSettlement(input, { seed: 2, theme: 'night', style: { paper: '#123456', smInk: '#abcdef' } });
      expect(background(result.svg)).toBe('#123456');
      expect(token(result.svg, '--sm-ink')).toBe('#abcdef');
      const legacy = generateSettlement(input, { seed: 2, svg: { palette: PALETTES.night, theme: { paper: '#123456', smInk: '#abcdef' } } });
      expect(result.svg === legacy.svg).toBe(true);
    }
  });

  it('normalises FMG biome names in the city planner as well as the village planner', () => {
    for (const engine of ['village', 'city'] as const) {
      const a = generateSettlement({ ...burg, biome: ' Hot Desert ', engine }, { seed: 2 });
      const b = generateSettlement({ ...burg, biome: 'desert', engine }, { seed: 2 });
      expect(a.svg === b.svg).toBe(true);
    }
  });

  it('honours shared palettes with skins and legacy village overrides last', () => {
    const skin = createSkin({ version: 1, id: 'shared-test', name: 'Shared test', tokens: { '--sm-ink': '#112233' } });
    const village = generateVillage(burg, 2);
    const svg = renderVillage(village, 4, { ...biomeThemeFor('desert'), tokens: { '--sm-ink': '#abcdef' } }, { skin, palette: PALETTES.night });
    expect(background(svg)).toBe(biomeThemeFor('desert').ground);
    expect(token(svg, '--sm-ink')).toBe('#abcdef');
    const high = generateSettlement(burg, { seed: 2, svg: { skin } });
    expect(token(high.svg, '--sm-ink')).toBe('#112233');
  });

  it('honours explicit native roof colour even on material-variant city glyphs', () => {
    const city = generateFromBurg({ ...burg, population: 800, engine: 'city' }, { seed: 2 });
    const svg = generateSvg(city.model, { palette: PALETTES.night, theme: { buildingFill: '#ff0000' } });
    const roofs = [...svg.matchAll(/var\(--sm-city-temperate-roof[^,]*,\s*([^)]*)\)/g)].map(m => m[1]);
    expect(roofs.length).toBeGreaterThan(0);
    expect(new Set(roofs)).toEqual(new Set(['#ff0000']));
  });

  it('retains custom material alpha and supports short hex colours', () => {
    expect(themedMaterial('#abcd', PALETTES.night)).toBe(themedMaterial('#aabbccdd', PALETTES.night));
    expect(themedMaterial('#abcd', PALETTES.night).endsWith('dd')).toBe(true);
    expect(themedMaterial('currentColor', PALETTES.night)).toBe('currentColor');
  });

  it('rejects unknown named themes instead of quietly using the natural appearance', () => {
    expect(() => generateSettlement(burg, { theme: '__proto__' as any })).toThrow('Unknown settlement theme');
  });

  it('changes only material variables, preserving mask and clip colours', () => {
    const svg = '<mask><path fill="white"/><path fill="black"/></mask><path fill="var(--custom-tone, #abcdef)"/>';
    expect(resolveVarFallbacks(svg, {}, () => '#123456')).toBe('<mask><path fill="white"/><path fill="black"/></mask><path fill="var(--custom-tone, #123456)"/>');
  });
});
