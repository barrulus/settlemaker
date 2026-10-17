import { afterEach, describe, expect, it, vi } from 'vitest';
import { Model } from '../src/generator/model.js';
import { blockLayout } from '../src/settlement/layouts.js';
import { resolveDevelopment } from '../src/settlement/development.js';
import * as inlet from '../src/settlement/harbour-inlet.js';
import * as harbourPlan from '../src/wards/harbour-plan.js';
import { waterBoundaryPaths, waterFillRings } from '../src/village/water-boundary.js';
import type { GenerationTimingObserver } from '../src/generator/timing.js';
import type { AzgaarBurgInput } from '../src/input/azgaar-input.js';
import tetlapan from './fixtures/tetlapan-coast.json';

const input = tetlapan.burg as AzgaarBurgInput;
const layout = (observe?: GenerationTimingObserver) => blockLayout(input, tetlapan.seed,
  resolveDevelopment(input.population, input.walls, { preset: 'city' }), undefined, undefined, observe);
afterEach(() => vi.restoreAllMocks());

function expectSameCoordinates(actual: Array<Array<{x:number;y:number}>>, expected: Array<Array<{x:number;y:number}>>, scale = 1) {
  expect(actual).toHaveLength(expected.length);
  for (const [i, ring] of actual.entries()) {
    expect(ring).toHaveLength(expected[i].length);
    for (const [j, p] of ring.entries()) {
      expect(p.x * scale).toBeCloseTo(expected[i][j].x, 9);
      expect(p.y * scale).toBeCloseTo(expected[i][j].y, 9);
    }
  }
}

describe('optional harbour inlet rollback', () => {
  it('preserves the original city and water caches when the trial shore cannot retain its harbour', () => {
    const shaping = vi.spyOn(inlet, 'harbourInlet').mockReturnValue(null);
    const original = layout();
    shaping.mockRestore();
    const plan = harbourPlan.planHarbour;
    let originalWater = '', rejectedTrials = 0;
    vi.spyOn(harbourPlan, 'planHarbour').mockImplementation(site => {
      const water = JSON.stringify(site.water);
      originalWater ||= water;
      if (water !== originalWater) { rejectedTrials++; return null; }
      return plan(site);
    });
    const generate = Model.prototype.generate;
    let generated: Model | undefined, originalParams = '';
    vi.spyOn(Model.prototype, 'generate').mockImplementation(function (this: Model) {
      generated = this; originalParams = JSON.stringify(this.params);
      return generate.call(this);
    });
    const retained = layout();
    expect(rejectedTrials).toBeGreaterThan(0);
    expect(JSON.stringify(generated!.params)).toBe(originalParams);
    expect(retained.scene).toEqual(original.scene);
    expect(retained.buildings).toEqual(original.buildings);
    expect(retained.site.water).toEqual(original.site.water);
    expect(retained.site.syntheticCoast).toEqual(original.site.syntheticCoast);
    // These caches use the outer water-array identity; restoring only the
    // source polygon would leave planning and rendering with different banks.
    expect(waterFillRings(retained.site.water)).toEqual(waterFillRings(original.site.water));
    expect(waterBoundaryPaths(retained.site.water)).toEqual(waterBoundaryPaths(original.site.water));
  });

  it('restores the original shore before retrying a failure after terrain shaping', () => {
    const shape = inlet.harbourInlet, shoreInputs: string[] = [];
    vi.spyOn(inlet, 'harbourInlet').mockImplementation((shore, plan, metresPerUnit) => {
      shoreInputs.push(JSON.stringify(shore));
      return shape(shore, plan, metresPerUnit);
    });
    const generate = Model.prototype.generate;
    let generated: Model | undefined, originalWater = '';
    vi.spyOn(Model.prototype, 'generate').mockImplementation(function (this: Model) {
      generated = this; originalWater = JSON.stringify(this.params.coastlineGeometry);
      return generate.call(this);
    });
    let topologyPasses = 0, failedAfterShaping = false;
    const retained = layout(timing => {
      if (timing.stage !== 'topology') return;
      topologyPasses++;
      if (!failedAfterShaping && JSON.stringify(generated!.params.coastlineGeometry) !== originalWater) {
        failedAfterShaping = true;
        throw new Error('Retry after harbour terrain has been accepted');
      }
    });
    expect(failedAfterShaping).toBe(true);
    expect(topologyPasses).toBeGreaterThan(1);
    expect(shoreInputs.length).toBeGreaterThan(1);
    expect(new Set(shoreInputs).size).toBe(1); // rounded headlands never accumulate between attempts
    expect(retained.site.syntheticCoast!.shoreline).toEqual(retained.site.water[0].slice(0, -2));
    expectSameCoordinates(generated!.params.coastlineGeometry!, waterFillRings(retained.site.water)!, 3);
    expectSameCoordinates(generated!.params.waterShorelines!, waterBoundaryPaths(retained.site.water), 3);
    expectSameCoordinates(retained.scene.layers.water.rings, waterFillRings(retained.site.water)!);
  });

  it('does not hide failure of the original city behind the optional terrain fallback', () => {
    vi.spyOn(Model.prototype, 'generate').mockImplementation(() => { throw new Error('Initial city failed'); });
    expect(() => layout()).toThrow('Initial city failed');
  });
});
