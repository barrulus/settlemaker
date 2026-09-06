import { describe, expect, it } from 'vitest';
import { SeededRandom } from '../../src/utils/random.js';

/**
 * G1 finding 1 (owner-approved 2026-09-06): a bare multiplicative LCG has
 * `state = seed * g^k mod N`, so the k-th draw is an AFFINE function of the
 * seed and consecutive seeds differ by a constant. Measured before the fix,
 * the 17th draw for seeds 1..8 ran 0.995, 0.990, 0.985, 0.980, 0.975, 0.970,
 * 0.965, 0.961 -- every one in the top 4% of the range, so every seeded
 * decision taken at that point in the stream came out the same. The trunk
 * network picked one convergence pattern for all seeds because of it.
 *
 * The seed is now scrambled before use, which breaks the linearity while
 * keeping the generator exactly as deterministic per input seed.
 */
describe('SeededRandom: neighbouring seeds must not move in lockstep', () => {
  const drawAt = (seed: number, k: number): number => {
    const rng = new SeededRandom(seed);
    let v = 0;
    for (let i = 0; i <= k; i++) v = rng.float();
    return v;
  };

  it('spreads the k-th draw across the range for consecutive seeds', () => {
    for (const k of [0, 1, 5, 17, 40]) {
      const vals = [1, 2, 3, 4, 5, 6, 7, 8].map((s) => drawAt(s, k));
      expect(Math.max(...vals) - Math.min(...vals),
        `draw ${k} is bunched: ${vals.map((v) => v.toFixed(4)).join(', ')}`).toBeGreaterThan(0.5);
    }
  });

  it('does not step by a near-constant amount between neighbouring seeds', () => {
    for (const k of [0, 1, 17]) {
      const vals = [1, 2, 3, 4, 5, 6, 7, 8].map((s) => drawAt(s, k));
      const steps = vals.slice(1).map((v, i) => v - vals[i]);
      const spread = Math.max(...steps) - Math.min(...steps);
      expect(spread, `draw ${k} steps are constant: ${steps.map((s) => s.toFixed(6)).join(', ')}`)
        .toBeGreaterThan(0.1);
    }
  });

  it('is still exactly deterministic for a given seed', () => {
    const a = new SeededRandom(12345);
    const b = new SeededRandom(12345);
    const seqA = Array.from({ length: 20 }, () => a.float());
    const seqB = Array.from({ length: 20 }, () => b.float());
    expect(seqA).toEqual(seqB);
    expect(new SeededRandom(12345).float()).not.toBe(new SeededRandom(12346).float());
  });

  it('keeps every draw inside its documented range', () => {
    const rng = new SeededRandom(7);
    for (let i = 0; i < 500; i++) {
      const f = rng.float();
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
    }
    const r2 = new SeededRandom(9);
    for (let i = 0; i < 200; i++) {
      const v = r2.int(3, 9);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThan(9);
    }
  });
});
