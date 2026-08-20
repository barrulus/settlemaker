import { describe, it, expect } from 'vitest';
import { Point } from '../../src/types/point.js';
import { relaxLanes, trimTails } from '../../src/village/skeleton/relax.js';
import type { Building, Lane } from '../../src/village/types.js';

const lane = (): Lane => ({
  id: 'arm-090', type: 'main', widthM: 5,
  points: [new Point(0, 0), new Point(20, 0), new Point(40, 0), new Point(60, 0)],
});

const building = (x: number, y: number, id = 'bld:a'): Building => ({
  id, lotId: 'arm-090:R0', glyph: 'sm-house', position: new Point(x, y),
  bearingDeg: 0, footprint: [8, 6.6], occupancy: 5,
});

describe('relaxLanes', () => {
  it('pushes the lane off a building that sits on it', () => {
    const out = relaxLanes([lane()], [building(20, 0.5)]);
    const moved = out[0].points[1];
    expect(Math.abs(moved.y)).toBeGreaterThan(0.5);
  });

  it('leaves a clear lane alone', () => {
    const before = lane();
    const out = relaxLanes([before], [building(20, 40)]);
    expect(out[0].points.map((p) => [p.x, p.y]))
      .toEqual(before.points.map((p) => [p.x, p.y]));
  });

  it('never moves a point more than 1.5 m', () => {
    const before = lane();
    const out = relaxLanes([before], [building(20, 0.1)]);
    const d = Math.hypot(
      out[0].points[1].x - before.points[1].x,
      out[0].points[1].y - before.points[1].y,
    );
    expect(d).toBeLessThanOrEqual(1.5 + 1e-9);
  });

  it('is a pure function of its inputs', () => {
    const input = [lane()];
    const a = relaxLanes(input, [building(20, 0.5)]);
    const b = relaxLanes(input, [building(20, 0.5)]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('does not mutate the input lane', () => {
    const before = lane();
    const originalPoints = before.points.map((p) => [p.x, p.y]);
    relaxLanes([before], [building(20, 0.5)]);
    expect(before.points.map((p) => [p.x, p.y])).toEqual(originalPoints);
  });
});

describe('trimTails', () => {
  it('cuts a lane back to its last building plus a stub', () => {
    const out = trimTails([lane()], [building(20, 6)]);
    const end = out[0].points[out[0].points.length - 1];
    expect(end.x).toBeLessThan(50);
    expect(end.x).toBeGreaterThanOrEqual(20);
  });

  it('leaves a fully built lane alone', () => {
    const before = lane();
    const out = trimTails([before], [building(58, 6)]);
    expect(out[0].points).toHaveLength(before.points.length);
  });

  it('keeps at least two points, so a lane never degenerates', () => {
    const out = trimTails([lane()], []);
    expect(out[0].points.length).toBeGreaterThanOrEqual(2);
  });

  it('keeps at least two points even when the trim window would collapse to one', () => {
    // Building sits only 5 m from the lane start, well inside the first
    // 20 m segment. furthest(5) + TAIL_STUB_M(12) = 17, which is less than
    // the 20 m to the second lane point — a naive "keep points within the
    // cutoff distance" filter would retain only the first point.
    const out = trimTails([lane()], [building(0, 5)]);
    expect(out[0].points.length).toBeGreaterThanOrEqual(2);
  });

  it('does not let a lane claim buildings belonging to one of its own branches', () => {
    // arm-090's own prefix test must not match arm-090/b50's buildings.
    // A naive startsWith(lane.id) would let it, since 'arm-090/b50:R3'
    // starts with 'arm-090'.
    const branchBuilding: Building = {
      id: 'bld:branch', lotId: 'arm-090/b50:R3', glyph: 'sm-house',
      position: new Point(58, 6), bearingDeg: 0, footprint: [8, 6.6], occupancy: 5,
    };
    const out = trimTails([lane()], [branchBuilding]);
    // arm-090 has no buildings of its own, so it must be trimmed away to
    // (effectively) nothing — not left full-length as though the branch's
    // far-out building justified keeping the whole tail.
    expect(out[0].points.length).toBeLessThan(lane().points.length);
  });
});
