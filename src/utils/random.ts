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
    this.seed = seed !== undefined ? seed : (Date.now() % SeededRandom.N);
    if (this.seed <= 0) this.seed = 1;
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
