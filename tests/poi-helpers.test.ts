import { describe, it, expect } from 'vitest';
import { generateFromBurg, type AzgaarBurgInput } from '../src/index.js';
import { isWaterAdjacent, regimeFor } from '../src/poi/poi-selector.js';

function makeBurg(overrides: Partial<AzgaarBurgInput> = {}): AzgaarBurgInput {
  return {
    name: 'B', population: 500, port: false, citadel: false,
    walls: true, plaza: true, temple: false, shanty: false, capital: false,
    ...overrides,
  };
}

describe('regimeFor', () => {
  it('returns hamlet when P < 300', () => {
    expect(regimeFor(0)).toBe('hamlet');
    expect(regimeFor(299)).toBe('hamlet');
  });
  it('returns town when P >= 300', () => {
    expect(regimeFor(300)).toBe('town');
    expect(regimeFor(100000)).toBe('town');
  });
});

describe('isWaterAdjacent', () => {
  it('returns false for a landlocked burg', () => {
    const { model } = generateFromBurg(makeBurg(), { seed: 1 });
    expect(isWaterAdjacent(model)).toBe(false);
  });

  it('returns true for a port burg with a harbour', () => {
    const { model } = generateFromBurg(
      makeBurg({ port: true, population: 8000, oceanBearing: 90, harbourSize: 'large' }),
      { seed: 1 },
    );
    expect(isWaterAdjacent(model)).toBe(true);
  });
});
