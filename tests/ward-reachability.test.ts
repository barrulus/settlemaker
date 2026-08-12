// tests/ward-reachability.test.ts
//
// Real reachability tests for the distinctive singleton wards (Park,
// Cathedral, Military), replacing the known-defect pin that tracked the
// ward-deck starvation (tests/known-defects.test.ts, deleted when the deck
// sizing was fixed). The deck is now sized to the exact number of patches
// the assignment loop deals to, so every deck entry — including the tail
// singletons — is dealt in every run. At a scale where a temple'd, plaza'd,
// walled city expects all three, they must appear in (nearly) every run,
// not a lucky minority.
import { describe, it, expect } from 'vitest';
import { generateFromBurg, WardType, type AzgaarBurgInput } from '../src/index.js';

const SEEDS = 20;
const POPULATION = 20000;

function burg(): AzgaarBurgInput {
  return {
    name: 'Deckburg', population: POPULATION,
    port: false, citadel: false, walls: true,
    plaza: true, temple: true, shanty: false, capital: false,
  };
}

describe('ward reachability: singleton wards are dealt, not starved', () => {
  it('Park, Cathedral, and Military appear in ~every run at pop 20000', () => {
    let parkRuns = 0;
    let cathedralRuns = 0;
    let militaryRuns = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const { model } = generateFromBurg(burg(), { seed });
      const types = new Set(model.patches.map(p => p.ward?.type));
      if (types.has(WardType.Park)) parkRuns++;
      if (types.has(WardType.Cathedral)) cathedralRuns++;
      if (types.has(WardType.Military)) militaryRuns++;
    }

    // Deck length == deal slots by construction, so these are expected at
    // 20/20; the 90% bound leaves room for a rare degenerate layout without
    // letting starvation (previously 1/20, 3/20, 6/20) sneak back.
    expect(parkRuns).toBeGreaterThanOrEqual(SEEDS * 0.9);
    expect(cathedralRuns).toBeGreaterThanOrEqual(SEEDS * 0.9);
    expect(militaryRuns).toBeGreaterThanOrEqual(SEEDS * 0.9);
  }, 120000);
});
