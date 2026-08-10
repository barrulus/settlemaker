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

  // Annotated rather than re-targeted (round-cores-faubourgs task 5 ledger).
  // The reuse check in `buildGates` compares each route's target bearing
  // against the bearing of an already-PLACED gate, not against the other
  // route's target — see the comment there. With 1 degree between these two
  // routes, reuse therefore depends on where the first gate physically
  // landed, which is a property of the mesh. Swept the fixture over five
  // name-seeds at pops 200-2500: pop 200 fails 5 of 5, pops 300 and 400 pass
  // 5 of 5, and every pop from 500 up passes 4 of 5. Pop 400 is already in
  // the most reliable band there is, so it stays.
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
