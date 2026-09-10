// tests/village/trunks-entries.test.ts
import { describe, expect, it } from 'vitest';
import { contractEntries, contractRadiusFor, isTrunk } from '../../src/village/skeleton/trunks.js';
import { trunkLaneId } from '../../src/village/types.js';
import type { Site } from '../../src/village/types.js';

const site = (routes: Site['routes']): Site => ({
  population: 300, biome: 'temperate', routes, water: [],
  flags: { port: false, temple: false, trade: false, walls: false },
});

describe('contract entries', () => {
  it('one entry per supplied bearing; through is a hint and never invents an opposite exit', () => {
    const s = site([
      { bearingDeg: 90, type: 'main', through: true, routeId: 'r1' },
      { bearingDeg: 210, type: 'trail', through: false, routeId: 'r2' },
    ]);
    const e = contractEntries(s, 100);
    expect(e).toHaveLength(2);
    const far = e.find((x) => x.farSide);
    expect(far).toBeUndefined();
    for (const x of e) expect(Math.hypot(x.point.x, x.point.y)).toBeCloseTo(100, 6);
  });
  it('NEVER merges near-duplicate bearings at the boundary (spec 5.1)', () => {
    const s = site([
      { bearingDeg: 90.0, type: 'main', through: false, routeId: 'a' },
      { bearingDeg: 90.5, type: 'local', through: false, routeId: 'b' },
      { bearingDeg: 91.2, type: 'trail', through: false, routeId: 'c' },
    ]);
    expect(contractEntries(s, 80)).toHaveLength(3);
  });
  it('entries are stably sorted: bearing, then nearSide-first, then routeId', () => {
    const s = site([
      { bearingDeg: 200, type: 'local', through: false, routeId: 'z' },
      { bearingDeg: 20, type: 'main', through: false, routeId: 'a' },
    ]);
    expect(contractEntries(s, 80).map((x) => x.route.routeId)).toEqual(['a', 'z']);
  });
});

describe('trunk ids', () => {
  it('content-derived from class + routeId, far side marked', () => {
    expect(trunkLaneId('main', 'r1', 90, false)).toBe('trunk-main-r1');
    expect(trunkLaneId('main', 'r1', 90, true)).toBe('trunk-main-r1~far');
    expect(trunkLaneId('trail', undefined, 210.25, false)).toBe('trunk-trail-210.25');
  });
  it('isTrunk accepts trunk lanes, rejects branches and invented lanes', () => {
    expect(isTrunk('trunk-main-r1')).toBe(true);
    expect(isTrunk('trunk-main-r1~far')).toBe(true);
    expect(isTrunk('trunk-main-r1/b45')).toBe(false);
    expect(isTrunk('lane-090')).toBe(false);
    expect(isTrunk('arm-090')).toBe(false);
  });
  it('a route_id containing "/b" is sanitised so isTrunk cannot misread it', () => {
    expect(isTrunk(trunkLaneId('main', 'r/b1', 90, false))).toBe(true);
  });
  it('contractRadiusFor scales the closed-form radius by the factor', () => {
    expect(contractRadiusFor(60)).toBeCloseTo(60 * 2.75);
  });
});
