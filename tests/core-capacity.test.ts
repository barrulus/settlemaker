import { describe, it, expect } from 'vitest';
import { mapToGenerationParams, corePatchCount, DEFAULT_CORE_CAPACITY, MAX_PATCHES } from '../src/input/azgaar-input.js';
import { parseSettlementUrl } from '../src/url/params.js';
import type { AzgaarBurgInput } from '../src/index.js';

function burg(population: number, coreCapacity?: number): AzgaarBurgInput {
  return {
    name: 'Capsford', population,
    port: false, citadel: false, walls: true,
    plaza: true, temple: false, shanty: false, capital: false,
    ...(coreCapacity !== undefined ? { coreCapacity } : {}),
  };
}

describe('coreCapacity', () => {
  it('defaults to 10000', () => {
    expect(DEFAULT_CORE_CAPACITY).toBe(10000);
  });

  it('caps core size once population exceeds the capacity', () => {
    const atCap = corePatchCount(10000, DEFAULT_CORE_CAPACITY);
    const wayOver = corePatchCount(250000, DEFAULT_CORE_CAPACITY);
    expect(wayOver).toBe(atCap);
  });

  it('leaves small settlements uncapped', () => {
    expect(corePatchCount(800, DEFAULT_CORE_CAPACITY))
      .toBeLessThan(corePatchCount(9000, DEFAULT_CORE_CAPACITY));
  });

  it('honours an explicit capacity', () => {
    expect(corePatchCount(250000, 40000)).toBeGreaterThan(corePatchCount(250000, 10000));
  });

  it('keeps nCore within the total budget', () => {
    const params = mapToGenerationParams(burg(250000));
    expect(params.nCore).toBeLessThanOrEqual(params.nPatches);
    expect(params.nPatches).toBeLessThanOrEqual(MAX_PATCHES);
  });

  it('is accepted as a flat URL param', async () => {
    const parsed = await parseSettlementUrl(new URLSearchParams('pop=250000&coreCapacity=40000'));
    expect(parsed.burg.coreCapacity).toBe(40000);
  });

  it('ignores a non-positive flat coreCapacity', async () => {
    const parsed = await parseSettlementUrl(new URLSearchParams('pop=1000&coreCapacity=0'));
    expect(parsed.burg.coreCapacity).toBeUndefined();
  });
});
