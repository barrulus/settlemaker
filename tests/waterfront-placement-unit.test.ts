import { describe, expect, it } from 'vitest';
import type { AzgaarBurgInput } from '../src/input/azgaar-input.js';
import { buildSite } from '../src/village/site.js';
import { portRiverBanks, riverfrontPlacement } from '../src/settlement/waterfront-placement.js';
import { riverPolygons } from '../src/village/rivers.js';

const river = (id: string | undefined, x: number) => ({ ...(id ? { id } : {}),
  centreline: [{ x, y: -7000 }, { x, y: 7000 }], widthM: 40, meander: false });
const base: AzgaarBurgInput = { name: 'Bank', population: 4000, port: true, harbourWaterKind: 'river',
  harbourRiverId: 'main', walls: true, citadel: false, plaza: true, temple: false, shanty: false,
  rivers: [river('main', 600)], coastlineGeometry: [], waterContext: { version: 1, status: 'measured',
    coordinateSpace: 'burg-local-metres', surveyRadiusM: 6000, geometryErrorM: .5, bodies: [] } };
const placement = (input: AzgaarBurgInput) => riverfrontPlacement(input, buildSite(input, 4), 100, 4);

describe('explicit riverfront town anchoring', () => {
  it('moves the town along dry ground while leaving its river survey untouched', () => {
    const site = buildSite(base, 4), before = JSON.stringify(site.water);
    expect(riverfrontPlacement(base, site, 100, 4)).toEqual({ kind: 'riverfront', riverId: 'main',
      offsetM: { x: 540, y: 0 }, originalBankDistanceM: 580, targetBankDistanceM: 40 });
    expect(JSON.stringify(site.water)).toBe(before);
  });
  it('leaves towns already near their bank and unrelated nonports in place', () => {
    expect(placement({ ...base, rivers: [river('main', 65)] })).toBeUndefined();
    expect(placement({ ...base, port: false })).toBeUndefined();
    expect(placement({ ...base, harbourWaterKind: 'ocean' })).toBeUndefined();
  });
  it('never crosses an intervening river or substitutes a missing named river', () => {
    expect(placement({ ...base, rivers: [river('blocker', 300), river('main', 600)] })).toBeUndefined();
    expect(placement({ ...base, harbourRiverId: 'missing' })).toBeUndefined();
    expect(portRiverBanks({ ...base, harbourRiverId: 'missing' }, 4)).toEqual([]);
  });
  it('accepts one legacy river but declines ambiguous distinct or anonymous rivers', () => {
    expect(placement({ ...base, harbourRiverId: undefined })).toBeDefined();
    expect(placement({ ...base, harbourRiverId: undefined, rivers: [river('a', 600), river('b', -600)] })).toBeUndefined();
    expect(placement({ ...base, harbourRiverId: undefined, rivers: [river(undefined, 600), river(undefined, -600)] })).toBeUndefined();
  });
  it('keeps the original procedural river index when selecting a named channel', () => {
    const input = { ...base, rivers: [river('other', -800), { ...river('main', 600), meander: true }] };
    expect(portRiverBanks(input, 4)).toEqual([riverPolygons(input, 4)[1]]);
    expect(placement(input)).toBeDefined();
  });
});
