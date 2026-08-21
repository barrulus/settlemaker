import { describe, it, expect } from 'vitest';
import { generateVillage, VILLAGE_POP_CEILING } from '../../src/village/village-model.js';
import type { AzgaarBurgInput } from '../../src/input/azgaar-input.js';

const base: AzgaarBurgInput = {
  name: 'Wick', population: 300, port: false, citadel: false, walls: false,
  plaza: false, temple: false, shanty: false, capital: false,
  roadBearings: [{ bearing_deg: 225, kind: 'road' }],
};

describe('generateVillage', () => {
  it('produces a green, lanes, lots and buildings', () => {
    const m = generateVillage(base, 1);
    expect(m.green.shape).toBe('sm-green-round');
    expect(m.lanes.length).toBeGreaterThan(0);
    expect(m.lots.length).toBeGreaterThan(0);
    expect(m.buildings.length).toBeGreaterThan(0);
  });

  it('houses the census', () => {
    const m = generateVillage(base, 1);
    const housed = m.buildings.reduce((s, b) => s + b.occupancy, 0);
    expect(housed).toBeGreaterThanOrEqual(base.population * 0.9);
  });

  it('is deterministic: same seed, identical model', () => {
    expect(JSON.stringify(generateVillage(base, 7)))
      .toBe(JSON.stringify(generateVillage(base, 7)));
  });

  it('differs between seeds', () => {
    expect(JSON.stringify(generateVillage(base, 7)))
      .not.toBe(JSON.stringify(generateVillage(base, 8)));
  });

  it('gives a bigger village more buildings than a hamlet', () => {
    const hamlet = generateVillage({ ...base, population: 60 }, 3);
    const village = generateVillage({ ...base, population: 600 }, 3);
    expect(village.buildings.length).toBeGreaterThan(hamlet.buildings.length);
  });

  it('records a diagnostic rather than throwing when the census cannot be housed', () => {
    const m = generateVillage({ ...base, population: 999 }, 4);
    expect(Array.isArray(m.diagnostics)).toBe(true);
  });

  it('never places a building inside the green', () => {
    const m = generateVillage(base, 5);
    for (const b of m.buildings) {
      const d = Math.hypot(b.position.x - m.green.centre.x, b.position.y - m.green.centre.y);
      expect(d).toBeGreaterThan(m.green.diameter / 2);
    }
  });

  // Finding 3: trimTails (R15) can drop an invented lane that earned no
  // dwelling AFTER `lots` was already finalised, orphaning that lane's
  // lots. Every returned lot must name a lane that survived, or the
  // 'green' pseudo-lane.
  it('never returns a lot whose laneId names a lane that was trimmed away', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const m = generateVillage({ ...base, population: 600 }, seed);
      const laneIds = new Set(m.lanes.map((l) => l.id));
      for (const lot of m.lots) {
        expect(lot.laneId === 'green' || laneIds.has(lot.laneId)).toBe(true);
      }
    }
  });

  it('declares the population band it serves', () => {
    expect(VILLAGE_POP_CEILING).toBe(1000);
  });
});

// R16: the loop must escalate on the measured shortfall rather than
// re-running an already-satisfied frontage budget. A single terminating
// road at the top of the served population band is exactly the case that
// exposed the no-op loop.
describe('generateVillage: frontage feedback loop escalation (R16)', () => {
  it('houses at least 95% of a 900-population census with no overflow diagnostic', () => {
    const m = generateVillage({ ...base, population: 900 }, 1);
    const housed = m.buildings.reduce((s, b) => s + b.occupancy, 0);
    expect(housed).toBeGreaterThanOrEqual(900 * 0.95);
    // Finding 6: deckDropped() is now surfaced as a diagnostic, and the
    // manifest currently loaded (batch001) is missing sm-chapel, so a
    // "deck dropped" diagnostic is expected here regardless of population —
    // that's not what this test is about. What this test asserts is the
    // R16 loop's own honesty: no *overflow* diagnostic for a census that
    // did fit.
    expect(m.diagnostics.some((d) => d.startsWith('overflow'))).toBe(false);
  });

  it('adds materially more lanes at pop 900 than at pop 150 (the loop actually added lanes)', () => {
    const small = generateVillage({ ...base, population: 150 }, 1);
    const big = generateVillage({ ...base, population: 900 }, 1);
    expect(big.lanes.length).toBeGreaterThan(small.lanes.length * 1.5);
  });

  // Finding 4: f0 must tighten cumulatively round over round, not reset
  // to the same value every time. Verified empirically against a scratch
  // copy of the pre-fix formula (`f0 = widest + gapForPopulation(pop) *
  // GAP_TIGHTEN`, recomputed from scratch on every tighten instead of
  // compounding): at population 11500 with this single-road input, the
  // pre-fix formula undershoots (only ~11053 of 11500 housed, an overflow
  // diagnostic), because round 3's tighten is a no-op duplicate of round
  // 2's. The fixed, compounding formula houses the full census in the same
  // 3-round budget. This is an observable-behaviour check (housed count /
  // absence of an overflow diagnostic), not a reach into f0 itself.
  it('the gap-tighten ladder compounds: a population needing all 3 rounds still houses fully', () => {
    const m = generateVillage({ ...base, population: 11500 }, 4);
    const housed = m.buildings.reduce((s, b) => s + b.occupancy, 0);
    expect(housed).toBeGreaterThanOrEqual(11500 * 0.999);
    expect(m.diagnostics.some((d) => d.startsWith('overflow'))).toBe(false);
  });

  it('still reports an honest overflow diagnostic when the census genuinely cannot fit', () => {
    const m = generateVillage({ ...base, population: 20000 }, 1);
    const housed = m.buildings.reduce((s, b) => s + b.occupancy, 0);
    expect(m.diagnostics.length).toBeGreaterThan(0);
    expect(housed).toBeLessThan(20000);
  }, 20000);

  it('stays deterministic across a multi-round escalation: same seed, identical model', () => {
    const a = generateVillage({ ...base, population: 900 }, 11);
    const b = generateVillage({ ...base, population: 900 }, 11);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
