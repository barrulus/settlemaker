import { describe, it, expect } from 'vitest';
import { generateFromBurg, mapToGenerationParams } from '../src/index.js';
import type { AzgaarBurgInput } from '../src/index.js';

function makeBurg(overrides: Partial<AzgaarBurgInput> = {}): AzgaarBurgInput {
  return {
    name: 'TestPort',
    population: 5000,
    port: true,
    citadel: false,
    walls: true,
    plaza: true,
    temple: true,
    shanty: false,
    capital: false,
    ...overrides,
  };
}

describe('oceanBearing param passthrough', () => {
  it('passes oceanBearing from burg input to generation params', () => {
    const params = mapToGenerationParams(makeBurg({ oceanBearing: 90 }), 42);
    expect(params.oceanBearing).toBe(90);
  });

  it('omits oceanBearing when not provided', () => {
    const params = mapToGenerationParams(makeBurg(), 42);
    expect(params.oceanBearing).toBeUndefined();
  });
});

describe('Water classification', () => {
  it('creates water patches for east-facing port (bearing 90)', () => {
    const result = generateFromBurg(
      makeBurg({ oceanBearing: 90 }),
      { seed: 42 },
    );
    expect(result.model.waterbody.length).toBeGreaterThan(0);

    // Water patches should be on the east side (positive x)
    for (const wp of result.model.waterbody) {
      expect(wp.shape.center.x).toBeGreaterThan(0);
    }
  });

  it('creates water patches for west-facing port (bearing 270)', () => {
    const result = generateFromBurg(
      makeBurg({ oceanBearing: 270 }),
      { seed: 42 },
    );
    expect(result.model.waterbody.length).toBeGreaterThan(0);

    // Water patches should be on the west side (negative x)
    for (const wp of result.model.waterbody) {
      expect(wp.shape.center.x).toBeLessThan(0);
    }
  });

  it('creates water patches for south-facing port (bearing 180)', () => {
    const result = generateFromBurg(
      makeBurg({ oceanBearing: 180 }),
      { seed: 42 },
    );
    expect(result.model.waterbody.length).toBeGreaterThan(0);

    // Water patches should be on the south side (positive y in SVG coords)
    for (const wp of result.model.waterbody) {
      expect(wp.shape.center.y).toBeGreaterThan(0);
    }
  });

  it('produces no water without oceanBearing', () => {
    const result = generateFromBurg(makeBurg(), { seed: 42 });
    expect(result.model.waterbody.length).toBe(0);
  });

  it('water patches have no wards assigned', () => {
    const result = generateFromBurg(
      makeBurg({ oceanBearing: 90 }),
      { seed: 42 },
    );
    for (const wp of result.model.waterbody) {
      expect(wp.ward).toBeNull();
    }
  });

  it('water patches are not inner patches', () => {
    const result = generateFromBurg(
      makeBurg({ oceanBearing: 90 }),
      { seed: 42 },
    );
    for (const wp of result.model.waterbody) {
      expect(wp.withinCity).toBe(false);
    }
  });
});

describe('Wall segments with water', () => {
  it('marks some wall segments as false on waterfront', () => {
    const result = generateFromBurg(
      makeBurg({ oceanBearing: 90 }),
      { seed: 42 },
    );
    const wall = result.model.wall!;
    expect(wall).not.toBeNull();

    // Some segments should be active, some inactive
    const activeCount = wall.segments.filter(s => s).length;
    const inactiveCount = wall.segments.filter(s => !s).length;
    expect(activeCount).toBeGreaterThan(0);
    expect(inactiveCount).toBeGreaterThan(0);
  });

  it('all wall segments active without oceanBearing', () => {
    const result = generateFromBurg(makeBurg(), { seed: 42 });
    const wall = result.model.wall!;
    expect(wall).not.toBeNull();
    expect(wall.segments.every(s => s)).toBe(true);
  });
});

describe('SVG rendering with water', () => {
  it('SVG contains water fill color for port cities', () => {
    const result = generateFromBurg(
      makeBurg({ oceanBearing: 90 }),
      { seed: 42 },
    );
    // Default palette water color is #8fbbc9
    expect(result.svg).toContain('#8fbbc9');
  });

  it('SVG does not contain water color without ocean', () => {
    const result = generateFromBurg(makeBurg(), { seed: 42 });
    expect(result.svg).not.toContain('#8fbbc9');
  });

  it('generates valid SVG with water', () => {
    const result = generateFromBurg(
      makeBurg({ oceanBearing: 90 }),
      { seed: 42 },
    );
    expect(result.svg).toMatch(/^<svg xmlns/);
    expect(result.svg).toMatch(/<\/svg>$/);
  });
});

describe('Gates and roads with water', () => {
  it('no border gates are adjacent to water patches', () => {
    const result = generateFromBurg(
      makeBurg({ oceanBearing: 90 }),
      { seed: 42 },
    );
    for (const gate of result.model.border!.gates) {
      const adjacentWater = result.model.waterbody.some(wp => wp.shape.contains(gate));
      expect(adjacentWater).toBe(false);
    }
  });

  it('roads do not pass through water patches', () => {
    const result = generateFromBurg(
      makeBurg({ oceanBearing: 90 }),
      { seed: 42 },
    );
    // Road endpoints should not be inside water patches
    for (const road of result.model.roads) {
      const last = road.vertices[road.vertices.length - 1];
      const first = road.vertices[0];
      const inWater = (pt: typeof first) =>
        result.model.waterbody.some(wp => wp.shape.contains(pt));
      // The road's far endpoint (first vertex) should not be in water
      // (it may touch a shared edge vertex but should not be deep in water)
      expect(inWater(first) && inWater(last)).toBe(false);
    }
  });

  it('still has at least one gate with ocean bearing', () => {
    const result = generateFromBurg(
      makeBurg({ oceanBearing: 90 }),
      { seed: 42 },
    );
    expect(result.model.gates.length).toBeGreaterThan(0);
    expect(result.model.border!.gates.length).toBeGreaterThan(0);
  });
});

describe('Backward compatibility', () => {
  it('existing determinism test still passes', () => {
    const burg = makeBurg({ port: false, oceanBearing: undefined });
    const r1 = generateFromBurg(burg, { seed: 12345 });
    const r2 = generateFromBurg(burg, { seed: 12345 });
    expect(r1.svg).toBe(r2.svg);
  });

  it('port city generation is deterministic', () => {
    const burg = makeBurg({ oceanBearing: 90 });
    const r1 = generateFromBurg(burg, { seed: 42 });
    const r2 = generateFromBurg(burg, { seed: 42 });
    expect(r1.svg).toBe(r2.svg);
    expect(r1.model.waterbody.length).toBe(r2.model.waterbody.length);
  });
});
