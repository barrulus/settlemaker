import { describe, test, expect } from 'vitest';
import { mapToGenerationParams } from '../src/input/azgaar-input.js';
import { Model } from '../src/generator/model.js';
import { Point } from '../src/types/point.js';

describe('route character fields', () => {
  test('object bearings carry group/through/relief/followsRiver into RoadEntry', () => {
    const params = mapToGenerationParams({
      name: 'T', population: 4000, port: false, citadel: false, walls: true,
      plaza: true, temple: false, shanty: false, capital: false,
      roadBearings: [
        { bearing_deg: 90, route_id: 'r1', kind: 'road', group: 'roads', through: true, relief: 'valley', followsRiver: true },
        180,
      ],
    }, 1);
    const [rich, bare] = params.roadEntryPoints!;
    expect(rich.group).toBe('roads');
    expect(rich.through).toBe(true);
    expect(rich.relief).toBe('valley');
    expect(rich.followsRiver).toBe(true);
    expect(bare.group).toBeUndefined();
    expect(bare.through).toBeUndefined();
  });
});

describe('coast gated on port — only harbourSize is', () => {
  const coastlineGeometry = [[
    { x: -2000, y: 60 }, { x: 2000, y: 60 }, { x: 2000, y: 2500 }, { x: -2000, y: 2500 },
  ]];

  // OWNER'S RULING 2026-09-08, REVERSING WHAT THIS FILE USED TO ASSERT.
  // Ocean data used to be gated on `port`, so a coastal-but-portless burg
  // rendered as a plain inland town. A burg on a harbour cell with no docks
  // is a beach settlement: it genuinely has a coastline and an ocean
  // direction, and only the harbour INFRASTRUCTURE should need `port`.
  // "No docks" is not "no sea".
  test('port: false KEEPS oceanBearing/coastlineGeometry and drops only harbourSize', () => {
    const params = mapToGenerationParams({
      name: 'Portless', population: 1200, port: false, citadel: false, walls: true,
      plaza: false, temple: false, shanty: false, capital: false,
      oceanBearing: 90,
      coastlineGeometry,
      harbourSize: 'small',
    }, 1);

    expect(params.oceanBearing).toBe(90);
    expect(params.coastlineGeometry).toBeDefined();
    // The one field that still requires docks.
    expect(params.harbourSize).toBeUndefined();

    // And the sea is actually rendered now, where before it was suppressed.
    const model = new Model(params).generate();
    expect(model.waterbody.length).toBeGreaterThan(0);
  });

  test('port: true keeps oceanBearing/coastlineGeometry/harbourSize (guards against over-dropping)', () => {
    const params = mapToGenerationParams({
      name: 'Porty', population: 1200, port: true, citadel: false, walls: true,
      plaza: false, temple: false, shanty: false, capital: false,
      oceanBearing: 90,
      coastlineGeometry,
      harbourSize: 'small',
    }, 1);

    expect(params.oceanBearing).toBe(90);
    expect(params.coastlineGeometry).toEqual(coastlineGeometry.map(ring => ring.map(p => new Point(p.x, p.y))));
    expect(params.harbourSize).toBe('small');
  });
});
