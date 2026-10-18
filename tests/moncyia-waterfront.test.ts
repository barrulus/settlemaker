import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { createSettlementModel, type AzgaarBurgInput } from '../src/index.js';
import { inferWaterfront } from '../src/input/waterfront.js';
import { buildSite } from '../src/village/site.js';
import { Point } from '../src/types/point.js';
import { pointInPolygon } from '../src/geom/point-in-polygon.js';
import { nearestOnSegment } from '../src/generator/city-frontage.js';

// Actual export of the naval capital (burg 11), not the identically named hamlet,
// from Moncyia 2026-10-18-16-42.map. Its source shore is over 7 km from the marker.
it('keeps Kindum inhabited beside both its river and its working sea harbour', () => {
  const fixture: { burg: AzgaarBurgInput; seed: number } = JSON.parse(readFileSync(
    new URL('./fixtures/moncyia-waterfront/kindum.json', import.meta.url), 'utf8'));
  const before = JSON.stringify(fixture);
  const model = createSettlementModel(fixture.burg, { seed: fixture.seed });
  expect(JSON.stringify(fixture)).toBe(before);
  expect(model.residents.assigned).toBe(19421);
  expect(model.residents.unassigned).toBe(0);
  expect(model.degradedFlags).toEqual([]);
  const issues = model.waterContextResult!.issues.map(i => i.code);
  expect(issues).toContain('water-frontage-inferred');
  expect(issues).not.toContain('water-context-conflict');
  expect(issues).not.toContain('water-harbour-unavailable');

  const inferred = inferWaterfront(fixture.burg, model.development, fixture.seed).input;
  const site = buildSite(inferred, fixture.seed), origin = new Point(0, 0);
  const distanceTo = (p: Point, rings: Point[][]) => Math.min(...rings.flatMap(r => r.map((a, i) =>
    Point.distance(p, nearestOnSegment(p, a, r[(i + 1) % r.length])))));
  const coastCount = inferred.coastlineGeometry!.length;
  const sea = site.water.slice(0, coastCount), river = site.water.slice(coastCount);
  expect(site.water.every(r => !pointInPolygon(origin, r))).toBe(true);
  expect(distanceTo(origin, sea)).toBeLessThan(66);
  expect(distanceTo(origin, river)).toBeLessThan(66);
  const harbour = model.scene.layers.harbours![0];
  expect(harbour.kind).toBe('protected');
  expect(harbour.berths.length).toBeGreaterThan(0);
  for (const quay of harbour.quays) for (const p of quay.edge) {
    expect(distanceTo(new Point(p.x, p.y), sea)).toBeLessThan(1);
  }
  for (const berth of harbour.berths) {
    const middle = berth.ring.reduce((sum, p) => sum.add(new Point(p.x, p.y)), origin).scale(1 / berth.ring.length);
    expect(sea.some(r => pointInPolygon(middle, r))).toBe(true);
  }
}, 60000);
