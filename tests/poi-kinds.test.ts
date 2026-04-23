import { describe, it, expect } from 'vitest';
import { FLOATING_POI_KINDS, POI_TIER, type PoiKind } from '../src/poi/poi-kinds.js';

describe('PoiKind constants', () => {
  it('FLOATING_POI_KINDS contains exactly pier and well', () => {
    expect(FLOATING_POI_KINDS).toEqual(new Set<PoiKind>(['pier', 'well']));
  });

  it('every listed kind has a priority tier', () => {
    const all: PoiKind[] = [
      'inn', 'tavern', 'temple', 'cathedral', 'chapel',
      'smithy', 'stable', 'shop', 'market', 'bathhouse',
      'guardhouse', 'guildhall', 'warehouse', 'pier',
      'mill', 'well',
    ];
    for (const k of all) {
      expect(POI_TIER[k]).toBeDefined();
      expect([1, 2, 3]).toContain(POI_TIER[k]);
    }
  });

  it('Tier 1 contains cathedral, chapel, inn, market, mill, smithy, tavern', () => {
    const tier1 = Object.entries(POI_TIER)
      .filter(([, t]) => t === 1)
      .map(([k]) => k)
      .sort();
    expect(tier1).toEqual(['cathedral', 'chapel', 'inn', 'market', 'mill', 'smithy', 'tavern']);
  });

  it('Tier 3 contains only warehouse', () => {
    const tier3 = Object.entries(POI_TIER)
      .filter(([, t]) => t === 3)
      .map(([k]) => k);
    expect(tier3).toEqual(['warehouse']);
  });
});
