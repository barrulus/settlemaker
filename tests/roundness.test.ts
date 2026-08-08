import { describe, it, expect } from 'vitest';
import { generateFromBurg, type AzgaarBurgInput } from '../src/index.js';
import { Polygon } from '../src/geom/polygon.js';

function crossroads(population: number, seed: number): AzgaarBurgInput {
  return {
    name: `Crossford${seed}`, population,
    port: false, citadel: false, walls: true,
    plaza: true, temple: false, shanty: false, capital: false,
    roadBearings: [0, 90, 180, 270],
  };
}

describe('core outline is not a disc', () => {
  it.each([1, 2, 3, 4, 5])('seed %i: walled core is measurably non-circular', (seed) => {
    const { model } = generateFromBurg(crossroads(4000, seed), { seed });
    const outline = new Polygon(model.border!.shape.vertices);
    // 1.0 is a perfect circle. Measured pre-change baseline over these seeds:
    // min 0.858, median 0.889, max 0.951. The bar sits well below the old
    // minimum so passing it proves the shape field did real work.
    expect(outline.compactness).toBeLessThan(0.75);
  });

  it('elongates along the road axis when roads are opposed', () => {
    const burg: AzgaarBurgInput = {
      name: 'Ribbonford', population: 4000,
      port: false, citadel: false, walls: true,
      plaza: true, temple: false, shanty: false, capital: false,
      roadBearings: [90, 270],   // due east and due west
    };
    const { model } = generateFromBurg(burg, { seed: 11 });
    const vs = model.border!.shape.vertices;
    const spanX = Math.max(...vs.map(v => v.x)) - Math.min(...vs.map(v => v.x));
    const spanY = Math.max(...vs.map(v => v.y)) - Math.min(...vs.map(v => v.y));
    expect(spanX).toBeGreaterThan(spanY * 1.15);
  });

  it('keeps the core connected', () => {
    const { model } = generateFromBurg(crossroads(4000, 9), { seed: 9 });
    // Every inner patch must be reachable from the first by adjacency.
    const reached = model.adjacency.hopDistances([model.inner[0]], model.inner.length);
    const innerReached = model.inner.filter(p => reached.has(p)).length;
    expect(innerReached).toBe(model.inner.length);
  });
});
