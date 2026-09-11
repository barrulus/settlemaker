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
    expect(site.flags).toEqual({ port: true, temple: true, trade: true, walls: false, capital: false, citadel: false, plaza: false, shanty: false });
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
  // spec §3 also promises an oceanBearing fallback when no vector coastline
  // was supplied. That leg was simply missing.
  //
  // UPDATED 2026-09-07 (owner ruling "move the village back"): this used to
  // assert the ORIGIN reads as water, because the synthesised near edge sat
  // 1 m behind it. That was the defect, not the contract — the village was
  // built astride its own shore and lanes ran into the sea. The sea now
  // stands off the settlement, so the origin is dry and the water starts out
  // along the bearing.
  it('synthesises water out along oceanBearing when no coastlineGeometry is given', () => {
    const site = buildSite({ ...base, port: true, oceanBearing: 90 }, 1);
    expect(site.water.length).toBeGreaterThan(0);
    // Bearing 90 = east. Far east is sea; the burg centre and far west are not.
    expect(inAnyWater(new Point(2000, 0), site.water)).toBe(true);
    expect(inAnyWater(new Point(0, 0), site.water)).toBe(false);
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

  // The green-displacement guarantee still matters, but the oceanBearing
  // fallback no longer exercises it: the sea now stands off the settlement,
  // so nothing intrudes on the green's probe ring and there is correctly
  // nothing to push away from. Re-aimed at a supplied coastline that DOES
  // reach the burg centre, so the protection survives the ruling rather than
  // being deleted with the case that used to trigger it.
  it('pushes its green away from water that actually reaches the village', () => {
    const m = generateVillage({
      ...base, port: true, population: 300,
      // Sea immediately east of the origin, overlapping where the green
      // would otherwise sit.
      coastlineGeometry: [[
        { x: 5, y: -400 }, { x: 400, y: -400 }, { x: 400, y: 400 }, { x: 5, y: 400 },
      ]],
    }, 1);
    expect(m.green.centre.x).toBeLessThan(0);
  });

  it('leaves the green unpushed when the sea stands off, and keeps it dry', () => {
    const m = generateVillage({ ...base, port: true, oceanBearing: 90, population: 300 }, 1);
    expect(inAnyWater(m.green.centre, m.site.water)).toBe(false);
  });

  it('object-form bearing with no kind defaults to main road', () => {
    const site = buildSite({ ...base, roadBearings: [{ bearing_deg: 45 }] });
    expect(site.routes).toEqual([
      { bearingDeg: 45, type: 'main', through: false, routeId: undefined,
        followsRiver: undefined, relief: undefined },
    ]);
  });
});
