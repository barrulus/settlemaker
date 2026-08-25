// tests/village/trunks-merge.test.ts
import { describe, expect, it } from 'vitest';
import { mergeTrunks, type DraftTrunk } from '../../src/village/skeleton/trunks.js';
import { closestPointOnSegment, dist, bearingVector } from '../../src/village/geometry.js';
import type { RouteType } from '../../src/village/route-class.js';
import { Point } from '../../src/types/point.js';
import { SeededRandom } from '../../src/utils/random.js';

const CIRCLE_R = 100;
const AIM = new Point(0, 0);
const BUILT_EDGE = 30;

function straightPath(from: Point, to: Point, steps = 50): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    pts.push(new Point(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t));
  }
  return pts;
}

function draft(bearingDeg: number, type: RouteType, routeId: string, aim: Point = AIM): DraftTrunk {
  const dir = bearingVector(bearingDeg);
  const circlePoint = new Point(dir.x * CIRCLE_R, dir.y * CIRCLE_R);
  const path = straightPath(circlePoint, aim, 50);
  return {
    entry: { point: circlePoint, bearingDeg, route: { bearingDeg, type, through: false, routeId }, farSide: false },
    path,
  };
}

const twoRoutes = () => [draft(0, 'main', 'r-main'), draft(0.6, 'trail', 'r-trail')];

describe('mergeTrunks', () => {
  it('(a) near-duplicate merge with provenance', () => {
    const { trunks, junctions } = mergeTrunks(twoRoutes(), BUILT_EDGE, new SeededRandom(1));
    expect(trunks).toHaveLength(2);

    const main = trunks.find((t) => t.type === 'main')!;
    const trail = trunks.find((t) => t.type === 'trail')!;
    expect(main).toBeDefined();
    expect(trail).toBeDefined();
    expect(main.points.length).toBe(51); // untouched, full length
    expect(trail.points.length).toBeLessThan(51); // truncated

    expect(junctions).toHaveLength(1);
    expect(junctions[0].laneIds.slice().sort()).toEqual([main.id, trail.id].sort());
    expect(junctions[0].id).toBe(`j:${[main.id, trail.id].sort().join('+')}`);

    expect(main.sourceRouteIds).toEqual(['r-main', 'r-trail']);
    expect(trail.sourceRouteIds).toBeUndefined();
  });

  it('(b) class dominance regardless of input order', () => {
    for (const drafts of [twoRoutes(), twoRoutes().reverse()]) {
      const { trunks } = mergeTrunks(drafts, BUILT_EDGE, new SeededRandom(2));
      const main = trunks.find((t) => t.type === 'main')!;
      const trail = trunks.find((t) => t.type === 'trail')!;
      expect(main.points.length).toBe(51);
      expect(trail.points.length).toBeLessThan(51);
    }
  });

  it('(c) well-separated same-class mains never merge', () => {
    const drafts = [draft(0, 'main', 'm1'), draft(120, 'main', 'm2')];
    const { trunks, junctions, roots } = mergeTrunks(drafts, BUILT_EDGE, new SeededRandom(3));
    expect(junctions).toHaveLength(0);
    expect(trunks).toHaveLength(2);
    expect(roots).toHaveLength(2);
    for (const t of trunks) expect(t.points.length).toBe(51);
  });

  it('(d) merge-band staggering over seeds 1..40', () => {
    const bands = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const { junctions } = mergeTrunks(twoRoutes(), BUILT_EDGE, new SeededRandom(seed));
      expect(junctions).toHaveLength(1);
      const r = Math.hypot(junctions[0].position.x, junctions[0].position.y);
      if (r > BUILT_EDGE * 1.15) bands.add('fields');
      else if (r >= BUILT_EDGE * 0.85) bands.add('edge');
      else bands.add('inner');
    }
    expect(bands.size).toBeGreaterThanOrEqual(2);
  });

  it('(e) deterministic per seed', () => {
    const a = mergeTrunks(twoRoutes(), BUILT_EDGE, new SeededRandom(7));
    const b = mergeTrunks(twoRoutes(), BUILT_EDGE, new SeededRandom(7));
    expect(a).toEqual(b);
  });

  it('(f) every junction lies on the survivor polyline within 1e-6', () => {
    for (let seed = 1; seed <= 15; seed++) {
      const { trunks, junctions } = mergeTrunks(twoRoutes(), BUILT_EDGE, new SeededRandom(seed));
      const main = trunks.find((t) => t.type === 'main')!;
      for (const j of junctions) {
        let minDist = Infinity;
        for (let i = 1; i < main.points.length; i++) {
          const q = closestPointOnSegment(j.position, main.points[i - 1], main.points[i]);
          minDist = Math.min(minDist, dist(j.position, q));
        }
        expect(minDist).toBeLessThanOrEqual(1e-6);
      }
    }
  });
});
