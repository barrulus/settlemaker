// tests/known-defects.test.ts
//
// KNOWN DEFECT — ward-distribution deck sized off params.nCore (uncapped,
// also mismatching this.nCore's clamp) but dealt to nCore minus plaza minus
// gate wards, starving the deck tail (see buildWardDistribution in
// src/wards/ward-distribution.ts and its consumption loop in
// src/generator/model.ts's createWards). Park and Cathedral sit near the
// tail of the deck, so they are starved hardest: at pop 20000 they only
// reach a small minority of runs. Deliberately deferred by the owner
// 2026-08-11 (see SDD ledger: .superpowers/sdd/2026-08-09-round-cores-faubourgs).
//
// This test exists ONLY to keep that defect visible. It pins the CURRENT
// BAD reachability rate with bounds set just above the measured rate, so it
// stays green while the bug is present. IT IS DESIGNED TO FAIL THE DAY
// SOMEONE FIXES THE DECK SIZING — at which point Park/Cathedral rates will
// jump well above these bounds. When that happens: DELETE this test and
// write real reachability tests (e.g. asserting Park/Cathedral appear in
// the large majority of runs at a size where they're expected).
//
// Measured 2026-08-11 at pop 20000, seeds 1-20, walled/plaza'd/templed
// non-capital non-port burg: Park in 1/20 runs (5%), Cathedral in 3/20 runs
// (15%). (A prior reviewer sweep at 40 seeds measured Park 1/40, Cathedral
// 5/40 — consistent with this measurement.) Bounds below are set just above
// these measured rates so the test is a tight pin, not a loose tripwire.
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

describe('known defect: ward-distribution deck starves Park/Cathedral', () => {
  it('Park and Cathedral reach only a small minority of runs at pop 20000 (KNOWN DEFECT — see file header)', () => {
    let parkRuns = 0;
    let cathedralRuns = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const { model } = generateFromBurg(burg(), { seed });
      const types = new Set(model.patches.map(p => p.ward?.type));
      if (types.has(WardType.Park)) parkRuns++;
      if (types.has(WardType.Cathedral)) cathedralRuns++;
    }

    // Measured: 1/20 (5%). Bound: <10% (< 2/20), just above the measured rate.
    expect(parkRuns).toBeLessThan(SEEDS * 0.10);
    // Measured: 3/20 (15%). Bound: <30% (< 6/20), just above the measured rate.
    expect(cathedralRuns).toBeLessThan(SEEDS * 0.30);
  }, 60000);
});
