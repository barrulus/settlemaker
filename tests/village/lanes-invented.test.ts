import { describe, it, expect } from 'vitest';
import { Point } from '../../src/types/point.js';
import { SeededRandom } from '../../src/utils/random.js';
import {
  availableFrontage, discRadiusFor, laneBudgetFor, laneLengthNeededM, polylineLength,
  saturateDisc,
} from '../../src/village/skeleton/lanes.js';
// GATE 8: growth takes a RADIUS PROFILE, not a radius. These tests are
// about saturation, not shape, so they hand it the profile that IS the disc
// they used to pass -- `circularProfile`. The anisotropy the profile exists
// for has its own tests in `profile.test.ts` and `village-model.test.ts`.
import { buildRadiusProfile, circularProfile } from '../../src/village/skeleton/profile.js';
import { isTrunk } from '../../src/village/skeleton/trunks.js';
import {
  DISC_MARGIN, LANE_SEATING_YIELD, LANE_TILE_SPACING_M,
} from '../../src/village/constants.js';
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
    // 60 dwellings x 14 m = 840 m of frontage = 420 m of lane (both sides).
    // GATE 6.10: that is the lane the houses STAND on, not the lane a
    // village has to lay — only LANE_SEATING_YIELD of what it cuts is ever
    // seated — so the road needed is that over the yield, tiled at
    // LANE_TILE_SPACING_M.
    const needed = 420 / LANE_SEATING_YIELD;
    expect(laneLengthNeededM(60, 14)).toBeCloseTo(needed, 5);
    const expected = Math.sqrt((needed * LANE_TILE_SPACING_M) / Math.PI) * DISC_MARGIN;
    expect(discRadiusFor(60, 14)).toBeCloseTo(expected, 5);
  });

  it('sizes the radius by the ratio of the two measured terms', () => {
    // The radius depends on LANE_TILE_SPACING_M / LANE_SEATING_YIELD and on
    // nothing else the split introduced; the BUDGET depends on the spacing
    // alone. That is what makes them two calibrations rather than one, and
    // it is the property to hold on to when either is re-measured: gate 6.9
    // had this ratio at 26 (spacing 26, yield implicitly 1.0), and gate 6.10
    // measures it at 29 against a fabric that now contains arcs.
    const ratio = LANE_TILE_SPACING_M / LANE_SEATING_YIELD;
    expect(discRadiusFor(60, 14))
      .toBeCloseTo(Math.sqrt((420 * ratio) / Math.PI) * DISC_MARGIN, 5);
    expect(ratio).toBeGreaterThan(20);
    expect(ratio).toBeLessThan(40);
  });

  it('grows the disc as the square root of the house count', () => {
    // Four times the houses, twice the radius: area-first, by construction.
    expect(discRadiusFor(240, 14) / discRadiusFor(60, 14)).toBeCloseTo(2, 5);
  });

  it('reads the lane the CENSUS needs back out of the radius', () => {
    // GATE 6.10, and this is the premise gate 6.9 had wrong. The round-trip
    // used to land on 420 m — the frontage the houses stand on — so growth
    // bought half the road the census needs, stopped early, and the
    // escalation ladder widened the disc purely to buy budget (+42% at pop
    // 300, +48% at pop 900: the disc was a cap in name only). The budget a
    // disc affords is now the lane its census actually has to lay.
    expect(laneBudgetFor(discRadiusFor(60, 14)))
      .toBeCloseTo(laneLengthNeededM(60, 14), 5);
    expect(laneBudgetFor(discRadiusFor(60, 14)))
      .toBeCloseTo(420 / LANE_SEATING_YIELD, 5);
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
    const lanes = [lane('trunk-main-000', new Point(0, -10), new Point(0, -35))];
    const out = grow(lanes, green, 12, circularProfile(8), new SeededRandom(1));
    expect(out.length).toBeLessThanOrEqual(3);
  });

  it('fills a real disc with streets', () => {
    const lanes = [lane('trunk-main-000', new Point(0, -10), new Point(0, -110))];
    const out = grow(lanes, green, 12, circularProfile(120), new SeededRandom(1));
    expect(out.length).toBeGreaterThan(1);
  });

  it('spends no more lane than the disc\'s own budget', () => {
    // The whole point of area-first sizing: the disc is tiled at ONE
    // density, so a bigger village is a bigger disc, never a finer mesh of
    // the same ground. Measured over the whole fabric, which is why the
    // allowance below is generous -- the last lane may straddle the rim,
    // and the FMG arm is drawn to the map edge whatever growth does.
    const arm = lane('trunk-main-000', new Point(0, -10), new Point(0, -400));
    const targetR = 120;
    const out = grow([arm], green, 12, circularProfile(targetR), new SeededRandom(5));
    const inventedLength = out
      .filter((l) => l.id !== 'trunk-main-000')
      .reduce((sum, l) => sum + polylineLength(l.points), 0);
    expect(inventedLength).toBeLessThan(laneBudgetFor(targetR) * 1.5);
  });

  it('never saturates past the disc it was given', () => {
    const out = saturateDisc(
      [lane('trunk-main-000', new Point(0, -10), new Point(0, -400))],
      green, 12, circularProfile(90), new SeededRandom(2),
    );
    expect(out.radiusM).toBeLessThanOrEqual(90);
  });

  it('keeps every invented lane in the village band: local, trail or footpath', () => {
    // Owner ruling (2026-08-21): royal/main/market/town are INTER-SETTLEMENT
    // classes — market lanes connect market towns, they are not suburban
    // routes. A branch off a `main` road is a `local` street, never `market`.
    const lanes = [lane('trunk-main-000', new Point(0, -10), new Point(0, -60))];
    const out = grow(lanes, green, 12, circularProfile(120), new SeededRandom(3));
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
      [lane('trunk-main-000', new Point(0, -10), new Point(0, -60))], green, 12,
      circularProfile(120), new SeededRandom(11),
    );
    expect(JSON.stringify(mk())).toBe(JSON.stringify(mk()));
  });

  it('gives green-attached invented lanes their own id space, distinct from trunks (R10)', () => {
    const lanes = [lane('trunk-main-000', new Point(0, -10), new Point(0, -60))];
    const out = grow(lanes, green, 12, circularProfile(120), new SeededRandom(3));
    const invented = out.filter((l) => !lanes.some((orig) => orig.id === l.id));
    const greenAttached = invented.filter((l) => l.parentId === undefined);
    expect(greenAttached.length).toBeGreaterThan(0);
    for (const l of greenAttached) {
      expect(l.id.startsWith('lane-')).toBe(true);
    }
    // No invented id may alias a trunk id, in either direction.
    const trunkIds = out.filter((l) => isTrunk(l.id)).map((l) => l.id);
    const inventedIds = greenAttached.map((l) => l.id);
    expect(inventedIds.every((id) => !trunkIds.includes(id))).toBe(true);
  });

  it('never collides branch-lane ids, even in a disc big enough to exhaust the green', () => {
    // A disc this large forces every iteration up to MAX_INVENTED_LANES:
    // the green's ~10 free-bearing slots fill fast (35deg separation), so
    // most of the run takes the branch path on a shrinking set of parents --
    // exactly where `branchLaneId`'s ~35 percentage buckets can collide if
    // the fallback probing is missing.
    for (const seed of [2, 5, 7, 13, 21, 42]) {
      const lanes = [lane('trunk-main-000', new Point(0, -10), new Point(0, -60))];
      const out = grow(lanes, green, 12, circularProfile(600), new SeededRandom(seed));
      const ids = out.map((l) => l.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('does not starve invented growth when many trunk lanes already crowd the budget', () => {
    // Task 1's diagnosis: `laneLengthWithin` summed every FMG arm into the
    // SAME budget `saturateDisc`'s growth loop spends against, so a village
    // with several incoming routes starved growth before it invented a
    // single street. Reproduces `hub` (Task 1 report, pop 300: 5 routes at
    // its exact bearings 12/78/155/231/304deg, 6 arm-lanes incl. one
    // through-echo, arms alone at 115% of the round-0 budget) at the same
    // round-0 radius (~52 m), against one trunk at the bearing set's first
    // member, same target disc and seed -- and compares how much INVENTED
    // (non-trunk) lane each grows. Before Task 1's fix: many-arm invented
    // was 0 m (the exact "zero blocks, starfish" symptom); one arm alone
    // got ~366 m.
    //
    // Trunks task 5 RED test (Step 2): re-pointed from `arm-*` fixture ids
    // to `trunk-*` ones. `isFmgArm` only ever recognised `arm-`, so this
    // failed red the moment `saturateDisc`'s budget filter (and this test)
    // moved to `isTrunk` while the fixtures still said `arm-` -- exactly
    // the regression the brief asked this test to catch: a lane whose id
    // the exemption no longer recognises gets double-counted against the
    // budget and CAN starve invented growth again.
    const targetR = 52;
    const trunkEnd = (bearingDeg: number, lengthM: number): Point => {
      const rad = (bearingDeg * Math.PI) / 180;
      const dir = { x: Math.sin(rad), y: -Math.cos(rad) };
      return new Point(dir.x * lengthM, dir.y * lengthM);
    };
    const trunkAt = (id: string, bearingDeg: number): Lane =>
      lane(id, trunkEnd(bearingDeg, 10), trunkEnd(bearingDeg, 400));
    const bearings = [12, 78, 155, 231, 304];

    const inventedLength = (out: Lane[], trunkIds: Set<string>) => out
      .filter((l) => !trunkIds.has(l.id))
      .reduce((sum, l) => sum + polylineLength(l.points), 0);

    const singleTrunks = [trunkAt('trunk-main-012', 12)];
    const singleOut = grow(singleTrunks, green, 12, circularProfile(targetR), new SeededRandom(9));
    const singleInvented = inventedLength(
      singleOut, new Set(singleTrunks.map((l) => l.id)),
    );

    const manyTrunks = bearings.map(
      (b) => trunkAt(`trunk-main-${String(Math.round(b)).padStart(3, '0')}`, b),
    );
    const manyOut = grow(manyTrunks, green, 12, circularProfile(targetR), new SeededRandom(9));
    const manyInvented = inventedLength(manyOut, new Set(manyTrunks.map((l) => l.id)));

    // Five trunks must not starve invented growth to nothing, nor to a
    // small fraction of what one trunk gets on the identical disc -- the
    // budget is meant to be spent on ground the census needs housed, not
    // eaten by however many routes FMG happened to draw. (Measured
    // post-fix: ~59% of the single-trunk figure -- some falloff is real,
    // since five trunks legitimately leave less clear ground than one; the
    // bar here is "not starved to zero", not parity.)
    expect(manyInvented).toBeGreaterThan(singleInvented * 0.4);
  });

  it('GATE 8: saturates the PROFILE, not a circle', () => {
    // The property the whole gate turns on: hand growth an elongated body
    // and the lanes come out elongated the same way. Measured as the extent
    // of the fabric along the profile's long axis against its short one --
    // the profile below is a pure cos(2 theta) ellipse-ish body at 0 deg,
    // so north-south is long and east-west is short.
    const profile = buildRadiusProfile({
      centre: green.centre,
      radiusM: 120,
      trunkBearingsDeg: [0, 180],
      water: [],
      rng: new SeededRandom(4),
    });
    const out = grow(
      [lane('trunk-main-000', new Point(0, -10), new Point(0, -110))], green, 12,
      profile, new SeededRandom(4),
    );
    let along = 0;
    let across = 0;
    for (const l of out.filter((x) => x.id !== 'trunk-main-000')) {
      for (const p of l.points) {
        along = Math.max(along, Math.abs(p.y - green.centre.y));
        across = Math.max(across, Math.abs(p.x - green.centre.x));
      }
    }
    expect(along / across).toBeGreaterThan(1.2);
  });
});
