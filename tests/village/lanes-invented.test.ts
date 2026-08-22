import { describe, it, expect } from 'vitest';
import { Point } from '../../src/types/point.js';
import { SeededRandom } from '../../src/utils/random.js';
import {
  addInventedLanes, availableFrontage, polylineLength, requiredFrontage,
} from '../../src/village/skeleton/lanes.js';
import type { Green, Lane } from '../../src/village/types.js';

const green: Green = {
  shape: 'sm-green-round', variant: 'a', centre: new Point(0, 0),
  diameter: 20, bearingDeg: 0,
};

const lane = (id: string, from: Point, to: Point): Lane =>
  ({ id, type: 'main', points: [from, to], widthM: 5 });

describe('frontage arithmetic', () => {
  it('measures a polyline', () => {
    expect(polylineLength([new Point(0, 0), new Point(3, 4)])).toBeCloseTo(5, 5);
  });

  it('counts both sides of every lane', () => {
    const lanes = [lane('a', new Point(0, 0), new Point(100, 0))];
    expect(availableFrontage(lanes)).toBeCloseTo(200, 5);
  });

  it('derives what the census needs', () => {
    // 300 people / 5 per dwelling = 60 dwellings * 14 m of frontage
    expect(requiredFrontage(300, 5, 14)).toBeCloseTo(840, 5);
  });
});

describe('addInventedLanes', () => {
  // Gate 5.1: addInventedLanes returns { lanes, radiusM } -- the cluster
  // radius it actually reached must reach the lot cutter, which applies
  // the same cut-off. Unwrapped here so the assertions below stay about
  // the lanes.
  const grow = (...args: Parameters<typeof addInventedLanes>): Lane[] => addInventedLanes(...args).lanes;

  it('adds nothing when the arms already provide enough frontage INSIDE the ring', () => {
    // Gate 6.2 (concentric saturation): frontage only counts where lots
    // will actually be cut — inside the saturated disc, which starts just
    // outside the green and widens only when its ring is full. A 490 m arm
    // therefore no longer "provides" 980 m of frontage up front; almost all
    // of it lies outside the first ring. The fixture is rewritten to match
    // the rule rather than the old accounting: a SHORT arm, well inside the
    // opening ring, supplying more than the small requirement asks for.
    // The whole arm must lie inside the opening ring (green drawn radius
    // + SATURATION_RING_START_M ~= 39 m here), or its outer segment is
    // only half-counted and the budget is not met after all.
    const lanes = [lane('arm-000', new Point(0, -10), new Point(0, -35))];
    const out = grow(lanes, green, 40, 12, 500, new SeededRandom(1));
    expect(out).toHaveLength(1);
  });

  // The other half of the same rule, which is the point of the change.
  it('does NOT count distant frontage: a long arm alone cannot satisfy the budget', () => {
    const lanes = [lane('arm-000', new Point(0, -10), new Point(0, -500))];
    const out = grow(lanes, green, 500, 12, 500, new SeededRandom(1));
    expect(out.length).toBeGreaterThan(1);
  });

  it('adds lanes until available frontage clears required x 1.15', () => {
    const lanes = [lane('arm-000', new Point(0, -10), new Point(0, -110))];
    const out = grow(lanes, green, 2000, 12, 500, new SeededRandom(1));
    expect(out.length).toBeGreaterThan(1);
    expect(availableFrontage(out)).toBeGreaterThanOrEqual(2000 * 1.15);
  });

  it('keeps every invented lane in the village band: local, trail or footpath', () => {
    // Owner ruling (2026-08-21): royal/main/market/town are INTER-SETTLEMENT
    // classes — market lanes connect market towns, they are not suburban
    // routes. A branch off a `main` road is a `local` street, never `market`.
    const lanes = [lane('arm-000', new Point(0, -10), new Point(0, -60))];
    const out = grow(lanes, green, 800, 12, 500, new SeededRandom(3));
    // Excluded by original id, not by prefix: green-attached invented lanes
    // now use their own `lane-` id space (ruling R10), but excluding by id
    // is the more general check and doesn't depend on that detail.
    const invented = out.filter((l) => !lanes.some((orig) => orig.id === l.id));
    expect(invented.length).toBeGreaterThan(0);
    for (const l of invented) {
      expect(['local', 'trail', 'footpath']).toContain(l.type);
    }
  });

  it('is deterministic for a seed', () => {
    const mk = () => grow(
      [lane('arm-000', new Point(0, -10), new Point(0, -60))], green, 900, 12, 500,
      new SeededRandom(11),
    );
    expect(JSON.stringify(mk())).toBe(JSON.stringify(mk()));
  });

  it('gives green-attached invented lanes their own id space, distinct from arms (R10)', () => {
    const lanes = [lane('arm-000', new Point(0, -10), new Point(0, -60))];
    const out = grow(lanes, green, 800, 12, 500, new SeededRandom(3));
    const invented = out.filter((l) => !lanes.some((orig) => orig.id === l.id));
    const greenAttached = invented.filter((l) => l.parentId === undefined);
    expect(greenAttached.length).toBeGreaterThan(0);
    for (const l of greenAttached) {
      expect(l.id.startsWith('lane-')).toBe(true);
    }
    // No invented id may alias an arm id, in either direction.
    const armIds = out.filter((l) => l.id.startsWith('arm-')).map((l) => l.id);
    const inventedIds = greenAttached.map((l) => l.id);
    expect(inventedIds.every((id) => !armIds.includes(id))).toBe(true);
  });

  it('never collides branch-lane ids even once the green runs out of free bearings', () => {
    // A frontage requirement this large forces every iteration up to
    // MAX_INVENTED_LANES: the green's ~10 free-bearing slots fill fast
    // (35deg separation), so most of the run takes the branch path on a
    // shrinking set of parents — exactly where `branchLaneId`'s ~35
    // percentage buckets can collide if the fallback probing is missing.
    for (const seed of [2, 5, 7, 13, 21, 42]) {
      const lanes = [lane('arm-000', new Point(0, -10), new Point(0, -60))];
      const out = grow(lanes, green, 100000, 12, 500, new SeededRandom(seed));
      const ids = out.map((l) => l.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});
