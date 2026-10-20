import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSettlementModel, exportSettlement, type AzgaarBurgInput } from '../src/index.js';
import { Model } from '../src/generator/model.js';
import { Point } from '../src/types/point.js';
import { Polygon } from '../src/geom/polygon.js';
import { pointInPolygon } from '../src/geom/point-in-polygon.js';
import { roadCorridor } from '../src/geom/road-corridor.js';
import { drySegments, overlapsWater, polygonsOverlap } from '../src/generator/city-frontage.js';
import { waterInView } from '../src/scene/water-view.js';
import aldford from './fixtures/aldford-harbour.json';
import seading from './fixtures/seading-harbour.json';

const points = (ring: Array<{ x: number; y: number }>) => ring.map(p => new Point(p.x, p.y));
afterEach(() => vi.restoreAllMocks());

describe('recessed ocean harbours', () => {
  it.each([aldford, seading])('recesses the exact $burg.name harbour and preserves a working town', fixture => {
    const input = fixture.burg as AzgaarBurgInput, before = JSON.stringify(input);
    let originalWater: Point[][] = [];
    const probe = Model.prototype.probeHarbour;
    vi.spyOn(Model.prototype, 'probeHarbour').mockImplementation(function (this: Model) {
      const k = this.params.development!.metresPerUnit;
      originalWater = this.params.coastlineGeometry!.map(r => r.map(p => p.scale(k)));
      return probe.call(this);
    });
    const model = createSettlementModel(input, { seed: fixture.seed });
    const layers = model.scene.layers, harbour = layers.harbours![0];
    const waterRings = layers.water.rings.map(points);
    expect(harbour).toBeDefined();
    expect(harbour.kind).toBe('protected');
    expect(harbour.basin.length).toBeGreaterThanOrEqual(4);
    expect(harbour.berths.length).toBeGreaterThan(0);
    expect(layers.buildings.filter(b => b.kind === 'harbour').length).toBeGreaterThan(0);
    const wetBefore = (p: { x: number; y: number }) => originalWater.filter(r => pointInPolygon(p, r)).length % 2 === 1;
    const wetNow = (p: { x: number; y: number }) => layers.water.rings.filter(r => pointInPolygon(p, r)).length % 2 === 1;
    // The navigable basin occupies former land; offshore masonry alone cannot pass.
    for (const p of harbour.basin) { expect(wetBefore(p)).toBe(false); expect(wetNow(p)).toBe(true); }
    for (const b of layers.buildings) expect(overlapsWater(new Polygon(points(b.ring)), waterRings)).toBe(false);
    for (const q of harbour.quays) for (const p of q.ring) expect(wetNow(p)).toBe(false);
    for (const w of layers.walls) for (const path of w.polylines) for (let i = 1; i < path.length; i++) {
      const a = new Point(path[i - 1].x, path[i - 1].y), b = new Point(path[i].x, path[i].y);
      const dry = drySegments(a, b, waterRings);
      expect(dry.reduce((n, [p, q]) => n + Point.distance(p, q), 0)).toBeCloseTo(Point.distance(a, b), 5);
    }
    for (const [index, path] of harbour.access.entries()) for (let i = 1; i < path.length; i++) {
      expect(overlapsWater(roadCorridor(path[i - 1], path[i], index < 2 ? 3.5 : 2.5), waterRings)).toBe(false);
    }
    for (let i = 1; i < harbour.approach.length; i++) {
      const corridor = roadCorridor(harbour.approach[i - 1], harbour.approach[i], harbour.navigationWidth);
      for (const p of corridor.vertices) expect(wetNow(p)).toBe(true);
      for (const solid of [...harbour.breakwaters, ...harbour.berths]) expect(polygonsOverlap(corridor, new Polygon(points(solid.ring)))).toBe(false);
    }
    for (const bounds of [model.scene.bounds, { min_x: -10000, min_y: -10000, max_x: 10000, max_y: 10000 }]) {
      const view = waterInView(layers.water, bounds);
      for (const p of harbour.basin) expect(view.rings.filter(r => pointInPolygon(p, r)).length % 2).toBe(1);
    }
    expect(model.residents.unassigned).toBe(0);
    expect(model.degradedFlags).not.toContain('walls');
    expect(layers.walls.length).toBeGreaterThan(0);
    expect(JSON.stringify(input)).toBe(before);
    expect(model.diagnostics).toContain('Harbour basin recessed into the locally inferred shoreline.');
    if (input.waterContext) expect(model.waterContextResult?.issues.map(i => i.code)).toContain('water-harbour-recessed');
    const water = exportSettlement(model).features.find(f => f.id === 'water');
    expect(water?.geometry.type).toBe('MultiPolygon');
    const repeat = createSettlementModel(input, { seed: fixture.seed });
    expect(repeat.scene.layers.harbours).toEqual(layers.harbours);
    expect(repeat.scene.layers.water).toEqual(layers.water);
  });
});
