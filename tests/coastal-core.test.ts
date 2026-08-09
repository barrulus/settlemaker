import { describe, test, expect } from 'vitest';
import { Model, mapToGenerationParams } from '../src/index.js';

const portBurg = (seed: number) => mapToGenerationParams({
  name: 'Port', population: 20000, port: true, citadel: false, walls: true,
  plaza: true, temple: false, shanty: false, capital: false,
  roadBearings: [0, 240], oceanBearing: 90, harbourSize: 'large',
}, seed);

describe('water-first classification', () => {
  test('no core patch centroid is in water, any seed', () => {
    for (const seed of [1, 2, 3, 5, 8]) {
      const m = new Model(portBurg(seed)).generate();
      for (const p of m.inner) {
        expect(m.isWaterAt(p.shape.center)).toBe(false);
      }
    }
  });
  test('no wall vertex is in water', () => {
    for (const seed of [1, 2, 3, 5, 8]) {
      const m = new Model(portBurg(seed)).generate();
      for (const v of m.border!.shape.vertices) {
        expect(m.isWaterAt(v)).toBe(false);
      }
    }
  });
});
