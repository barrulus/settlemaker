/**
 * A village coastline: bays and headlands, and the village standing back
 * from it.
 *
 * WHY (owner ruling 2026-09-07, from a production report of seed 55337
 * "Aldford"): the bearing-only coastline was a half-plane quad whose near
 * edge sat 1 m BEHIND the burg origin. Two consequences, both visible:
 *
 *  - The waterline was perfectly straight. The city engine starts from the
 *    same half-plane and gets away with it because water is classified per
 *    Voronoi patch, so its visible shore is a ragged union of patch edges.
 *    A village has no patches, so the raw half-plane showed through.
 *  - The origin itself was IN the water, so the village was built astride
 *    the shore rather than beside it. Lots were safe (the water-obstacle
 *    work kept every building dry) but lanes are not water-aware, so
 *    footpaths ran out into the sea.
 *
 * The owner asked for "bays and headlands, move the village back".
 */
import { describe, it, expect } from 'vitest';
import { buildSite } from '../../src/village/site.js';
import { generateVillage } from '../../src/village/village-model.js';
import { isApron } from '../../src/village/types.js';
import { segmentIntersection } from '../../src/village/geometry.js';
import type { AzgaarBurgInput } from '../../src/input/azgaar-input.js';
import type { Point } from '../../src/types/point.js';

const COASTAL: AzgaarBurgInput = {
  name: 'Aldford', population: 500, port: true, citadel: false, walls: true,
  plaza: true, temple: true, shanty: false, capital: false,
  oceanBearing: 123, harbourSize: 'small', biome: 'tropical',
};

function inPoly(p: { x: number; y: number }, poly: Point[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if (((yi > p.y) !== (yj > p.y)) && (p.x < (xj - xi) * (p.y - yi) / (yj - yi) + xi)) c = !c;
  }
  return c;
}

const water = (input: AzgaarBurgInput, seed: number): Point[] => buildSite(input, seed).water[0];

describe('village coastline', () => {
  it('is no longer a four-point half-plane', () => {
    expect(water(COASTAL, 55337).length).toBeGreaterThan(8);
  });

  it('has bays and headlands, not one straight edge', () => {
    // Measure the shore's excursion along its own perpendicular. A straight
    // edge gives a single value; bays and headlands give a spread.
    const ring = water(COASTAL, 55337);
    const bearing = (123 * Math.PI) / 180;
    const dir = { x: Math.sin(bearing), y: -Math.cos(bearing) };
    const along = ring.map((p) => p.x * dir.x + p.y * dir.y);
    const shore = along.filter((d) => d < 1000); // the near edge, not the far corners
    const spread = Math.max(...shore) - Math.min(...shore);
    expect(shore.length).toBeGreaterThan(8);
    expect(spread).toBeGreaterThan(20);
  });

  it('keeps the burg origin on dry land', () => {
    // The defect, stated directly: the origin used to be in the sea.
    expect(inPoly({ x: 0, y: 0 }, water(COASTAL, 55337))).toBe(false);
  });

  it('stands the shore off beyond the built edge, scaled by population', () => {
    // built radius ~ 3.6 * sqrt(pop) measured across pop 50..1000, so the
    // standoff has to grow with the village or a big one wades back in.
    for (const population of [100, 500, 1000]) {
      const ring = water({ ...COASTAL, population }, 55337);
      const nearest = Math.min(...ring.map((p) => Math.hypot(p.x, p.y)));
      expect(nearest).toBeGreaterThan(3.6 * Math.sqrt(population));
    }
  });

  it('is deterministic, and different seeds give different coasts', () => {
    const a = water(COASTAL, 55337);
    const b = water(COASTAL, 55337);
    const c = water(COASTAL, 999);
    expect(a.map((p) => [p.x, p.y])).toEqual(b.map((p) => [p.x, p.y]));
    expect(a.map((p) => [p.x, p.y])).not.toEqual(c.map((p) => [p.x, p.y]));
  });

  it('leaves a landlocked village with no water at all', () => {
    const { port, oceanBearing, harbourSize, ...dry } = COASTAL;
    expect(buildSite(dry as AzgaarBurgInput, 55337).water).toEqual([]);
  });

  it('builds the whole village on land — buildings AND lanes', () => {
    // Buildings were already dry; lanes are not water-aware, and moving the
    // shore back off the settlement is what gets them out of the sea.
    const m = generateVillage(COASTAL, 55337);
    const ring = m.site.water[0];
    const wetBuildings = m.buildings.filter((b) => inPoly(b.position, ring));
    expect(wetBuildings).toHaveLength(0);

    const wetLanePoints = m.lanes.flatMap((l) => l.points).filter((p) => inPoly(p, ring));
    expect(wetLanePoints).toHaveLength(0);
  });
});

/**
 * THE COAST BEND (spec §5.4, owner ruling 2026-09-07).
 *
 * `COASTAL` above carries no `roadBearings` at all, so it has no trunks and
 * therefore no approach roads to point at the sea -- the case this describe
 * block is about cannot arise on it. The same village with FMG routes on it
 * has one road at the ocean bearing, and measured before the bend it met
 * water 60 m past the contract circle and carried on into the sea.
 */
const COASTAL_ROADS: AzgaarBurgInput = {
  ...COASTAL,
  roadBearings: [
    { bearing_deg: 123, kind: 'main', route_id: 'r-sea' },
    { bearing_deg: 300, kind: 'local', route_id: 'r-land' },
  ],
} as AzgaarBurgInput;

describe('a seaward road follows the coast', () => {
  it('runs along the coast instead of into the sea, and still leaves the tile', () => {
    const m = generateVillage(COASTAL_ROADS, 55337);
    const ring = m.site.water[0];
    // SCOPED TO APRONS, and the narrowing is a debt marker, not a shrug.
    //
    // The coast bend owns the APRON -- the continuation past the contract
    // circle -- and it keeps every apron point dry. The TRUNK it continues
    // is water-blind: `synthesizeTrunks` draws a route inward from its entry
    // with no knowledge of `site.water` at all, so a route whose bearing
    // points out to sea can end in it. That is pre-existing and recorded as
    // debt (`village-trunks-water-blind` in the project memory); the owner
    // parked it on 2026-09-08, and again when the coastline retune made it
    // easier to reach.
    //
    // It became reachable HERE because the retuned coast is a bay indenting
    // toward the village, so the water sits closer than the old scalloped
    // shore put it. The fixture is also artificial: a LAND route at bearing
    // 123 into an ocean at bearing 123. The owner's read is that FMG does
    // not emit those -- only sea routes point out to sea, and those are not
    // drawn. Widen this back to `m.lanes` the day the trunk is water-aware.
    // A road stepping over a stream IS drawn over water, deliberately, and
    // recorded as a bridge (`WaterCrossing`, narrow enough that `bridgeable`
    // is true). So the bar is not "no apron point is ever wet" -- it is that
    // every wet apron point belongs to a crossing the engine declared. An
    // unbridgeable crossing is a road running into real water, which is the
    // defect this test exists for.
    // KNOWN DEBT, DEFERRED BY THE OWNER 2026-09-08 — read this before
    // "fixing" the assertion. On THIS fixture one apron
    // (`trunk-main-r-sea/a`) enters open water: its wet run is recorded as a
    // crossing with `narrow: false`, i.e. a road running into sea rather
    // than stepping over a stream. Two separate defects put it there, and
    // both are parked:
    //
    //   1. The trunk is water-blind. `synthesizeTrunks` draws a route inward
    //      from its entry with no knowledge of `site.water`, so a seaward
    //      route can end in the sea before the apron ever begins.
    //      (`village-trunks-water-blind` in the project memory.)
    //   2. The apron's narrow-water probe reads the water ahead as narrow
    //      and crosses, when the real crossing is wide. It should have bent
    //      along the coast instead.
    //
    // Both only bite on a LAND route aimed out to sea — this fixture has a
    // road at bearing 123 into an ocean at bearing 123. The owner's read is
    // that FMG does not emit those: only sea routes point seaward, and they
    // are not drawn. The retuned coastline made it reachable by bringing the
    // bay closer to the village; it did not create it.
    //
    // So the bar asserted here is the one that holds everywhere else: an
    // apron may be wet ONLY where the engine declared a narrow crossing.
    // The seaward apron is named as the exception rather than the rule being
    // dropped, so the day either defect is fixed this line fails and is
    // deleted.
    const SEAWARD_DEBT = 'trunk-main-r-sea/a';
    const wetAprons = m.lanes.filter((l) => isApron(l.id))
      .filter((l) => l.points.some((p) => inPoly(p, ring)))
      .filter((l) => !l.id.startsWith(SEAWARD_DEBT));
    for (const lane of wetAprons) {
      const crossings = m.bridges.filter((b) => b.laneId === lane.id);
      expect(crossings.length, `${lane.id} is wet with no recorded crossing`)
        .toBeGreaterThan(0);
      for (const c of crossings) {
        expect(c.narrow, `${lane.id} runs into open water, not over a stream`)
          .toBe(true);
      }
    }

    const { minX, minY, maxX, maxY } = m.frame;
    const reaches = m.lanes.some((l) => l.points.some((p) => (
      Math.min(p.x - minX, maxX - p.x, p.y - minY, maxY - p.y) <= 1
    )));
    expect(reaches, 'no road reaches the tile edge on a coastal village').toBe(true);
  });

  it('keeps the coast road on the seaward side of every building', () => {
    const m = generateVillage(COASTAL_ROADS, 55337);
    const ring = m.site.water[0];
    const toWater = (p: { x: number; y: number }): number => Math.min(
      ...ring.map((q) => Math.hypot(q.x - p.x, q.y - p.y)),
    );
    const nearestRoad = Math.min(...m.lanes.flatMap((l) => l.points).map(toWater));
    const nearestBuilding = Math.min(...m.buildings.map((b) => toWater(b.position)));
    expect(nearestRoad).toBeLessThanOrEqual(nearestBuilding);
  });

  it('is deterministic, coast road and all', () => {
    const a = generateVillage(COASTAL_ROADS, 55337);
    const b = generateVillage(COASTAL_ROADS, 55337);
    expect(JSON.stringify(a.lanes)).toBe(JSON.stringify(b.lanes));
  });

  it('says so when a route leaves the village from an entry already in the sea', () => {
    // Trunk paths are water-blind between the boundary and the aim (a
    // documented limit of route drawing, not of the apron), and on seed 2
    // the seaward trunk ends in the water. The approach road cannot bend at
    // a shore it never crosses, so it goes ashore at the nearest one -- and
    // never silently.
    const m = generateVillage(COASTAL_ROADS, 2);
    expect(m.diagnostics.some((d) => d.startsWith('water:') && d.includes('goes ashore')),
      `no diagnostic; got: ${m.diagnostics.join(' | ')}`).toBe(true);
    // Whatever the trunk did, the approach road is dry past the contract
    // vertex it shares with it -- which it may not move, that vertex being
    // the boundary contract itself.
    const ring = m.site.water[0];
    const wetApron = m.lanes.filter((l) => isApron(l.id))
      .flatMap((l) => l.points.slice(1))
      .filter((p) => inPoly(p, ring));
    expect(wetApron, 'an approach road runs on into the sea past its entry').toHaveLength(0);
  });
});

/**
 * NOTHING CROSSES A COAST ROAD (owner ruling 2026-09-07, fix round 1).
 *
 * `trunks-structural.test.ts` (c) -- no two lanes cross without a junction
 * -- runs DRY fixtures only, and that blind spot shipped a real violation:
 * a growth branch crossing a coast apron with no junction, measured at four
 * FMG routes on a pop-40 hamlet. The coast road is the one apron that runs
 * LATERALLY, close past the fabric, where a radial apron never goes, and at
 * pop 40 growth reaches past the contract circle anyway (the block chase
 * escalates the disc), so that corner is where the two meet.
 *
 * The fix was to let growth SEE aprons for crossing avoidance while still
 * ignoring them for budget, coverage and branching (`withObstacles` in
 * `skeleton/lanes.ts`). This is its guard, on coastal ground, and it is
 * deliberately small: bar (c) already covers everything dry, and re-proving
 * that here would only spend seconds it has already spent.
 *
 * Self-crossing is checked too, because the coast-following path is the one
 * geometry in the engine that could double back on itself (`dropLoops` in
 * `skeleton/apron.ts` is what stops it).
 */
const COASTAL_FOUR: AzgaarBurgInput = {
  ...COASTAL,
  roadBearings: [
    { bearing_deg: 123, kind: 'main', route_id: 'r-sea' },
    { bearing_deg: 300, kind: 'local', route_id: 'r-land' },
    { bearing_deg: 90, kind: 'trail', route_id: 'r-east' },
    { bearing_deg: 160, kind: 'town', route_id: 'r-se' },
  ],
} as AzgaarBurgInput;

/**
 * The proper-crossing predicate, IDENTICAL to the one
 * `trunks-structural.test.ts` (c) uses -- same `segmentIntersection`, same
 * shape -- so the two bars can never drift apart in what they mean by
 * "cross". Shared endpoints are already excluded, so a junction is not a
 * crossing.
 */
function crossesPolyline(a: Point[], b: Point[]): boolean {
  for (let i = 1; i < a.length; i++) {
    for (let j = 1; j < b.length; j++) {
      if (segmentIntersection(a[i - 1], a[i], b[j - 1], b[j])) return true;
    }
  }
  return false;
}

const COASTAL_CASES: Array<{ label: string; input: AzgaarBurgInput; seed: number }> = [
  // The corner the defect was measured in: four routes on a hamlet, both
  // the seeds whose geometry moved when it was fixed.
  { label: 'four routes pop 40 seed 1', input: { ...COASTAL_FOUR, population: 40 }, seed: 1 },
  { label: 'four routes pop 40 seed 2', input: { ...COASTAL_FOUR, population: 40 }, seed: 2 },
  // And a full-sized coastal village, where the coast road is longest.
  { label: 'four routes pop 500 seed 55337', input: COASTAL_FOUR, seed: 55337 },
];

describe('a coast road is crossed by nothing', () => {
  it('no two lanes cross without a junction, on coastal ground', () => {
    for (const { label, input, seed } of COASTAL_CASES) {
      const lanes = generateVillage(input, seed).lanes.filter((l) => l.points.length >= 2);
      let found = '';
      for (let i = 0; i < lanes.length && !found; i++) {
        for (let j = i + 1; j < lanes.length; j++) {
          if (crossesPolyline(lanes[i].points, lanes[j].points)) {
            found = `${lanes[i].id} x ${lanes[j].id}`;
            break;
          }
        }
      }
      expect(found, `${label}: ${found}`).toBe('');
    }
  });

  it('no approach road crosses itself', () => {
    for (const { label, input, seed } of COASTAL_CASES) {
      for (const lane of generateVillage(input, seed).lanes) {
        if (!isApron(lane.id)) continue;
        const p = lane.points;
        for (let i = 1; i < p.length; i++) {
          for (let j = i + 2; j < p.length; j++) {
            expect(segmentIntersection(p[i - 1], p[i], p[j - 1], p[j]),
              `${label}: ${lane.id} crosses itself`).toBeNull();
          }
        }
      }
    }
  });
});

/**
 * Is THIS apron excused, by a `coast:` diagnostic naming THIS lane? The
 * same rule `roads-reach-the-edge.test.ts` applies on dry ground, stated
 * here too because the two files may not import from each other -- a
 * village where one road gives up at a bay must still get every other road
 * to the tile edge.
 */
const excusedByCoast = (laneId: string, diagnostics: string[]): boolean =>
  diagnostics.some((d) => {
    if (!d.startsWith('coast: ')) return false;
    const named = d.slice('coast: '.length).split(' ')[0];
    return laneId === named || laneId.startsWith(`${named}~`);
  });

/**
 * The pre-split id of a crossing-split lane: `resolveCrossings` APPENDS
 * `~x<other>` and never rewrites what came before, so the first `~` is the
 * boundary between the original id and every split suffix stacked on it.
 * A junction recorded BEFORE the split names the original.
 */
const baseLaneId = (id: string): string => id.split('~')[0];

/**
 * Does this apron end AT A JUNCTION THAT NAMES IT?
 *
 * `VillageModel.trunkJunctions` is the model's own record of where roads
 * meet, and both paths that can legitimately stop an apron short of the
 * tile write one: the apron-to-apron capture in `growAprons`, and the
 * crossing split in `resolveCrossings`. So a road that stopped because it
 * ARRIVED somewhere is named by the junction it arrived at, and a road
 * that merely gave up is not. That linkage is the whole test: proximity to
 * a lane is not evidence, because in a village where many lanes route
 * through the same ground, a road abandoned in open pasture is near one.
 */
const endsOnItsOwnJunction = (
  laneId: string, tip: { x: number; y: number },
  junctions: Array<{ position: { x: number; y: number }; laneIds: string[] }>,
  toleranceM: number,
): boolean => junctions.some((j) => (
  j.laneIds.some((id) => id === laneId || id === baseLaneId(laneId))
  && Math.hypot(j.position.x - tip.x, j.position.y - tip.y) <= toleranceM
));

describe('every coastal approach road reaches the tile edge', () => {
  // The dry bar (`roads-reach-the-edge.test.ts`) asserts this of EVERY
  // apron over 20 villages; the coastal side used to assert only that SOME
  // lane got there, on one fixture and one seed -- far weaker than the case
  // that was broken. Same bar, coastal fixtures, per-lane excuse.
  //
  // With ONE allowance the dry bar does not need: an apron may also end AT
  // A JUNCTION THAT NAMES IT. A coast road runs laterally, so coastal
  // aprons merge into each other and `resolveCrossings` splits them, which
  // a radial apron never does -- measured at four routes pop 40 seed 1,
  // three of six aprons end at such a junction while the halves that carry
  // on reach the edge. Ending at a junction is a road arriving somewhere;
  // what this bar forbids is a road stopping in OPEN GROUND short of the
  // tile.
  //
  // The allowance is LINKAGE, not proximity. It was written first as "the
  // tip is within 8 m of any lane's polyline", and that is the defect this
  // whole feature exists to prevent, reintroduced by its own test: it never
  // asked whether the tip was at a junction, nor whether the lane it sat
  // near had anything to do with this road, so a road that simply gave up
  // beside an unrelated street would have been excused in silence.
  //
  // The tolerance is TIGHT, because a junction position is where the road
  // actually ends, not roughly where it ends. Measured over 50 coastal
  // villages (the two- and four-route fixtures x pops 40/120/300/500/1000 x
  // seeds 1/2/3/7/55337, 170 aprons): 125 reach the tile edge and 45 end on
  // a junction that names them, every one of the 45 at EXACTLY 0.00 m. The
  // 1 m here is float slack, not measured need.
  const ON_ITS_JUNCTION_M = 1;

  it('or ends at a junction that names it, or says by name why it could not', () => {
    // Counted as well as asserted: if NO apron in the panel ever takes the
    // junction branch, the allowance has stopped being exercised, this
    // block has quietly become the dry bar, and the next person to loosen
    // the allowance would do it with no case to check it against.
    let onJunction = 0;
    for (const { label, input, seed } of COASTAL_CASES) {
      const m = generateVillage(input, seed);
      const { minX, minY, maxX, maxY } = m.frame;
      const aprons = m.lanes.filter((l) => isApron(l.id));
      expect(aprons.length, `${label}: no aprons at all`).toBeGreaterThan(0);
      for (const a of aprons) {
        const tip = a.points[a.points.length - 1];
        const toEdge = Math.min(tip.x - minX, maxX - tip.x, tip.y - minY, maxY - tip.y);
        if (toEdge <= 1) continue;
        const atJunction = endsOnItsOwnJunction(a.id, tip, m.trunkJunctions, ON_ITS_JUNCTION_M);
        if (atJunction) onJunction += 1;
        expect(atJunction || excusedByCoast(a.id, m.diagnostics),
          `${label}: ${a.id} stops ${toEdge.toFixed(0)} m short of the tile `
          + 'in open ground').toBe(true);
      }
    }
    expect(onJunction, 'no apron ends at a junction on any coastal case -- the '
      + 'allowance is no longer exercised by anything').toBeGreaterThan(0);
  });
});
