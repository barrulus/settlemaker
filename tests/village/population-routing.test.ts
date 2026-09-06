/**
 * Ship plan Phase 5 — population routing.
 *
 * Two engines now exist. A caller should not have to know that: they hand
 * over a burg and get a settlement back. Which engine ran is an
 * implementation detail, reported for diagnostics but never asked for.
 */
import { describe, expect, it } from 'vitest';
import { generateSettlement, VILLAGE_POP_CEILING } from '../../src/index.js';
import type { AzgaarBurgInput } from '../../src/input/azgaar-input.js';

const burg = (population: number): AzgaarBurgInput => ({
  name: 'Boundary', population, port: false, citadel: false, walls: false,
  plaza: false, temple: false, shanty: false, capital: false,
  roadBearings: [
    { bearing_deg: 40, kind: 'main', through: true, route_id: 'r-main' },
    { bearing_deg: 165, kind: 'town', route_id: 'r-town' },
  ],
} as AzgaarBurgInput);

describe('Phase 5: one entry point, routed by population', () => {
  it('sends the small ones to the village engine and the big ones to the old one', () => {
    expect(generateSettlement(burg(VILLAGE_POP_CEILING - 1), { seed: 1 }).kind).toBe('village');
    expect(generateSettlement(burg(VILLAGE_POP_CEILING), { seed: 1 }).kind).toBe('village');
    expect(generateSettlement(burg(VILLAGE_POP_CEILING + 1), { seed: 1 }).kind).toBe('settlement');
  });

  it('gives a consumer the same shape on both sides of the boundary', () => {
    // The acceptance bar: sweep the boundary, and nothing a consumer reads
    // should tell them which engine ran unless they look at `kind`.
    for (const population of [200, 600, 999, 1000, 1001, 1400, 4000]) {
      const r = generateSettlement(burg(population), { seed: 1 });
      expect(typeof r.svg, `pop ${population}: svg`).toBe('string');
      expect(r.svg.startsWith('<svg'), `pop ${population}: svg is not an svg`).toBe(true);
      expect(r.svg, `pop ${population}: tiler crop contract`).toContain('data-bg="paper"');
      expect(r.geojson.type, `pop ${population}: geojson`).toBe('FeatureCollection');
      expect(r.geojson.features.length, `pop ${population}: no features`).toBeGreaterThan(0);
      expect(Array.isArray(r.degradedFlags), `pop ${population}: degradedFlags`).toBe(true);
    }
  });

  it('emits the same metadata keys from either engine', () => {
    const small = generateSettlement(burg(400), { seed: 1 });
    const large = generateSettlement(burg(4000), { seed: 1 });
    const meta = (r: typeof small) =>
      (r.geojson as unknown as { metadata: Record<string, unknown> }).metadata;
    // Every key the settlement path publishes must exist on the village path
    // too, or a consumer that reads one crashes on the other.
    for (const k of Object.keys(meta(large))) {
      expect(meta(small)[k], `village metadata is missing '${k}'`).toBeDefined();
    }
  });

  it('gives two differently-named burgs different villages with NO seed', () => {
    // C1 (whole-branch review): the village branch hard-coded `seed ?? 1`
    // while the settlement branch defaults to a hash of the burg name. Every
    // unseeded village on an FMG map with the same route/population shape
    // was therefore the SAME village, and regenerating the map could not
    // change it. The Phase 5 grid missed it because every call in it passes
    // an explicit seed -- so this one deliberately passes none.
    for (const population of [400, 4000]) {
      const a = generateSettlement({ ...burg(population), name: 'Ashford' });
      const b = generateSettlement({ ...burg(population), name: 'Bexley' });
      expect(a.svg, `pop ${population}: two burgs generated the same settlement`).not.toBe(b.svg);
    }
    // ...and the same name still gives the same settlement, on both sides.
    for (const population of [400, 4000]) {
      expect(generateSettlement({ ...burg(population), name: 'Ashford' }).svg)
        .toBe(generateSettlement({ ...burg(population), name: 'Ashford' }).svg);
    }
  });

  it('is deterministic, and honours the seed on both sides', () => {
    for (const population of [400, 4000]) {
      const a = generateSettlement(burg(population), { seed: 7 });
      const b = generateSettlement(burg(population), { seed: 7 });
      expect(a.svg, `pop ${population}`).toBe(b.svg);
      const c = generateSettlement(burg(population), { seed: 8 });
      expect(c.svg, `pop ${population}: seed 8 matched seed 7`).not.toBe(a.svg);
    }
  });

  it('hands back the engine-specific model for callers that want it', () => {
    const v = generateSettlement(burg(400), { seed: 1 });
    const s = generateSettlement(burg(4000), { seed: 1 });
    if (v.kind !== 'village') throw new Error('expected a village');
    if (s.kind !== 'settlement') throw new Error('expected a settlement');
    expect(v.model.green).toBeDefined();
    expect(v.model.lanes.length).toBeGreaterThan(0);
    expect(s.model.patches.length).toBeGreaterThan(0);
  });
});
