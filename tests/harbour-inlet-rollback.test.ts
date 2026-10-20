import { afterEach, describe, expect, it, vi } from 'vitest';
import { Model } from '../src/generator/model.js';
import { blockLayout } from '../src/settlement/layouts.js';
import { resolveDevelopment } from '../src/settlement/development.js';
import * as inlet from '../src/settlement/recessed-harbour.js';
import { waterBoundaryPaths, waterFillRings } from '../src/village/water-boundary.js';
import { WaterContextError } from '../src/input/water-context.js';
import type { AzgaarBurgInput } from '../src/input/azgaar-input.js';
import aldford from './fixtures/aldford-harbour.json';

const input = aldford.burg as AzgaarBurgInput;
const layout = () => blockLayout(input, aldford.seed,
  resolveDevelopment(input.population, input.walls, { preset: 'city' }));
afterEach(() => vi.restoreAllMocks());

describe('recessed harbour trial isolation', () => {
  it('retains the original city and water caches when no inset city can be generated', () => {
    const shaping = vi.spyOn(inlet, 'recessedHarbour').mockReturnValue(null);
    const original = layout();
    shaping.mockRestore();
    const generate = Model.prototype.generate;
    let rejected = 0;
    vi.spyOn(Model.prototype, 'generate').mockImplementation(function (this: Model) {
      if (this.params.harbourShorelines) { rejected++; throw new Error('Trial city failed'); }
      return generate.call(this);
    });
    const retained = layout();
    expect(rejected).toBeGreaterThan(0);
    expect(retained.scene).toEqual(original.scene);
    expect(retained.buildings).toEqual(original.buildings);
    expect(retained.site.water).toEqual(original.site.water);
    expect(retained.site.syntheticCoast).toEqual(original.site.syntheticCoast);
    expect(waterFillRings(retained.site.water)).toEqual(waterFillRings(original.site.water));
    expect(waterBoundaryPaths(retained.site.water)).toEqual(waterBoundaryPaths(original.site.water));
    expect(retained.diagnostics.some(d => d.includes('recessed harbour basin could not fit'))).toBe(true);
  });

  it('propagates insufficient survey coverage rather than silently hiding it', () => {
    vi.spyOn(Model.prototype, 'generate').mockImplementation(() => {
      throw new WaterContextError('water-coverage-exceeded', 'Larger survey required', 5000);
    });
    expect(layout).toThrow('water-coverage-exceeded');
  });

  it('does not hide failure of the original city behind an optional basin', () => {
    vi.spyOn(Model.prototype, 'generate').mockImplementation(() => { throw new Error('City failed'); });
    expect(layout).toThrow('City failed');
  });
});
