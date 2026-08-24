import {
  describe, it, expect, vi,
} from 'vitest';
import type { AzgaarBurgInput } from '../../src/input/azgaar-input.js';

/**
 * Code review of ab72dbf..6b34262 (finding #1): the escalation loop's
 * overflow branch (`village-model.ts`, `round === MAX_FEEDBACK_ROUNDS`)
 * restored `firstHousedSnapshot` only in the "already housed" arm. If a
 * round after the first-housed one regressed the census back to unhoused
 * -- and the ladder then ran out at `MAX_FEEDBACK_ROUNDS` still unhoused --
 * the loop shipped that unhoused round and silently discarded the housed
 * one it had already found.
 *
 * A real seed that hits this exact shape was not found across a sweep of
 * ~6,000 (scenario x population x seed) combinations -- the ladder only
 * ever LOOSENS constraints (tighter frontage, terracing, relaxed spacing,
 * a wider disc), so a genuine regression from housed back to unhoused is
 * rare enough that this task's search budget did not turn one up. That
 * does not make the bug's control-flow path untested: `spendCensus` is
 * mocked here to force the exact sequence -- housed on the first round,
 * unhoused on every round after -- so the loop's OWN logic is exercised
 * deterministically, independent of whether any real seed happens to walk
 * that path.
 */
vi.mock('../../src/village/dwellings.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/village/dwellings.js')>();
  return { ...actual, spendCensus: vi.fn(actual.spendCensus) };
});

import { spendCensus } from '../../src/village/dwellings.js';
import { generateVillage } from '../../src/village/village-model.js';

const mockedSpendCensus = vi.mocked(spendCensus);

// Five mixed-class routes (the report's "hub" probe scenario): the extra
// arms keep round-0 growth sparse enough that round 0's real block count is
// well under the pop-900 floor of 6, so the loop does not break immediately
// on the forced-housed first round -- it is what lets rounds 1..12 run at
// all under the forced-unhoused override below.
const base: AzgaarBurgInput = {
  name: 'Wick', population: 900, port: false, citadel: false, walls: false,
  plaza: false, temple: false, shanty: false, capital: false,
  roadBearings: [
    { bearing_deg: 12, kind: 'royal', through: true, route_id: 'r-royal' },
    { bearing_deg: 78, kind: 'main', route_id: 'r-main' },
    { bearing_deg: 155, kind: 'town', route_id: 'r-town' },
    { bearing_deg: 231, kind: 'trail', route_id: 'r-trail' },
    { bearing_deg: 304, kind: 'footpath', route_id: 'r-foot' },
  ],
};

describe('generateVillage: block-chase overflow-arm regression (finding #1)', () => {
  it('restores the first-housed round instead of shipping a later un-housed one', () => {
    const defaultImpl = mockedSpendCensus.getMockImplementation()!;
    let call = 0;
    mockedSpendCensus.mockImplementation((...args) => {
      call += 1;
      const real = defaultImpl(...args);
      // Round 0 (the first call): force housed, whatever the real fabric
      // achieved. Every round after: force unhoused, simulating a later
      // ladder rung (chasing blocks) reshaping the fabric badly enough to
      // un-house the census again -- the exact regression finding #1
      // describes.
      return call === 1
        ? { ...real, unhoused: 0 }
        : { ...real, unhoused: Math.max(1, real.unhoused) };
    });

    const m = generateVillage(base, 1);

    // The bug: shipping the unhoused final round and discarding the
    // housed one silently. The fix: restore the first-housed round and
    // say so.
    expect(m.diagnostics.some((d) => d.startsWith('overflow:'))).toBe(false);
    expect(m.diagnostics.some((d) => d.startsWith('restored:'))).toBe(true);

    mockedSpendCensus.mockImplementation(defaultImpl);
  });
});
