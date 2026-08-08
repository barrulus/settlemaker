import { describe, it, expect } from 'vitest';
import { createShapeField } from '../src/generator/shape-field.js';
import { Point } from '../src/types/point.js';
import { SeededRandom } from '../src/utils/random.js';

/** Unit vector for a math angle. */
function dir(angleRad: number): Point {
  return new Point(Math.cos(angleRad), Math.sin(angleRad));
}

describe('shape field', () => {
  it('elongates along road directions', () => {
    const field = createShapeField({
      roadDirections: [dir(0), dir(Math.PI)],
      probeRadius: 100,
      rng: new SeededRandom(1),
    });
    // Along the road (angle 0) vs perpendicular to it (angle pi/2).
    expect(field.scaleAt(0)).toBeGreaterThan(field.scaleAt(Math.PI / 2) * 1.2);
  });

  it('suppresses directions that meet water', () => {
    // Water occupies the entire +x half-plane beyond the origin.
    const field = createShapeField({
      roadDirections: [],
      probeRadius: 100,
      isWaterAt: (p: Point) => p.x > 10,
      rng: new SeededRandom(1),
    });
    expect(field.scaleAt(0)).toBeLessThan(field.scaleAt(Math.PI));
  });

  it('is not perfectly circular with no roads and no water', () => {
    const field = createShapeField({
      roadDirections: [],
      probeRadius: 100,
      rng: new SeededRandom(7),
    });
    const samples = Array.from({ length: 32 }, (_, i) => field.scaleAt(i * Math.PI / 16));
    const min = Math.min(...samples), max = Math.max(...samples);
    expect(max - min).toBeGreaterThan(0.05);
  });

  it('has mean scale ~1 so enclosed area is preserved', () => {
    const field = createShapeField({
      roadDirections: [dir(0), dir(2), dir(4)],
      probeRadius: 100,
      rng: new SeededRandom(3),
    });
    const samples = Array.from({ length: 64 }, (_, i) => field.scaleAt(i * Math.PI / 32));
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    expect(mean).toBeCloseTo(1, 1);
  });

  it('is deterministic for a given seed', () => {
    const build = () => createShapeField({
      roadDirections: [dir(1)],
      probeRadius: 100,
      rng: new SeededRandom(42),
    });
    expect(build().scaleAt(0.3)).toBe(build().scaleAt(0.3));
  });
});
