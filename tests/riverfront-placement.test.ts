import { beforeAll, describe, expect, it } from 'vitest';
import { createSettlementModel, createSettlementSession, exportSettlement, type AzgaarBurgInput, type SettlementModel } from '../src/index.js';
import { buildSite } from '../src/village/site.js';
import { waterFillRings, waterBoundarySegments } from '../src/village/water-boundary.js';
import { closestPointOnSegment, dist, inAnyWater } from '../src/village/geometry.js';
import { Point } from '../src/types/point.js';
import { validateWaterContext } from '../src/input/water-context.js';
import silahla from './fixtures/silahla-river.json';

const input = silahla.burg as AzgaarBurgInput;
const originalInput = JSON.stringify(input);

describe('riverfront city placement in source coordinates', () => {
  let model: SettlementModel;
  beforeAll(() => { model = createSettlementModel(input, { seed: silahla.seed }); }, 60000);

  it('places actual Silahla beside its intended river with a working harbour', () => {
    expect(model.placement).toMatchObject({ kind: 'riverfront', riverId: '653' });
    const p = model.placement!;
    expect(p.originalBankDistanceM).toBeCloseTo(825.5428, 2);
    expect(Math.hypot(p.offsetM.x, p.offsetM.y)).toBeGreaterThan(500);
    const site = buildSite(input, silahla.seed), centre = new Point(p.offsetM.x, p.offsetM.y);
    const distance = Math.min(...waterBoundarySegments(site.water).map(([a, b]) => dist(centre, closestPointOnSegment(centre, a, b))));
    expect(distance).toBeCloseTo(p.targetBankDistanceM, 4);
    expect(distance).toBeLessThan(150);
    expect(inAnyWater(centre, site.water)).toBe(false);
    expect(model.scene.layers.harbours?.[0].kind).toBe('river');
    expect(model.scene.layers.harbours![0].quays.length).toBeGreaterThan(0);
    expect(model.residents.assigned).toBe(input.population);
    expect(model.waterContextResult?.issues.some(i => i.code === 'water-context-conflict')).toBe(false);
  });

  it('keeps source water fixed and buildings dry after the town and countryside move', () => {
    const site = buildSite(input, silahla.seed);
    expect(model.scene.layers.water.rings).toEqual(waterFillRings(site.water));
    expect(JSON.stringify(input)).toBe(originalInput);
    for (const building of model.scene.layers.buildings)
      for (const p of building.ring) expect(inAnyWater(new Point(p.x, p.y), site.water)).toBe(false);
    const bounds = model.scene.bounds;
    const radius = Math.max(...[bounds.min_x, bounds.max_x].flatMap(x => [bounds.min_y, bounds.max_y].map(y => Math.hypot(x, y))));
    expect(radius + 1000).toBeLessThanOrEqual(4000);
    const c = model.placement!.offsetM;
    const outwardRoads = model.scene.layers.roads.filter(r => r.kind === 'road' && r.path.length > 1);
    expect(outwardRoads.length).toBeGreaterThan(0);
    for (const r of outwardRoads) {
      const first = r.path[0], last = r.path.at(-1)!;
      expect(Math.hypot(last.x - c.x, last.y - c.y)).toBeGreaterThanOrEqual(Math.hypot(first.x - c.x, first.y - c.y));
    }
  });

  it('exports the placement decision without changing the original coordinate system', () => {
    const geojson = exportSettlement(model);
    expect(geojson.metadata.placement).toEqual(model.placement);
    expect(geojson.metadata.coordinate_system).toBe('local_metres_y_down');
    expect(geojson.metadata.placement).not.toBe(model.placement);
  });
});

it('carries riverfront placement into session metadata and retains original survey coverage', () => {
  const small: AzgaarBurgInput = { ...input, name: 'Riverfront session', population: 2000, temple: false,
    rivers: [{ id: '653', centreline: [{ x: 600, y: -6000 }, { x: 600, y: 6000 }], widthM: 40, meander: false }],
    waterContext: { version: 1, status: 'measured', coordinateSpace: 'burg-local-metres', surveyRadiusM: 6000, geometryErrorM: .5, bodies: [] },
  };
  const session = createSettlementSession(small, { seed: 2 });
  expect(session.metadata.placement).toMatchObject({ kind: 'riverfront', riverId: '653' });
  expect(session.metadata.placement!.offsetM.x).toBeGreaterThan(400);
  expect(session.metadata.surveyRadiusM).toBe(6000);
  expect(session.exportGeoJson().metadata.placement).toEqual(session.metadata.placement);
}, 30000);

it.each(['', '   ', 653])('rejects malformed intended river identity %j', harbourRiverId => {
  expect(() => validateWaterContext({ ...input, harbourRiverId } as AzgaarBurgInput)).toThrow('harbourRiverId');
});
