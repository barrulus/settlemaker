import { afterEach, describe, expect, it, vi } from 'vitest';
import { evaluatePlacement } from '../../src/village/placement.js';
import { generateVillage } from '../../src/village/village-model.js';
import { roadFixture } from '../fixtures/village-roads.js';
vi.mock('../../src/village/placement.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/village/placement.js')>();
  return { ...actual, evaluatePlacement: vi.fn(actual.evaluatePlacement) };
});
const evaluate = vi.mocked(evaluatePlacement);
const original = evaluate.getMockImplementation()!;
afterEach(() => { evaluate.mockImplementation(original); evaluate.mockClear(); });
describe('preserving the best valid placement', () => {
  it('stops immediately when existing frontage houses everyone', () => {
    generateVillage(roadFixture(40, { roadBearings: [{ bearing_deg: 225, kind: 'trail' }] }), 2);
    // The initial placement may need a bounded setback/deck retry, but once a
    // housed result is found there must be no subsequent candidate evaluation.
    const results = evaluate.mock.results.map(r => r.value);
    const firstHoused = results.findIndex(r => r.spend.unhoused === 0);
    expect(firstHoused).toBeGreaterThanOrEqual(0);
    expect(firstHoused).toBe(results.length - 1);
  });
  it('retains the initial valid buildings when every later trial loses capacity', () => {
    let first: ReturnType<typeof original> | undefined;
    evaluate.mockImplementation(input => {
      const actual = original(input);
      if (!first) {
        // Force a shortfall independently of the selected artwork's dimensions.
        const buildings=actual.spend.buildings.slice(0,-1),housed=buildings.reduce((n,b)=>n+b.occupancy,0);
        first={...actual,spend:{...actual.spend,buildings,housed,unhoused:input.site.population-housed}};
        return first;
      }
      return { ...actual, spend: { buildings: [], housed: 0, unhoused: input.site.population } };
    });
    const m = generateVillage(roadFixture(80), 1);
    expect(evaluate.mock.calls.length).toBeGreaterThan(1);
    expect(m.buildings).toEqual(first!.spend.buildings);
    expect(m.diagnostics.some(d => d.startsWith('overflow:'))).toBe(true);
  });
});
