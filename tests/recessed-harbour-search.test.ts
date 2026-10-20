import { afterEach, expect, it, vi } from 'vitest';
import { createSettlementModel, type AzgaarBurgInput } from '../src/index.js';
import { Model } from '../src/generator/model.js';
import { Point } from '../src/types/point.js';
import { pointInPolygon } from '../src/geom/point-in-polygon.js';
import aldford from './fixtures/aldford-harbour.json';

afterEach(() => vi.restoreAllMocks());
it.each([
  [2250, 0, 1], [2250, 90, 2], [2250, 180, 3],
  [4000, 270, 4], [10000, 90, 5], [10000, 180, 6],
])('retains an inset basin after capacity expansion (%i residents, bearing %i, seed %i)', (population, oceanBearing, seed) => {
  let originalWater: Point[][] = [];
  const probe = Model.prototype.probeHarbour;
  vi.spyOn(Model.prototype, 'probeHarbour').mockImplementation(function (this: Model) {
    const k = this.params.development!.metresPerUnit;
    originalWater = this.params.coastlineGeometry!.map(r => r.map(p => p.scale(k)));
    return probe.call(this);
  });
  const input = { ...aldford.burg, population, oceanBearing } as AzgaarBurgInput;
  const model = createSettlementModel(input, { seed });
  const harbour = model.scene.layers.harbours![0];
  expect(harbour.kind).toBe('protected');
  expect(harbour.basin.length).toBeGreaterThanOrEqual(4);
  for (const p of harbour.basin) {
    expect(originalWater.filter(r => pointInPolygon(p, r)).length % 2).toBe(0);
    expect(model.scene.layers.water.rings.filter(r => pointInPolygon(p, r)).length % 2).toBe(1);
  }
  expect(originalWater.filter(r => pointInPolygon(harbour.approach[0], r)).length % 2).toBe(1);
  expect(model.residents.unassigned).toBe(0);
  expect(model.scene.layers.walls.length).toBeGreaterThan(0);
});
