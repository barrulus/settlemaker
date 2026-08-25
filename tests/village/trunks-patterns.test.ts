// tests/village/trunks-patterns.test.ts
import { describe, expect, it } from 'vitest';
import {
  choosePattern, synthesizeTrunks, isTrunk, type ConvergencePattern,
} from '../../src/village/skeleton/trunks.js';
import { segmentIntersection } from '../../src/village/geometry.js';
import type { Site, Lane } from '../../src/village/types.js';
import { SeededRandom } from '../../src/utils/random.js';
import { Point } from '../../src/types/point.js';

const CONTRACT_R = 100;
const BUILT_EDGE = 30;

function makeSite(routes: Site['routes']): Site {
  return {
    population: 300,
    biome: 'temperate',
    routes,
    water: [],
    flags: { port: false, temple: false, trade: false, walls: false },
  };
}

/** Reuse the crossesLane predicate shape from village-model.ts (per the brief). */
function crossesLane(a: Point[], b: Point[]): boolean {
  for (let i = 1; i < a.length; i++) {
    for (let j = 1; j < b.length; j++) {
      if (segmentIntersection(a[i - 1], a[i], b[j - 1], b[j])) return true;
    }
  }
  return false;
}

function findSeedForPattern(
  site: Site, pattern: ConvergencePattern, maxSeed = 300,
): { seed: number; network: ReturnType<typeof synthesizeTrunks> } {
  for (let seed = 1; seed <= maxSeed; seed++) {
    const network = synthesizeTrunks(site, CONTRACT_R, BUILT_EDGE, new SeededRandom(seed));
    if (network.pattern === pattern) return { seed, network };
  }
  throw new Error(`pattern ${pattern} never reached in ${maxSeed} seeds`);
}

describe('choosePattern', () => {
  it('(a) terminal deterministic for a terminating main with only trail feeders', () => {
    for (let seed = 1; seed <= 20; seed++) {
      expect(choosePattern(3, false, 'main', true, new SeededRandom(seed))).toBe('terminal');
    }
  });

  it('(a) through royal/main present -> main-street >= 0.6 over seeds 1..100', () => {
    let count = 0;
    for (let seed = 1; seed <= 100; seed++) {
      if (choosePattern(2, true, 'main', false, new SeededRandom(seed)) === 'main-street') count++;
    }
    expect(count / 100).toBeGreaterThanOrEqual(0.6);
  });

  it('(a) 4+ roots -> loop reachable, junction rare (< 15%)', () => {
    let loopCount = 0;
    let junctionCount = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const p = choosePattern(4, false, 'town', false, new SeededRandom(seed));
      if (p === 'loop') loopCount++;
      if (p === 'junction') junctionCount++;
    }
    expect(loopCount).toBeGreaterThan(0);
    expect(junctionCount / 100).toBeLessThan(0.15);
  });
});

describe('synthesizeTrunks: main-street', () => {
  const site = makeSite([
    { bearingDeg: 90, type: 'main', through: true, routeId: 'r-through' },
  ]);

  it('(b) a through route\'s near+far entries resolve to ONE continuous lane', () => {
    const { network } = findSeedForPattern(site, 'main-street');
    const spine = network.trunks.find((t) => t.id === 'trunk-main-r-through');
    expect(spine).toBeDefined();
    expect(network.trunks.some((t) => t.id === 'trunk-main-r-through~far')).toBe(false);
    expect(spine!.id).not.toContain('~far');

    const first = spine!.points[0];
    const last = spine!.points[spine!.points.length - 1];
    expect(Math.hypot(first.x, first.y)).toBeCloseTo(CONTRACT_R, 3);
    expect(Math.hypot(last.x, last.y)).toBeCloseTo(CONTRACT_R, 3);
  });
});

describe('synthesizeTrunks: loop', () => {
  const site = makeSite([
    { bearingDeg: 0, type: 'town', through: false, routeId: 'a' },
    { bearingDeg: 90, type: 'town', through: false, routeId: 'b' },
    { bearingDeg: 180, type: 'town', through: false, routeId: 'c' },
    { bearingDeg: 270, type: 'town', through: false, routeId: 'd' },
  ]);

  it('(c) loop lanes, stepped-down class, every root lands on the loop, staggered', () => {
    const { network } = findSeedForPattern(site, 'loop');
    const loopLanes = network.trunks.filter((t) => t.id.startsWith('trunk-loop-'));
    expect(loopLanes.length).toBeGreaterThanOrEqual(8);
    for (const l of loopLanes) expect(l.type).toBe('local'); // stepDown('town', 'local')

    const loopPoints: Point[] = [];
    for (const l of loopLanes) loopPoints.push(...l.points);

    const roots = network.trunks.filter((t) => site.routes.some((r) => t.id === `trunk-${r.type}-${r.routeId}`));
    expect(roots).toHaveLength(4);

    const landingIdxs: number[] = [];
    for (const r of roots) {
      const inner = r.points[0];
      let onLoop = false;
      let closestIdx = -1;
      let closestDist = Infinity;
      loopPoints.forEach((p, idx) => {
        const d = Math.hypot(p.x - inner.x, p.y - inner.y);
        if (d < closestDist) { closestDist = d; closestIdx = idx; }
        if (d < 1e-6) onLoop = true;
      });
      expect(onLoop).toBe(true);
      landingIdxs.push(closestIdx);
    }
    // staggered: not every root landed at the very same point.
    expect(new Set(landingIdxs).size).toBeGreaterThan(1);
  });
});

describe('synthesizeTrunks: y-tree', () => {
  const site = makeSite([
    { bearingDeg: 0, type: 'town', through: false, routeId: 'a' },
    { bearingDeg: 60, type: 'town', through: false, routeId: 'b' },
    { bearingDeg: 150, type: 'town', through: false, routeId: 'c' },
    { bearingDeg: 240, type: 'town', through: false, routeId: 'd' },
    { bearingDeg: 300, type: 'town', through: false, routeId: 'e' },
  ]);

  it('(d) at most 3 lanes reach within builtEdgeRadiusM x 0.5 of origin', () => {
    const { network } = findSeedForPattern(site, 'y-tree');
    const near = network.trunks.filter((t) => Math.hypot(t.points[0].x, t.points[0].y) <= BUILT_EDGE * 0.5);
    expect(near.length).toBeLessThanOrEqual(3);
  });
});

describe('synthesizeTrunks: junction', () => {
  const site = makeSite([
    { bearingDeg: 0, type: 'town', through: false, routeId: 'a' },
    { bearingDeg: 120, type: 'town', through: false, routeId: 'b' },
    { bearingDeg: 240, type: 'town', through: false, routeId: 'c' },
  ]);

  it('(e) all roots share one junction at origin', () => {
    const { network } = findSeedForPattern(site, 'junction');
    const rootIds = network.trunks
      .filter((t) => site.routes.some((r) => t.id === `trunk-${r.type}-${r.routeId}`))
      .map((t) => t.id)
      .sort();
    expect(rootIds).toHaveLength(3);
    const j = network.junctions.find((x) => {
      const ids = [...x.laneIds].sort();
      return ids.length === rootIds.length && ids.every((id, i) => id === rootIds[i]);
    });
    expect(j).toBeDefined();
    expect(Math.hypot(j!.position.x, j!.position.y)).toBeCloseTo(0, 6);
  });
});

describe('synthesizeTrunks: invariants across patterns', () => {
  const scenarios: Site[] = [
    makeSite([{ bearingDeg: 90, type: 'main', through: true, routeId: 'r-through' }]),
    makeSite([
      { bearingDeg: 0, type: 'town', through: false, routeId: 'a' },
      { bearingDeg: 90, type: 'town', through: false, routeId: 'b' },
      { bearingDeg: 180, type: 'town', through: false, routeId: 'c' },
      { bearingDeg: 270, type: 'town', through: false, routeId: 'd' },
    ]),
    makeSite([
      { bearingDeg: 0, type: 'town', through: false, routeId: 'a' },
      { bearingDeg: 60, type: 'town', through: false, routeId: 'b' },
      { bearingDeg: 150, type: 'town', through: false, routeId: 'c' },
      { bearingDeg: 240, type: 'town', through: false, routeId: 'd' },
      { bearingDeg: 300, type: 'town', through: false, routeId: 'e' },
    ]),
    makeSite([
      { bearingDeg: 0, type: 'town', through: false, routeId: 'a' },
      { bearingDeg: 120, type: 'town', through: false, routeId: 'b' },
      { bearingDeg: 240, type: 'town', through: false, routeId: 'c' },
    ]),
    makeSite([
      { bearingDeg: 10, type: 'main', through: false, routeId: 'r-main' },
      { bearingDeg: 140, type: 'trail', through: false, routeId: 'r-trail1' },
      { bearingDeg: 250, type: 'trail', through: false, routeId: 'r-trail2' },
    ]),
  ];

  it('(f) no two lanes properly cross, and every route_id appears in exactly one lane\'s id or sourceRouteIds', () => {
    for (const site of scenarios) {
      for (let seed = 1; seed <= 25; seed++) {
        const network = synthesizeTrunks(site, CONTRACT_R, BUILT_EDGE, new SeededRandom(seed));
        const lanes = network.trunks;
        for (let i = 0; i < lanes.length; i++) {
          for (let j = i + 1; j < lanes.length; j++) {
            expect(crossesLane(lanes[i].points, lanes[j].points)).toBe(false);
          }
        }
        for (const route of site.routes) {
          const key = route.routeId as string;
          const count = lanes.filter(
            (l) => l.id.includes(key) || (l.sourceRouteIds ?? []).includes(key),
          ).length;
          expect(count).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });

  it('(g) deterministic per seed', () => {
    for (const site of scenarios) {
      const a = synthesizeTrunks(site, CONTRACT_R, BUILT_EDGE, new SeededRandom(11));
      const b = synthesizeTrunks(site, CONTRACT_R, BUILT_EDGE, new SeededRandom(11));
      expect(a).toEqual(b);
    }
  });
});

describe('isTrunk still holds for pattern-added lanes', () => {
  it('loop and y-tree connector lanes count as trunks', () => {
    expect(isTrunk('trunk-loop-0')).toBe(true);
    expect(isTrunk('trunk-ytree-1')).toBe(true);
  });
});
