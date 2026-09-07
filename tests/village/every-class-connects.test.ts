/**
 * Every route class must reach the EDGE OF THE TILE.
 *
 * This file used to assert that roads reached the CONTRACT CIRCLE, which is
 * an inner circle at roughly 0.4 of the drawn tile's half-width. All seven
 * classes passed it while the owner looked at a village whose roads petered
 * out in open field: on seed 55337, pop 500, every road ended at 188 m while
 * fields ran to 262 m, vegetation to 336 m and the tile was 664 x 631 m.
 * Two separate sessions cited it as evidence the village was connected.
 *
 * It now asserts the thing that was actually wanted (spec 2026-09-07 §9).
 *
 * WHY the per-class sweep exists (raised by the settlemaker-web session,
 * 2026-09-07): its builder rolls the road class at random, so a class that
 * failed to connect would look random rather than systematic and would be
 * miserable to diagnose from a bug report.
 */
import { describe, it, expect } from 'vitest';
import { generateVillage } from '../../src/village/village-model.js';
import { ROUTE_CLASS_ORDER } from '../../src/village/route-class.js';
import type { AzgaarBurgInput } from '../../src/input/azgaar-input.js';

describe('every route class connects a village to its boundary', () => {
  it.each(ROUTE_CLASS_ORDER)('%s reaches the tile edge', (kind) => {
    const burg = {
      name: 'Aldford', population: 500, port: false, citadel: false, walls: true,
      plaza: true, temple: true, shanty: false, capital: false,
      roadBearings: [{ bearing_deg: 45, kind }, { bearing_deg: 170, kind }],
    } as unknown as AzgaarBurgInput;
    const m = generateVillage(burg, 55337);
    const { minX, minY, maxX, maxY } = m.frame;
    const onBoundary = m.lanes.some((l) => l.points.some((p) => (
      Math.min(p.x - minX, maxX - p.x, p.y - minY, maxY - p.y) <= 1
    )));
    expect(onBoundary, 'no road reaches the edge of the drawn tile').toBe(true);
    // And the contract circle is still met, since a consumer aligns on it.
    const furthest = Math.max(
      ...m.lanes.flatMap((l) => l.points.map((p) => Math.hypot(p.x, p.y))),
    );
    expect(furthest).toBeGreaterThan(m.contractRadiusM);
  });
});
