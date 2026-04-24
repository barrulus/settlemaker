import { describe, it, expect } from 'vitest';
import { Model, mapToGenerationParams, generateFromBurg, type AzgaarBurgInput } from '../src/index.js';

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

describe('citadel fallback via staged retries', () => {
  // Yarwick: pop=199, citadel=true. With its hashString("Yarwick") seed,
  // every retry in the 20-attempt loop produces compactness < 0.75 — the
  // default retry loop exhausts and the citadel-drop fallback must kick in.
  it('drops citadel for the Yarwick case via fallback instead of throwing', () => {
    const result = generateFromBurg(burg({
      name: 'Yarwick',
      population: 199,
      citadel: true,
      walls: false,
    }));
    expect(result.model.degradedFlags.has('citadel')).toBe(true);
    expect(result.model.citadel).toBeNull();
  });

  it('drops citadel for the Undraladrynn case via fallback instead of throwing', () => {
    const result = generateFromBurg(burg({
      name: 'Undraladrynn',
      population: 181,
      citadel: true,
      walls: false,
    }));
    expect(result.model.degradedFlags.has('citadel')).toBe(true);
    expect(result.model.citadel).toBeNull();
  });
});

describe('walls fallback for pop ≥ threshold cases', () => {
  // Monmouth et al. are covered by Task 2's up-front constructor drop.
  // This test verifies the existing walls fallback path: if an unknown
  // geometry failure exhausts retries while walls is still requested,
  // the fallback drops walls and retries.
  //
  // We can't easily construct a deterministic case that exhausts 20
  // wall-retries but succeeds without walls (the known pop-50 cases are
  // pre-empted by Task 2). So we only assert the three Task 2 cases still
  // pass — the walls fallback code path is defensive; its exercise would
  // require injecting failures, which we don't do in this suite.
  for (const name of ['Monmouth', 'Wargmore', 'Skipton']) {
    it(`generates ${name} (pop=50, walls=true) without throwing`, () => {
      const result = generateFromBurg(burg({
        name,
        population: 50,
        walls: true,
      }));
      expect(result.model.degradedFlags.has('walls')).toBe(true);
      expect(result.model.wall).toBeNull();
    });
  }
});

describe('degradedFlags on generateFromBurg result', () => {
  it('exposes degradedFlags as a sorted array', () => {
    const result = generateFromBurg(burg({
      name: 'BothDegraded',
      population: 50,   // forces walls drop via the up-front threshold
      walls: true,
      citadel: true,    // may or may not degrade depending on geometry — walls is the guaranteed entry
    }));
    expect(Array.isArray(result.degradedFlags)).toBe(true);
    expect(result.degradedFlags).toContain('walls');
    // Sorted for deterministic consumer output.
    const copy = [...result.degradedFlags].sort();
    expect(result.degradedFlags).toEqual(copy);
  });

  it('returns an empty array when nothing is degraded', () => {
    const result = generateFromBurg(burg({
      name: 'Clean',
      population: 5000,
      walls: true,
      citadel: false,
    }));
    expect(result.degradedFlags).toEqual([]);
  });
});
