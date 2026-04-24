import { describe, it, expect } from 'vitest';
import { Model, mapToGenerationParams, generateFromBurg, SETTLEMAKER_VERSION, type AzgaarBurgInput } from '../src/index.js';
import type { FeatureCollection } from 'geojson';

function meta(fc: FeatureCollection): Record<string, unknown> {
  return (fc as unknown as { metadata: Record<string, unknown> }).metadata;
}

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

describe('degraded_flags in GeoJSON metadata', () => {
  it('includes degraded_flags in metadata for a degraded generation', () => {
    const result = generateFromBurg(burg({
      name: 'Tiny',
      population: 50,
      walls: true,
    }));
    const m = meta(result.geojson);
    expect(m.degraded_flags).toEqual(['walls']);
  });

  it('emits an empty degraded_flags array when nothing is degraded', () => {
    const result = generateFromBurg(burg({
      name: 'Clean',
      population: 5000,
    }));
    expect(meta(result.geojson).degraded_flags).toEqual([]);
  });

  it('bumps settlemaker_version to 0.6.0', () => {
    expect(SETTLEMAKER_VERSION).toBe('0.6.0');
    const result = generateFromBurg(burg({ name: 'V', population: 5000 }));
    expect(meta(result.geojson).settlemaker_version).toBe('0.6.0');
  });
});

describe('acceptance: the five named failing burgs', () => {
  // The user's instruction listed five burgs that previously threw
  // "Failed to generate after 20 attempts". Every input must now return a
  // sidecar; `degradedFlags` reflects which flags were auto-dropped (empty
  // when the default retry loop happens to find a valid geometry before
  // any fallback kicks in).
  const cases: Array<{
    input: AzgaarBurgInput;
    expectDegraded: Array<'walls' | 'citadel'>;
  }> = [
    // Atarten's hashString seed happens to find compactness ≥ 0.75 on a
    // retry within the default loop, so no degradation is applied. Success
    // here = sidecar returned without throwing.
    {
      input: burg({ name: 'Atarten',      population: 199, walls: false, citadel: true }),
      expectDegraded: [],
    },
    {
      input: burg({ name: 'Monmouth',     population: 50,  walls: true,  citadel: false }),
      expectDegraded: ['walls'],
    },
    {
      input: burg({ name: 'Wargmore',     population: 50,  walls: true,  citadel: false }),
      expectDegraded: ['walls'],
    },
    {
      input: burg({ name: 'Skipton',      population: 50,  walls: true,  citadel: false }),
      expectDegraded: ['walls'],
    },
    // Undraladrynn: every retry produces compactness < 0.75, so the
    // citadel fallback drops it.
    {
      input: burg({ name: 'Undraladrynn', population: 181, walls: false, citadel: true }),
      expectDegraded: ['citadel'],
    },
  ];

  for (const { input, expectDegraded } of cases) {
    it(`generates ${input.name} with degradedFlags = ${JSON.stringify(expectDegraded)}`, () => {
      const result = generateFromBurg(input);
      expect(result.degradedFlags).toEqual(expectDegraded);
    });
  }
});

describe('fuzz: population × walls × citadel', () => {
  // 271 × 4 = 1084 cases. Each burg generates in ~5-20 ms on a warm process,
  // which keeps total fuzz under a few seconds. If CI tightens we can step
  // population by 5.
  const populations = Array.from({ length: 271 }, (_, i) => 30 + i);
  const flags = [
    { walls: false, citadel: false },
    { walls: true,  citadel: false },
    { walls: false, citadel: true  },
    { walls: true,  citadel: true  },
  ];

  it('produces zero throws across the full grid', () => {
    const failures: string[] = [];
    for (const population of populations) {
      for (const f of flags) {
        try {
          generateFromBurg(burg({
            name: `Fuzz-${population}-${f.walls}-${f.citadel}`,
            population,
            walls: f.walls,
            citadel: f.citadel,
          }));
        } catch (e) {
          failures.push(`pop=${population} walls=${f.walls} citadel=${f.citadel}: ${(e as Error).message}`);
        }
      }
    }
    expect(failures, failures.slice(0, 5).join('\n')).toEqual([]);
  }, 120_000); // 120s safety ceiling
});
