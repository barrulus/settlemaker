import { describe, it, expect } from 'vitest';
import { parseSettlementUrl } from '../src/url/params.js';
import { UrlCodecError } from '../src/url/codec.js';
import { BIOMES, biomeThemeFor } from '../src/appearance/biomes.js';
import { encodeJsonParam } from '../src/url/codec.js';

const parse = (q: string) => parseSettlementUrl(new URLSearchParams(q));

describe('migration of villageTheme= links to shared appearance', () => {
  it('becomes common appearance overrides', async () => {
    const p = await parse('name=Ashford&pop=400&villageTheme=desert');
    expect(p.themeOverrides?.paper).toBe(biomeThemeFor('desert').ground);
    expect(p).not.toHaveProperty('villageThemeName');
  });

  it('is absent when not supplied, rather than defaulted', async () => {
    const p = await parse('name=Ashford&pop=400');
    expect(p.themeOverrides).toBeUndefined();
    expect(p).not.toHaveProperty('villageThemeName');
  });

  it('applies the same surface colours to a city-sized burg', async () => {
    const p = await parse('name=Teli&pop=9000&villageTheme=tundra');
    expect(p.themeOverrides?.paper).toBe(biomeThemeFor('tundra').ground);
  });

  it('is independent of biome=, which stays a data param', async () => {
    const p = await parse('name=Ashford&pop=400&biome=hot+desert&villageTheme=tundra');
    expect(p.burg.biome).toBe('hot desert');   // untouched; the engine normalises
    expect(p.themeOverrides?.paper).toBe(biomeThemeFor('tundra').ground);
  });

  it('is independent of the shared theme= palette', async () => {
    const p = await parse('name=Ashford&pop=400&theme=night&villageTheme=desert');
    expect(p.paletteName).toBe('night');
    expect(p.themeOverrides?.paper).toBe(biomeThemeFor('desert').ground);
    expect(p).not.toHaveProperty('villageThemeName');
  });

  it('rejects an unknown theme loudly instead of rendering temperate', async () => {
    // The whole point. A silent fallback here would be byte-identical to
    // passing nothing, which is precisely the "looks live, does nothing"
    // failure the biome normalisation in this release removes. Validated in
    // the library so an unmigrated consumer cannot forget to check.
    await expect(parse('name=Ashford&pop=400&villageTheme=desrt'))
      .rejects.toBeInstanceOf(UrlCodecError);
  });

  it('names the legal set in the error, so the caller can fix it', async () => {
    const err = await parse('name=Ashford&pop=400&villageTheme=desrt').catch(e => e);
    expect(err.reason).toBe('villageTheme');
    for (const b of BIOMES) expect(err.message).toContain(b);
    expect(err.message).toContain('desrt');
  });

  it('rejects it on a city-sized burg too — uniform parse, uniform validation', async () => {
    await expect(parse('name=Teli&pop=9000&villageTheme=desrt'))
      .rejects.toBeInstanceOf(UrlCodecError);
  });

  it('accepts every shipped theme', async () => {
    for (const b of BIOMES) {
      const p = await parse(`name=Ashford&pop=400&villageTheme=${b}`);
      expect(p.themeOverrides).toMatchObject({ paper: biomeThemeFor(b).ground, water: biomeThemeFor(b).water });
    }
  });

  it('lets explicit style colours override migrated regional colours', async () => {
    const style = await encodeJsonParam({ paper: '#123456' });
    const p = await parseSettlementUrl(new URLSearchParams({ villageTheme: 'desert', style }));
    expect(p.themeOverrides?.paper).toBe('#123456');
    expect(p.themeOverrides?.water).toBe(biomeThemeFor('desert').water);
  });

  it('does not on its own count as a data param' , async () => {
    // Presence of only presentation params must still yield the random demo
    // burg, exactly as `theme=`/`style=` do.
    const p = await parse('villageTheme=desert');
    expect(p.random).toBe(true);
  });
});
