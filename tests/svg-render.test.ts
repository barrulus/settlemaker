import { describe, it, expect } from 'vitest';
import { generateFromBurg, type AzgaarBurgInput } from '../src/index.js';
import { generateSvg } from '../src/output/svg-builder.js';
import { PALETTE_PARCHMENT } from '../src/output/palette.js';

function makeBurg(overrides: Partial<AzgaarBurgInput> = {}): AzgaarBurgInput {
  return {
    name: 'RenderBurg',
    population: 5000,
    port: false,
    citadel: true,
    walls: true,
    plaza: true,
    temple: true,
    shanty: false,
    capital: false,
    ...overrides,
  };
}

describe('svg render: fields and water', () => {
  it('renders farm subplots with the pale field wash, not the loud green', () => {
    const { model } = generateFromBurg(makeBurg({ population: 12000 }), { seed: 42 });
    const svg = generateSvg(model);
    // fieldFill for parchment = blend(0xfff2c8, 0x8fa26a, 0.08) = #f6ecc0
    expect(svg).toContain('fill="#f6ecc0"');
  });

  it('gives every water patch a same-color seam stroke', () => {
    const { model, svg } = generateFromBurg(
      makeBurg({ port: true, oceanBearing: 90 }),
      { seed: 42 },
    );
    expect(model.waterbody.length).toBeGreaterThan(0);
    const waterPaths = svg.match(/<path[^>]*fill="#85bcb2"[^>]*\/>/g) ?? [];
    expect(waterPaths.length).toBeGreaterThan(0);
    for (const p of waterPaths) {
      expect(p).toContain('stroke="#85bcb2"');
      expect(p).toContain('stroke-width="0.50"');
    }
  });

  it('draws shore strokes on outer water edges only', () => {
    const { svg } = generateFromBurg(
      makeBurg({ port: true, oceanBearing: 90 }),
      { seed: 42 },
    );
    // waterEdge for parchment = darken(0x85bcb2, 0.2) = #6a968e
    const shoreLines = svg.match(/stroke="#6a968e"/g) ?? [];
    expect(shoreLines.length).toBeGreaterThan(0);
  });

  it('keeps the data-bg contract for the tiler', () => {
    const { svg } = generateFromBurg(makeBurg(), { seed: 42 });
    expect(svg).toMatch(/<rect data-bg="paper" x="[-\d.]+" y="[-\d.]+" width="[\d.]+" height="[\d.]+" fill="#fff2c8"\/>/);
  });

  it('paints background before water before buildings', () => {
    const { svg } = generateFromBurg(
      makeBurg({ port: true, oceanBearing: 90 }),
      { seed: 42 },
    );
    const bg = svg.indexOf('data-bg="paper"');
    const water = svg.indexOf('fill="#85bcb2"');
    const building = svg.indexOf(`fill="#d5ad6e"`);
    expect(bg).toBeGreaterThan(-1);
    expect(water).toBeGreaterThan(bg);
    expect(building).toBeGreaterThan(water);
  });
});
