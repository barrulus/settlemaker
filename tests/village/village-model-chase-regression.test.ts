import {
  describe, it, expect, vi,
} from 'vitest';
import type { AzgaarBurgInput } from '../../src/input/azgaar-input.js';
import {
  cloneLotTrace, newLotTrace, resetLotTrace, restoreLotTrace,
} from '../../src/village/lot-trace.js';

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

// F3 (final fix wave): the same forcing technique, applied to `blockAreas`
// instead of `spendCensus`, so the block chase can be forced to enter and
// exhaust its capped rounds (and therefore restore) independently of
// whether any real seed happens to fall short at round 0.
vi.mock('../../src/village/skeleton/blocks.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/village/skeleton/blocks.js')>();
  return { ...actual, blockAreas: vi.fn(actual.blockAreas) };
});

import { spendCensus } from '../../src/village/dwellings.js';
import { blockAreas } from '../../src/village/skeleton/blocks.js';
import { generateVillage } from '../../src/village/village-model.js';

const mockedSpendCensus = vi.mocked(spendCensus);
const mockedBlockAreas = vi.mocked(blockAreas);

// Five mixed-class routes (the report's "hub" probe scenario) at pop 300,
// seed 38: Task 5's trimTails weld fix (see relax.ts) closes far more of
// growth's own loops into the SHIPPED geometry than before, which raises
// round 0's real block count comfortably over the floor for nearly every
// seed this suite otherwise samples -- so this test was re-pointed at a
// seed that STILL falls short (measured directly with a one-off seed
// sweep run during this task, not kept in scripts/: seed 38 is the one
// hit in a 200-seed sweep of this exact scenario whose round-0 fabric
// stays under its own
// pop-300 floor of 2, letting rounds 1..N still run under the
// forced-unhoused override below). The seed choice is load-bearing for
// the MOCK to reach the code path at all; it is not otherwise special.
const base: AzgaarBurgInput = {
  name: 'Wick', population: 300, port: false, citadel: false, walls: false,
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

    const m = generateVillage(base, 38);

    // The bug: shipping the unhoused final round and discarding the
    // housed one silently. The fix: restore the first-housed round and
    // say so.
    expect(m.diagnostics.some((d) => d.startsWith('overflow:'))).toBe(false);
    expect(m.diagnostics.some((d) => d.startsWith('restored:'))).toBe(true);

    mockedSpendCensus.mockImplementation(defaultImpl);
  });
});

/**
 * F3 (final fix wave): `resetLotTrace` runs every round, mutating the
 * `LotTrace` passed to `generateVillage` IN PLACE (clear, then refill) --
 * unlike `lanes`/`lots`/`spend`, which are reassigned fresh references each
 * round. `restoreFirstHoused` used to restore those reassigned fields but
 * leave `trace` alone, so a discarded chase round's lot histogram (fates,
 * cut frontages, convergence detail) survived into the model the caller
 * actually shipped, even though the geometry it describes was rolled back.
 *
 * `cloneLotTrace`/`restoreLotTrace` (`src/village/lot-trace.ts`) give the
 * trace the same snapshot/restore semantics every other chase field
 * already has. This section tests the mechanism directly (unit-level,
 * reproducing the exact "mutate in place, then reset-and-refill" shape
 * `village-model.ts`'s round loop puts a live trace through), and then
 * once through `generateVillage` itself with the block chase forced to
 * run and restore, confirming the restored trace's contents are internally
 * consistent with what actually shipped.
 */
describe('cloneLotTrace / restoreLotTrace (F3: a faithful trace snapshot for the block chase)', () => {
  it('round-trips a trace through clone -> further in-place mutation -> restore', () => {
    const trace = newLotTrace();
    trace.cut.set('lane-1:R0', 6);
    trace.fates.set('lane-1:R0', 'seated');
    trace.convergeDetail.set('lane-1:R0', 'inner-fold');

    const snapshot = cloneLotTrace(trace);

    // Exactly what `village-model.ts`'s round loop does to a live trace on
    // every round after the snapshot: clear it in place, refill with a
    // DIFFERENT (later, discarded) round's lots.
    resetLotTrace(trace);
    trace.cut.set('lane-1:R7', 9);
    trace.fates.set('lane-1:R7', 'lane-intrusion');
    trace.staleAfterTrim.add('lane-1:R7');

    restoreLotTrace(trace, snapshot);

    expect(trace.cut.size).toBe(1);
    expect(trace.cut.get('lane-1:R0')).toBe(6);
    expect(trace.cut.has('lane-1:R7')).toBe(false);
    expect(trace.fates.get('lane-1:R0')).toBe('seated');
    expect(trace.staleAfterTrim.has('lane-1:R7')).toBe(false);
    expect(trace.convergeDetail.get('lane-1:R0')).toBe('inner-fold');
  });

  it('generateVillage restores an honest trace when the block chase runs and gives up', () => {
    const defaultBlockAreas = mockedBlockAreas.getMockImplementation()!;
    // Every call the loop makes reads back short of any population's
    // floor, forcing the chase to run BLOCK_CHASE_ROUND_CAP extra rounds
    // (advancing the notch/terrace/spacing ladder each time -- a real
    // change to the fabric a discarded round's trace would otherwise
    // still be describing) and then restore.
    mockedBlockAreas.mockImplementation(() => []);

    const trace = newLotTrace();
    const m = generateVillage(base, 38, trace);

    expect(m.diagnostics.some((d) => d.startsWith('overflow:'))).toBe(false);
    expect(m.diagnostics.some((d) => d.startsWith('blocks short:'))).toBe(true);
    // The trace must describe SOME round (it is not left empty by a reset
    // with no refill), and every lot the final geometry actually kept must
    // be traced -- if the trace still held a later, discarded round's cut
    // map, it would not agree with the lots the restored geometry shipped.
    expect(trace.cut.size).toBeGreaterThan(0);
    const shippedIds = new Set(m.lots.map((l) => l.id));
    for (const id of shippedIds) {
      expect(trace.cut.has(id)).toBe(true);
    }

    mockedBlockAreas.mockImplementation(defaultBlockAreas);
  });
});
