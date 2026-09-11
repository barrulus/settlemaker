import { describe, expect, it } from 'vitest';
import { Point } from '../../src/types/point.js';
import { reserveTempleHenge } from '../../src/village/dressing/temple-henge.js';
import { generateVillage } from '../../src/village/village-model.js';
import { circleClearOfClaims, circleIntersectsPolygon } from '../../src/village/dressing/pois.js';
import { dist, closestPointOnSegment } from '../../src/village/geometry.js';
import { roadFixture, roadReviewFixtures } from '../fixtures/village-roads.js';

const examples = [
  roadFixture(23), roadFixture(94, { biome: 'tundra' }), roadFixture(190),
  roadFixture(900), roadFixture(40, { roadBearings: [] }),
  ...['headland', 'estuary', 'brook', 'desert', 'tropical'].flatMap(id =>
    roadReviewFixtures.filter(f => f.id === id).map(f => f.input)),
];
describe('FMG temple henges', () => {
  it.each(examples)('reserves an accessible dry clearing at pop $population / $biome', input => {
    for (const seed of [2, 17]) {
      const m = generateVillage({ ...input, temple: true }, seed);
      const circles = m.pois.filter(p => p.kind === 'stone-circle');
      expect(circles, m.diagnostics.join('\n')).toHaveLength(1);
      const henge = circles[0];
      expect(henge.glyph).toMatch(/^sm-henge-/);
      for (const wall of m.wall?.polylines ?? []) for (let i=1;i<wall.length;i++) {
        expect(dist(henge.position, closestPointOnSegment(henge.position, new Point(wall[i-1].x,wall[i-1].y), new Point(wall[i].x,wall[i].y)))).toBeGreaterThanOrEqual(16);
      }
      const access = m.lanes.find(l => l.id === 'poi:stone-circle/access');
      expect(access).toBeDefined();
      expect(access!.type).toBe('footpath');
      expect(dist(access!.points.at(-1)!, henge.position)).toBeCloseTo(16);
      const occupied = new Set(m.buildings.map(b => b.lotId));
      expect(circleClearOfClaims(henge.position, 15, m.lanes, m.lots.filter(l => occupied.has(l.id)), m.crofts, m.fields)).toBe(true);
      expect(m.site.water.some(p => circleIntersectsPolygon(henge.position, 17, p))).toBe(false);
      expect(m.vegetation.every(v => dist(v.position, henge.position) >= 19)).toBe(true);
      if (access!.parentId) {
        const parent = m.lanes.find(l => l.id === access!.parentId)!;
        expect(parent).toBeDefined();
        expect(parent.points.slice(1).some((b, i) => dist(access!.points[0], closestPointOnSegment(access!.points[0], parent.points[i], b)) < .001)).toBe(true);
      }
    }
  }, 30000);

  it('does not force a requested henge into water when no clearing is possible', () => {
    const m = generateVillage(roadFixture(23), 2);
    const water = [[new Point(-10000, -10000), new Point(10000, -10000), new Point(10000, 10000), new Point(-10000, 10000)]];
    expect(reserveTempleHenge({ ...m.site, flags: { ...m.site.flags, temple: true }, water },
      m.green, m.lanes, [], [], 100)).toBeNull();
  });

  it('preserves all seven FMG feature flags without forcing a henge when Temple is false', () => {
    const input = roadFixture(130, { capital: true, port: true, citadel: true, walls: true, plaza: true, shanty: true, temple: true });
    const requested = generateVillage(input, 3);
    for (const key of ['capital', 'port', 'citadel', 'walls', 'plaza', 'shanty', 'temple'] as const) expect(requested.site.flags[key]).toBe(true);
    expect(requested.pois.some(p => p.kind === 'stone-circle')).toBe(true);
    const ordinary = generateVillage({ ...input, temple: false }, 3);
    expect(ordinary.lanes.some(l => l.id === 'poi:stone-circle/access')).toBe(false);
    expect(requested.buildings).toEqual(ordinary.buildings);
  });
});
