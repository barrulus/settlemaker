import { beforeAll, describe, expect, it } from 'vitest';
import { createSettlementModel, type AzgaarBurgInput, type SettlementModel } from '../src/index.js';
import { Point } from '../src/types/point.js';
import { Polygon } from '../src/geom/polygon.js';
import { drySegments, nearestOnSegment, polygonsOverlap } from '../src/generator/city-frontage.js';
import { roadCorridor } from '../src/geom/road-corridor.js';
import { buildSite } from '../src/village/site.js';
import { waterFillRings, waterBoundarySegments } from '../src/village/water-boundary.js';
import { inAnyWater } from '../src/village/geometry.js';
import { planRiverSuburb, riverCrossingTarget } from '../src/generator/river-suburb.js';
import { exportSettlement } from '../src/settlement/output.js';
import type { Model } from '../src/generator/model.js';
import silahla from './fixtures/silahla-smooth-river.json';

const input = silahla.burg as AzgaarBurgInput;
const point = (p: {x:number;y:number}) => new Point(p.x,p.y);
const centre = (ring: {x:number;y:number}[]) => new Polygon(ring.map(point)).center;

describe('connected opposite-bank river suburbs', () => {
  let model: SettlementModel;
  beforeAll(() => { model = createSettlementModel(input, { seed: silahla.seed }); }, 30000);

  it('allocates real residents beyond Silahla’s unchanged river', () => {
    const site = buildSite(input, silahla.seed), water = waterFillRings(site.water)!;
    const town = point(model.placement!.offsetM);
    const far = model.buildings.filter(b => b.settlementRole === 'urban' && b.residents > 0
      && drySegments(town, centre(b.footprint), water).length > 1);
    expect(far.length).toBeGreaterThan(20);
    expect(far.reduce((sum, b) => sum + b.residents, 0)).toBeGreaterThan(150);
    expect(model.residents.assigned).toBe(input.population);
    expect(model.residents.unassigned).toBe(0);
    expect(model.scene.layers.water.rings).toEqual(water);
    for (const b of model.scene.layers.buildings) for (const p of b.ring) expect(inAnyWater(point(p), site.water)).toBe(false);
  });

  it('connects both neighbourhoods with one straight bridge and dry landings', () => {
    const site = buildSite(input, silahla.seed), layers = model.scene.layers;
    expect(layers.bridges).toHaveLength(1);
    const bridge = layers.bridges![0];
    expect(bridge.path).toHaveLength(2);
    const [a, b] = bridge.path.map(point);
    expect(Point.distance(a, b)).toBeGreaterThan(40);
    // Forty metres of channel plus the dry bridge landings; a diagonal mesh
    // shortcut formerly stretched this same crossing to fifty-five metres.
    expect(Point.distance(a, b)).toBeLessThan(46);
    const axis = b.subtract(a).norm(), banks = waterBoundarySegments(site.water);
    for (const landing of [a, b]) {
      const bank = banks.slice().sort((p, q) => Point.distance(landing, nearestOnSegment(landing, ...p))
        - Point.distance(landing, nearestOnSegment(landing, ...q)))[0];
      expect(Math.abs(axis.dot(bank[1].subtract(bank[0]).norm()))).toBeLessThan(.15);
    }
    expect(inAnyWater(a, site.water)).toBe(false);
    expect(inAnyWater(b, site.water)).toBe(false);
    expect(inAnyWater(a.add(b).scale(.5), site.water)).toBe(true);
    const roads = layers.roads.filter(r => r.kind === 'road' && [a, b].every(p =>
      r.path.slice(1).some((end, i) => Point.distance(p, nearestOnSegment(p, point(r.path[i]), point(end))) < 1e-5)));
    expect(roads.length).toBeGreaterThan(0);
    const connection = roads[0];
    expect(Point.distance(point(connection.path[0]), a)).toBeGreaterThan(10);
    expect(Point.distance(point(connection.path.at(-1)!), b)).toBeGreaterThan(10);
    for (let i = 1; i < connection.path.length; i++) {
      const corridor = roadCorridor(connection.path[i - 1], connection.path[i], bridge.width * .9);
      for (const building of layers.buildings) expect(polygonsOverlap(corridor, new Polygon(building.ring.map(point)))).toBe(false);
    }
  });

  it('does not reserve a suburb without an outer population budget or associated river banks', () => {
    expect(planRiverSuburb({ params: { development: {}, harbourWaterKind: 'river', harbourSize: 'small' } } as unknown as Model, 0)).toBeNull();
    expect(planRiverSuburb({ params: { development: {}, harbourWaterKind: 'lake', harbourSize: 'small' } } as unknown as Model, 4)).toBeNull();
    expect(planRiverSuburb({ params: { development: {}, harbourWaterKind: 'river' } } as unknown as Model, 4)).toBeNull();
  });
});

describe('population and area dependent river crossings', () => {
  const town: AzgaarBurgInput = { name: 'River town', population: 20000, port: false, walls: true,
    rivers: [{ id: 'river', centreline: [{ x: 80, y: -10000 }, { x: 80, y: 10000 }], widthM: 40, meander: false }] };
  let large: SettlementModel;
  beforeAll(() => { large = createSettlementModel(town, { seed: 3 }); }, 30000);

  it('adds demand for either more residents or a larger developed footprint, with a bounded target', () => {
    const compact = riverCrossingTarget(2000, 40000);
    expect(compact).toBe(1);
    expect(riverCrossingTarget(20000, 40000)).toBeGreaterThan(compact);
    expect(riverCrossingTarget(2000, 640000)).toBeGreaterThan(compact);
    expect(riverCrossingTarget(1000000, 100000000)).toBeLessThanOrEqual(6);
  });

  it('gives a larger non-port river city more crossings than a small town', () => {
    const small = createSettlementModel({ ...town, population: 2000 }, { seed: 3 });
    expect(small.scene.layers.bridges).toHaveLength(1);
    expect(large.scene.layers.bridges!.length).toBeGreaterThan(small.scene.layers.bridges!.length);
    expect(large.scene.layers.bridges!.length).toBeLessThanOrEqual(6);
    expect(large.residents.assigned).toBe(town.population);
    expect(large.residents.unassigned).toBe(0);
  }, 30000);

  it('adds crossings for a more extensive city at the same population when the banks permit them', () => {
    const input = { ...town, population: 4000 };
    const compact = createSettlementModel(input, { seed: 3 });
    const extensive = createSettlementModel(input, { seed: 3,
      development: { preset: 'city', centreOccupancy: 1, edgeOccupancy: 1 } });
    const urbanArea = (model: SettlementModel) => model.districts.reduce((sum, d) =>
      sum + (d.settlementRole === 'urban' ? d.areaM2 ?? 0 : 0), 0);
    expect(urbanArea(extensive)).toBeGreaterThan(urbanArea(compact) * 2);
    expect(extensive.scene.layers.bridges!.length).toBeGreaterThan(compact.scene.layers.bridges!.length);
    expect(extensive.residents.assigned).toBe(input.population);
  }, 30000);

  it('exports separated, straight spans with dry landings and building-free approaches', () => {
    const water = large.scene.layers.water.rings;
    const wet = (p: Point) => drySegments(p, p.add(new Point(.001, 0)), water.map(r => r.map(point))).length === 0;
    const bridges = large.scene.layers.bridges!, exported = exportSettlement(large);
    for (const bridge of bridges) {
      expect(bridge.path).toHaveLength(2);
      const [a, b] = bridge.path.map(point);
      expect(wet(a)).toBe(false); expect(wet(b)).toBe(false);
      expect(wet(a.add(b).scale(.5))).toBe(true);
      expect(Point.distance(a, b)).toBeLessThan(46);
      for (const other of bridges) if (bridge !== other) {
        const mid = point(other.path[0]).add(point(other.path[1])).scale(.5);
        expect(Point.distance(a.add(b).scale(.5), mid)).toBeGreaterThanOrEqual(80);
      }
      const road = large.scene.layers.roads.find(r => r.kind === 'road' && [a, b].every(p =>
        r.path.slice(1).some((end, i) => Point.distance(p, nearestOnSegment(p, point(r.path[i]), point(end))) < 1e-5)));
      expect(road).toBeDefined();
      for (let i = 1; i < road!.path.length; i++) {
        const corridor = roadCorridor(road!.path[i - 1], road!.path[i], bridge.width * .9);
        for (const building of large.scene.layers.buildings)
          expect(polygonsOverlap(corridor, new Polygon(building.ring.map(point)))).toBe(false);
      }
      expect(exported.features.find(f => f.id === bridge.id)?.geometry).toEqual({
        type: 'LineString', coordinates: bridge.path.map(p => [p.x, p.y]),
      });
    }
  });

  it('chooses the same crossings for the same seed', () => {
    expect(createSettlementModel(town, { seed: 3 }).scene.layers.bridges).toEqual(large.scene.layers.bridges);
  }, 30000);
});

it.each([
  { port: true, harbourWaterKind: 'river', widthM: 160 },
  { port: true, harbourWaterKind: 'river', widthM: 40, harbourRiverId: 'missing' },
])('does not force an unsupported cross-river suburb (%j)', extra => {
  const width = extra.widthM;
  const fixture: AzgaarBurgInput = { ...input, ...extra, population: 2000, temple: false,
    harbourWaterKind: extra.harbourWaterKind as 'river', harbourRiverId: extra.harbourRiverId ?? '653',
    rivers: [{ id: '653', centreline: [{ x: 60 + width / 2, y: -6000 }, { x: 60 + width / 2, y: 6000 }], widthM: width, meander: false }],
    waterContext: { version: 1, status: 'measured', coordinateSpace: 'burg-local-metres', surveyRadiusM: 6000, geometryErrorM: .5, bodies: [] },
  };
  const result = createSettlementModel(fixture, { seed: 2 });
  expect(result.scene.layers.bridges ?? []).toHaveLength(0);
}, 30000);
