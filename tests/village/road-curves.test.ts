import { describe, expect, it } from 'vitest';
import { Point } from '../../src/types/point.js';
import { forwardJoin, smoothLane } from '../../src/village/skeleton/curves.js';
import { relaxLanes } from '../../src/village/skeleton/relax.js';
import type { Building, Lane } from '../../src/village/types.js';
const p = (x: number, y: number) => new Point(x, y);
describe('road curves and junctions', () => {
  it('rejects a snap that doubles back, including the observed 164 degree hook', () => {
    expect(forwardJoin(p(58.537, -26.242), p(70.055, -20.622), p(56.98, -22.958))).toBe(false);
    expect(smoothLane([p(58.537, -26.242), p(70.055, -20.622), p(56.98, -22.958)])).toBeNull();
  });
  it('rounds a corner before parcel placement while retaining exact endpoints', () => {
    const out = smoothLane([p(0, 0), p(20, 0), p(20, 20)])!;
    expect(out[0]).toEqual(p(0, 0)); expect(out.at(-1)).toEqual(p(20, 20));
    expect(out).not.toContainEqual(p(20, 0)); expect(out.length).toBeGreaterThan(4);
    expect(out.every(q => q.x >= 0 && q.x <= 20 && q.y >= 0 && q.y <= 20)).toBe(true);
  });
  it('pins the vertex where another street meets the lane', () => {
    const host: Lane = { id: 'host', type: 'local', widthM: 2, points: [p(20, 0), p(40, 0)] };
    expect(smoothLane([p(0, 0), p(20, 0), p(20, 20)], [host])).toContainEqual(p(20, 0));
  });
  it('keeps both ends of a host segment fixed around a mid-segment junction', () => {
    const host: Lane = { id: 'host', type: 'local', widthM: 2, points: [p(0, 0), p(20, 0), p(40, 0), p(60, 0)] };
    const child: Lane = { id: 'child', type: 'local', widthM: 2, points: [p(30, 0), p(30, 20)] };
    const b: Building = { id: 'b', lotId: 'host:R0', glyph: 'sm-house', footprint: [6, 5], position: p(20, 0.2), bearingDeg: 0, occupancy: 4 };
    const out = relaxLanes([host, child], [b]);
    expect(out[0].points[1]).toEqual(host.points[1]); expect(out[0].points[2]).toEqual(host.points[2]);
    expect(out[1].points[0]).toEqual(child.points[0]);
  });
});
