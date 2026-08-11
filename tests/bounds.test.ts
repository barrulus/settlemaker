import { describe, it, expect } from 'vitest';
import { generateFromBurg, type AzgaarBurgInput } from '../src/index.js';
import { computeLocalBounds, computeDiameterLocal } from '../src/generator/bounds.js';
import { Castle } from '../src/wards/castle.js';
import { Harbour } from '../src/wards/harbour.js';
import { Farm } from '../src/wards/farm.js';

function makeBurg(overrides: Partial<AzgaarBurgInput> = {}): AzgaarBurgInput {
  return {
    name: 'BoundsBurg',
    population: 5000,
    port: false,
    citadel: false,
    walls: true,
    plaza: true,
    temple: false,
    shanty: false,
    capital: false,
    ...overrides,
  };
}

describe('computeLocalBounds', () => {
  it('returns an AABB that contains every vertex of every patch that renders something', () => {
    const { model } = generateFromBurg(makeBurg(), { seed: 42 });
    const bounds = computeLocalBounds(model, 20);

    // Water patches are deliberately EXCLUDED from "renders something" here:
    // for a coastal burg the ocean's synthesised coastline ring reaches the
    // (radius*12) mesh edge, and letting it count would squeeze the
    // settlement into a sliver against the frame edge. Water fills whatever
    // part of the frame it reaches and is clipped by #frame-clip instead —
    // see the dedicated "does NOT expand over water patches" test below.
    for (const patch of model.patches) {
      const ward = patch.ward;
      const rendersSomething =
        (ward !== null && ward.geometry.length > 0) ||
        (ward instanceof Farm && ward.subPlots.length > 0) ||
        (ward instanceof Harbour && ward.piers.length > 0);
      if (!rendersSomething) continue;

      for (const v of patch.shape.vertices) {
        expect(v.x).toBeGreaterThanOrEqual(bounds.min_x);
        expect(v.x).toBeLessThanOrEqual(bounds.max_x);
        expect(v.y).toBeGreaterThanOrEqual(bounds.min_y);
        expect(v.y).toBeLessThanOrEqual(bounds.max_y);
      }
    }
  });

  it('does NOT expand over a bare countryside patch that renders nothing', () => {
    // Regression test: a plain Ward has empty geometry and draws no ink, so
    // it must not inflate the frame. buildWalls' patch cull was widened
    // (radius*3 -> radius*12) to give extramural sprawl room, which used to
    // balloon the frame around a sea of invisible wilderness patches.
    const { model } = generateFromBurg(makeBurg(), { seed: 42 });
    const bounds = computeLocalBounds(model, 20);

    const bareCountrysidePatches = model.patches.filter(patch => {
      const ward = patch.ward;
      const rendersSomething =
        (ward !== null && ward.geometry.length > 0) ||
        (ward instanceof Farm && ward.subPlots.length > 0) ||
        (ward instanceof Harbour && ward.piers.length > 0);
      return !rendersSomething;
    });
    // This fixture must actually have some — otherwise the assertion below
    // is vacuous.
    expect(bareCountrysidePatches.length).toBeGreaterThan(0);

    const outside = bareCountrysidePatches.some(patch =>
      patch.shape.vertices.some(v =>
        v.x < bounds.min_x || v.x > bounds.max_x || v.y < bounds.min_y || v.y > bounds.max_y,
      ),
    );
    expect(outside).toBe(true);
  });

  it('does NOT expand over water patches for a coastal port (piers still do)', () => {
    // Owner's rule: "focus should be on the landward side of the image with
    // just enough water to show the coastline." The ocean's synthesised
    // coastline ring reaches the mesh edge, far beyond the settlement, so it
    // must not set the frame. Water is drawn clipped to #frame-clip instead
    // (see assemble-svg.ts / the svg-render suite).
    const { model } = generateFromBurg(
      makeBurg({ port: true, population: 20000, oceanBearing: 90, harbourSize: 'large' }),
      { seed: 3 },
    );
    const bounds = computeLocalBounds(model, 0);
    const waterbody = new Set(model.waterbody);
    expect(waterbody.size).toBeGreaterThan(0);

    const someWaterOutside = [...waterbody].some(patch =>
      patch.shape.vertices.some(v =>
        v.x < bounds.min_x || v.x > bounds.max_x || v.y < bounds.min_y || v.y > bounds.max_y,
      ),
    );
    expect(someWaterOutside).toBe(true);

    // Piers are the one water-adjacent thing that still expands the frame.
    let pierCount = 0;
    for (const patch of model.patches) {
      if (!(patch.ward instanceof Harbour)) continue;
      for (const pier of patch.ward.piers) {
        pierCount++;
        for (const v of pier.vertices) {
          expect(v.x).toBeGreaterThanOrEqual(bounds.min_x);
          expect(v.x).toBeLessThanOrEqual(bounds.max_x);
          expect(v.y).toBeGreaterThanOrEqual(bounds.min_y);
          expect(v.y).toBeLessThanOrEqual(bounds.max_y);
        }
      }
    }
    expect(pierCount).toBeGreaterThan(0);
  });

  it('respects the padding argument', () => {
    const { model } = generateFromBurg(makeBurg(), { seed: 42 });
    const tight = computeLocalBounds(model, 0);
    const padded = computeLocalBounds(model, 20);
    expect(padded.min_x).toBeCloseTo(tight.min_x - 20);
    expect(padded.min_y).toBeCloseTo(tight.min_y - 20);
    expect(padded.max_x).toBeCloseTo(tight.max_x + 20);
    expect(padded.max_y).toBeCloseTo(tight.max_y + 20);
  });

  it('does NOT expand over street/artery/road polylines (they run to and past the frame edge, clipped by the viewBox instead)', () => {
    const { model } = generateFromBurg(makeBurg({ population: 15000 }), { seed: 42 });
    const bounds = computeLocalBounds(model, 0);

    // External roads are documented, deliberate product behaviour: they
    // reach beyond the settlement's frame. At least one road/artery vertex
    // should now fall outside the tight (padding=0) bounds — if this ever
    // stops being true the fixture no longer exercises the regression this
    // test guards against.
    const allRoadVerts = [...model.arteries, ...model.roads, ...model.streets]
      .flatMap(r => r.vertices);
    const someOutside = allRoadVerts.some(v =>
      v.x < bounds.min_x || v.x > bounds.max_x || v.y < bounds.min_y || v.y > bounds.max_y,
    );
    expect(someOutside).toBe(true);
  });

  it('clips road/artery/street paths to the viewBox in the rendered SVG', () => {
    const { svg } = generateFromBurg(makeBurg({ population: 15000 }), { seed: 42 });
    // The #roads group must carry an explicit clip-path referencing a
    // clipPath def whose <rect> matches the viewBox — belt-and-braces so
    // roads that now run past computeLocalBounds don't rely solely on a
    // consumer's default SVG overflow behaviour.
    const roadsGroupMatch = svg.match(/<g id="roads" clip-path="url\(#([^)]+)\)">/);
    expect(roadsGroupMatch).not.toBeNull();
    const clipId = roadsGroupMatch![1];
    const clipRectMatch = svg.match(
      new RegExp(`<clipPath id="${clipId}"><rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"`),
    );
    expect(clipRectMatch).not.toBeNull();
    const viewBoxMatch = svg.match(/viewBox="([^"]+)"/);
    expect(viewBoxMatch).not.toBeNull();
    const [vbX, vbY, vbW, vbH] = viewBoxMatch![1].split(' ');
    expect(clipRectMatch![1]).toBe(vbX);
    expect(clipRectMatch![2]).toBe(vbY);
    expect(clipRectMatch![3]).toBe(vbW);
    expect(clipRectMatch![4]).toBe(vbH);
  });

  it('still covers piers, walls and border (unaffected by the road/countryside exclusion)', () => {
    const { model } = generateFromBurg(makeBurg({ population: 15000 }), { seed: 42 });
    const bounds = computeLocalBounds(model, 0);
    if (model.wall !== null) {
      for (const v of model.wall.shape.vertices) {
        expect(v.x).toBeGreaterThanOrEqual(bounds.min_x);
        expect(v.x).toBeLessThanOrEqual(bounds.max_x);
        expect(v.y).toBeGreaterThanOrEqual(bounds.min_y);
        expect(v.y).toBeLessThanOrEqual(bounds.max_y);
      }
    }
  });

  it('covers harbour piers for port burgs', () => {
    const { model } = generateFromBurg(
      makeBurg({ port: true, population: 15000, oceanBearing: 180, harbourSize: 'large' }),
      { seed: 42 },
    );
    const bounds = computeLocalBounds(model, 0);

    let pierCount = 0;
    for (const patch of model.patches) {
      if (!(patch.ward instanceof Harbour)) continue;
      for (const pier of patch.ward.piers) {
        pierCount++;
        for (const v of pier.vertices) {
          expect(v.x).toBeGreaterThanOrEqual(bounds.min_x);
          expect(v.x).toBeLessThanOrEqual(bounds.max_x);
          expect(v.y).toBeGreaterThanOrEqual(bounds.min_y);
          expect(v.y).toBeLessThanOrEqual(bounds.max_y);
        }
      }
    }
    expect(pierCount).toBeGreaterThan(0);
  });

  it('covers the citadel wall when present', () => {
    const { model } = generateFromBurg(
      makeBurg({ citadel: true, population: 15000 }),
      { seed: 42 },
    );
    const bounds = computeLocalBounds(model, 0);

    expect(model.citadel).not.toBeNull();
    const castle = model.citadel!.ward;
    expect(castle).toBeInstanceOf(Castle);
    for (const v of (castle as Castle).wall.shape.vertices) {
      expect(v.x).toBeGreaterThanOrEqual(bounds.min_x);
      expect(v.x).toBeLessThanOrEqual(bounds.max_x);
      expect(v.y).toBeGreaterThanOrEqual(bounds.min_y);
      expect(v.y).toBeLessThanOrEqual(bounds.max_y);
    }
  });

  it('is deterministic for the same seed', () => {
    const a = generateFromBurg(makeBurg(), { seed: 42 }).model;
    const b = generateFromBurg(makeBurg(), { seed: 42 }).model;
    expect(computeLocalBounds(a, 20)).toEqual(computeLocalBounds(b, 20));
  });
});

describe('computeDiameterLocal', () => {
  it('returns 2 * max vertex distance from origin on the border polygon', () => {
    const { model } = generateFromBurg(makeBurg(), { seed: 42 });
    expect(model.border).not.toBeNull();

    let maxDist = 0;
    for (const v of model.border!.shape.vertices) {
      maxDist = Math.max(maxDist, v.length);
    }

    expect(computeDiameterLocal(model)).toBeCloseTo(maxDist * 2);
  });

  it('is non-zero for a tiny hamlet', () => {
    const { model } = generateFromBurg(
      makeBurg({ population: 80, walls: false, plaza: false }),
      { seed: 42 },
    );
    expect(computeDiameterLocal(model)).toBeGreaterThan(0);
  });

  it('is deterministic for the same seed', () => {
    const a = generateFromBurg(makeBurg(), { seed: 42 }).model;
    const b = generateFromBurg(makeBurg(), { seed: 42 }).model;
    expect(computeDiameterLocal(a)).toBeCloseTo(computeDiameterLocal(b));
  });
});
