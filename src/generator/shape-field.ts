import { Point } from '../types/point.js';
import type { SeededRandom } from '../utils/random.js';

/** Peak radial gain directly along a road. */
const ROAD_LOBE_AMPLITUDE = 1.8;
/** Higher = tighter lobe. cos^k falloff. Must stay non-even: for exactly
 * four roads spaced 90 degrees apart (a common case), an even exponent k
 * makes cos^k(theta) + cos^k(theta-90) identically 1 for every angle (a
 * trig identity, cos^2+sin^2=1), so the two adjacent lobes' contributions
 * sum to a constant and the road term produces NO angular variation at all
 * regardless of amplitude. A higher odd exponent both breaks that identity
 * and concentrates the lobe tightly around the road direction (cos^k(45deg)
 * -> 0 as k grows), which is what keeps the peak-to-valley ratio from being
 * capped near 1.4x regardless of amplitude (the k=3 asymptote). */
const ROAD_LOBE_SHARPNESS = 14;
/** Radial loss for a direction that is entirely water. */
const WATER_PENALTY = 0.55;
/** Per-harmonic amplitude for the organic term. */
const HARMONIC_AMPLITUDE = 0.09;
/** Clamp before normalisation — keeps pathological inputs from folding the shape inside out. */
const MIN_SCALE = 0.35;
const MAX_SCALE = 2.2;
/** Directions sampled to compute the normalisation mean. */
const NORMALISE_SAMPLES = 64;

export interface ShapeFieldOptions {
  /** Unit direction vectors of approaching roads (`RoadEntry.point`). May be empty. */
  roadDirections: Point[];
  /** Distance at which water is probed; roughly the expected core radius. */
  probeRadius: number;
  /** Water test in model coordinates. Omit for landlocked burgs. */
  isWaterAt?: (p: Point) => boolean;
  rng: SeededRandom;
}

export interface ShapeField {
  /** Radial multiplier for a math-space angle. Mean over all directions ≈ 1. */
  scaleAt(angleRad: number): number;
}

export function createShapeField(opts: ShapeFieldOptions): ShapeField {
  const { roadDirections, probeRadius, isWaterAt, rng } = opts;

  // Draw harmonic phases up front so rng consumption is fixed regardless of
  // how many times scaleAt is later called.
  const phase2 = rng.float() * Math.PI * 2;
  const phase3 = rng.float() * Math.PI * 2;

  const roadAngles = roadDirections.map(d => Math.atan2(d.y, d.x));

  /** Fraction of the probe ray that is wet, sampled at 0.6R and 1.0R. */
  function wetFraction(angleRad: number): number {
    if (isWaterAt === undefined) return 0;
    const cx = Math.cos(angleRad), cy = Math.sin(angleRad);
    let wet = 0;
    for (const t of [0.6, 1.0]) {
      if (isWaterAt(new Point(cx * probeRadius * t, cy * probeRadius * t))) wet++;
    }
    return wet / 2;
  }

  function raw(angleRad: number): number {
    let s = 1;

    for (const ra of roadAngles) {
      const c = Math.cos(angleRad - ra);
      if (c > 0) s += ROAD_LOBE_AMPLITUDE * Math.pow(c, ROAD_LOBE_SHARPNESS);
    }

    s += HARMONIC_AMPLITUDE * Math.sin(2 * angleRad + phase2);
    s += HARMONIC_AMPLITUDE * Math.sin(3 * angleRad + phase3);

    s -= WATER_PENALTY * wetFraction(angleRad);

    return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
  }

  // Normalise so the mean radial scale is 1: the core keeps the area its
  // population budget paid for, it just stops being a disc.
  let total = 0;
  for (let i = 0; i < NORMALISE_SAMPLES; i++) {
    total += raw(i * 2 * Math.PI / NORMALISE_SAMPLES);
  }
  const mean = total / NORMALISE_SAMPLES;
  const norm = mean > 0 ? 1 / mean : 1;

  return { scaleAt: (angleRad: number) => raw(angleRad) * norm };
}
