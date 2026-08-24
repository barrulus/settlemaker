import { describe, it, expect } from 'vitest';
import { Point } from '../../src/types/point.js';
import { relaxLanes, trimTails } from '../../src/village/skeleton/relax.js';
import type { Building, Lane } from '../../src/village/types.js';

const defaultPoints = () => [
  new Point(0, 0), new Point(20, 0), new Point(40, 0), new Point(60, 0),
];

const lane = (): Lane => ({
  id: 'arm-090', type: 'main', widthM: 5, points: defaultPoints(),
});

const armLane = (): Lane => ({
  id: 'arm-090', type: 'main', widthM: 5, points: defaultPoints(),
});

const inventedLane = (): Lane => ({
  id: 'lane-090', type: 'local', widthM: 5, points: defaultPoints(),
});

const building = (x: number, y: number, id = 'bld:a', lotId = 'arm-090:R0'): Building => ({
  id, lotId, glyph: 'sm-house', position: new Point(x, y),
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

  it('stays bounded and deterministic when a lane point is squeezed between buildings on opposite sides', () => {
    // Two houses, one on each side of the same lane point, close enough
    // that clearing either alone would already need more than the 1.5 m
    // cap. Their pushes conflict rather than agree — this is the ordinary
    // case for a real village, not an edge case.
    const before = lane();
    const squeeze = [building(20, 0.4, 'bld:north'), building(20, -0.4, 'bld:south')];

    const a = relaxLanes([before], squeeze);
    const b = relaxLanes([before], squeeze);

    const originalPoint = before.points[1];
    const movedA = a[0].points[1];
    const d = Math.hypot(movedA.x - originalPoint.x, movedA.y - originalPoint.y);
    expect(d).toBeLessThanOrEqual(1.5 + 1e-9);

    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('trimTails', () => {
  describe('provenance (ruling R15)', () => {
    it('an arm- lane with no buildings survives at full length', () => {
      const before = armLane();
      const out = trimTails([before], []);
      expect(out).toHaveLength(1);
      expect(out[0].points).toHaveLength(before.points.length);
      expect(out[0].points.map((p) => [p.x, p.y]))
        .toEqual(before.points.map((p) => [p.x, p.y]));
    });

    it('an arm- lane with buildings also survives at full length, not trimmed to its last building', () => {
      const before = armLane();
      // A single building well short of the far end — if the arm exemption
      // were missing, this would trim back to last-building + stub, well
      // short of the last point.
      const out = trimTails([before], [building(20, 6, 'bld:a', 'arm-090:R0')]);
      expect(out).toHaveLength(1);
      expect(out[0].points).toHaveLength(before.points.length);
      expect(out[0].points[out[0].points.length - 1].x).toBe(60);
    });

    it('a lane- lane with buildings is trimmed to last-building-plus-stub', () => {
      const out = trimTails([inventedLane()], [building(20, 6, 'bld:a', 'lane-090:R0')]);
      expect(out).toHaveLength(1);
      const end = out[0].points[out[0].points.length - 1];
      expect(end.x).toBeLessThan(50);
      expect(end.x).toBeGreaterThanOrEqual(20);
    });

    it('a lane- lane with no buildings at all is dropped from the result entirely', () => {
      const out = trimTails([inventedLane()], []);
      expect(out).toHaveLength(0);
    });
  });

  it('leaves a fully built invented lane alone (natural, not because of any exemption)', () => {
    const before = inventedLane();
    const out = trimTails([before], [building(58, 6, 'bld:a', 'lane-090:R0')]);
    expect(out).toHaveLength(1);
    expect(out[0].points).toHaveLength(before.points.length);
  });

  it('keeps at least two points even when the trim window would collapse to one', () => {
    // Building sits only 5 m from the lane start, well inside the first
    // 20 m segment. furthest(5) + TAIL_STUB_M(12) = 17, which is less than
    // the 20 m to the second lane point — a naive "keep points within the
    // cutoff distance" filter would retain only the first point.
    const out = trimTails([inventedLane()], [building(0, 5, 'bld:a', 'lane-090:R0')]);
    expect(out).toHaveLength(1);
    expect(out[0].points.length).toBeGreaterThanOrEqual(2);
  });

  it('does not let a lane claim buildings belonging to one of its own branches', () => {
    // lane-090's own prefix test must not match lane-090/b50's buildings.
    // A naive startsWith(lane.id) would let it, since 'lane-090/b50:R3'
    // starts with 'lane-090'. If the hazard were present, lane-090 would
    // wrongly believe it owns a building and survive trimmed rather than
    // being dropped for owning none.
    const branchBuilding: Building = {
      id: 'bld:branch', lotId: 'lane-090/b50:R3', glyph: 'sm-house',
      position: new Point(58, 6), bearingDeg: 0, footprint: [8, 6.6], occupancy: 5,
    };
    const out = trimTails([inventedLane()], [branchBuilding]);
    expect(out.find((l) => l.id === 'lane-090')).toBeUndefined();
  });

  it('a branch of an arm (.../bNN) is treated as invented, not exempt', () => {
    // arm-090/b50 starts with "arm-" but the /b marks it as an invented
    // branch — it must still be droppable when it earns no building.
    const branch: Lane = { id: 'arm-090/b50', type: 'local', widthM: 4, points: defaultPoints() };
    const out = trimTails([branch], []);
    expect(out).toHaveLength(0);
  });

  describe('growth-time joins (Task 5: rungs, not just /c connectors, are structural)', () => {
    // Task 1's arm-exemption fix and Task 2's block-aware chase mesh the
    // interior with growth-time closure lanes (growOne's rungs -- a branch
    // whose FAR end lands, via loopSnap or truncateAtFirstCrossing, on a
    // NEIGHBOUR lane -- and seedArcThrough's arcs). Measured directly on
    // the failing multi-route fixtures (Task 5 report, Part A): growth
    // genuinely closes loops this way, but trimTails only ever protected
    // the ONE closure mechanism that already carries a `/c` id
    // (connectDeadEnds' own connectors, added after this first trim even
    // runs) -- a growth-time rung earning no building of its own was
    // simply DROPPED (same rule as any other empty invented lane), and
    // even a SURVIVING rung's target could be trimmed back past the exact
    // point the rung welded onto, silently reopening the loop growth just
    // closed. Neither failure shows up as a crash or a thrown error --
    // only as a `blocks` count that reads lower than the fabric's own
    // geometry would otherwise support.
    const laneA = (): Lane => ({
      id: 'lane-000',
      type: 'local',
      widthM: 5,
      points: [
        new Point(0, 0), new Point(20, 0), new Point(40, 0), new Point(60, 0), new Point(80, 0),
      ],
    });
    // Welds EXACTLY onto laneA's point at (40, 0) -- s=40 along laneA --
    // the way loopSnap/truncateAtFirstCrossing actually land a join: on
    // the target polyline, not near it.
    const rung = (): Lane => ({
      id: 'lane-000/b50',
      type: 'footpath',
      widthM: 4,
      points: [new Point(40, 20), new Point(40, 0)],
    });

    it("a rung whose far end welds onto another lane survives even though it earns no building of its own", () => {
      const out = trimTails([laneA(), rung()], []);
      expect(out.find((l) => l.id === 'lane-000/b50')).toBeDefined();
    });

    it('does not trim a lane back past a point another lane welded onto it', () => {
      // laneA's only building sits near its start (furthestS=10), so
      // WITHOUT the weld floor its tail would be cut to
      // 10 + TAIL_STUB_M(12) = 22 -- short of the rung's join at s=40.
      const buildingNearStart = building(10, 0, 'bld:a', 'lane-000:R0');
      const out = trimTails([laneA(), rung()], [buildingNearStart]);
      const trimmedA = out.find((l) => l.id === 'lane-000')!;
      expect(trimmedA).toBeDefined();
      const lastPoint = trimmedA.points[trimmedA.points.length - 1];
      // Must reach at least as far as the weld point (40, 0), not stop at
      // the pre-weld-floor cutoff of 22.
      expect(lastPoint.x).toBeGreaterThanOrEqual(40 - 1e-9);
    });

    it('a HOST with no buildings of its own is kept when a rung welds onto it', () => {
      // laneA earns no dwelling at all here -- under the pre-fix rule it
      // would simply be dropped, orphaning the rung's join even though the
      // rung itself is protected as a joiner.
      const out = trimTails([laneA(), rung()], []);
      expect(out.find((l) => l.id === 'lane-000')).toBeDefined();
    });

    it('a rung earning no building AND welding onto nothing (both ends free) is still dropped', () => {
      // The generalisation must not blanket-protect every empty invented
      // lane -- only ones a surviving junction actually depends on.
      const freeFloating: Lane = {
        id: 'lane-000/b70',
        type: 'footpath',
        widthM: 4,
        points: [new Point(200, 200), new Point(200, 220)],
      };
      const out = trimTails([laneA(), freeFloating], []);
      expect(out.find((l) => l.id === 'lane-000/b70')).toBeUndefined();
    });
  });
});
