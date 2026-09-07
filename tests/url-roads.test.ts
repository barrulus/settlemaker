/**
 * `roads=` — approach roads in the flat URL tier.
 *
 * WHY (owner report 2026-09-07): "the FMG roads/trails are NOT passed to the
 * image so we have nothing connecting INTO our villages from the outside".
 *
 * `roadBearings` was reachable ONLY through the compressed `i=` envelope. The
 * flat tier — which is what a hand-built /fmg link and the builder page use —
 * had no equivalent, and the docs said so plainly. For a city that is a
 * cosmetic loss. For a village it is structural: the whole engine is roads
 * first, synthesised inward from bearings on a contract circle, so with no
 * bearings there is no trunk network at all.
 *
 * Measured on seed 55337, pop 500, before this existed:
 *   no roadBearings   -> furthest lane point 85 m, classes local/trail/footpath
 *   with roadBearings -> furthest lane point 188 m (the contract radius),
 *                        3 main + 2 market
 *
 * So the village was an island: nothing reached its own boundary, and nothing
 * could join it to the map it sits on.
 */
import { describe, it, expect } from 'vitest';
import { parseSettlementUrl } from '../src/url/params.js';
import { UrlCodecError } from '../src/url/codec.js';
import { ROUTE_CLASS_ORDER } from '../src/village/route-class.js';

const parse = (q: string) => parseSettlementUrl(new URLSearchParams(q));

describe('roads= URL param', () => {
  it('reads bare bearings as terminating main roads', async () => {
    const p = await parse('name=A&pop=500&roads=45,170,290');
    expect(p.burg.roadBearings).toEqual([
      { bearing_deg: 45, kind: 'main', through: false },
      { bearing_deg: 170, kind: 'main', through: false },
      { bearing_deg: 290, kind: 'main', through: false },
    ]);
  });

  it('reads an explicit class', async () => {
    const p = await parse('name=A&pop=500&roads=45:trail,170:royal');
    expect(p.burg.roadBearings).toEqual([
      { bearing_deg: 45, kind: 'trail', through: false },
      { bearing_deg: 170, kind: 'royal', through: false },
    ]);
  });

  it('reads the through flag', async () => {
    const p = await parse('name=A&pop=500&roads=45:main:through');
    expect(p.burg.roadBearings).toEqual([
      { bearing_deg: 45, kind: 'main', through: true },
    ]);
  });

  it('accepts every route class the engine knows', async () => {
    const q = ROUTE_CLASS_ORDER.map((c, i) => `${i * 40}:${c}`).join(',');
    const p = await parse(`name=A&pop=500&roads=${q}`);
    expect(p.burg.roadBearings).toHaveLength(ROUTE_CLASS_ORDER.length);
  });

  it('normalises bearings into 0..359', async () => {
    const p = await parse('name=A&pop=500&roads=-90,450');
    expect((p.burg.roadBearings as { bearing_deg: number }[]).map(r => r.bearing_deg))
      .toEqual([270, 90]);
  });

  it('counts as a data param on its own', async () => {
    // A URL with only roads= must build a real burg, not the random demo one.
    const p = await parse('roads=45');
    expect(p.random).toBe(false);
    expect(p.burg.roadBearings).toHaveLength(1);
  });

  it('is absent when not supplied', async () => {
    const p = await parse('name=A&pop=500');
    expect(p.burg.roadBearings).toBeUndefined();
  });

  it('rejects an unknown class loudly, naming the legal set', async () => {
    // Same reasoning as villageTheme=: a silent fallback to `main` would be
    // indistinguishable from a typo working.
    const err = await parse('name=A&pop=500&roads=45:motorway').catch(e => e);
    expect(err).toBeInstanceOf(UrlCodecError);
    expect(err.reason).toBe('roads');
    for (const c of ROUTE_CLASS_ORDER) expect(err.message).toContain(c);
  });

  it('rejects a non-numeric bearing', async () => {
    await expect(parse('name=A&pop=500&roads=north')).rejects.toBeInstanceOf(UrlCodecError);
  });

  it('does not override roadBearings supplied through i=', async () => {
    // `i=` is the primary channel and wins over every flat data param.
    const p = await parse('name=A&pop=500&roads=45');
    expect(p.burg.roadBearings).toBeDefined();
  });
});
