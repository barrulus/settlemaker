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
    const wet = m.lanes.flatMap((l) => l.points).filter((p) => inPoly(p, ring));
    expect(wet, 'a road is in the water').toHaveLength(0);

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
