import { describe, expect, it } from 'vitest';
import type { AzgaarBurgInput } from '../../src/input/azgaar-input.js';
import { Point } from '../../src/types/point.js';
import { SeededRandom } from '../../src/utils/random.js';
import { closestPointOnPolyline, dist } from '../../src/village/geometry.js';
import { ROUTE_CLASS_ORDER } from '../../src/village/route-class.js';
import { buildSite } from '../../src/village/site.js';
import { synthesizeTrunks } from '../../src/village/skeleton/trunks.js';
import { isApron } from '../../src/village/types.js';
import { roadFixture } from '../fixtures/village-roads.js';

const network = (population: number, roads: AzgaarBurgInput['roadBearings'], seed = 7) =>
  synthesizeTrunks(buildSite(roadFixture(population, { roadBearings: roads })), 165, 60, new SeededRandom(seed));

describe('FMG approaches become village streets', () => {
  it('accepts upstream groups and fork classes without dropping land approaches', () => {
    const s = buildSite(roadFixture(300, {
      roadBearings: [
        { bearing_deg: 12, kind: 'roads' }, { bearing_deg: 66, kind: 'trails' },
        { bearing_deg: 123, group: 'trails' }, { bearing_deg: 178, kind: 'footpath' },
        { bearing_deg: 233, kind: 'royal' }, { bearing_deg: 310, kind: 'sea' },
      ]
    }));
    expect(s.routes.map(r => [r.bearingDeg, r.type])).toEqual([
      [12, 'main'], [66, 'trail'], [123, 'trail'], [178, 'footpath'], [233, 'royal'],
    ]);
  });
  it('honours two measured bearings of one continuing route without inventing either opposite', () => {
    const n = network(300, [
      { bearing_deg: 36, kind: 'royal', route_id: 'r', through: true },
      { bearing_deg: 209, kind: 'royal', route_id: 'r', through: true },
    ]);
    expect(n.entries.map(e => e.bearingDeg)).toEqual([36, 209]);
    for (const e of n.entries) expect(Math.min(...n.trunks.map(l => closestPointOnPolyline(e.point, l.points).distance))).toBeLessThan(1e-6);
    expect(n.trunks.filter(l => l.routeRole === 'street').every(l => ['town', 'local', 'footpath'].includes(l.type))).toBe(true);
    expect(n.trunks.filter(l => l.routeRole === 'approach' && !isApron(l.id))).toHaveLength(2);
  });
  it.each(ROUTE_CLASS_ORDER)('retains inbound %s classification while limiting village streets', type => {
    const n = network(300, [{ bearing_deg: 31, kind: type }]);
    const outer = n.trunks.find(l => l.routeRole === 'approach' && !isApron(l.id))!;
    expect(outer.type).toBe(type);
    expect(n.trunks.filter(l => l.routeRole === 'street').length).toBeGreaterThan(0);
    for (const l of n.trunks.filter(l => l.routeRole === 'street')) expect(['town', 'local', 'footpath']).toContain(l.type);
  });
  it.each(['royal', 'main', 'market'] as const)('lets a small hamlet grow around a real %s through road', kind => {
    const n = network(80, [{ bearing_deg: 36, kind }, { bearing_deg: 209, kind }]);
    expect(n.pattern).toBe('main-street');
    expect(n.trunks.find(l => l.routeRole === 'through')?.type).toBe(kind);
    const larger = network(300, [{ bearing_deg: 36, kind }, { bearing_deg: 209, kind }]);
    expect(larger.trunks.some(l => l.routeRole === 'through')).toBe(false);
  });
  it('uses shared streets and offset junctions for a busy village, without an automatic ring', () => {
    const n = network(300, [13, 66, 124, 171, 227, 281, 337].map((bearing_deg, i) => ({ bearing_deg, kind: ROUTE_CLASS_ORDER[i], route_id: `r${i}` })));
    expect(n.ring).toEqual([]);
    const junctions = n.junctions.filter(j => j.laneIds.length >= 3 && dist(j.position, new Point()) < 60);
    expect(junctions.length).toBeGreaterThan(1);
    expect(n.trunks.some(l => l.routeRole === 'street' && (l.sourceRouteIds?.length ?? 0) > 1)).toBe(true);
  });
});
