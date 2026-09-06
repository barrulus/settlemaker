/**
 * Seeded LCG PRNG — port of Random.hx.
 * Instance-based (not global) to allow concurrent generation.
 * Algorithm: seed = seed * 48271 % 2147483647
 */
export class SeededRandom {
  private static readonly G = 48271;
  private static readonly N = 2147483647;

  private seed: number;

  constructor(seed?: number) {
    const given = seed !== undefined ? seed : Date.now();
    this.seed = SeededRandom.scramble(given);
  }

  /**
   * Spread the caller's seed across the state space before the first draw.
   *
   * WHY (G1 finding, owner-approved 2026-09-06): the generator below is
   * purely multiplicative, `state_k = seed * G^k mod N`, so the k-th draw is
   * an AFFINE function of the seed -- neighbouring seeds differ by the same
   * constant at every draw index. Measured on the raw seed: the 17th draw
   * for seeds 1..8 was 0.995, 0.990, 0.985, 0.980, 0.975, 0.970, 0.965,
   * 0.961, all inside the top 4% of the range. Any decision taken at a fixed
   * position in the stream therefore came out the SAME for every seed, which
   * is why the village generator drew one convergence pattern for all seeds
   * (`hub` chose `junction` in 6 of 6 runs at a weight of 0.07) and why a
   * single-draw weighted pick off a fresh generator needed a throwaway call
   * to look random at all.
   *
   * This is a finalising avalanche hash (the murmur3 mixer), which is
   * NON-linear -- so seed+1 lands nowhere near seed -- applied once, at
   * construction. Determinism is untouched: one input seed still yields
   * exactly one stream. Every seeded artefact in the project moves once, as
   * the owner accepted when approving the change.
   */
  private static scramble(seed: number): number {
    let h = Math.trunc(seed) | 0;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    h ^= h >>> 16;
    // `>>> 0` first: the mixer works in signed 32-bit, and a negative state
    // would break the modulus below.
    const state = (h >>> 0) % (SeededRandom.N - 1);
    // The generator has a fixed point at 0 -- it would emit zeros forever.
    return state + 1;
  }

  getSeed(): number {
    return this.seed;
  }

  private next(): number {
    this.seed = (this.seed * SeededRandom.G) % SeededRandom.N;
    return this.seed;
  }

  /** Random float in [0, 1) */
  float(): number {
    return this.next() / SeededRandom.N;
  }

  /** Approximation of normal distribution via averaging 3 uniforms */
  normal(): number {
    return (this.float() + this.float() + this.float()) / 3;
  }

  /** Random integer in [min, max) */
  int(min: number, max: number): number {
    return Math.floor(min + (this.next() / SeededRandom.N) * (max - min));
  }

  /** Random boolean with given probability */
  bool(chance: number = 0.5): boolean {
    return this.float() < chance;
  }

  /** Fuzzy value centered at 0.5 */
  fuzzy(f: number = 1.0): number {
    if (f === 0) return 0.5;
    return (1 - f) / 2 + f * this.normal();
  }
}
