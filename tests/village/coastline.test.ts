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
