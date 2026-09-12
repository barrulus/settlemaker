import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  createSkin, generateSettlement, generateFromBurg, renderVillage, generateSvg,
  skinBiomeFor, SKIN_SLOTS, PALETTES, themeFrom, type AzgaarBurgInput,
} from '../src/index.js';

const burg: AzgaarBurgInput = {
  name: 'Skin test', population: 250, port: false, citadel: false,
  walls: false, plaza: true, temple: true, shanty: false, capital: false,
};
const body = '<path d="M12 46L32 10L52 46Z" fill="var(--sm-crystal, #aaccee)"/>';
const sil = '<path d="M12 46L32 10L52 46Z" fill="currentColor"/>';
const header = { version: 1, id: 'crystal', name: 'Crystal' };
const stableGeoJson = (value: unknown): unknown => JSON.parse(JSON.stringify(value,
  (key, value) => key === 'generated_at' ? undefined : value));

describe('portable skins', () => {
  it('loads the documented JSON example', () => {
    const source = JSON.parse(readFileSync(new URL('../docs/examples/moon-glass.skin.json', import.meta.url), 'utf8'));
    const skin = createSkin(source);
    const result = generateSettlement({ ...burg, biome: 'moon wastes' }, { seed: 42, skin });
    expect(result.svg).toContain('#68748c');
    expect(result.svg).toContain('M12 46L32 10L52 46Z');
  });

  it('replaces every used village asset category without changing geometry or default rendering', () => {
    const original = generateSettlement(burg, { seed: 42 });
    if (original.kind !== 'village') throw new Error('Expected village');
    expect(original.model.fields.length).toBeGreaterThan(0);
    expect(original.model.vegetation.length).toBeGreaterThan(0);
    const glyphs = Object.fromEntries(Object.keys(SKIN_SLOTS).map(id => [id, { body, sil }]));
    const skin = createSkin({ ...header, glyphs, tokens: { '--sm-crystal': '#123456' } });
    const changed = generateSettlement(burg, { seed: 42, skin });
    expect(changed.model).toEqual(original.model);
    expect(stableGeoJson(changed.geojson)).toEqual(stableGeoJson(original.geojson));
    expect(changed.svg).toContain('var(--sm-crystal, #123456)');
    for (const id of [original.model.buildings[0].glyph, original.model.fields[0].glyph, original.model.vegetation[0].glyph, `${original.model.green.shape}-${original.model.green.variant}`]) {
      expect(changed.svg).toContain(`<g id="${id}">${body.replace('#aaccee', '#123456')}</g>`);
    }
    expect(renderVillage(original.model, 4, undefined, { skin })).toBe(changed.svg);
    expect(renderVillage(original.model)).toBe(original.svg);
    expect(generateSettlement(burg, { seed: 42, skin: createSkin(header) }).svg).toBe(original.svg);
  });

  it('uses a custom biome’s base for the whole generation pipeline in both engines', () => {
    const skin = createSkin({ ...header, biomes: {
      lunar: { base: 'tundra', aliases: ['Moon wastes'], village: { ground: '#112233' }, city: { paper: '#445566' } },
    } });
    expect(skinBiomeFor(skin, ' MOON WASTES ')).toEqual({ name: 'lunar', base: 'tundra' });
    expect(skinBiomeFor(skin, 'hot desert').base).toBe('desert');
    expect(skinBiomeFor(skin, 'constructor').base).toBe('temperate');
    for (const population of [250, 2000]) {
      const baseline = generateSettlement({ ...burg, population, biome: 'tundra' }, { seed: 42 });
      const custom = generateSettlement({ ...burg, population, biome: 'moon wastes' }, { seed: 42, skin });
      expect(stableGeoJson(custom.geojson)).toEqual(stableGeoJson(baseline.geojson));
      expect(custom.svg).toContain(population === 250 ? '#112233' : '#445566');
    }
  });

  it('applies city artwork and themes through high and low level entry points', () => {
    const city = { ...burg, population: 2000 };
    const baseline = generateFromBurg(city, { seed: 42 });
    const glyphs = Object.fromEntries(Object.keys(SKIN_SLOTS).map(id => [id, { body, sil }]));
    const skin = createSkin({ ...header, glyphs, tokens: { '--sm-crystal': '#123456' }, city: { paper: '#223344' } });
    const changed = generateFromBurg(city, { seed: 42, skin });
    expect(stableGeoJson(changed.geojson)).toEqual(stableGeoJson(baseline.geojson));
    expect(changed.svg).toContain(body.replace('#aaccee', '#123456'));
    expect(changed.svg).toContain(sil);
    expect(changed.svg).toContain('fill="#223344"');
    expect(generateSvg(changed.model, { skin })).toBe(changed.svg);
    expect(generateFromBurg(city, { seed: 42, skin, svg: { theme: { paper: '#abcdef' } } }).svg).toContain('fill="#abcdef"');
    expect(generateFromBurg(city, { seed: 42, skin: createSkin(header) }).svg).toBe(baseline.svg);
  });

  it('preserves material tokens for unrelated city overrides and honours an explicit palette', () => {
    const city = generateFromBurg({ ...burg, population: 2000 }, { seed: 42 }).model;
    const skin = createSkin({ ...header, tokens: { '--sm-stone': '#abcdef' }, city: { paper: '#112233' } });
    const themed = generateSvg(city, { skin, theme: { paper: '#445566' } });
    expect(themed).toContain('--sm-stone:#abcdef');
    expect(themed).toContain('fill="#445566"');
    const night = generateSvg(city, { skin, palette: PALETTES.night });
    expect(night).toContain(`fill="${themeFrom(PALETTES.night).paper}"`);
    expect(night).toContain(`--sm-stone:${themeFrom(PALETTES.night).smStone}`);
  });

  it('scopes clipping IDs and does not reuse a replaced building’s old silhouette', () => {
    const artwork = '<defs><clipPath id="crop"><rect width="64" height="64"/></clipPath></defs><g clip-path="url(#crop)"><circle cx="32" cy="32" r="20"/></g>';
    const source = { ...header, glyphs: { 'sm-house': { body: artwork }, 'sm-house-tiled': { body: artwork } } };
    const skin = createSkin(source);
    source.glyphs['sm-house'].body = '<script/>';
    const result = generateSettlement(burg, { seed: 42, skin });
    expect(result.svg).toMatch(/id="skin-crystal-sm-house(?:-tiled)?-body-crop"/);
    expect(result.svg).not.toContain('id="crop"');
    expect(result.svg).not.toContain('<script');
    expect(result.svg).not.toMatch(/<g id="sm-house(?:-tiled)?-sil">/);
    expect(Object.isFrozen(skin)).toBe(true);
  });

  it('lets biome overrides win over skin defaults and keeps skins isolated', () => {
    const skin = createSkin({ ...header, village: { ground: '#111111' }, biomes: {
      temperate: { base: 'temperate', village: { ground: '#222222' } },
    } });
    const other = createSkin({ ...header, village: { ground: '#333333' } });
    expect(generateSettlement(burg, { seed: 42, skin }).svg).toContain('fill="#222222"');
    expect(generateSettlement(burg, { seed: 42, skin: other }).svg).toContain('fill="#333333"');
    expect(generateSettlement(burg, { seed: 42, skin }).svg).toContain('fill="#222222"');
  });

  it.each([
    { version: 2 }, { glyphs: { 'unknown-house': { body } } },
    { glyphs: { 'sm-house': { body, viewBox: [0, 0, 10, 10] } } },
    { biomes: { lunar: { base: 'missing' } } },
    { biomes: { lunar: { base: 'tundra', aliases: ['lunar'] } } },
    { tokens: { '--sm-ink': ';}body{display:none}' } },
    { village: { ground: '"><script/>' } }, { city: { shadowOpacity: 2 } },
    { city: { shadowOffset: { dx: Infinity, dy: 0 } } },
    { glyphs: { 'sm-house': { body: '<script>alert(1)</script>' } } },
    { glyphs: { 'sm-house': { body: '<path onclick="alert(1)"/>' } } },
    { glyphs: { 'sm-house': { body: '<image href="https://example.com/a.png"/>' } } },
    { glyphs: { 'sm-house': { body: '<path fill="url(https://example.com/a.svg)"/>' } } },
    { glyphs: { 'sm-house': { body: '<g><path/></defs>' } } },
    { glyphs: { 'sm-house': { body: '<path clip-path="url(#missing)"/>' } } },
    { glyphs: { 'sm-house': { body: '<path fill="&#35;fff"/>' } } },
  ])('rejects invalid definitions before rendering: %j', invalid => {
    expect(() => createSkin({ ...header, ...invalid })).toThrow();
  });
});
