/**
 * `villageTheme=` — an explicit village look, independent of `biome=`.
 *
 * WHY a separate param (owner ruling 2026-09-07): `biome=` already reaches the
 * village, but it is a DATA param — it selects the dwelling deck, the field
 * deck, the canopy deck and the plot-edge treatment as well as the ground. A
 * caller who only wants a different look must not silently rebuild the village
 * out of different houses. `theme=` was unavailable: it already names the city
 * palette.
 *
 * Parsed for both branches and surfaced unconditionally; it has effect only on
 * the village branch. That matches the contract's existing habits —
 * `harbourSize` is meaningless without `port`, `oceanBearing` is ignored
 * inland, neither errors — and it means FMG can build one legal URL without
 * first knowing which side of VILLAGE_POP_CEILING the burg falls on.
 */
import { describe, it, expect } from 'vitest';
import { parseSettlementUrl } from '../src/url/params.js';
import { UrlCodecError } from '../src/url/codec.js';
import { VILLAGE_BIOMES } from '../src/village/theme.js';

const parse = (q: string) => parseSettlementUrl(new URLSearchParams(q));

describe('villageTheme= URL param', () => {
  it('is surfaced as villageThemeName', async () => {
    const p = await parse('name=Ashford&pop=400&villageTheme=desert');
    expect(p.villageThemeName).toBe('desert');
  });

  it('is absent when not supplied, rather than defaulted', async () => {
    // Absent must stay absent: renderVillage's own default is
    // villageThemeFor(site.biome), and a value here would override it.
    const p = await parse('name=Ashford&pop=400');
    expect(p.villageThemeName).toBeUndefined();
    expect('villageThemeName' in p).toBe(false);
  });

  it('is accepted on a city-sized burg too, and simply has no effect there', async () => {
    const p = await parse('name=Teli&pop=9000&villageTheme=tundra');
    expect(p.villageThemeName).toBe('tundra');
  });

  it('is independent of biome=, which stays a data param', async () => {
    const p = await parse('name=Ashford&pop=400&biome=hot+desert&villageTheme=tundra');
    expect(p.burg.biome).toBe('hot desert');   // untouched; the engine normalises
    expect(p.villageThemeName).toBe('tundra');
  });

  it('is independent of theme=, which stays the city palette', async () => {
    const p = await parse('name=Ashford&pop=400&theme=night&villageTheme=desert');
    expect(p.paletteName).toBe('night');
    expect(p.villageThemeName).toBe('desert');
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
    for (const b of VILLAGE_BIOMES) expect(err.message).toContain(b);
    expect(err.message).toContain('desrt');
  });

  it('rejects it on a city-sized burg too — uniform parse, uniform validation', async () => {
    await expect(parse('name=Teli&pop=9000&villageTheme=desrt'))
      .rejects.toBeInstanceOf(UrlCodecError);
  });

  it('accepts every shipped theme', async () => {
    for (const b of VILLAGE_BIOMES) {
      const p = await parse(`name=Ashford&pop=400&villageTheme=${b}`);
      expect(p.villageThemeName).toBe(b);
    }
  });

  it('does not on its own count as a data param', async () => {
    // Presence of only presentation params must still yield the random demo
    // burg, exactly as `theme=`/`style=` do.
    const p = await parse('villageTheme=desert');
    expect(p.random).toBe(true);
  });
});
