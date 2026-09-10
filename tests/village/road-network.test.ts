import { describe, expect, it } from 'vitest';
import { Point } from '../../src/types/point.js';
import { networkComponents, networkDistances, pruneRedundantLanes, roadNetwork, usefulShortcut } from '../../src/village/skeleton/network.js';
import { trimTails } from '../../src/village/skeleton/relax.js';
import type { Building, Green, Lane, Lot } from '../../src/village/types.js';

const green: Green = { centre: new Point(0, 0), diameter: 10, bearingDeg: 0, shape: 'sm-green-round', variant: 'a' };
const lane = (id: string, coords: number[][]): Lane => ({ id, type: 'local', widthM: 2, points: coords.map(([x, y]) => new Point(x, y)) });
const resident = (id: string, laneId: string, x: number, y: number) => ({
  building: { id, lotId: id, glyph: 'sm-house', position: new Point(x, y), bearingDeg: 0, footprint: [4, 4], occupancy: 4 } as Building,
  lot: { id, laneId, front: new Point(x, y), side: 1, frontageM: 5, depthM: 8, bearingDeg: 0 } as Lot,
});

describe('road network access and redundant edges', () => {
  it('splits a host at a branch attachment between its samples', () => {
    const lanes = [lane('trunk-main-0', [[0, 0], [100, 0]]), lane('branch', [[33, 0], [33, 30]])];
    const r = resident('home', 'branch', 33, 25);
    const graph = roadNetwork(lanes, green, [r.building], [r.lot]);
    const d = networkDistances(graph, 'green');
    expect(d.get(graph.buildings.get('home')!)).toBeCloseTo(58);
  });
  it('removes a wholly empty peripheral loop', () => {
    const trunk = lane('trunk-main-0', [[0, 0], [100, 0]]);
    const lanes = [trunk, lane('a', [[20, 0], [20, 30]]), lane('b', [[20, 30], [60, 30]]), lane('c', [[60, 30], [60, 0]])];
    expect(pruneRedundantLanes(lanes, green, [], [])).toEqual([trunk]);
  });
  it('keeps an empty access edge when it is the only route to homes', () => {
    const lanes = [lane('trunk-main-0', [[0, 0], [20, 0]]), lane('access', [[20, 0], [60, 0]]), lane('street', [[60, 0], [60, 40]])];
    const r = resident('home', 'street', 60, 30);
    const kept = pruneRedundantLanes(lanes, green, [r.building], [r.lot]);
    expect(kept.map(l => l.id)).toContain('access');
  });
  it('can open an empty side of a loop while keeping inhabited frontage connected', () => {
    const lanes = [lane('trunk-main-0', [[0, 0], [100, 0]]), lane('a', [[20, 0], [20, 30]]), lane('b', [[20, 30], [60, 30]]), lane('c', [[60, 30], [60, 0]])];
    const r = resident('home', 'b', 40, 30);
    const kept = pruneRedundantLanes(lanes, green, [r.building], [r.lot]);
    expect(kept.length).toBe(3);
    const graph = roadNetwork(kept, green, [r.building], [r.lot]), components = networkComponents(graph);
    expect(components.get(graph.buildings.get('home')!)).toBe(components.get('green'));
  });
  it('keeps a green connector touching the turf within floating-point tolerance', () => {
    const r = green.diameter * 0.82 / 2 + 0.5;
    const roads = [lane('green-c0', [[r + 1e-12, 0], [20, 0]]), lane('trunk-main-0', [[20, 0], [100, 0]])];
    expect(pruneRedundantLanes(roads, green, [], [])).toHaveLength(2);
  });
  it('connects a tangent green only when it reaches the travelled surface', () => {
    const touching = lane('trunk-trail-0', [[-30, 5], [30, 5]]);
    const r = resident('home', touching.id, 20, 8);
    const attached = roadNetwork([touching], green, [r.building], [r.lot]);
    expect(networkDistances(attached, 'green').has(attached.buildings.get('home')!)).toBe(true);
    const separated = { ...touching, points: [new Point(-30, 6), new Point(30, 6)] };
    const detached = roadNetwork([separated], green, [r.building], [r.lot]);
    expect(networkDistances(detached, 'green').has(detached.buildings.get('home')!)).toBe(false);
  });
  it('keeps the interpolated host attachment when trimming past its last house', () => {
    const parent = lane('parent', [[0, 0], [20, 0], [40, 0], [60, 0]]);
    const child = { ...lane('child', [[35, 0], [35, 40]]), parentId: 'parent' };
    const r = resident('home', 'parent', 10, 3), s = resident('side-home', 'child', 35, 30);
    r.building.lotId = 'parent:R0'; s.building.lotId = 'child:R0';
    const trimmed = trimTails([parent, child], [r.building, s.building]);
    expect(trimmed.find(l => l.id === 'parent')!.points.at(-1)!.x).toBeCloseTo(35);
  });
});

describe('optional shortcuts', () => {
  const roads = [lane('u', [[0, 0], [0, 60], [80, 60], [80, 0]])];
  const link = lane('u/c', [[0, 0], [80, 0]]);
  const a = resident('a', 'u', 0, 8), b = resident('b', 'u', 80, 8);
  it('accepts a substantial shortcut between occupied destinations', () => {
    expect(usefulShortcut(roads, link, green, [a.building, b.building], [a.lot, b.lot])).toBe(true);
  });
  it('does not close an empty loop', () => {
    expect(usefulShortcut(roads, link, green, [], [])).toBe(false);
  });
  it('does not add a second road alongside an already direct route', () => {
    expect(usefulShortcut([lane('direct', [[0, 0], [80, 0]])], link, green, [a.building, b.building], [a.lot, b.lot])).toBe(false);
  });
});
