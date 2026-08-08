import { describe, it, expect } from 'vitest';
import { createUrbanisationField } from '../src/generator/urbanisation.js';
import { Point } from '../src/types/point.js';

const eastward = () => createUrbanisationField({
  roadDirections: [new Point(1, 0)],
  coreRadius: 100,
  reach: 400,
  corridorHalfWidth: 40,
  satellites: false,
  satelliteSpacing: 150,
});

describe('urbanisation field', () => {
  it('scores on-road points above off-road points at the same distance', () => {
    const f = eastward();
    expect(f.scoreAt(new Point(200, 0))).toBeGreaterThan(f.scoreAt(new Point(0, 200)));
  });

  it('decays with distance along the road', () => {
    const f = eastward();
    expect(f.scoreAt(new Point(150, 0))).toBeGreaterThan(f.scoreAt(new Point(350, 0)));
  });

  it('decays with perpendicular offset', () => {
    const f = eastward();
    expect(f.scoreAt(new Point(200, 0))).toBeGreaterThan(f.scoreAt(new Point(200, 60)));
  });

  it('scores nothing inside the core radius', () => {
    const f = eastward();
    expect(f.scoreAt(new Point(50, 0))).toBe(0);
  });

  it('scores nothing beyond reach when satellites are off', () => {
    const f = eastward();
    expect(f.scoreAt(new Point(600, 0))).toBe(0);
  });

  it('places satellite bumps along the road beyond reach when enabled', () => {
    const f = createUrbanisationField({
      roadDirections: [new Point(1, 0)],
      coreRadius: 100, reach: 400, corridorHalfWidth: 40,
      satellites: true, satelliteSpacing: 150,
    });
    // On-ray at the first bump beats off-ray at the same distance.
    expect(f.scoreAt(new Point(550, 0))).toBeGreaterThan(f.scoreAt(new Point(0, 550)));
  });

  it('overlapping corridors sum, producing a belt between close roads', () => {
    // Single road provides a baseline score at the test point.
    const singleRoad = createUrbanisationField({
      roadDirections: [new Point(1, 0)],
      coreRadius: 100, reach: 400, corridorHalfWidth: 40,
      satellites: false, satelliteSpacing: 150,
    });
    const singleScore = singleRoad.scoreAt(new Point(197, 26));

    // Two roads should sum their contributions. A point between the rays
    // receives scores from both corridors, producing a belt. The summed
    // corridor contributions must be meaningfully greater than the single-road
    // score at the same point. This fails for max() or nearest-only logic.
    const twoRoads = createUrbanisationField({
      roadDirections: [new Point(1, 0), new Point(0.966, 0.259)],  // 15 degrees apart
      coreRadius: 100, reach: 400, corridorHalfWidth: 40,
      satellites: false, satelliteSpacing: 150,
    });
    const twoScore = twoRoads.scoreAt(new Point(197, 26));

    // Verify that the summed contribution is significantly greater. The reviewer
    // measured ~0.443 for single vs ~0.888 for two roads, so 1.5x is a safe bar.
    expect(twoScore).toBeGreaterThan(singleScore * 1.5);
  });

  it('does not return NaN when corridorHalfWidth is 0', () => {
    const f = createUrbanisationField({
      roadDirections: [new Point(1, 0)],
      coreRadius: 100, reach: 400, corridorHalfWidth: 0,
      satellites: false, satelliteSpacing: 150,
    });
    // On-road point should score finite non-zero
    const onRoad = f.scoreAt(new Point(200, 0));
    expect(Number.isFinite(onRoad)).toBe(true);
    expect(onRoad).toBeGreaterThan(0);
    // Off-road point should score 0 (no lateral reach)
    const offRoad = f.scoreAt(new Point(200, 10));
    expect(offRoad).toBe(0);
  });
});
