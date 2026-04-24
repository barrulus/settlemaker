import { describe, it, expect } from 'vitest';
import { generateFromBurg, Point } from '../src/index.js';
import { pointInPolygon } from '../src/geom/point-in-polygon.js';
import type { AzgaarBurgInput } from '../src/index.js';

function makeBurg(overrides: Partial<AzgaarBurgInput> = {}): AzgaarBurgInput {
  return {
    name: 'CoastBurg',
    population: 5000,
    port: true,
    citadel: false,
    walls: true,
    plaza: true,
    temple: false,
    shanty: false,
    capital: false,
    ...overrides,
  };
}

/** Rectangle spanning x ∈ [xMin, xMax], y ∈ [yMin, yMax], CCW winding. */
function rect(xMin: number, yMin: number, xMax: number, yMax: number) {
  return [
    { x: xMin, y: yMin },
    { x: xMax, y: yMin },
    { x: xMax, y: yMax },
    { x: xMin, y: yMax },
  ];
}

describe('pointInPolygon primitive', () => {
  it('classifies interior points', () => {
    const square = [new Point(-1, -1), new Point(1, -1), new Point(1, 1), new Point(-1, 1)];
    expect(pointInPolygon(new Point(0, 0), square)).toBe(true);
  });

  it('classifies exterior points', () => {
    const square = [new Point(-1, -1), new Point(1, -1), new Point(1, 1), new Point(-1, 1)];
    expect(pointInPolygon(new Point(5, 0), square)).toBe(false);
  });

  it('handles concave polygons (U-shape)', () => {
    // U opening upward: arms at x<-2 and x>2, floor at y<-2
    const u = [
      new Point(-4, -4),
      new Point(4, -4),
      new Point(4, 4),
      new Point(2, 4),
      new Point(2, -2),
      new Point(-2, -2),
      new Point(-2, 4),
      new Point(-4, 4),
    ];
    expect(pointInPolygon(new Point(0, 0), u)).toBe(false);    // in the hollow
    expect(pointInPolygon(new Point(3, 0), u)).toBe(true);     // right arm
    expect(pointInPolygon(new Point(-3, 0), u)).toBe(true);    // left arm
    expect(pointInPolygon(new Point(0, -3), u)).toBe(true);    // floor
  });

  it('returns false for degenerate polygons with <3 vertices', () => {
    expect(pointInPolygon(new Point(0, 0), [])).toBe(false);
    expect(pointInPolygon(new Point(0, 0), [new Point(0, 0), new Point(1, 1)])).toBe(false);
  });
});

describe('coastlineGeometry drives water classification', () => {
  it('patches with centroid inside a coastline polygon are water', () => {
    // Water polygon covering the northern half-plane (large enough to catch
    // every outer patch above y = -10 in local coords).
    const northernSea = rect(-1000, -1000, 1000, -10);
    const result = generateFromBurg(
      makeBurg({
        coastlineGeometry: [northernSea],
        harbourSize: 'large',
      }),
      { seed: 42 },
    );
    expect(result.model.waterbody.length).toBeGreaterThan(0);
    for (const wp of result.model.waterbody) {
      expect(wp.shape.center.y).toBeLessThan(-10);
    }
  });

  it('patches outside every coastline polygon stay non-water', () => {
    // Tiny water polygon far off to the side — no patch centroid should land in it.
    const farAway = rect(500, 500, 600, 600);
    const result = generateFromBurg(
      makeBurg({
        coastlineGeometry: [farAway],
        harbourSize: 'small',
      }),
      { seed: 42 },
    );
    expect(result.model.waterbody).toHaveLength(0);
  });

  it('supports multiple water bodies', () => {
    // Two distinct water regions flanking the burg on opposite sides.
    const northSea = rect(-1000, -1000, 1000, -10);
    const southLake = rect(-1000, 10, 1000, 1000);
    const result = generateFromBurg(
      makeBurg({
        coastlineGeometry: [northSea, southLake],
        harbourSize: 'large',
      }),
      { seed: 42 },
    );
    expect(result.model.waterbody.length).toBeGreaterThan(0);
    const northCount = result.model.waterbody.filter(w => w.shape.center.y < -10).length;
    const southCount = result.model.waterbody.filter(w => w.shape.center.y > 10).length;
    expect(northCount).toBeGreaterThan(0);
    expect(southCount).toBeGreaterThan(0);
  });

  it('coastlineGeometry takes precedence over oceanBearing when both set', () => {
    // Ocean bearing says east (90°) but coastline polygon is to the west.
    // Water must follow the polygon, not the bearing.
    const westSea = rect(-1000, -1000, -10, 1000);
    const result = generateFromBurg(
      makeBurg({
        oceanBearing: 90, // would pick the east side
        coastlineGeometry: [westSea],
        harbourSize: 'large',
      }),
      { seed: 42 },
    );
    expect(result.model.waterbody.length).toBeGreaterThan(0);
    for (const wp of result.model.waterbody) {
      expect(wp.shape.center.x).toBeLessThan(-10);
    }
  });

  it('falls back to oceanBearing when coastlineGeometry is empty or degenerate', () => {
    const result = generateFromBurg(
      makeBurg({
        oceanBearing: 90,
        coastlineGeometry: [], // empty
        harbourSize: 'large',
      }),
      { seed: 42 },
    );
    expect(result.model.waterbody.length).toBeGreaterThan(0);
    // Bearing 90° → water should be east (positive x)
    for (const wp of result.model.waterbody) {
      expect(wp.shape.center.x).toBeGreaterThan(0);
    }
  });

  it('harbour ward still places when using coastlineGeometry', () => {
    const northernSea = rect(-1000, -1000, 1000, -10);
    const result = generateFromBurg(
      makeBurg({
        coastlineGeometry: [northernSea],
        harbourSize: 'large',
      }),
      { seed: 42 },
    );
    expect(result.model.harbour).not.toBeNull();
  });
});

describe('coastlineGeometry in generation version hash', () => {
  it('changes the settlement_generation_version when coastline changes', () => {
    const a = generateFromBurg(
      makeBurg({ coastlineGeometry: [rect(-100, -100, 100, -10)], harbourSize: 'small' }),
      { seed: 7 },
    );
    const b = generateFromBurg(
      makeBurg({ coastlineGeometry: [rect(-100, 10, 100, 100)], harbourSize: 'small' }),
      { seed: 7 },
    );
    const meta = (fc: typeof a.geojson) =>
      (fc as unknown as { metadata: Record<string, unknown> }).metadata;
    expect(meta(a.geojson).settlement_generation_version)
      .not.toBe(meta(b.geojson).settlement_generation_version);
  });
});
