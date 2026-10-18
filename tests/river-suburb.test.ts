import { beforeAll, describe, expect, it } from 'vitest';
import { createSettlementModel, type AzgaarBurgInput, type SettlementModel } from '../src/index.js';
import { Point } from '../src/types/point.js';
import { Polygon } from '../src/geom/polygon.js';
import { drySegments, nearestOnSegment, polygonsOverlap } from '../src/generator/city-frontage.js';
import { roadCorridor } from '../src/geom/road-corridor.js';
import { buildSite } from '../src/village/site.js';
import { waterFillRings, waterBoundarySegments } from '../src/village/water-boundary.js';
import { inAnyWater } from '../src/village/geometry.js';
import { planRiverSuburb } from '../src/generator/river-suburb.js';
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
