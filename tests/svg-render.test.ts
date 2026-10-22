import { describe, it, expect } from 'vitest';
import { generateFromBurg } from './helpers/layout-output.js';
import { themeFrom, type AzgaarBurgInput } from '../src/index.js';
import { generateSvg } from '../src/output/svg-builder.js';
import { WardType } from '../src/types/interfaces.js';
import { buildScene } from '../src/scene/build-scene.js';
import { linkedBuildingIds } from '../src/scene/symbol-buildings.js';
import { assembleSvg } from '../src/output/assemble-svg.js';

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
  it('renders farm subplots with the natural temperate field wash', () => {
    const { model } = generateFromBurg(makeBurg({ population: 12000 }), { seed: 42 });
    const svg = generateSvg(model);
    // Shared temperate ground blended toward the regional common colour.
    expect(svg).toContain('#fields .plot{fill:#a4c787');
  });

  it('renders oceanBearing water as one clipped geometry path (synthetic half-plane)', () => {
    const { model, svg } = generateFromBurg(
      makeBurg({ port: true, oceanBearing: 90 }),
      { seed: 42 },
    );
    // Patch classification still drives placement (harbour needs waterbody)…
    expect(model.waterbody.length).toBeGreaterThan(0);
    // …but the painted water is the synthesized half-plane, not patch shapes:
    // exactly one even-odd fill path, no per-patch seam strokes.
    const waterFills = svg.match(/<path class="fill"[^>]*fill-rule="evenodd"[^>]*\/>/g) ?? [];
    expect(waterFills.length).toBe(1);
    expect(svg).toContain('#water .fill{fill:#85bcb2');
  });

  it('draws shore strokes on outer water edges only', () => {
    const { svg } = generateFromBurg(
      makeBurg({ port: true, oceanBearing: 90 }),
      { seed: 42 },
    );
    // waterEdge for parchment = darken(0x85bcb2, 0.2) = #6a968e; the shore
    // color lives once in the style block, painted by a single shore path.
    expect(svg).toContain('#water .shore{fill:none;stroke:#6a968e');
    const shorePaths = svg.match(/<path class="shore"/g) ?? [];
    expect(shorePaths.length).toBeGreaterThan(0);
  });

  it('keeps the data-bg contract for the tiler', () => {
    const { svg } = generateFromBurg(makeBurg(), { seed: 42 });
    expect(svg).toMatch(/<rect data-bg="paper" x="[-\d.]+" y="[-\d.]+" width="[\d.]+" height="[\d.]+" fill="#a3c98d"\/>/);
  });

  it('paints background before water before buildings', () => {
    const { svg } = generateFromBurg(
      makeBurg({ port: true, oceanBearing: 90 }),
      { seed: 42 },
    );
    const bg = svg.indexOf('data-bg="paper"');
    const water = svg.indexOf('<g id="water"');
    const building = svg.indexOf('<g id="buildings"');
    expect(bg).toBeGreaterThan(-1);
    expect(water).toBeGreaterThan(bg);
    expect(building).toBeGreaterThan(water);
  });
});

describe('svg render: roads', () => {
  it('paints all road casings before their inner surfaces', () => {
    const { model, svg } = generateFromBurg(makeBurg({ population: 12000 }), { seed: 42 });
    expect(model.arteries.length).toBeGreaterThan(0);
    const lastCasing = svg.lastIndexOf('class="casing"');
    const firstCore = svg.indexOf('class="core"');
    expect(lastCasing).toBeGreaterThan(-1);
    expect(firstCore).toBeGreaterThan(lastCasing);
  });

  it('draws surveyed inner streets at full width without borders, including tapered surfaces', () => {
    const {model}=generateFromBurg(makeBurg({population:1200}),{seed:42});
    const scene=buildScene(model);
    for(const role of ['trunk','street','service'] as const) {
      scene.layers.roads=[{path:[{x:0,y:0},{x:10,y:0}],kind:'alley',role,width:3}];
      const svg=assembleSvg(scene);
      expect(svg).not.toContain('class="casing"');
      expect(svg).not.toContain('class="surface-casing"');
      expect(svg).toContain('<path class="core" d="M0.00,0.00L10.00,0.00" stroke-width="3.00"/>');
      scene.layers.roads[0].taper=[3,2];
      const tapered=assembleSvg(scene);
      expect(tapered).not.toContain('class="surface-casing"');
      const surface=tapered.match(/<path class="surface-core" d="([^"]+)"/)!;
      const points=[...surface[1].matchAll(/[ML]([-\d.]+),([-\d.]+)/g)].map(m=>[Number(m[1]),Number(m[2])]);
      // The surface helper includes a small antialias overlap at each edge.
      for(const [x,width] of [[0,3],[10,2]]) {
        const ys=points.filter(p=>p[0]===x).map(p=>p[1]);
        const painted=Math.max(...ys)-Math.min(...ys);
        expect(painted).toBeGreaterThanOrEqual(width);
        expect(painted).toBeLessThan(width+.1);
      }
    }
  });

  it('uses round joins for road strokes', () => {
    const { svg } = generateFromBurg(makeBurg({ population: 12000 }), { seed: 42 });
    expect(svg).toContain('stroke-linejoin:round');
  });
});

describe('svg render: shadows, buildings, landmarks', () => {
  it('emits one shadow group before buildings, after roads', () => {
    const { svg } = generateFromBurg(makeBurg({ population: 12000 }), { seed: 42 });
    const shadow = svg.indexOf('<g id="shadows" transform="translate(0.40,0.60)">');
    const lastRoadCore = svg.lastIndexOf('stroke-width="1.60"');
    const firstBuilding = svg.indexOf('<g id="buildings"');
    expect(shadow).toBeGreaterThan(lastRoadCore);
    expect(firstBuilding).toBeGreaterThan(shadow);
  });

  it('shadows represent every building exactly once, including compound wings', () => {
    const { model, svg } = generateFromBurg(makeBurg({ population: 12000 }), { seed: 42 });
    const shadowGroup = svg.match(/<g id="shadows"[^>]*>([\s\S]*?)<\/g>/)![1];
    const shadowIds = [...shadowGroup.matchAll(/<(?:path|use)\b[^>]*>/g)].flatMap(([tag]) => {
      const buildingId = tag.match(/data-building-id="([^"]+)"/)?.[1];
      const buildingIds = tag.match(/data-building-ids="([^"]+)"/)?.[1].split(' ');
      return [...linkedBuildingIds({ buildingId, buildingIds })];
    });
    // A compound has one silhouette but several real wing footprints. Parks
    // are absent from the scene's buildings and must not acquire shadows.
    expect(new Set(shadowIds).size).toBe(shadowIds.length);
    expect(shadowIds.sort()).toEqual(buildScene(model).layers.buildings.map(b => b.id).sort());
  });

  it('keeps well shadows attached at legacy and metre scales without changing building shadows', () => {
    const { model } = generateFromBurg(makeBurg({ population: 1200 }), { seed: 42 });
    const scene = buildScene(model);
    const house = scene.layers.symbols.find(s => s.buildingId)!;
    expect(house).toBeDefined();
    house.materialVariant = undefined;
    // The same renderer handles both legacy mesh units and physical metres.
    for (const scale of [0.99, 3.6]) for (const offset of [
      undefined, { dx: -4, dy: 3 }, { dx: 0.01, dy: -0.02 }, { dx: 0, dy: 0 },
    ]) {
      scene.layers.symbols = [house, { id: 'sm-well', at: { x: 0, y: 0 }, scale, rotationDeg: 0, zBand: 'structure' }];
      const svg = assembleSvg(scene, offset ? { theme: { shadowOffset: offset } } : {});
      const parent = svg.match(/<g id="shadows" transform="translate\(([-\d.]+),([-\d.]+)\)">/)!.slice(1).map(Number);
      const transform = (id: string) => svg.match(new RegExp(`<use href="#glyph-${id}"[^>]*transform="([^"]+)"`))![1];
      const body = transform('sm-well'), shadow = transform('sm-well-sil');
      expect(shadow.endsWith(body)).toBe(true); // artwork size/rotation are unchanged
      const correction = shadow.slice(0, shadow.length - body.length).match(/translate\(([-\d.]+),([-\d.]+)\)/)?.slice(1).map(Number) ?? [0, 0];
      const actual = parent.map((value, i) => value + correction[i]);
      const factor = Math.hypot(...parent) === 0 ? 1 : Math.min(1, scale * 0.1 / Math.hypot(...parent));
      actual.forEach((value, i) => expect(value).toBeCloseTo(parent[i] * factor, 3));
      expect(Math.hypot(...actual)).toBeLessThanOrEqual(scale * 0.1 + 0.0001);
      const houseGlyph=`${house.id}${house.artworkVariant!==undefined?`-shape-${house.artworkVariant}`:''}`;
      expect(transform(`${houseGlyph}-sil`)).toBe(transform(houseGlyph));
    }
  });

  it('does not shadow or repaint Park ward geometry (park overpaint regression)', () => {
    const { model } = generateFromBurg(makeBurg({ population: 12000 }), { seed: 42 });
    const parkPatch = model.patches.find(p => p.ward && p.ward.geometry.length > 0);
    expect(parkPatch).toBeDefined();
    const ward = parkPatch!.ward!;
    ward.type = WardType.Park;
    const svg = generateSvg(model);

    // Shared natural temperate common colour.
    const greenFill = '#a8bf6d';
    const paths = ward.geometry.map(poly => {
      const [first] = poly.vertices;
      return `M${first.x.toFixed(2)},${first.y.toFixed(2)}`;
    });

    const greensGroup = svg.split('<g id="greens">')[1]?.split('<g id="roads"')[0] ?? '';
    // Every geometry path should appear painted (in greens).
    for (const start of paths) {
      expect(greensGroup).toContain(start);
    }

    // None of those paths should also appear in shadows or buildings.
    const shadowGroup = svg.match(/<g id="shadows"[^>]*>([\s\S]*?)<\/g>/)?.[1] ?? '';
    const buildingsGroup = svg.match(/<g id="buildings">([\s\S]*?)<\/g>/)?.[1] ?? '';
    for (const start of paths) {
      expect(shadowGroup).not.toContain(start);
      expect(buildingsGroup).not.toContain(start);
    }
    expect(svg).toContain(`#greens > path{fill:${greenFill}`);
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
      // Unfitted landmark polygons match the native city's pale roof planes.
      expect(svg).toContain('#landmarks path{fill:#aab2bd');
    }
  });
});

describe('svg render: overrides + determinism', () => {
  it('honors options.theme overrides', () => {
    const { model } = generateFromBurg(makeBurg(), { seed: 42 });
    const svg = generateSvg(model, { theme: { buildingFill: '#ff0000' } });
    expect(svg).toContain('#buildings path{fill:#ff0000');
    expect(svg).not.toContain('#buildings path{fill:#d5ad6e');
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
    const lastBuilding = svg.lastIndexOf('<g id="buildings"');
    const wall = svg.lastIndexOf('<g id="walls"');
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
    expect(svg).toContain('#water .fill{fill:#85bcb2');
  });
});
