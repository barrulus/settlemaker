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

  it('matches LCG algorithm: seed * 48271 % 2147483647', () => {
    const rng = new SeededRandom(1);
    // First call: seed = 1 * 48271 % 2147483647 = 48271
    const first = rng.float();
    expect(first).toBeCloseTo(48271 / 2147483647, 10);
  });
});
