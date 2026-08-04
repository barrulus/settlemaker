import { describe, it, expect } from 'vitest';
import { generateFromBurg, type AzgaarBurgInput } from '../src/index.js';
import { pointInPolygon } from '../src/geom/point-in-polygon.js';

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

  it('oceanBearing-only burgs render open ocean to the frame edge, not a patch lake', () => {
    const { svg } = generateFromBurg({
      ...coastalBurg,
      coastlineGeometry: undefined,
      oceanBearing: 90,
    });
    // The bearing now synthesizes a half-plane coastline and reuses the
    // geometry water pass — same markers as vector-coastline burgs.
    expect(svg).toContain('fill-rule="evenodd"');
    expect(svg).toContain('clip-path="url(#frame-clip)"');
  });

  it('roads are clipped at the waterline instead of walking on the sea', () => {
    // Organic south coast whose bulges cross the west road's corridor —
    // the case a straight shoreline never triggers (mirrors the
    // compare-versions.ts Saltmere panel that exposed the bug).
    const coast: Array<{ x: number; y: number }> = [];
    for (let s = -1600; s <= 1600; s += 40) {
      const wobble = 30 * Math.sin(s / 230 + 3.4) + 12 * Math.sin(s / 67 + 6.2) + 5 * Math.sin(s / 21 + 10.6);
      coast.push({ x: -s, y: 55 + wobble }); // bearing 180: sea to the south
    }
    coast.push({ x: -1600, y: 2500 });
    coast.push({ x: 1600, y: 2500 });

    const { model } = generateFromBurg({
      name: 'Saltmere',
      population: 350,
      port: true,
      citadel: false,
      walls: false,
      plaza: true,
      temple: false,
      shanty: false,
      capital: false,
      roadBearings: [
        { bearing_deg: 250, kind: 'road', route_id: 'r-west' },
        { bearing_deg: 10, kind: 'foot', route_id: 'f-north' },
      ],
      coastlineGeometry: [coast],
      harbourSize: 'small',
    });

    const rings = model.params.coastlineGeometry!;
    const inWater = (p: { x: number; y: number }): boolean =>
      rings.filter(ring => pointInPolygon(p as Parameters<typeof pointInPolygon>[0], ring)).length % 2 === 1;
    for (const road of model.roads) {
      for (const v of road.vertices) {
        expect(inWater(v)).toBe(false);
      }
    }
  });
});
