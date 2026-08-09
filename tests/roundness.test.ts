import { describe, it, expect } from 'vitest';
import { generateFromBurg, type AzgaarBurgInput } from '../src/index.js';

function crossroads(population: number, seed: number): AzgaarBurgInput {
  return {
    name: `Crossford${seed}`, population,
    port: false, citadel: false, walls: true,
    plaza: true, temple: false, shanty: false, capital: false,
    roadBearings: [0, 90, 180, 270],
  };
}

describe('core outline is not a disc', () => {
  // Task 4 (2026-08-09, round-cores-faubourgs): the shape field that lobed
  // the walled core toward road directions is deleted — the core is now a
  // mild seeded ovoid (see coreRank in buildPatches) and routes/terrain
  // shape the sprawl OUTSIDE the walls instead (spec §2). The two tests that
  // used to live here ("seed N: walled core is measurably non-circular" and
  // "elongates along the road axis when roads are opposed") asserted exactly
  // the lobed-toward-roads silhouette this task removes; they are superseded
  // by tests/core-shape.test.ts's compactness/Rmin-Rmax bounds, which assert
  // the opposite (round, not lobed) and are the render-gate's coverage.

  it('keeps the core connected', () => {
    const { model } = generateFromBurg(crossroads(4000, 9), { seed: 9 });
    // Every inner patch must be reachable from the first by adjacency.
    const reached = model.adjacency!.hopDistances([model.inner[0]], model.inner.length);
    const innerReached = model.inner.filter(p => reached.has(p)).length;
    expect(innerReached).toBe(model.inner.length);
  });
});
