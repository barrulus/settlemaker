import { describe, it, expect } from 'vitest';
import { buildSite } from '../../src/village/site.js';
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
});
