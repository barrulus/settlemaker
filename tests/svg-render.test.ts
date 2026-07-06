import { describe, it, expect } from 'vitest';
import { generateFromBurg, themeFrom, type AzgaarBurgInput } from '../src/index.js';
import { generateSvg } from '../src/output/svg-builder.js';
import { WardType } from '../src/types/interfaces.js';

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

describe('svg render: roads', () => {
  it('paints all casings before any core, arteries wider than roads', () => {
    const { model, svg } = generateFromBurg(makeBurg({ population: 12000 }), { seed: 42 });
    expect(model.arteries.length).toBeGreaterThan(0);
    // artery casing 2.4+0.6=3.00, artery core 2.40; road casing 1.6+0.6=2.20, core 1.60
    const lastCasing = Math.max(
      svg.lastIndexOf('stroke-width="3.00"'),
      svg.lastIndexOf('stroke-width="2.20"'),
    );
    const firstCore = Math.min(
      ...['stroke-width="2.40"', 'stroke-width="1.60"']
        .map(s => svg.indexOf(s))
        .filter(i => i >= 0),
    );
    expect(lastCasing).toBeGreaterThan(-1);
    expect(firstCore).toBeGreaterThan(lastCasing);
  });

  it('uses round joins for road strokes', () => {
    const { svg } = generateFromBurg(makeBurg({ population: 12000 }), { seed: 42 });
    expect(svg).toContain('stroke-linejoin="round"');
  });
});

describe('svg render: shadows, buildings, landmarks', () => {
  it('emits one shadow group before buildings, after roads', () => {
    const { svg } = generateFromBurg(makeBurg({ population: 12000 }), { seed: 42 });
    const shadow = svg.indexOf('<g transform="translate(0.40,0.60)" fill="#4a3f2a" opacity="0.18">');
    const lastRoadCore = svg.lastIndexOf('stroke-width="1.60"');
    const firstBuilding = svg.indexOf('fill="#d5ad6e"');
    expect(shadow).toBeGreaterThan(lastRoadCore);
    expect(firstBuilding).toBeGreaterThan(shadow);
  });

  it('shadow count matches building count', () => {
    const { model, svg } = generateFromBurg(makeBurg({ population: 12000 }), { seed: 42 });
    const shadowGroup = svg.slice(
      svg.indexOf('opacity="0.18">'),
      svg.indexOf('</g>'),
    );
    const shadowPaths = (shadowGroup.match(/<path /g) ?? []).length;
    let buildings = 0;
    for (const patch of model.patches) {
      if (!patch.ward) continue;
      // Park geometry (groves) is painted by paintGreens, not shadowed.
      if (patch.ward.type === WardType.Park) continue;
      buildings += patch.ward.geometry.length;
    }
    expect(shadowPaths).toBe(buildings);
  });

  it('does not shadow or repaint Park ward geometry (park overpaint regression)', () => {
    const { model } = generateFromBurg(makeBurg({ population: 12000 }), { seed: 42 });
    const parkPatch = model.patches.find(p => p.ward && p.ward.geometry.length > 0);
    expect(parkPatch).toBeDefined();
    const ward = parkPatch!.ward!;
    ward.type = WardType.Park;
    const svg = generateSvg(model);

    // greenFill for parchment (default palette) = cssHex(0x8fa26a) = '#8fa26a'
    const greenFill = '#8fa26a';
    const paths = ward.geometry.map(poly => {
      const [first, ...rest] = poly.vertices;
      const start = `M${first.x.toFixed(2)},${first.y.toFixed(2)}`;
      return start;
    });

    // Every geometry path should appear painted with greenFill.
    for (const start of paths) {
      const idx = svg.indexOf(start);
      expect(idx).toBeGreaterThan(-1);
    }

    // None of those paths should also appear with the building tan fill.
    const shadowGroup = svg.slice(
      svg.indexOf('opacity="0.18">'),
      svg.indexOf('</g>'),
    );
    for (const start of paths) {
      expect(shadowGroup).not.toContain(start);
      const buildingRegex = new RegExp(
        `<path d="${start.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^"]*" fill="#d5ad6e"`,
      );
      expect(svg).not.toMatch(buildingRegex);
    }
    expect(svg).toContain(`fill="${greenFill}"`);
  });

  it('landmark wards use the landmark fill', () => {
    const { model, svg } = generateFromBurg(
      makeBurg({ citadel: true, temple: true, population: 12000 }),
      { seed: 42 },
    );
    const hasLandmarkWard = model.patches.some(
      p => p.ward && ['castle', 'cathedral', 'market'].includes(String(p.ward.type)),
    );
    if (hasLandmarkWard) {
      // landmarkFill parchment = blend(0xd5ad6e, 0xffffff, 0.45):
      // r 213+42×0.45=231.9→232 (e8), g 173+82×0.45=209.9→210 (d2),
      // b 110+145×0.45=175.25→175 (af) → #e8d2af
      expect(svg).toContain('fill="#e8d2af"');
    }
  });
});

describe('svg render: overrides + determinism', () => {
  it('honors options.theme overrides', () => {
    const { model } = generateFromBurg(makeBurg(), { seed: 42 });
    const svg = generateSvg(model, { theme: { buildingFill: '#ff0000' } });
    expect(svg).toContain('fill="#ff0000"');
    expect(svg).not.toContain('fill="#d5ad6e"');
  });

  it('honors options.palette via themeFrom', () => {
    const { model } = generateFromBurg(makeBurg(), { seed: 42 });
    const svg = generateSvg(model, { palette: { paper: 0x111111, light: 0x222222, medium: 0x333333, dark: 0x444444 } });
    expect(svg).toContain('fill="#111111"');
  });

  it('is byte-identical across runs (determinism)', () => {
    const a = generateFromBurg(makeBurg({ port: true, oceanBearing: 90 }), { seed: 777 });
    const b = generateFromBurg(makeBurg({ port: true, oceanBearing: 90 }), { seed: 777 });
    expect(a.svg).toBe(b.svg);
  });

  it('walls paint after buildings', () => {
    const { svg } = generateFromBurg(makeBurg({ walls: true }), { seed: 42 });
    const lastBuilding = svg.lastIndexOf('fill="#d5ad6e"');
    const wall = svg.lastIndexOf('stroke-width="1.80"');
    expect(wall).toBeGreaterThan(lastBuilding);
  });

  it('exports themeFrom from the package root', () => {
    expect(typeof themeFrom).toBe('function');
  });

  it('ignores explicit-undefined theme overrides instead of clobbering the default', () => {
    const { model } = generateFromBurg(makeBurg({ port: true, oceanBearing: 90 }), { seed: 42 });
    const svg = generateSvg(model, { theme: { water: undefined } });
    expect(svg).not.toContain('fill="undefined"');
    expect(svg).not.toContain('stroke="undefined"');
    // Default parchment water color still renders.
    expect(svg).toContain('fill="#85bcb2"');
  });
});
