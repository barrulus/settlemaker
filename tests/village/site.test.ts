import { describe, it, expect } from 'vitest';
import { buildSite } from '../../src/village/site.js';
import { generateVillage } from '../../src/village/village-model.js';
import { inAnyWater } from '../../src/village/geometry.js';
import { Point } from '../../src/types/point.js';
import type { AzgaarBurgInput } from '../../src/input/azgaar-input.js';

const base: AzgaarBurgInput = {
  name: 'Test', population: 300, port: false, citadel: false, walls: false,
  plaza: false, temple: false, shanty: false, capital: false,
};

describe('buildSite', () => {
  it('reads a bare numeric bearing as a main road that terminates', () => {
    const site = buildSite({ ...base, roadBearings: [225] });
    expect(site.routes).toEqual([
      { bearingDeg: 225, type: 'main', through: false, routeId: undefined,
        followsRiver: undefined, relief: undefined },
    ]);
  });

  it('maps the legacy kind field', () => {
    const site = buildSite({ ...base, roadBearings: [{ bearing_deg: 10, kind: 'foot' }] });
    expect(site.routes[0].type).toBe('trail');
  });

  it('carries through, relief and followsRiver', () => {
    const site = buildSite({
      ...base,
      roadBearings: [{ bearing_deg: 10, kind: 'road', through: true, relief: 'valley', followsRiver: true }],
    });
    expect(site.routes[0]).toMatchObject({ through: true, relief: 'valley', followsRiver: true });
  });

  it('copies water polygons as metres in burg-local coordinates', () => {
    const site = buildSite({
      ...base,
      coastlineGeometry: [[{ x: 10, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }]],
    });
    expect(site.water).toHaveLength(1);
    expect(site.water[0][0].x).toBe(10);
    expect(site.water[0]).toHaveLength(3);
  });

  it('has no water when none is supplied', () => {
    expect(buildSite(base).water).toEqual([]);
  });

  it('carries the flags the deck gates on', () => {
    const site = buildSite({ ...base, temple: true, trade: true, port: true });
    expect(site.flags).toEqual({ port: true, temple: true, trade: true, walls: false });
  });

  it('drops sea routes — one road and one sea bearing yields exactly one land route (R6)', () => {
    const site = buildSite({
      ...base,
      roadBearings: [
        { bearing_deg: 90, kind: 'road' },
        { bearing_deg: 180, kind: 'sea' },
      ],
    });
    expect(site.routes).toHaveLength(1);
    expect(site.routes[0]).toMatchObject({ bearingDeg: 90, type: 'main' });
  });

  // Finding 2: coastlineGeometry is the primary source of Site.water, but
  // spec §3 also promises an oceanBearing half-plane fallback when no
  // vector coastline was supplied. That leg was simply missing.
  it('synthesises a water half-plane from oceanBearing when no coastlineGeometry is given', () => {
    const site = buildSite({ ...base, port: true, oceanBearing: 90 });
    expect(site.water.length).toBeGreaterThan(0);
    // Origin (the burg centre) should read as water: bearing 90 = east,
    // and the origin sits just inside the near edge of the half-plane.
    expect(inAnyWater(new Point(0, 0), site.water)).toBe(true);
    // A point far to the west (opposite the ocean bearing) must stay dry.
    expect(inAnyWater(new Point(-2000, 0), site.water)).toBe(false);
  });

  it('coastlineGeometry, when present, is used instead of the oceanBearing fallback', () => {
    const site = buildSite({
      ...base, port: true, oceanBearing: 90,
      coastlineGeometry: [[{ x: 10, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }]],
    });
    expect(site.water).toHaveLength(1);
    expect(site.water[0]).toHaveLength(3);
  });

  it('a port sited only by oceanBearing still pushes its green away from the water', () => {
    const m = generateVillage({
      ...base, port: true, oceanBearing: 90, population: 300,
    }, 1);
    expect(m.green.centre.x).toBeLessThan(0);
  });

  it('object-form bearing with no kind defaults to main road', () => {
    const site = buildSite({ ...base, roadBearings: [{ bearing_deg: 45 }] });
    expect(site.routes).toEqual([
      { bearingDeg: 45, type: 'main', through: false, routeId: undefined,
        followsRiver: undefined, relief: undefined },
    ]);
  });
});
