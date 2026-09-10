import { beforeAll, describe, expect, it } from 'vitest';
import { polylineLength } from '../../src/village/geometry.js';
import { newLotTrace } from '../../src/village/lot-trace.js';
import { networkComponents, roadNetwork } from '../../src/village/skeleton/network.js';
import { isTrunk } from '../../src/village/skeleton/trunks.js';
import { generateVillage } from '../../src/village/village-model.js';
import baseline from '../fixtures/village-roads-baseline.json';
import { roadFixture, roadReviewFixtures } from '../fixtures/village-roads.js';

const fixtures = roadReviewFixtures.filter(f => f.input.population <= 1000);
const models = new Map<string, ReturnType<typeof generateVillage>>();
beforeAll(async () => {
  for (const f of fixtures) {
    models.set(f.id, generateVillage(f.input, f.seed));
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}, 60000);
describe('frontage-driven road policy', () => {
  it.each(fixtures)('$id houses its census and keeps occupied frontage connected', f => {
    const m = models.get(f.id)!;
    expect(m.buildings.reduce((sum, b) => sum + b.occupancy, 0)).toBeGreaterThanOrEqual(f.input.population);
    const graph = roadNetwork(m.lanes, m.green, m.buildings, m.lots), groups = networkComponents(graph);
    for (const b of m.buildings) {
      expect(graph.buildings.has(b.id), b.id).toBe(true);
      expect(groups.get(graph.buildings.get(b.id)!), b.id).toBe(groups.get('green'));
    }
  });
  it('at least halves median hamlet internal length without removing homes or required roads', () => {
    const lengths = [1, 2, 3].map(seed => models.get(`p40-s${seed}`)!.lanes.filter(l => !isTrunk(l.id)).reduce((sum, l) => sum + polylineLength(l.points), 0)).sort((a, b) => a - b);
    const before = baseline.rows.filter(f => f.id.startsWith('p40-')).map(f => f.internalMetres!).sort((a, b) => a - b);
    expect(lengths[1]).toBeLessThan(before[1] * 0.5);
    for (const seed of [1, 2, 3]) expect(models.get(`p40-s${seed}`)!.buildings).toHaveLength(8);
  });
  it('keeps diagnostics observational: asking for lot fates cannot change the village', () => {
    const input = roadFixture(300); const trace = newLotTrace();
    const traced = generateVillage(input, 1, trace);
    expect(traced).toEqual(models.get('p300-s1'));
    for (const b of traced.buildings.filter(b => !b.lotId.startsWith('landmark:'))) {
      if (trace.cut.has(b.lotId)) expect(trace.fates.get(b.lotId)).toBe('seated');
    }
  });
  it('uses existing road frontage without inventing a compulsory mesh', () => {
    const m = models.get('trail')!;
    expect(m.lanes.filter(l => !isTrunk(l.id)).reduce((sum, l) => sum + polylineLength(l.points), 0)).toBeLessThan(10);
    expect(m.diagnostics.join(' ')).toContain('0 additions accepted');
  });
});
