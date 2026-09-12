import { describe, expect, it } from 'vitest';
import { Point } from '../../src/types/point.js';
import { buildSite } from '../../src/village/site.js';
import { generateVillage } from '../../src/village/village-model.js';
import { roadFixture, roadReviewFixtures } from '../fixtures/village-roads.js';
import { arcLengths, closestPointOnSegment, dist, sampleAt } from '../../src/village/geometry.js';
import { roadCrossSection } from '../../src/village/cross-section.js';
import { clearRiverbanks } from '../../src/village/skeleton/riverbanks.js';
import { growApronPath } from '../../src/village/skeleton/apron.js';
import { validWaterRoute } from '../../src/village/skeleton/water-routing.js';

const input = roadFixture(300, { rivers: [{ centreline: [{ x: -500, y: 0 }, { x: 500, y: 0 }], widthM: 4 }] });
describe('natural river geometry and road verges', () => {
  it('gives coarse river surveys deterministic bends and retains surveyed endpoints and width', () => {
    const first = buildSite(input, 3), second = buildSite(input, 3), other = buildSite(input, 103);
    expect(first.water).toEqual(second.water);
    expect(first.water).not.toEqual(other.water);
    const ring = first.water[0], count = ring.length / 2;
    const centres = ring.slice(0, count).map((p, i) => new Point((p.x + ring.at(-1 - i)!.x) / 2, (p.y + ring.at(-1 - i)!.y) / 2));
    expect(centres[0]).toEqual(new Point(-500, 0));
    expect(centres.at(-1)).toEqual(new Point(500, 0));
    expect(Math.max(...centres.map(p => Math.abs(p.y)))).toBeGreaterThan(15);
    for (let i = 0; i < count; i++) expect(dist(ring[i], ring.at(-1 - i)!)).toBeCloseTo(4, 1);
    expect(input.rivers![0].centreline).toHaveLength(2);
  });
  it('leaves authored water polygons unchanged and allows an explicitly straight river', () => {
    const polygon = [{ x: 0, y: 40 }, { x: 100, y: 40 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
    const m = buildSite({ ...input, coastlineGeometry: [polygon], rivers: [{ ...input.rivers![0], meander: false }] }, 3);
    expect(m.water[0]).toEqual(polygon.map(p => new Point(p.x, p.y)));
    expect(m.water[1].every(p => Math.abs(p.y) === 2)).toBe(true);
  });
  it('bends straight approaches without moving their entry or initial heading', () => {
    const tip = new Point(0, -100);
    const points = growApronPath({ id: 'north', type: 'main', widthM: 5, points: [new Point(0, 0), tip] }, 500);
    expect(points[0]).toEqual(tip);
    expect(points[1].x).toBeCloseTo(0);
    expect(Math.max(...points.map(p => Math.abs(p.x)))).toBeGreaterThan(5);
  });
  it('keeps a broad road surface off the bank, including a centreline that was already dry', () => {
    const water = [[new Point(-200, -4), new Point(200, -4), new Point(200, 0), new Point(-200, 0)]];
    const path = [new Point(-100, 15), new Point(-50, 2), new Point(50, 2), new Point(100, 15)];
    expect(validWaterRoute(path, water, 4)).toBe(false);
    const routed = clearRiverbanks(path, water, 2.5);
    const acc = arcLengths(routed);
    for (let s = 0; s < acc.at(-1)!; s++) expect(sampleAt(routed, acc, s).p.y).toBeGreaterThanOrEqual(5.4);
    expect(routed[0]).toEqual(path[0]); expect(routed.at(-1)).toEqual(path.at(-1));
  });
  it.each([3, 103])('keeps Brook seed %i clear outside short bridge approaches', seed => {
    const fixture = roadReviewFixtures.find(f => f.id === 'brook')!;
    const m = generateVillage(fixture.input, seed);
    expect(m.buildings.reduce((sum, b) => sum + b.occupancy, 0)).toBeGreaterThanOrEqual(300);
    expect(m.bridges.length).toBeGreaterThan(0);
    expect(m.bridges.every(b => b.narrow && b.spanM <= 10)).toBe(true);
    for (const lane of m.lanes) {
      const half = roadCrossSection(lane).surfaceM / 2, acc = arcLengths(lane.points);
      for (let s = 0; s < acc.at(-1)!; s += 2) {
        const p = sampleAt(lane.points, acc, s).p;
        if (m.bridges.some(b => dist(p, b.position) < b.spanM / 2 + half + 8)) continue;
        const gap = Math.min(...m.site.water.flatMap(poly => poly.map((a, i) =>
          dist(p, closestPointOnSegment(p, a, poly[(i + 1) % poly.length]))))) - half;
        expect(gap, `${lane.id} at ${s}m`).toBeGreaterThanOrEqual(1.45);
      }
    }
  }, 30000);
});
