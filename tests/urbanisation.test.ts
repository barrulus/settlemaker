import { describe, it, expect } from 'vitest';
import { createUrbanisationField, radialProfile } from '../src/generator/urbanisation.js';
import { Point } from '../src/types/point.js';

const eastward = () => createUrbanisationField({
  roads: [{ direction: new Point(1, 0), weight: 1, rawWeight: 1 }],
  coreRadius: 100,
  haloDepth: 75,
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
      roads: [{ direction: new Point(1, 0), weight: 1, rawWeight: 1 }],
      coreRadius: 100, haloDepth: 75, reach: 400, corridorHalfWidth: 40,
      satellites: true, satelliteSpacing: 150,
    });
    // On-ray at the first bump beats off-ray at the same distance.
    expect(f.scoreAt(new Point(550, 0))).toBeGreaterThan(f.scoreAt(new Point(0, 550)));
  });

  it('overlapping corridors sum, producing a belt between close roads', () => {
    // haloDepth: 0 disables the isotropic halo so this measures the corridor
    // term alone — the halo is identical at the shared test point and would
    // otherwise dilute the ratio without saying anything about summation.
    // Single road provides a baseline score at the test point.
    const singleRoad = createUrbanisationField({
      roads: [{ direction: new Point(1, 0), weight: 1, rawWeight: 1 }],
      coreRadius: 100, haloDepth: 0, reach: 400, corridorHalfWidth: 40,
      satellites: false, satelliteSpacing: 150,
    });
    const singleScore = singleRoad.scoreAt(new Point(197, 26));

    // Two roads should sum their contributions. A point between the rays
    // receives scores from both corridors, producing a belt. The summed
    // corridor contributions must be meaningfully greater than the single-road
    // score at the same point. This fails for max() or nearest-only logic.
    const twoRoads = createUrbanisationField({
      roads: [{ direction: new Point(1, 0), weight: 1, rawWeight: 1 }, { direction: new Point(0.966, 0.259), weight: 1, rawWeight: 1 }],  // 15 degrees apart
      coreRadius: 100, haloDepth: 0, reach: 400, corridorHalfWidth: 40,
      satellites: false, satelliteSpacing: 150,
    });
    const twoScore = twoRoads.scoreAt(new Point(197, 26));

    // Verify that the summed contribution is significantly greater. The reviewer
    // measured ~0.443 for single vs ~0.888 for two roads, so 1.5x is a safe bar.
    expect(twoScore).toBeGreaterThan(singleScore * 1.5);
  });

  it('does not return NaN when corridorHalfWidth is 0', () => {
    // haloDepth: 0 to isolate the corridor term — with a halo every dry point
    // outside the core scores non-zero, which is the whole point of the halo.
    const f = createUrbanisationField({
      roads: [{ direction: new Point(1, 0), weight: 1, rawWeight: 1 }],
      coreRadius: 100, haloDepth: 0, reach: 400, corridorHalfWidth: 0,
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

  it('scores a halo in every direction, with no roads at all', () => {
    // The defect this pins: with only road corridors the field could score
    // nothing off a road ray, so a roadless burg got no extramural fabric and
    // a roaded one got bare spikes with empty ground between them.
    const f = createUrbanisationField({
      roads: [],
      coreRadius: 100, haloDepth: 75, reach: 400, corridorHalfWidth: 40,
      satellites: false, satelliteSpacing: 150,
    });
    for (let i = 0; i < 36; i++) {
      const a = (i * Math.PI) / 18;
      const p = new Point(130 * Math.cos(a), 130 * Math.sin(a));
      expect(f.scoreAt(p)).toBeGreaterThan(0);
    }
  });

  it('the halo decays with distance from the core edge', () => {
    const f = eastward();
    expect(f.scoreAt(new Point(0, 120))).toBeGreaterThan(f.scoreAt(new Point(0, 200)));
    expect(f.scoreAt(new Point(0, 200))).toBeGreaterThan(f.scoreAt(new Point(0, 320)));
  });

  it('the halo outranks the arms: the first ring beats any point further out along a road', () => {
    // Requirement 2 of the spec: the halo carries the MAJORITY of extramural
    // growth. Greedy selection ranks by score, so "ring fills before the arm
    // extends" is exactly "every point in the first ring outscores on-road
    // points beyond it".
    const f = eastward();
    const ringOffRoad = f.scoreAt(new Point(0, 130));   // 30 out, perpendicular to the road
    expect(ringOffRoad).toBeGreaterThan(f.scoreAt(new Point(260, 0)));
    expect(ringOffRoad).toBeGreaterThan(f.scoreAt(new Point(380, 0)));
  });

  it('measures the core edge directionally when given a lobed outline', () => {
    // A lobed core: reaching to 200 east, only 100 north. With the scalar
    // radius alone the halo's inner edge sits at the circumscribed radius
    // (200), so the ground just north of the wall — where a faubourg actually
    // is — scores zero.
    const outline: Point[] = [];
    for (let i = 0; i < 48; i++) {
      const a = (i * Math.PI) / 24;
      const r = 100 + 100 * Math.max(0, Math.cos(a));
      outline.push(new Point(r * Math.cos(a), r * Math.sin(a)));
    }
    const f = createUrbanisationField({
      roads: [],
      coreRadius: 200, coreRadiusAt: radialProfile(outline),
      haloDepth: 75, reach: 800, corridorHalfWidth: 40,
      satellites: false, satelliteSpacing: 150,
    });
    expect(f.scoreAt(new Point(0, 120))).toBeGreaterThan(0);   // just outside the short side
    expect(f.scoreAt(new Point(0, 90))).toBe(0);               // inside the short side
    expect(f.scoreAt(new Point(230, 0))).toBeGreaterThan(0);   // just outside the lobe tip
    expect(f.scoreAt(new Point(180, 0))).toBe(0);              // inside the lobe
  });

  it('tapers the corridor: a ribbon is narrower far out than near the core', () => {
    // Width, not just score. Compare the ratio of an off-axis score to the
    // on-axis score at the same distance: a narrower corridor loses more.
    const f = createUrbanisationField({
      roads: [{ direction: new Point(1, 0), weight: 1, rawWeight: 1 }],
      coreRadius: 100, haloDepth: 0, reach: 400, corridorHalfWidth: 40,
      satellites: false, satelliteSpacing: 150,
    });
    const near = f.scoreAt(new Point(140, 30)) / f.scoreAt(new Point(140, 0));
    const far = f.scoreAt(new Point(360, 30)) / f.scoreAt(new Point(360, 0));
    expect(far).toBeLessThan(near);
  });
});
