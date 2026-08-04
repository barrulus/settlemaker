import { describe, it, expect } from 'vitest';
import { generateFromBurg, type AzgaarBurgInput } from '../src/index.js';

// Open sea east of the burg: shoreline at x=40 (inside the frame), far edge at
// x=1500 (far beyond it). Output coords equal input coords: generateFromBurg
// pre-shifts rings before generation and re-adds the shift when painting.
const seaEast = [[
  { x: 40, y: -1500 },
  { x: 1500, y: -1500 },
  { x: 1500, y: 1500 },
  { x: 40, y: 1500 },
]];

const coastalBurg: AzgaarBurgInput = {
  name: 'Watertest',
  population: 300,
  port: false,
  citadel: false,
  walls: false,
  plaza: true,
  temple: false,
  shanty: false,
  capital: false,
  coastlineGeometry: seaEast,
};

function viewBoxOf(svg: string): { minX: number; minY: number; maxX: number; maxY: number } {
  const m = svg.match(/viewBox="(-?[\d.]+) (-?[\d.]+) ([\d.]+) ([\d.]+)"/);
  expect(m).not.toBeNull();
  const [, x, y, w, h] = m!;
  return {
    minX: parseFloat(x),
    minY: parseFloat(y),
    maxX: parseFloat(x) + parseFloat(w),
    maxY: parseFloat(y) + parseFloat(h),
  };
}

describe('water rendered from coastline geometry', () => {
  it('paints the supplied rings as one clipped even-odd path', () => {
    const { svg } = generateFromBurg(coastalBurg);
    expect(svg).toContain('<clipPath id="frame-clip">');
    expect(svg).toContain('clip-path="url(#frame-clip)"');
    expect(svg).toContain('fill-rule="evenodd"');
  });

  it('open sea extends past the frame edge instead of closing into a pond', () => {
    const { svg } = generateFromBurg(coastalBurg);
    const vb = viewBoxOf(svg);
    // Shoreline is visible inside the frame…
    expect(40).toBeLessThan(vb.maxX);
    // …and the ring continues beyond it, so after clipping the water
    // visually reaches the frame edge (no far shore inside the frame).
    expect(1500).toBeGreaterThan(vb.maxX);
  });

  it('no building or farm plot overhangs the supplied water', () => {
    const { model } = generateFromBurg(coastalBurg);
    // Model-frame check: params rings and ward geometry share the same frame.
    const ring = model.params.coastlineGeometry![0];
    const shoreX = Math.min(...ring.map(p => p.x)); // rectangle sea: straight shoreline
    for (const patch of model.patches) {
      if (!patch.ward) continue;
      for (const poly of patch.ward.geometry) {
        for (const v of poly.vertices) {
          expect(v.x).toBeLessThanOrEqual(shoreX + 1e-6);
        }
      }
    }
  });

  it('clipId option renames the clipPath and its reference (multi-SVG documents)', () => {
    const { svg } = generateFromBurg(coastalBurg, { svg: { clipId: 'frame-clip-watertest' } });
    expect(svg).toContain('<clipPath id="frame-clip-watertest">');
    expect(svg).toContain('clip-path="url(#frame-clip-watertest)"');
    expect(svg).not.toContain('"frame-clip"');
  });

  it('oceanBearing-only burgs keep the patch-painted fallback', () => {
    const { svg } = generateFromBurg({
      ...coastalBurg,
      coastlineGeometry: undefined,
      oceanBearing: 90,
    });
    expect(svg).not.toContain('fill-rule="evenodd"');
  });
});
