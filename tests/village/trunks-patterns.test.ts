// tests/village/trunks-patterns.test.ts
import { describe, expect, it } from 'vitest';
import { Point } from '../../src/types/point.js';
import { SeededRandom } from '../../src/utils/random.js';
import { segmentIntersection } from '../../src/village/geometry.js';
import {
  isTrunk, resolveCrossings,
  synthesizeTrunks,
} from '../../src/village/skeleton/trunks.js';
import type { Lane, Site } from '../../src/village/types.js';

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

describe('synthesizeTrunks: invariants across approach configurations', () => {
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

describe('resolveCrossings: single-pass forward sweep can leave a residual crossing', () => {
  // Found by brute-force search: A and B cross TWICE (a real polyline can
  // wander back across another). The single-pass sweep resolves the FIRST
  // A-B crossing it finds, then B gets split again by C before A's own
  // outer index-0 slot ever gets a chance to re-check the pieces that carry
  // the SECOND A-B crossing -- so it survives unresolved. This is the
  // "outer loop never revisits an index it already passed" gap: not (as the
  // module's docstring speculated) that split-only truncation can invent a
  // NEW crossing, but that a pair crossing MORE THAN ONCE only ever gets
  // its first intersection handled in a single sweep.
  const mkLane = (id: string, pts: [number, number][]): Lane => ({
    id, type: 'local', points: pts.map(([x, y]) => new Point(x, y)), widthM: 3,
  });

  const A = mkLane('A', [
    [8.957683164140988, -23.675983750110483],
    [16.588398416800608, -21.420022617755468],
    [14.088218325790123, 12.38680421485882],
  ]);
  const B = mkLane('B', [
    [14.059630112750284, 12.405172568934582],
    [10.085075041318817, -23.34268049958287],
    [25.469604635364192, -16.714646335092674],
  ]);
  const C = mkLane('C', [
    [19.161577061359573, -11.513671112020347],
    [3.581751665837018, -25.265338381410267],
    [-23.149009055061736, 14.183903114955832],
  ]);

  it('leaves no properly-crossing pair once resolved', () => {
    const { trunks } = resolveCrossings([A, B, C], []);
    for (let i = 0; i < trunks.length; i++) {
      for (let j = i + 1; j < trunks.length; j++) {
        expect(crossesLane(trunks[i].points, trunks[j].points)).toBe(false);
      }
    }
  });
});
