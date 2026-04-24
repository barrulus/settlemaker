import { describe, it, expect } from 'vitest';
import { Model, mapToGenerationParams, type AzgaarBurgInput } from '../src/index.js';

function burg(overrides: Partial<AzgaarBurgInput>): AzgaarBurgInput {
  return {
    name: 'Test',
    population: 100,
    port: false,
    citadel: false,
    walls: false,
    plaza: false,
    temple: false,
    shanty: false,
    capital: false,
    ...overrides,
  };
}

describe('up-front walls threshold', () => {
  it('drops walls when population is below the threshold', () => {
    const model = new Model(mapToGenerationParams(burg({
      name: 'Tiny',
      population: 50,
      walls: true,
    })));
    // Field must be populated BEFORE generate() runs, at construction time.
    expect(model.degradedFlags.has('walls')).toBe(true);
    expect((model as unknown as { wallsNeeded: boolean }).wallsNeeded).toBe(false);
  });

  it('keeps walls when population is at or above the threshold', () => {
    const model = new Model(mapToGenerationParams(burg({
      name: 'Big',
      population: 500,
      walls: true,
    })));
    expect(model.degradedFlags.has('walls')).toBe(false);
  });

  it('does not add walls to degradedFlags if walls were never requested', () => {
    const model = new Model(mapToGenerationParams(burg({
      name: 'Tiny',
      population: 50,
      walls: false,
    })));
    expect(model.degradedFlags.has('walls')).toBe(false);
  });
});
