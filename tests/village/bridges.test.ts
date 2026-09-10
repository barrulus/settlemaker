import { describe, expect, it } from 'vitest';
import { Point } from '../../src/types/point.js';
import { inAnyWater } from '../../src/village/geometry.js';
import { renderVillage } from '../../src/village/render.js';
import { findWaterCrossings } from '../../src/village/skeleton/crossings.js';
import { shortenWaterCrossings, validWaterRoute, wetRuns } from '../../src/village/skeleton/water-routing.js';
import { generateVillage } from '../../src/village/village-model.js';
import { roadReviewFixtures } from '../fixtures/village-roads.js';

const river = [[new Point(-100, -2), new Point(100, -2), new Point(100, 2), new Point(-100, 2)]];
describe('roads cross rivers on bridges', () => {
  it('measures exact banks, including sub-metre water between sample points', () => {
    const water = [[new Point(-10, .2), new Point(10, .2), new Point(10, .6), new Point(-10, .6)]];
    const runs = wetRuns([new Point(0, -5), new Point(0, 5)], water);
    expect(runs).toHaveLength(1);
    expect(runs[0].endM - runs[0].startM).toBeCloseTo(.4);
    expect(runs[0].points[0].y).toBeCloseTo(.2);
    expect(runs[0].points.at(-1)!.y).toBeCloseTo(.6);
  });
  it('rejects river-following lanes even when every individual segment is short', () => {
    expect(validWaterRoute([new Point(-15, -5), new Point(-10, 0), new Point(0, 0), new Point(10, 0), new Point(15, 5)], river)).toBe(false);
  });
  it('reroutes a long oblique approach to a short crossing without moving its endpoints', () => {
    const points = [new Point(-40, -5), new Point(40, 5)];
    const routed = shortenWaterCrossings(points, river);
    expect(routed[0]).toEqual(points[0]); expect(routed.at(-1)).toEqual(points.at(-1));
    expect(validWaterRoute(routed, river)).toBe(true);
    expect(wetRuns(routed, river)).toHaveLength(1);
  });
  it('extends a bridge onto both dry banks', () => {
    const [bridge] = findWaterCrossings([{ id: 'lane', type: 'local', widthM: 2, points: [new Point(0, -10), new Point(0, 10)] }], river);
    expect(bridge.spanM).toBeCloseTo(4);
    expect(bridge.centreline!.filter((_, i) => i === 0 || i === bridge.centreline!.length - 1).every(p => !inAnyWater(p, river))).toBe(true);
    expect(bridge.deck!.length).toBeGreaterThanOrEqual(4);
  });
  it.each([3, 103])('keeps brook seed %i housed and paints bridges rather than ordinary road surfaces in water', seed => {
    const f = roadReviewFixtures.find(f => f.id === 'brook')!, m = generateVillage(f.input, seed);
    expect(m.buildings.reduce((n, b) => n + b.occupancy, 0)).toBeGreaterThanOrEqual(300);
    expect(m.bridges.length).toBeGreaterThan(0);
    expect(m.bridges.every(b => b.narrow && b.spanM <= 10 && b.deck?.length)).toBe(true);
    const svg = renderVillage(m);
    expect(svg).toMatch(/data-band="route" mask="url\(#road-land-/);
    for (const bridge of m.bridges) expect(svg).toContain(`data-bridge="${bridge.id}"`);
  });
  it('uses snowy roofs for every tundra seed 2 residence and landmark', () => {
    const f = roadReviewFixtures.find(f => f.id === 'tundra')!, m = generateVillage(f.input, 2);
    expect(m.buildings.reduce((n, b) => n + b.occupancy, 0)).toBeGreaterThanOrEqual(300);
    expect(m.buildings.every(b => b.glyph.endsWith('--tundra'))).toBe(true);
  });
});
