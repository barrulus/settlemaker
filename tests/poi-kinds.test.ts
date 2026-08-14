import { describe, it, expect } from 'vitest';
import { FLOATING_POI_KINDS, POI_TIER, type PoiKind } from '../src/poi/poi-kinds.js';

describe('PoiKind constants', () => {
  it('FLOATING_POI_KINDS contains exactly pier, well, market, mill', () => {
    // Task 10: market/mill are now sourced from generator-placed symbol
    // sites (sm-market-cross, sm-mill-wind) rather than adopted buildings,
    // so they carry a null building_id like the other floating kinds.
    expect(FLOATING_POI_KINDS).toEqual(new Set<PoiKind>(['pier', 'well', 'market', 'mill']));
  });

  it('POI_TIER has one entry per PoiKind and tiers are 1/2/3', () => {
    // Driven by Object.keys(POI_TIER) so adding a kind to the type AND the map
    // is self-consistent without editing this test. TS ensures POI_TIER is a
    // total Record<PoiKind, ...>, so keys(POI_TIER) IS the full PoiKind set.
    const kinds = Object.keys(POI_TIER) as PoiKind[];
    expect(kinds).toHaveLength(16);
    for (const k of kinds) expect([1, 2, 3]).toContain(POI_TIER[k]);
  });

  it('FLOATING_POI_KINDS is a subset of the PoiKind keys', () => {
    const kinds = new Set(Object.keys(POI_TIER));
    for (const k of FLOATING_POI_KINDS) expect(kinds.has(k)).toBe(true);
  });

  it('Tier 1 contains cathedral, chapel, inn, market, mill, smithy, tavern', () => {
    const tier1 = Object.entries(POI_TIER)
      .filter(([, t]) => t === 1)
      .map(([k]) => k)
      .sort();
    expect(tier1).toEqual(['cathedral', 'chapel', 'inn', 'market', 'mill', 'smithy', 'tavern']);
  });

  it('Tier 3 contains warehouse plus floating kinds pier and well', () => {
    const tier3 = Object.entries(POI_TIER)
      .filter(([, t]) => t === 3)
      .map(([k]) => k)
      .sort();
    expect(tier3).toEqual(['pier', 'warehouse', 'well']);
  });

  it('Tier 2 contains bathhouse, guardhouse, guildhall, shop, stable, temple', () => {
    const tier2 = Object.entries(POI_TIER)
      .filter(([, t]) => t === 2)
      .map(([k]) => k)
      .sort();
    expect(tier2).toEqual(['bathhouse', 'guardhouse', 'guildhall', 'shop', 'stable', 'temple']);
  });
});
