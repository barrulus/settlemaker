import { expect, it } from 'vitest';
import { createSettlementModel, type AzgaarBurgInput } from '../src/index.js';
import erdemeli from './fixtures/erdemeli-coast.json';

it('generates Erdemeli’s original coastal URL without exhausting harbour street retries', () => {
  const input = erdemeli.burg as AzgaarBurgInput;
  const model = createSettlementModel(input, { seed: erdemeli.seed });
  expect(model.residents.requested).toBe(173976);
  expect(model.residents.assigned).toBe(input.population);
  expect(model.residents.unassigned).toBe(0);
  expect(model.residents.insideWalls.assigned).toBe(10000);
  expect(model.scene.layers.harbours).toHaveLength(1);
  expect(model.scene.layers.harbours![0].quays.length).toBeGreaterThan(0);
  expect(model.scene.layers.walls.length).toBeGreaterThan(0);
}, 180000);
