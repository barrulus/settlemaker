import { describe, expect, it } from 'vitest';
import { createSettlementModel, type AzgaarBurgInput } from '../src/index.js';
import { buildSite } from '../src/village/site.js';
import { riverPolygons } from '../src/village/rivers.js';
import { validateWaterContext } from '../src/input/water-context.js';
import { waterBoundarySegments, waterFillRings } from '../src/village/water-boundary.js';
import { closestPointOnSegment, dist, inAnyWater } from '../src/village/geometry.js';
import { pointInPolygon } from '../src/geom/point-in-polygon.js';
import { cityCrossings } from '../src/scene/crossings.js';
import { Point } from '../src/types/point.js';
import exported from './fixtures/fmg-river-export.json';

const base: AzgaarBurgInput = {
  name: 'River survey', population: 4000, port: false, citadel: false, walls: true,
  plaza: true, temple: false, shanty: false, capital: false, coastlineGeometry: [],
  waterContext: { version: 1, status: 'measured', coordinateSpace: 'burg-local-metres',
    surveyRadiusM: 10000, geometryErrorM: .5, bodies: [] },
};
const course: NonNullable<AzgaarBurgInput['rivers']>[number] = {
  id: 'river:7', centreline: [{ x: -11000, y: 60 }, { x: 0, y: 60 }, { x: 11000, y: 60 }],
  widthM: 16, widthsM: [8, 16, 32], widthSource: 'fmg-local-width-model', meander: false,
};
const riverInput = (river = course): AzgaarBurgInput => ({ ...base, rivers: [river] });

describe('FMG river export integration', () => {
  it('retains surveyed bends exactly instead of resampling or inventing meanders', () => {
    const input = riverInput({ centreline: [{ x: 3, y: 30 }, { x: 3, y: 37 }, { x: 15, y: 37 }], widthM: 2, meander: false });
    const water = riverPolygons(input, 2);
    expect(water[0]).toContainEqual(new Point(2, 38));
    expect(water[0]).toContainEqual(new Point(4, 36));
    expect(water).toEqual(riverPolygons(input, 999));
    for (const p of input.rivers![0].centreline.slice(1, -1)) expect(pointInPolygon(p, water[0])).toBe(true);
  });

  it('buffers a continuous local width profile and distinguishes modelled width from measured coast', () => {
    const site = buildSite(riverInput(), 2);
    expect(site.waterContextResult).toEqual({ version: 1, status: 'approximate', issues: [{ code: 'water-river-width-modelled' }] });
    expect(inAnyWater(new Point(0, 67.9), site.water)).toBe(true);
    expect(inAnyWater(new Point(0, 68.1), site.water)).toBe(false);
    expect(inAnyWater(new Point(5500, 71.9), site.water)).toBe(true);
    expect(inAnyWater(new Point(5500, 72.1), site.water)).toBe(false);
    expect(waterFillRings(site.water)).toHaveLength(1);
    expect(waterBoundarySegments(site.water).some(([a, b]) => a.x === 0 && b.x === 0)).toBe(false);
    expect(site.water).toEqual(buildSite(riverInput(), 17).water);
    const { waterContext: _, ...legacyEnvelope } = riverInput();
    expect(buildSite(legacyEnvelope, 2).waterContextResult).toEqual(site.waterContextResult);
  });

  it.each([
    { widthsM: [8, 16] }, { widthsM: [8, 0, 32] }, { widthsM: [8, Infinity, 32] },
    { widthSource: 'display-stroke' }, { courseSource: 'unknown-curve' }, { id: 7 },
  ])('rejects invalid river profile metadata %j', invalid => {
    expect(() => validateWaterContext(riverInput({ ...course, ...invalid } as typeof course))).toThrow('water-context-invalid');
    const { waterContext: _, ...legacyEnvelope } = riverInput({ ...course, ...invalid } as typeof course);
    expect(() => buildSite(legacyEnvelope, 2)).toThrow('water-context-invalid');
  });

  it('bounds sharp variable-width joins without resampling the authored bend', () => {
    const bend = { ...course, centreline: [{ x: -80, y: 100 }, { x: 0, y: 100 }, { x: -70, y: 115 }], widthsM: [4, 12, 20] };
    const [ring] = riverPolygons(riverInput(bend), 2);
    expect(ring.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
    expect(Point.distance(ring[1], new Point(0, 100))).toBeLessThanOrEqual(24 + 1e-8);
    expect(Point.distance(ring[4], new Point(0, 100))).toBeLessThanOrEqual(24 + 1e-8);
    const site = buildSite(riverInput(bend), 2);
    expect(inAnyWater(new Point(-30, 100), site.water)).toBe(true);
    expect(inAnyWater(new Point(-35, 107.5), site.water)).toBe(true);
  });

  it('preserves constant-width compatibility and does not invent a width diagnostic', () => {
    const { widthsM: _, widthSource: __, ...constant } = course;
    const site = buildSite(riverInput(constant), 2);
    expect(site.waterContextResult).toEqual({ version: 1, status: 'measured', issues: [] });
    for (const x of [-500, 0, 500]) {
      expect(inAnyWater(new Point(x, 67.9), site.water)).toBe(true);
      expect(inAnyWater(new Point(x, 68.1), site.water)).toBe(false);
    }
  });

  it('dissolves a widened river mouth into its sea and keeps ocean harbour navigation clear', () => {
    const coastlineGeometry = [[{ x: 100, y: -10000 }, { x: 10000, y: -10000 }, { x: 10000, y: 10000 }, { x: 100, y: 10000 }]];
    const input: AzgaarBurgInput = { ...base, port: true, harbourSize: 'large', harbourWaterKind: 'ocean', coastlineGeometry,
      waterContext: { ...base.waterContext as Extract<AzgaarBurgInput['waterContext'], { status: 'measured' }>,
        bodies: [{ kind: 'ocean', distanceM: 100, bearingDeg: 90, polygonIndices: [0] }] },
      rivers: [{ ...course, centreline: course.centreline.map(p => ({ x: p.x, y: 80 })) }] };
    const site = buildSite(input, 2), mouth = new Point(100, 80);
    expect(waterBoundarySegments(site.water).every(([a, b]) => dist(mouth, closestPointOnSegment(mouth, a, b)) > 7)).toBe(true);
    expect(inAnyWater(new Point(105, 80), site.water)).toBe(true);
    expect(site.water[0]).toEqual(coastlineGeometry[0]);
    const model = createSettlementModel(input, { seed: 2 }), layers = model.scene.layers;
    const wet = (p: { x: number; y: number }) => layers.water.rings.filter(r => pointInPolygon(p, r)).length % 2 === 1;
    expect(layers.harbours?.[0].kind).toBe('protected');
    for (const building of layers.buildings) for (const p of building.ring) expect(wet(p)).toBe(false);
    for (const p of layers.harbours![0].approach) expect(wet(p)).toBe(true);
    expect(model.waterContextResult?.issues).toEqual([{ code: 'water-river-width-modelled' }]);
  });

  it('consumes the representative FMG export without substituting its nearer river for the declared sea port', () => {
    // This is output from FMG's real width/course exporter over a representative
    // mocked map, not a reconstruction of the user's Tetlapan geography.
    const input = exported.burg as AzgaarBurgInput;
    const model = createSettlementModel(input, { seed: exported.seed });
    expect(model.waterContextResult?.issues).toContainEqual({ code: 'water-river-width-modelled' });
    expect(model.residents.unassigned).toBe(0);
    // The sea is beyond the compact core, but an outer harbour now has a
    // connected land route. Its quay must still berth on that sea bank,
    // rather than relabelling the closer river as an ocean harbour.
    const harbour=model.scene.layers.harbours![0];
    expect(harbour.kind).toBe('protected');
    expect(harbour.quays.flatMap(q=>q.edge).every(p=>Math.abs(p.x-200)<1)).toBe(true);
    expect(harbour.berths.every(b=>b.ring.some(p=>p.x>200))).toBe(true);
    expect(model.waterContextResult?.issues.some(i=>i.code==='water-context-conflict'||i.code==='water-harbour-unavailable')).toBe(false);
    for (const p of [{ x: 0, y: 100 }, { x: 205, y: 104 }])
      expect(model.scene.layers.water.rings.filter(r => pointInPolygon(p, r)).length % 2).toBe(1);
    for (const b of model.scene.layers.buildings) for (const p of b.ring)
      expect(model.scene.layers.water.rings.filter(r => pointInPolygon(p, r)).length % 2).toBe(0);
  });

  it('keeps a river port open along the channel without ocean breakwaters', () => {
    const input: AzgaarBurgInput = { ...base, port: true, harbourSize: 'large', harbourWaterKind: 'river',
      rivers: [{ centreline: [{ x: -11000, y: 100 }, { x: 11000, y: 100 }], widthM: 80, meander: false }] };
    const model = createSettlementModel(input, { seed: 2 }), layers = model.scene.layers;
    expect(layers.harbours?.[0].kind).toBe('river');
    expect(layers.harbours?.[0].breakwaters).toEqual([]);
    for (const building of layers.buildings) for (const p of building.ring)
      expect(layers.water.rings.filter(r => pointInPolygon(p, r)).length % 2).toBe(0);
  });

  it('bridges a bounded road crossing of the imported river with dry landings', () => {
    const site = buildSite(riverInput(), 2), rings = waterFillRings(site.water)!;
    const bridges = cityCrossings([{ kind: 'road', width: 5, path: [{ x: 0, y: 0 }, { x: 0, y: 120 }] }], rings);
    expect(bridges).toHaveLength(1);
    expect(bridges[0].width).toBe(5);
    expect(inAnyWater(new Point(bridges[0].path[0].x, bridges[0].path[0].y), site.water)).toBe(false);
    expect(inAnyWater(new Point(bridges[0].path.at(-1)!.x, bridges[0].path.at(-1)!.y), site.water)).toBe(false);
    expect(bridges[0].path.at(-1)!.y - bridges[0].path[0].y).toBeCloseTo(21);
    expect(cityCrossings([{ kind: 'road', path: [{ x: 0, y: 0 }, { x: 0, y: 60 }] }], rings)).toEqual([]);
  });
});
