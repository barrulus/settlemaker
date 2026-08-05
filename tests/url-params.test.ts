import { describe, it, expect } from 'vitest';
import { parseSettlementUrl, sanitizeThemeOverrides } from '../src/url/params.js';
import { encodeBurgParam, encodeJsonParam } from '../src/url/codec.js';
import { toprak } from './fixtures/toprak.js';

const sp = (q: string) => new URLSearchParams(q);

describe('parseSettlementUrl', () => {
  it('parses the flat tier', async () => {
    const p = await parseSettlementUrl(sp('name=Salt+Harbour&pop=4200&seed=7&port=1&walls=1&plaza=1&temple=0&shanty=0&citadel=0&capital=0&trade=1&oceanBearing=135&harbourSize=large&biome=desert&urbanDensity=5'));
    expect(p.random).toBe(false);
    expect(p.burg.name).toBe('Salt Harbour');
    expect(p.burg.population).toBe(4200);
    expect(p.burg.port).toBe(true);
    expect(p.burg.walls).toBe(true);
    expect(p.burg.temple).toBe(false);
    expect(p.burg.trade).toBe(true);
    expect(p.burg.oceanBearing).toBeCloseTo(135, 5);
    expect(p.burg.harbourSize).toBe('large');
    expect(p.burg.biome).toBe('desert');
    expect(p.burg.urbanDensity).toBeCloseTo(5, 5);
    expect(p.seedOverride).toBe(7);
  });

  it('i= wins over every flat data param', async () => {
    const i = await encodeBurgParam(toprak, 99);
    const p = await parseSettlementUrl(sp(`i=${i}&name=Ignored&pop=99999&seed=1`));
    expect(p.burg).toEqual(toprak);
    expect(p.seedOverride).toBe(99); // envelope seed, not the flat one
  });

  it('presentation params apply in both tiers', async () => {
    const style = await encodeJsonParam({ buildingFill: '#123456' });
    const i = await encodeBurgParam(toprak);
    const p = await parseSettlementUrl(sp(`i=${i}&theme=classic&style=${style}`));
    expect(p.paletteName).toBe('classic');
    expect(p.themeOverrides).toEqual({ buildingFill: '#123456' });
  });

  it('no params → deterministic random demo burg from injected seed', async () => {
    const a = await parseSettlementUrl(sp(''), { randomSeed: () => 424242 });
    const b = await parseSettlementUrl(sp(''), { randomSeed: () => 424242 });
    expect(a.random).toBe(true);
    expect(a.seedOverride).toBe(424242);
    expect(a.burg).toEqual(b.burg);
    expect(a.burg.population).toBeGreaterThan(0);
  });

  it('invalid harbourSize is dropped, not passed through', async () => {
    const p = await parseSettlementUrl(sp('name=X&pop=100&port=1&harbourSize=gigantic'));
    expect(p.burg.harbourSize).toBeUndefined();
  });

  it('malformed i= propagates UrlCodecError (page renders the error card)', async () => {
    await expect(parseSettlementUrl(sp('i=%%%'))).rejects.toMatchObject({ name: 'UrlCodecError' });
  });

  it('malformed style= propagates too', async () => {
    const i = await encodeBurgParam(toprak);
    await expect(parseSettlementUrl(sp(`i=${i}&style=AAAA`))).rejects.toMatchObject({ name: 'UrlCodecError' });
  });
});

describe('sanitizeThemeOverrides', () => {
  it('drops XSS-shaped color strings and unknown keys', () => {
    const out = sanitizeThemeOverrides({
      paper: '"><img src=x onerror=x>',
      buildingFill: 'javascript:alert(1)',
      notARealKey: '#123456',
    });
    expect(out).not.toHaveProperty('paper');
    expect(out).not.toHaveProperty('buildingFill');
    expect(out).not.toHaveProperty('notARealKey');
    expect(out).toEqual({});
  });

  it('accepts valid hex colors, null water/waterEdge, and finite numbers', () => {
    const out = sanitizeThemeOverrides({
      buildingFill: '#123456',
      water: null,
      waterEdge: null,
      shadowOpacity: 0.5,
      arteryWidth: 3,
    });
    expect(out).toEqual({
      buildingFill: '#123456',
      water: null,
      waterEdge: null,
      shadowOpacity: 0.5,
      arteryWidth: 3,
    });
  });

  it('drops shadowOffset with a non-numeric dx', () => {
    const out = sanitizeThemeOverrides({ shadowOffset: { dx: 'nope', dy: 1 } });
    expect(out).not.toHaveProperty('shadowOffset');
  });

  it('accepts a valid shadowOffset and rebuilds it rather than aliasing the input', () => {
    const offset = { dx: 0.4, dy: 0.6 };
    const out = sanitizeThemeOverrides({ shadowOffset: offset });
    expect(out.shadowOffset).toEqual(offset);
    expect(out.shadowOffset).not.toBe(offset);
  });
});
