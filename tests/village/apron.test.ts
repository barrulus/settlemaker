/**
 * Apron geometry (spec 2026-09-07 §5.3): the continuation of a trunk past
 * its contract entry. Pure geometry — no model, no RNG.
 */
import { describe, it, expect } from 'vitest';
import { Point } from '../../src/types/point.js';
import { apronLaneId, isApron, type Lane } from '../../src/village/types.js';
import {
  apronReachM, coastEscapeRadiusM, growApronPath, growAprons,
} from '../../src/village/skeleton/apron.js';
import { dist, inAnyWater, polylineLength } from '../../src/village/geometry.js';
import { APRON_REACH_FLOOR_M } from '../../src/village/constants.js';

/** A straight trunk running inward along -y, outer end at (0, -100). */
const straight: Lane = {
  id: 'trunk-main-000', type: 'main', widthM: 5,
  points: [new Point(0, -20), new Point(0, -60), new Point(0, -100)],
};

describe('apron ids', () => {
  it('suffixes the trunk id with /a', () => {
    expect(apronLaneId('trunk-main-045')).toBe('trunk-main-045/a');
  });

  it('recognises an apron, a crossing-split apron, and nothing else', () => {
    expect(isApron('trunk-main-045/a')).toBe(true);
    expect(isApron('trunk-main-045/a~xtrunk-local-120')).toBe(true);
    expect(isApron('trunk-main-045')).toBe(false);
    expect(isApron('trunk-main-045/b45')).toBe(false);
    expect(isApron('lane-090/c')).toBe(false);
  });
});

describe('apron reach', () => {
  it('is a multiple of the contract radius, floored for tiny villages', () => {
    expect(apronReachM(264)).toBeGreaterThan(264 * 5.5);
    expect(apronReachM(10)).toBe(APRON_REACH_FLOOR_M);
  });
});

describe('growApronPath', () => {
  it('starts at the trunk’s own outer vertex and does not move it', () => {
    const apron = growApronPath(straight, 300);
    expect(apron[0].x).toBeCloseTo(0);
    expect(apron[0].y).toBeCloseTo(-100);
  });

  it('continues outward, away from the village, for the reach asked', () => {
    const apron = growApronPath(straight, 300);
    const tip = apron[apron.length - 1];
    // Straight trunk pointing at -y: the apron carries on that way.
    expect(tip.y).toBeLessThan(-380);
    expect(polylineLength(apron)).toBeGreaterThan(290);
    expect(polylineLength(apron)).toBeLessThan(310);
  });

  it('samples at roughly the apron step, not the lane step', () => {
    const apron = growApronPath(straight, 300);
    for (let i = 1; i < apron.length; i++) {
      expect(dist(apron[i - 1], apron[i])).toBeLessThanOrEqual(26);
    }
    expect(apron.length).toBeLessThan(20);
  });

  it('continues a bend rather than kinking straight off the end', () => {
    // A trunk curving as it arrives: each segment turns 10 deg.
    const curving: Lane = {
      id: 'trunk-trail-000', type: 'trail', widthM: 2,
      points: [new Point(0, -20), new Point(10, -58), new Point(24, -95)],
    };
    const apron = growApronPath(curving, 300);
    const turn = (a: Point, b: Point, c: Point): number => {
      const ab = Math.atan2(b.y - a.y, b.x - a.x);
      const bc = Math.atan2(c.y - b.y, c.x - b.x);
      return Math.abs(((bc - ab) * 180) / Math.PI);
    };
    // The join is smooth: no sharp corner where the apron meets the trunk.
    expect(turn(curving.points[1], apron[0], apron[1])).toBeLessThan(8);
    // And it keeps turning the same way it was.
    expect(apron[apron.length - 1].x).toBeGreaterThan(24);
  });

  it('never spirals, however hard the trunk was turning', () => {
    const hairpin: Lane = {
      id: 'trunk-footpath-000', type: 'footpath', widthM: 1.5,
      points: [new Point(0, -20), new Point(30, -50), new Point(20, -85)],
    };
    const apron = growApronPath(hairpin, 600);
    const start = Math.atan2(
      apron[1].y - apron[0].y, apron[1].x - apron[0].x,
    );
    const end = Math.atan2(
      apron[apron.length - 1].y - apron[apron.length - 2].y,
      apron[apron.length - 1].x - apron[apron.length - 2].x,
    );
    const totalTurnDeg = Math.abs(((end - start) * 180) / Math.PI);
    expect(totalTurnDeg).toBeLessThanOrEqual(31);
  });

  it('returns nothing for a degenerate lane', () => {
    const stub: Lane = { id: 'trunk-main-000', type: 'main', widthM: 5, points: [new Point(0, 0)] };
    expect(growApronPath(stub, 300)).toEqual([]);
  });
});

describe('growAprons', () => {
  const entries = [
    { point: new Point(0, -100), bearingDeg: 0, route: { bearingDeg: 0, type: 'main' as const, through: false }, farSide: false },
  ];

  it('gives one apron per lane whose outer end is a contract entry', () => {
    const { lanes: aprons } = growAprons([straight], entries as never, 100);
    expect(aprons).toHaveLength(1);
    expect(aprons[0].id).toBe('trunk-main-000/a');
  });

  it('inherits the trunk’s class and width so the stroke is continuous', () => {
    const { lanes: [apron] } = growAprons([straight], entries as never, 100);
    expect(apron.type).toBe('main');
    expect(apron.widthM).toBe(straight.widthM);
  });

  it('carries no parentId — exitRoads skips lanes that have one', () => {
    const { lanes: [apron] } = growAprons([straight], entries as never, 100);
    expect(apron.parentId).toBeUndefined();
  });

  it('ignores a lane whose outer end is not on an entry', () => {
    const inner: Lane = {
      id: 'lane-090', type: 'local', widthM: 3,
      points: [new Point(0, 0), new Point(10, 10)],
    };
    expect(growAprons([inner], entries as never, 100).lanes).toHaveLength(0);
  });

  it('merges an apron into an earlier one it converges on, and records a junction', () => {
    // Two entries half a degree apart -- the `fan` fixture's own case --
    // whose aprons run outward nearly parallel and converge within capture
    // distance well past the shared tip.
    const a: Lane = {
      id: 'trunk-main-000', type: 'main', widthM: 5,
      points: [new Point(0, -20), new Point(0, -60), new Point(0, -100)],
    };
    const b: Lane = {
      id: 'trunk-main-001', type: 'main', widthM: 5,
      points: [new Point(1, -20), new Point(1, -60), new Point(1, -100)],
    };
    const twoEntries = [
      { point: new Point(0, -100), bearingDeg: 0, route: { bearingDeg: 0, type: 'main' as const, through: false }, farSide: false },
      { point: new Point(1, -100), bearingDeg: 0.5, route: { bearingDeg: 0.5, type: 'main' as const, through: false }, farSide: false },
    ];
    const { lanes: aprons, junctions } = growAprons([a, b], twoEntries as never, 100);
    expect(aprons).toHaveLength(2);
    expect(junctions).toHaveLength(1);
    const merged = aprons.find((l) => l.id === 'trunk-main-001/a')!;
    // Truncated well short of the full, unmerged reach.
    expect(polylineLength(merged.points)).toBeLessThan(polylineLength(
      growApronPath(b, apronReachM(100)),
    ));
    expect(junctions[0].laneIds).toEqual(['trunk-main-000/a', 'trunk-main-001/a']);
  });
});

/**
 * The coast bend (spec §5.4, owner ruling 2026-09-07): a road whose bearing
 * points out to sea turns and follows the shore until it leaves the tile.
 * It does not stop at the water, and it is not left short.
 */
describe('the coast bend', () => {
  // Water filling y > 40: a road heading +y meets it head on.
  const sea = [[
    new Point(-1000, 40), new Point(1000, 40),
    new Point(1000, 2000), new Point(-1000, 2000),
  ]];
  const seaward: Lane = {
    id: 'trunk-main-180', type: 'main', widthM: 5,
    points: [new Point(0, -20), new Point(0, 0)],
  };
  const entries = [{
    point: new Point(0, 0), bearingDeg: 180,
    route: { bearingDeg: 180, type: 'main' as const, through: false }, farSide: false,
  }];
  const wet = (p: Point): boolean => inAnyWater(p, sea);

  it('never puts a point in the water', () => {
    const { lanes } = growAprons([seaward], entries as never, 60, sea);
    expect(lanes.flatMap((l) => l.points).filter(wet)).toHaveLength(0);
  });

  it('turns instead of stopping at the shore', () => {
    const { lanes } = growAprons([seaward], entries as never, 60, sea);
    const tip = lanes[0].points[lanes[0].points.length - 1];
    // It got a long way sideways, which a road that merely stopped could not.
    expect(Math.abs(tip.x)).toBeGreaterThan(200);
  });

  it('runs a standoff clear of the waterline, not on it', () => {
    const { lanes } = growAprons([seaward], entries as never, 60, sea);
    const alongShore = lanes[0].points.filter((p) => Math.abs(p.x) > 100);
    expect(alongShore.length).toBeGreaterThan(0);
    for (const p of alongShore) expect(p.y).toBeLessThanOrEqual(31);
  });

  it('leaves the tile: it gets clear of the escape radius', () => {
    // The frame does not exist yet at synthesis time, so the road runs
    // until no point of any possible tile could still contain it.
    const { lanes, diagnostics } = growAprons([seaward], entries as never, 60, sea);
    const tip = lanes[0].points[lanes[0].points.length - 1];
    expect(Math.hypot(tip.x, tip.y)).toBeGreaterThanOrEqual(coastEscapeRadiusM(60));
    expect(diagnostics).toEqual([]);
  });

  it('is deterministic — the same input gives the same road', () => {
    const a = growAprons([seaward], entries as never, 60, sea);
    const b = growAprons([seaward], entries as never, 60, sea);
    expect(JSON.stringify(a.lanes)).toBe(JSON.stringify(b.lanes));
  });

  it('is unchanged by which way round the water ring is wound', () => {
    // The dry side is TESTED, never derived from the winding, so a ring
    // handed over clockwise gives the same road as the same ring
    // anticlockwise.
    const reversed = [[...sea[0]].reverse()];
    const a = growAprons([seaward], entries as never, 60, sea);
    const b = growAprons([seaward], entries as never, 60, reversed);
    expect(a.lanes[0].points.filter(wet)).toHaveLength(0);
    expect(b.lanes[0].points.filter(wet)).toHaveLength(0);
    const far = (l: typeof a.lanes[0]): number =>
      Math.hypot(l.points[l.points.length - 1].x, l.points[l.points.length - 1].y);
    expect(far(b.lanes[0])).toBeCloseTo(far(a.lanes[0]), 6);
  });

  it('lands a second seaward road on the first and records a junction', () => {
    const second: Lane = {
      id: 'trunk-local-170', type: 'local', widthM: 3,
      points: [new Point(-6, -20), new Point(-6, 0)],
    };
    const both = [...(entries as never[]), {
      point: new Point(-6, 0), bearingDeg: 170,
      route: { bearingDeg: 170, type: 'local', through: false }, farSide: false,
    }];
    const { lanes, junctions } = growAprons([seaward, second], both as never, 60, sea);
    expect(lanes).toHaveLength(2);
    expect(junctions.length).toBeGreaterThan(0);
  });

  it('crosses a brook rather than turning to follow it', () => {
    // AFMG's real river width is 4 m. `profile.ts` already treats water
    // this narrow as an obstacle the village sits on, not a boundary it
    // stops at, and so must the apron -- otherwise the `brook` fixture's
    // through road runs along the stream instead of over it.
    const brook = [[
      new Point(-1000, 40), new Point(1000, 40),
      new Point(1000, 44), new Point(-1000, 44),
    ]];
    const { lanes, diagnostics } = growAprons([seaward], entries as never, 60, brook);
    const tip = lanes[0].points[lanes[0].points.length - 1];
    expect(Math.abs(tip.x)).toBeLessThan(1);
    expect(tip.y).toBeGreaterThan(400);
    expect(diagnostics).toEqual([]);
  });

  it('ends at the shore, and says so, when the coast never leaves the tile', () => {
    // A lagoon small enough that the road can walk right round it and be no
    // further out than when it started.
    const lagoon = [[
      new Point(-30, 40), new Point(30, 40), new Point(30, 100), new Point(-30, 100),
    ]];
    const { lanes, diagnostics } = growAprons([seaward], entries as never, 60, lagoon);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatch(/^coast:/);
    // Ended at the water, dry, rather than running on into it.
    expect(lanes[0].points.filter((p) => inAnyWater(p, lagoon))).toHaveLength(0);
    const tip = lanes[0].points[lanes[0].points.length - 1];
    expect(tip.y).toBeGreaterThan(25);
    expect(tip.y).toBeLessThan(40);
    expect(Math.hypot(tip.x, tip.y)).toBeLessThan(coastEscapeRadiusM(60));
  });

  it('leaves a dry village’s aprons exactly as they were', () => {
    const dry = growAprons([seaward], entries as never, 60);
    const withEmptyWater = growAprons([seaward], entries as never, 60, []);
    expect(JSON.stringify(withEmptyWater.lanes)).toBe(JSON.stringify(dry.lanes));
    expect(dry.diagnostics).toEqual([]);
  });
});

/**
 * THE ENDPOINT BLIND SPOT (review finding, fix round 3).
 *
 * `segmentIntersection` rejects an intersection within 1e-6 of either
 * segment's ends. So a waterline met EXACTLY at a ring vertex, or exactly
 * at an apron sample, registers as no crossing at all -- and the road used
 * to run on into the sea saying nothing at all, which is the one path where
 * this task's headline bar failed silently.
 *
 * Every ordinate here is a multiple of the apron's own 25 m sample step, so
 * the apron lands exactly ON the waterline rather than across it. Real
 * coordinates never do this (they come out of trigonometry), which is why
 * it took a lattice to find.
 */
describe('a waterline met exactly on a sample', () => {
  const seaward: Lane = {
    id: 'trunk-main-180', type: 'main', widthM: 5,
    points: [new Point(0, -20), new Point(0, 0)],
  };
  const entries = [{
    point: new Point(0, 0), bearingDeg: 180,
    route: { bearingDeg: 180, type: 'main' as const, through: false }, farSide: false,
  }];

  it('still bends, rather than running on into the sea in silence', () => {
    // The apron samples at y = 0, 25, 50, ...; the shore IS y = 50.
    const sea = [[
      new Point(-1000, 50), new Point(1000, 50),
      new Point(1000, 2000), new Point(-1000, 2000),
    ]];
    const { lanes, diagnostics } = growAprons([seaward], entries as never, 60, sea);
    expect(lanes[0].points.filter((p) => inAnyWater(p, sea)),
      'the road is in the sea').toHaveLength(0);
    const tip = lanes[0].points[lanes[0].points.length - 1];
    expect(Math.abs(tip.x), 'it did not turn').toBeGreaterThan(200);
    // It got out, so there is nothing to report; what must never happen is
    // a wet road AND an empty diagnostics list.
    expect(diagnostics).toEqual([]);
  });

  it('still crosses a stream met exactly on a sample', () => {
    // Same lattice, but the water is 4 m of brook. The blind-spot fallback
    // must not turn a road that should simply cross.
    const brook = [[
      new Point(-1000, 50), new Point(1000, 50),
      new Point(1000, 54), new Point(-1000, 54),
    ]];
    const { lanes, diagnostics } = growAprons([seaward], entries as never, 60, brook);
    const tip = lanes[0].points[lanes[0].points.length - 1];
    expect(Math.abs(tip.x), 'it turned along a brook').toBeLessThan(1);
    expect(tip.y).toBeGreaterThan(400);
    expect(diagnostics).toEqual([]);
  });
});
