import {
  describe, it, expect, vi,
} from 'vitest';
import type { AzgaarBurgInput } from '../../src/input/azgaar-input.js';

/**
 * Task 5 review, finding #3: `village-model.test.ts`'s "enters the block
 * chase" coverage used to run a real seed (hub pop 300, seed 38) chosen by
 * sweeping 1-200 for the one that still falls short of its own blocks floor
 * at round 0, post the `weldJoins` fix (`relax.ts`). That makes the
 * control-flow guarantee -- the chase actually runs, burns its capped
 * rounds, gives up honestly with a `blocks short:` diagnostic rather than
 * an `overflow:` one -- depend on a single knife-edge seed that a future,
 * unrelated change to growth/trimming could quietly stop reproducing
 * (exactly what happened to the THREE tests this fix replaces, all built
 * around a seed the loop-closure fix itself made obsolete).
 *
 * Same technique as `village-model-chase-regression.test.ts`'s finding #1
 * fix: mock the ONE thing the chase branch reads to decide whether it is
 * short (`blockAreas`, imported by `village-model.ts` from
 * `skeleton/blocks.js`) so the branch is entered and exhausted
 * deterministically, independent of whether any real seed happens to fall
 * short. The real census-housing and growth logic run untouched -- only
 * the blocks COUNT the loop sees is forced low, so the fabric shipped is
 * genuine, only the diagnostic path is pinned.
 */
vi.mock('../../src/village/skeleton/blocks.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/village/skeleton/blocks.js')>();
  return { ...actual, blockAreas: vi.fn(actual.blockAreas) };
});

import { blockAreas } from '../../src/village/skeleton/blocks.js';
import { blockFloorFor, generateVillage } from '../../src/village/village-model.js';

const mockedBlockAreas = vi.mocked(blockAreas);

// Any ordinary hub-shaped scenario at a population whose floor is > 0
// (`blockFloorFor` is 2 from HAMLET_RIBBON_POP up) works here -- the seed
// is not special, because the mock (not the real geometry) decides
// whether the chase sees a shortfall.
const hub: AzgaarBurgInput = {
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

describe('generateVillage: block chase entry (finding #3, mock-driven)', () => {
  it('enters and exhausts the block chase when blocks always read short, and reports honestly', () => {
    const defaultImpl = mockedBlockAreas.getMockImplementation()!;
    // Every call the loop makes -- the mid-loop trial and the final
    // shipped-geometry check alike -- reads back short of any population's
    // floor, forcing `blockChaseRounds` to run out rather than break early.
    mockedBlockAreas.mockImplementation(() => []);

    const m = generateVillage(hub, 1);

    expect(m.diagnostics.some((d) => d.startsWith('overflow:'))).toBe(false);
    expect(m.diagnostics.some((d) => d.startsWith('blocks short:'))).toBe(true);
    expect(blockFloorFor(300)).toBeGreaterThan(0);

    mockedBlockAreas.mockImplementation(defaultImpl);
  });
});
