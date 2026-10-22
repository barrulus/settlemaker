import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { createSettlementSession, decodeBurgParam } from '../src/index.js';

// Exact compact FMG URL payload reported for Seave. Its original survey is
// usable, but unioning an optional harbour excavation can fail numerically.
it('renders Seave with its water, walls and population when an inlet trial fails', async () => {
  const payload = readFileSync(new URL('./fixtures/seave-harbour.txt', import.meta.url), 'utf8').trim();
  const { burg, seed } = await decodeBurgParam(payload);
  const before = JSON.stringify(burg);
  const session = createSettlementSession(burg, { seed });
  expect(session.metadata.residents?.assigned).toBe(15934);
  expect(session.metadata.residents?.unassigned).toBe(0);
  expect(session.metadata.degradedFlags).toEqual([]);
  expect(session.metadata.waterContextResult?.status).toBe('approximate');
  expect(session.metadata.waterContextResult?.issues.map(issue => issue.code)).not.toContain('water-context-invalid');
  const layers = session.scene!.layers;
  expect(layers.water.rings.length).toBeGreaterThan(0);
  expect(layers.walls.length).toBeGreaterThan(0);
  expect(layers.harbours?.length).toBeGreaterThan(0);
  expect(layers.bridges?.length).toBeGreaterThan(0);
  expect(layers.buildings.length).toBeGreaterThan(0);
  expect(session.renderFull()).toContain('<svg');
  expect(JSON.stringify(burg)).toBe(before);
});
