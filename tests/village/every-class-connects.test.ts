/**
 * Every route class must reach the CONTRACT CIRCLE.
 *
 * READ THE NAME LITERALLY. This asserts roads reach the contract circle — an
 * INNER circle, roughly 0.4 of the drawn tile's half-width. It does NOT assert
 * that a road reaches the edge of the picture, and it must not be cited as
 * evidence that a village looks connected. Measured on seed 55337, pop 500:
 * every road ends at 188 m while fields run to 290 m, vegetation to 367 m and
 * the tile half-width is 340 m — so all seven classes pass this test while the
 * owner looks at a village whose roads peter out in open field.
 *
 * That conflation was made once already (settlemaker-web, 2026-09-07) and
 * reported as if it settled the question. Whether roads SHOULD run to the tile
 * edge is an open contract decision; until it is made, this file is only
 * evidence about the circle.
 *
 * WHY (raised by the settlemaker-web session, 2026-09-07): its builder rolls
 * the road class at random. If any one of the seven failed to connect, that
 * would silently reintroduce the isolated-village bug 2.0.4 fixed — but only
 * for some rolls, so it would look random rather than systematic and would be
 * miserable to diagnose from a bug report.
 *
 * It verified all seven by hand against the live bundle and asked to be told
 * if it ever stopped being true. A standing test is a better answer than a
 * promise to remember.
 */
import { describe, it, expect } from 'vitest';
import { generateVillage } from '../../src/village/village-model.js';
import { ROUTE_CLASS_ORDER } from '../../src/village/route-class.js';
import type { AzgaarBurgInput } from '../../src/input/azgaar-input.js';

describe('every route class connects a village to its boundary', () => {
  it.each(ROUTE_CLASS_ORDER)('%s reaches the contract circle (NOT the tile edge)', (kind) => {
    const burg = {
      name: 'Aldford', population: 500, port: false, citadel: false, walls: true,
      plaza: true, temple: true, shanty: false, capital: false,
      roadBearings: [{ bearing_deg: 45, kind }, { bearing_deg: 170, kind }],
    } as unknown as AzgaarBurgInput;
    const m = generateVillage(burg, 55337);
    const furthest = Math.max(
      ...m.lanes.flatMap((l) => l.points.map((p) => Math.hypot(p.x, p.y))),
    );
    // Within a metre of the contract radius: the road runs out to the circle
    // FMG hands us, which is the whole point of the contract.
    expect(furthest).toBeGreaterThan(m.contractRadiusM - 1);
    // ...and pin the gap this test does NOT cover, so the limitation is a
    // measured fact in the suite rather than a comment someone can miss.
    const drawnReach = Math.max(
      ...m.fields.flatMap((f) => f.polygon.map((p) => Math.hypot(p.x, p.y))),
      ...m.vegetation.map((v) => Math.hypot(v.position.x, v.position.y)),
    );
    expect(drawnReach).toBeGreaterThan(m.contractRadiusM);
  });
});
