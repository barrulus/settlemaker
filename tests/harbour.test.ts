import { describe, it, expect } from 'vitest';
import { generateFromBurg, mapToGenerationParams } from '../src/index.js';
import type { AzgaarBurgInput } from '../src/index.js';
import { Harbour } from '../src/wards/harbour.js';

function makeBurg(overrides: Partial<AzgaarBurgInput> = {}): AzgaarBurgInput {
  return {
    name: 'TestPort',
    population: 10000,
    port: true,
    citadel: false,
    walls: true,
    plaza: true,
    temple: true,
    shanty: false,
    capital: false,
    oceanBearing: 90,
    harbourSize: 'large',
    ...overrides,
  };
}

describe('harbourSize param passthrough', () => {
  it('passes harbourSize from burg input to generation params', () => {
    const params = mapToGenerationParams(makeBurg(), 42);
    expect(params.harbourSize).toBe('large');
  });

  it('omits harbourSize when not provided', () => {
    const params = mapToGenerationParams(makeBurg({ harbourSize: undefined }), 42);
    expect(params.harbourSize).toBeUndefined();
  });
});

describe('Harbour placement', () => {
  it('places harbour for port with harbourSize + oceanBearing', () => {
    const result = generateFromBurg(makeBurg(), { seed: 42 });
    expect(result.model.harbour).not.toBeNull();
    expect(result.model.harbour!.ward).toBeInstanceOf(Harbour);
  });

  it('no harbour without harbourSize', () => {
    const result = generateFromBurg(
      makeBurg({ harbourSize: undefined }),
      { seed: 42 },
    );
    expect(result.model.harbour).toBeNull();
  });

  it('no harbour without water (no oceanBearing)', () => {
    const result = generateFromBurg(
      makeBurg({ oceanBearing: undefined, harbourSize: 'large' }),
      { seed: 42 },
    );
    expect(result.model.harbour).toBeNull();
  });

  it('harbour patch borders water', () => {
    const result = generateFromBurg(makeBurg(), { seed: 42 });
    const harbour = result.model.harbour!;
    expect(harbour).not.toBeNull();

    // At least one edge should be shared with a water patch
    let hasWaterfrontEdge = false;
    harbour.shape.forEdge((v0, v1) => {
      for (const wp of result.model.waterbody) {
        if (wp.shape.findEdge(v1, v0) !== -1) {
          hasWaterfrontEdge = true;
        }
      }
    });
    expect(hasWaterfrontEdge).toBe(true);
  });

  it('harbour patch is marked withinCity', () => {
    const result = generateFromBurg(makeBurg(), { seed: 42 });
    expect(result.model.harbour!.withinCity).toBe(true);
  });
});

describe('Harbour geometry', () => {
  it('large harbour has >= 3 piers', () => {
    const result = generateFromBurg(makeBurg({ harbourSize: 'large' }), { seed: 42 });
    const ward = result.model.harbour!.ward as Harbour;
    expect(ward.piers.length).toBeGreaterThanOrEqual(3);
  });

  it('small dock has 1-2 piers', () => {
    const result = generateFromBurg(makeBurg({ harbourSize: 'small' }), { seed: 42 });
    const ward = result.model.harbour!.ward as Harbour;
    expect(ward.piers.length).toBeGreaterThanOrEqual(1);
    expect(ward.piers.length).toBeLessThanOrEqual(2);
  });

  it('has warehouse buildings', () => {
    const result = generateFromBurg(makeBurg(), { seed: 42 });
    const ward = result.model.harbour!.ward as Harbour;
    expect(ward.geometry.length).toBeGreaterThan(0);
  });

  it('piers extend beyond harbour patch toward water', () => {
    const result = generateFromBurg(makeBurg(), { seed: 42 });
    const ward = result.model.harbour!.ward as Harbour;
    const harbourCenter = result.model.harbour!.shape.center;

    // At least one pier vertex should be farther from city center than harbour center
    for (const pier of ward.piers) {
      const pierCenter = pier.center;
      // Pier center should be offset from harbour center toward water
      // (water is to the east for bearing 90, so pier x should be > harbour x)
      expect(pierCenter.x).toBeGreaterThan(harbourCenter.x - 5);
    }
  });
});

describe('Harbour labels', () => {
  it('large harbour label is "Harbour"', () => {
    const result = generateFromBurg(makeBurg({ harbourSize: 'large' }), { seed: 42 });
    expect(result.model.harbour!.ward!.getLabel()).toBe('Harbour');
  });

  it('small harbour label is "Dock"', () => {
    const result = generateFromBurg(makeBurg({ harbourSize: 'small' }), { seed: 42 });
    expect(result.model.harbour!.ward!.getLabel()).toBe('Dock');
  });
});

describe('Harbour survives createWards', () => {
  it('harbour ward is not overwritten by createWards', () => {
    const result = generateFromBurg(makeBurg(), { seed: 42 });
    expect(result.model.harbour!.ward).toBeInstanceOf(Harbour);
    expect(result.model.harbour!.ward!.type).toBe('harbour');
  });
});

describe('Harbour determinism', () => {
  it('same seed produces identical harbour', () => {
    const burg = makeBurg();
    const r1 = generateFromBurg(burg, { seed: 42 });
    const r2 = generateFromBurg(burg, { seed: 42 });
    expect(r1.svg).toBe(r2.svg);
    expect(r1.model.harbour !== null).toBe(r2.model.harbour !== null);
    if (r1.model.harbour && r2.model.harbour) {
      const w1 = r1.model.harbour.ward as Harbour;
      const w2 = r2.model.harbour.ward as Harbour;
      expect(w1.piers.length).toBe(w2.piers.length);
      expect(w1.geometry.length).toBe(w2.geometry.length);
    }
  });
});

describe('Backward compatibility', () => {
  it('no harbourSize = no harbour', () => {
    const result = generateFromBurg(
      makeBurg({ harbourSize: undefined, oceanBearing: undefined }),
      { seed: 42 },
    );
    expect(result.model.harbour).toBeNull();
  });

  it('non-port city without harbour still works', () => {
    const burg: AzgaarBurgInput = {
      name: 'Inland',
      population: 5000,
      port: false,
      citadel: true,
      walls: true,
      plaza: true,
      temple: true,
      shanty: false,
      capital: false,
    };
    const result = generateFromBurg(burg, { seed: 42 });
    expect(result.model.harbour).toBeNull();
    expect(result.svg).toMatch(/^<svg xmlns/);
  });
});
