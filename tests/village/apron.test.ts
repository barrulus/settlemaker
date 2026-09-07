/**
 * Apron geometry (spec 2026-09-07 §5.3): the continuation of a trunk past
 * its contract entry. Pure geometry — no model, no RNG.
 */
import { describe, it, expect } from 'vitest';
import { Point } from '../../src/types/point.js';
import { apronLaneId, isApron, type Lane } from '../../src/village/types.js';
import { apronReachM, growApronPath, growAprons } from '../../src/village/skeleton/apron.js';
import { dist, polylineLength } from '../../src/village/geometry.js';
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
