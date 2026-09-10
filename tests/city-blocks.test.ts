import { describe, expect, it } from 'vitest';
import { generateSettlement, buildScene, Point, Polygon } from '../src/index.js';
import { planCityBlock, coalesceCityRuns } from '../src/generator/city-blocks.js';
import { blocksAccess, nearestOnSegment, overlapsWater } from '../src/generator/city-frontage.js';
import type { WardLane } from '../src/wards/ward.js';

const polygon = (xy: number[][]) => new Polygon(xy.map(([x, y]) => new Point(x, y)));
function input(population: number) {
  return { name: 'City blocks', population, biome: 'temperate', walls: true, plaza: true,
    temple: true, port: false, citadel: false, shanty: false, capital: false };
}

describe('street-led city blocks', () => {
  it.each([
    [[0, 0], [40, 0], [40, 32], [0, 32]],
    [[0, 0], [31, -3], [42, 20], [21, 35], [-3, 24]],
  ])('keeps lots contained, disjoint and accessible, with connected service lanes', (...vertices) => {
    const site = polygon(vertices);
    const streets: Array<WardLane & { kind: 'street' }> = [];
    site.forEdge((a, b) => streets.push({ a, b, width: 0.6, kind: 'street' }));
    const plan = planCityBlock(site, streets, 8, 0.36)!;
    expect(plan.buildings.length).toBeGreaterThan(50);
    expect(plan.runs.some(run => run.length >= 3)).toBe(true);
    expect(plan.lanes.length).toBeGreaterThan(1);
    const reached: WardLane[] = [...streets];
    for (const lane of plan.lanes) {
      expect([lane.a, lane.b].some(p => reached.some(line => Point.distance(p, nearestOnSegment(p, line.a, line.b)) < 1e-7))).toBe(true);
      reached.push(lane);
    }
    for (const building of plan.buildings) {
      for (const p of building.vertices) site.forEdge((a, b) => {
        expect(Math.sign(site.square) * ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x))).toBeGreaterThanOrEqual(-1e-7);
      });
      const f = plan.frontages.get(building)!;
      for (const other of plan.buildings) if (other !== building) {
        expect(blocksAccess(building.centroid, f.at, other)).toBe(false);
        // Positive intersection area via separating axes, allowing touching edges.
        let separated = false;
        for (const p of [building, other]) p.forEdge((a, b) => {
          const nx = a.y - b.y, ny = b.x - a.x;
          const project = (poly: Polygon) => poly.vertices.map(v => nx * v.x + ny * v.y);
          const x = project(building), y = project(other);
          if (Math.max(...x) <= Math.min(...y) + 1e-8 || Math.max(...y) <= Math.min(...x) + 1e-8) separated = true;
        });
        expect(separated).toBe(true);
      }
      for (const lane of plan.lanes) expect(blocksAccess(lane.a, lane.b, building)).toBe(false);
    }
    expect(planCityBlock(site, streets, 8, 0.36)).toEqual(plan);
  });

  it('does not claim street access on an enclosed site with no street', () => {
    const plan = planCityBlock(polygon([[0, 0], [40, 0], [40, 30], [0, 30]]), [], 8, 0.36)!;
    expect(plan.buildings).toHaveLength(0);
    expect(plan.lanes).toHaveLength(0);
  });

  it('meets a lower quota by joining neighbouring houses without hollowing the block', () => {
    const site = polygon([[0, 0], [40, 0], [40, 32], [0, 32]]);
    const streets: Array<WardLane & { kind: 'street' }> = [];
    site.forEdge((a, b) => streets.push({ a, b, width: 0.6, kind: 'street' }));
    const plan = planCityBlock(site, streets, 8, 0.36)!;
    const target = plan.buildings.length - 12;
    const area = plan.buildings.reduce((n, b) => n + Math.abs(b.square), 0);
    coalesceCityRuns(plan, target);
    expect(plan.buildings).toHaveLength(target);
    expect(plan.frontages.size).toBe(target);
    expect(plan.buildings.reduce((n, b) => n + Math.abs(b.square), 0)).toBeGreaterThanOrEqual(area);
    for (const building of plan.buildings) {
      const f = plan.frontages.get(building)!;
      for (const other of plan.buildings) if (other !== building) expect(blocksAccess(building.centroid, f.at, other)).toBe(false);
      for (const lane of plan.lanes) expect(blocksAccess(lane.a, lane.b, building)).toBe(false);
    }
  });

  it('checks the whole footprint against narrow water, enclosed ponds and islands', () => {
    const lot = polygon([[0, 0], [10, 0], [10, 10], [0, 10]]);
    const water = polygon([[4.9, -1], [5.1, -1], [5.1, 11], [4.9, 11]]).vertices;
    expect(overlapsWater(lot, [water])).toBe(true);
    expect(overlapsWater(lot, [polygon([[4, 4], [6, 4], [6, 6], [4, 6]]).vertices])).toBe(true);
    const sea = polygon([[-20, -20], [20, -20], [20, 20], [-20, 20]]).vertices;
    const island = polygon([[-2, -2], [12, -2], [12, 12], [-2, 12]]).vertices;
    expect(overlapsWater(lot, [sea, island])).toBe(false);
  });

  it.each([2, 102])('reports actual capacity and keeps contiguous runs at seed %i', seed => {
    const r = generateSettlement(input(10000), { seed });
    if (r.kind !== 'settlement') throw new Error('expected city');
    const capacity = r.model.getBuildingCapacity();
    expect(capacity.placed).toBe(r.model.countOrdinaryBuildingsPublic());
    expect(capacity.placed).toBeGreaterThanOrEqual(capacity.target * 0.95);
    expect(capacity.shortfall).toBe(capacity.target - capacity.placed);
    expect(capacity.corePlaced + capacity.outerPlaced).toBe(capacity.placed);
    expect(buildScene(r.model).buildingCapacity).toEqual(capacity);
    expect((r.geojson as any).metadata.building_capacity).toEqual(capacity);
    for (const patch of r.model.patches) if (patch.ward) for (const run of patch.ward.streetRuns) {
      // A well may reserve one interior house; all remaining budget deletions
      // must be a suffix of the run, rather than holes across its street front.
      const alive = run.map(b => patch.ward!.geometry.includes(b));
      const last = alive.lastIndexOf(true);
      const internalGaps = alive.slice(0, last).filter(a => !a).length;
      expect(internalGaps).toBeLessThanOrEqual(1);
    }
  });

  it('improves metropolis capacity without packing the excess inside the capped core', () => {
    const r = generateSettlement({ ...input(250000), roadBearings: [
      { bearing_deg: 18, kind: 'main', route_id: 'a' },
      { bearing_deg: 142, kind: 'town', route_id: 'b' },
      { bearing_deg: 267, kind: 'local', route_id: 'c' },
    ] }, { seed: 2 });
    if (r.kind !== 'settlement') throw new Error('expected city');
    const c = r.model.getBuildingCapacity();
    expect(c.placed).toBeGreaterThan(c.target * 0.85);
    expect(c.corePlaced).toBeLessThan(1200);
    expect(c.outerPlaced).toBeGreaterThan(15000);
    expect(c.placed).toBeLessThanOrEqual(c.target);
    expect(c.status).toBe(c.shortfall ? 'shortfall' : 'met');
  });

  it('reports the shortfall when absent approach routes constrain outer-city supply', () => {
    const r = generateSettlement({ ...input(250000), roadBearings: [] }, { seed: 2 });
    if (r.kind !== 'settlement') throw new Error('expected city');
    const c = r.model.getBuildingCapacity();
    expect(c.status).toBe('shortfall');
    expect(c.shortfall).toBe(c.target - r.model.countOrdinaryBuildingsPublic());
    expect(c.corePlaced).toBeLessThan(1200);
  });
});
