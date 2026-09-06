import { describe, it, expect } from 'vitest';
import { SeededRandom } from '../src/utils/random.js';

describe('SeededRandom', () => {
  it('is deterministic with same seed', () => {
    const a = new SeededRandom(42);
    const b = new SeededRandom(42);
    for (let i = 0; i < 100; i++) {
      expect(a.float()).toBe(b.float());
    }
  });

  it('produces different sequences with different seeds', () => {
    const a = new SeededRandom(1);
    const b = new SeededRandom(2);
    // Very unlikely all 10 match
    let same = 0;
    for (let i = 0; i < 10; i++) {
      if (a.float() === b.float()) same++;
    }
    expect(same).toBeLessThan(10);
  });

  it('float() returns values in [0, 1)', () => {
    const rng = new SeededRandom(123);
    for (let i = 0; i < 1000; i++) {
      const v = rng.float();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('int() returns values in [min, max)', () => {
    const rng = new SeededRandom(456);
    for (let i = 0; i < 100; i++) {
      const v = rng.int(5, 15);
      expect(v).toBeGreaterThanOrEqual(5);
      expect(v).toBeLessThan(15);
    }
  });

  it('bool() respects chance parameter', () => {
    const rng = new SeededRandom(789);
    let trueCount = 0;
    const n = 10000;
    for (let i = 0; i < n; i++) {
      if (rng.bool(0.3)) trueCount++;
    }
    expect(trueCount / n).toBeCloseTo(0.3, 1);
  });

  it('advances by the LCG recurrence, from a scrambled starting state', () => {
    // The recurrence is unchanged (`state = state * 48271 % 2147483647`);
    // what changed at G1 (2026-09-06, owner-approved) is that the caller's
    // seed is now avalanche-hashed ONCE before the first step. It has to
    // be: the raw recurrence is purely multiplicative, so the k-th draw was
    // an affine function of the seed and neighbouring seeds moved in
    // lockstep -- seeds 1..8 all produced the same convergence pattern in
    // the village generator. `tests/utils/random.test.ts` pins the
    // decorrelation; this pins that the step itself still works.
    const rng = new SeededRandom(1);
    const first = rng.float();
    const second = rng.float();
    const G = 48271;
    const N = 2147483647;
    const firstState = Math.round(first * N);
    expect(second).toBeCloseTo(((firstState * G) % N) / N, 10);
  });
});
