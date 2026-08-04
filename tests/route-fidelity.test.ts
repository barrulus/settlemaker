import { describe, it, expect } from 'vitest';
import { generateFromBurg, type AzgaarBurgInput } from '../src/index.js';

const base: AzgaarBurgInput = {
  name: 'Routetown',
  population: 400,
  port: false,
  citadel: false,
  walls: false,
  plaza: true,
  temple: false,
  shanty: false,
  capital: false,
};

describe('route-count fidelity', () => {
  it('one supplied trail yields exactly one external road', () => {
    const { model } = generateFromBurg({
      ...base,
      roadBearings: [{ bearing_deg: 270, kind: 'foot', route_id: 't1' }],
    });
    expect(model.roads.length).toBe(1);
  });

  it('three well-separated routes yield exactly three external roads', () => {
    const { model } = generateFromBurg({ ...base, roadBearings: [0, 120, 240] });
    expect(model.roads.length).toBe(3);
  });

  it('two clustered routes share one gate and one road, both ids echoed', () => {
    const { model } = generateFromBurg({
      ...base,
      roadBearings: [
        { bearing_deg: 45, route_id: 'a' },
        { bearing_deg: 46, route_id: 'b' },
      ],
    });
    expect(model.roads.length).toBe(1);
    const routed = [...model.border!.gateMeta.values()].flatMap(m => m.routes);
    expect(routed.map(r => r.routeId).sort()).toEqual(['a', 'b']);
  });

  it('an explicitly empty route list yields zero external roads but streets remain', () => {
    const { model } = generateFromBurg({ ...base, roadBearings: [] });
    expect(model.roads.length).toBe(0);
    expect(model.streets.length).toBeGreaterThan(0);
  });

  it('legacy: no roadBearings field keeps random gates and their roads', () => {
    const { model } = generateFromBurg(base);
    expect(model.roads.length).toBeGreaterThan(0);
  });
});
