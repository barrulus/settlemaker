import { describe, it, expect } from 'vitest';
import { Point } from '../../src/types/point.js';
import { SeededRandom } from '../../src/utils/random.js';
import {
  availableFrontage, discRadiusFor, laneBudgetFor, polylineLength, saturateDisc,
} from '../../src/village/skeleton/lanes.js';
import { DISC_MARGIN, VOID_SPACING_M } from '../../src/village/constants.js';
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

  // Gate 6.6 retired `requiredFrontage`: the disc is no longer bargained
  // for in metres of frontage, it is sized in CLOSED FORM from the census
  // and then saturated. The property below is that closed form, stated as
  // arithmetic rather than as a pinned number.
  it('sizes the disc from the house count and the plot width', () => {
    // 60 dwellings x 14 m = 840 m of frontage = 420 m of lane (both sides),
    // tiled at VOID_SPACING_M, in a circle, plus the margin.
    const expected = Math.sqrt((420 * VOID_SPACING_M) / Math.PI) * DISC_MARGIN;
    expect(discRadiusFor(60, 14)).toBeCloseTo(expected, 5);
  });

  it('grows the disc as the square root of the house count', () => {
    // Four times the houses, twice the radius: area-first, by construction.
    expect(discRadiusFor(240, 14) / discRadiusFor(60, 14)).toBeCloseTo(2, 5);
  });

  it('reads its own lane budget back out of the radius, at one density', () => {
    // laneBudgetFor is discRadiusFor inverted: the lane a disc of that
    // radius holds at VOID_SPACING_M. Round-trip them.
    expect(laneBudgetFor(discRadiusFor(60, 14))).toBeCloseTo(420, 5);
  });
});

describe('saturateDisc', () => {
  // Gate 6.6: growth no longer bargains over a frontage budget. It is
  // handed the disc the census needs (`discRadiusFor`) and saturates THAT,
  // spending at most that disc's lane budget. `radiusM` -- the disc it
  // actually saturated -- must reach the lot cutter, which applies the same
  // cut-off. Unwrapped here so the assertions below stay about the lanes.
  const grow = (...args: Parameters<typeof saturateDisc>): Lane[] => saturateDisc(...args).lanes;

  it('builds almost nothing for a disc smaller than the green', () => {
    // A hamlet's disc can be smaller than the turf at its centre. Growth
    // still opens the green's own radials (that ring is what makes a green
    // a green), but the lane budget stops it there -- no fabric.
    const lanes = [lane('arm-000', new Point(0, -10), new Point(0, -35))];
    const out = grow(lanes, green, 12, 8, new SeededRandom(1));
    expect(out.length).toBeLessThanOrEqual(3);
  });

  it('fills a real disc with streets', () => {
    const lanes = [lane('arm-000', new Point(0, -10), new Point(0, -110))];
    const out = grow(lanes, green, 12, 120, new SeededRandom(1));
    expect(out.length).toBeGreaterThan(1);
  });

  it('spends no more lane than the disc\'s own budget', () => {
    // The whole point of area-first sizing: the disc is tiled at ONE
    // density, so a bigger village is a bigger disc, never a finer mesh of
    // the same ground. Measured over the whole fabric, which is why the
    // allowance below is generous -- the last lane may straddle the rim,
    // and the FMG arm is drawn to the map edge whatever growth does.
    const arm = lane('arm-000', new Point(0, -10), new Point(0, -400));
    const targetR = 120;
    const out = grow([arm], green, 12, targetR, new SeededRandom(5));
    const inventedLength = out
      .filter((l) => l.id !== 'arm-000')
      .reduce((sum, l) => sum + polylineLength(l.points), 0);
    expect(inventedLength).toBeLessThan(laneBudgetFor(targetR) * 1.5);
  });

  it('never saturates past the disc it was given', () => {
    const out = saturateDisc(
      [lane('arm-000', new Point(0, -10), new Point(0, -400))],
      green, 12, 90, new SeededRandom(2),
    );
    expect(out.radiusM).toBeLessThanOrEqual(90);
  });

  it('keeps every invented lane in the village band: local, trail or footpath', () => {
    // Owner ruling (2026-08-21): royal/main/market/town are INTER-SETTLEMENT
    // classes — market lanes connect market towns, they are not suburban
    // routes. A branch off a `main` road is a `local` street, never `market`.
    const lanes = [lane('arm-000', new Point(0, -10), new Point(0, -60))];
    const out = grow(lanes, green, 12, 120, new SeededRandom(3));
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
      [lane('arm-000', new Point(0, -10), new Point(0, -60))], green, 12, 120,
      new SeededRandom(11),
    );
    expect(JSON.stringify(mk())).toBe(JSON.stringify(mk()));
  });

  it('gives green-attached invented lanes their own id space, distinct from arms (R10)', () => {
    const lanes = [lane('arm-000', new Point(0, -10), new Point(0, -60))];
    const out = grow(lanes, green, 12, 120, new SeededRandom(3));
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

  it('never collides branch-lane ids, even in a disc big enough to exhaust the green', () => {
    // A disc this large forces every iteration up to MAX_INVENTED_LANES:
    // the green's ~10 free-bearing slots fill fast (35deg separation), so
    // most of the run takes the branch path on a shrinking set of parents --
    // exactly where `branchLaneId`'s ~35 percentage buckets can collide if
    // the fallback probing is missing.
    for (const seed of [2, 5, 7, 13, 21, 42]) {
      const lanes = [lane('arm-000', new Point(0, -10), new Point(0, -60))];
      const out = grow(lanes, green, 12, 600, new SeededRandom(seed));
      const ids = out.map((l) => l.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});
