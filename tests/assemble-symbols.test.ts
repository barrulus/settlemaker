import { describe, it, expect } from 'vitest';
import { assembleSvg } from '../src/output/assemble-svg.js';
import { REFINED_SET } from '../src/assets/asset-sets.js';
import { buildScene } from '../src/scene/build-scene.js';
import { SCENE_VERSION, type Scene } from '../src/scene/scene.js';
import { Point } from '../src/types/point.js';
import type { OriginShift } from '../src/generator/origin-shift.js';
import { Model, mapToGenerationParams, type AzgaarBurgInput, SCHEMATIC_SET } from '../src/index.js';

// Canonical test-model helper (pattern from tests/degraded-generation.test.ts).
function mk(population: number, seed: number, overrides: Partial<AzgaarBurgInput> = {}): Model {
  return new Model(mapToGenerationParams({
    name: 'Test', population, port: false, citadel: false, walls: false,
    plaza: false, temple: false, shanty: false, capital: false, ...overrides,
  }, seed)).generate();
}

function sceneWith(
  symbols: Scene['layers']['symbols'],
  vegetation: Scene['layers']['vegetation'] = [],
): Scene {
  return {
    version: SCENE_VERSION, seed: 1, population: 500,
    bounds: { min_x: -50, min_y: -50, max_x: 50, max_y: 50 },
    layers: {
      water: { rings: [], synthetic: false },
      fields: [], furrows: [], greens: [], vegetation,
      roads: [], buildings: [], piers: [], walls: [],
      symbols,
    },
  };
}

const WELL = { id: 'sm-well', at: { x: 0, y: 0 }, scale: 3.2, rotationDeg: 45, zBand: 'structure' as const };
const MARK = { id: 'sm-mark-church', at: { x: 5, y: 5 }, scale: 4, rotationDeg: 0, zBand: 'overlay' as const };
const TREE = { at: { x: -10, y: -10 }, kind: 'sm-tree-deciduous', scale: 2, rotationDeg: 0 };

describe('assembler symbol path', () => {
  it('structure symbols land in #symbols with a sil shadow, offset outside rotation', () => {
    const svg = assembleSvg(sceneWith([WELL]));
    expect(svg).toContain('<g id="symbols">');
    expect(svg).toContain('href="#glyph-sm-well"');
    // sil in shadows: the rotation lives on the use transform, the offset on the group
    expect(svg).toMatch(/<g id="shadows" transform="translate\([^)]*\)">[\s\S]*href="#glyph-sm-well-sil"/);
  });

  it('marks land in #marks after #symbols and after #canopy, and drop unknown ids', () => {
    // Overlay support remains available to asset sets; the retired church
    // mark is deliberately not part of the default village artwork.
    const svg = assembleSvg(sceneWith([WELL, MARK, { ...WELL, id: 'sm-nonexistent' }], [TREE]), {
      assetSet: {
        ...REFINED_SET,
        manifest: { ...REFINED_SET.manifest, [MARK.id]: { footprint: null, minScale: 0 } },
        glyphs: { ...REFINED_SET.glyphs, [MARK.id]: {
          viewBox: [0, 0, 32, 32], anchor: [16, 16], body: '<circle cx="16" cy="16" r="4"/>', sil: '',
        } },
      },
    });
    const marks = svg.indexOf('<g id="marks">');
    const canopy = svg.indexOf('<g id="canopy">');
    expect(canopy).toBeGreaterThan(-1);
    expect(marks).toBeGreaterThan(svg.indexOf('<g id="symbols">'));
    expect(marks).toBeGreaterThan(canopy);
    expect(svg.slice(marks)).toContain('href="#glyph-sm-mark-church"');
    // marks never shadow
    expect(svg).not.toMatch(/shadows[\s\S]*sm-mark-church-sil/);
    // unknown manifest id is silently dropped
    expect(svg).not.toContain('sm-nonexistent');
  });

  it('minScale gate drops sub-floor fixed instances', () => {
    // sm-well minScale is 0.35 with footprint 3.2 → scale 0.5 gives ratio ~0.16
    const svg = assembleSvg(sceneWith([{ ...WELL, scale: 0.5 }]));
    expect(svg).not.toContain('glyph-sm-well');
  });

  it('symbols:false removes symbol groups and their defs, keeps everything else', () => {
    const svg = assembleSvg(sceneWith([WELL, MARK], [TREE]), { symbols: false });
    expect(svg).not.toContain('<g id="symbols">');
    expect(svg).not.toContain('<g id="marks">');
    expect(svg).not.toContain('glyph-sm-well');
    expect(svg).not.toContain('glyph-sm-mark-church');
    expect(svg).not.toContain('<symbol id="glyph-sm-well"');
    expect(svg).not.toContain('<symbol id="glyph-sm-mark-church"');
    // canopy is unaffected by the symbols off-switch
    expect(svg).toContain('<g id="canopy">');
  });

  it('a manifest id with no glyph asset in the active asset set is silently dropped', () => {
    const svg = assembleSvg(sceneWith([WELL], []), {
      assetSet: { name: 'empty', symbols: {}, glyphs: {} },
    });
    expect(svg).not.toContain('glyph-sm-well');
    expect(svg).not.toContain('<g id="symbols">');
  });

  it('glyph definitions have no viewport that can rescale instances', () => {
    const svg = assembleSvg(sceneWith([WELL], [TREE]));
    expect(svg).toContain('<g id="glyph-sm-well">');
    expect(svg).toContain('<g id="glyph-sm-well-sil">');
    expect(svg).toContain('<g id="glyph-sm-tree-deciduous">');
    expect(svg).not.toContain('<symbol id="glyph-');
  });

  it('buildScene applies the origin shift to model.symbols instances, unchanged otherwise', () => {
    const model = mk(1200, 11);
    const placed = {
      id: 'sm-well',
      at: new Point(3, 4),
      scale: 3.2,
      rotationDeg: 45,
      zBand: 'structure' as const,
    };
    model.symbols.push(placed);

    const shift: OriginShift = { dx: 7, dy: -3, source: 'coast_pull' };
    const scene = buildScene(model, { shift });

    const instance = scene.layers.symbols.find(s => s.at.x === 10 && s.at.y === 1);
    expect(instance).toBeDefined();
    expect(instance).toMatchObject({
      id: 'sm-well',
      at: { x: 10, y: 1 },
      scale: 3.2,
      rotationDeg: 45,
      zBand: 'structure',
    });
  });
});

describe('glyph-backed buildings', () => {
  const HOUSE_RECT = { id: 'b0', ring: [{x:0,y:0},{x:6,y:0},{x:6,y:6},{x:0,y:6}], kind: 'craftsmen', landmark: false, glyphBacked: true as const };
  const HOUSE_SYM = { id: 'sm-house', buildingId: 'b0', at: { x: 3, y: 3 }, scale: 6, rotationDeg: 0, zBand: 'structure' as const };

  it('suppresses path and rect shadow when symbols render', () => {
    const scene = sceneWith([HOUSE_SYM]);
    scene.layers.buildings.push(HOUSE_RECT);
    const svg = assembleSvg(scene);
    expect(svg).toContain('href="#glyph-sm-house"');
    expect(svg).not.toMatch(/<g id="buildings">[\s\S]*M0\.00,0\.00/);
    expect(svg).not.toMatch(/<g id="shadows"[^>]*>[\s\S]*M0\.00,0\.00/);
  });

  it('symbols:false restores the footprint painting', () => {
    const scene = sceneWith([HOUSE_SYM]);
    scene.layers.buildings.push(HOUSE_RECT);
    const svg = assembleSvg(scene, { symbols: false });
    expect(svg).not.toContain('glyph-sm-house');
    expect(svg).toMatch(/<g id="buildings">[\s\S]*M0\.00,0\.00/);
  });

  it('non-glyphBacked buildings are unaffected either way', () => {
    const scene = sceneWith([]);
    scene.layers.buildings.push({ ...HOUSE_RECT, glyphBacked: undefined });
    const svg = assembleSvg(scene);
    expect(svg).toMatch(/<g id="buildings">[\s\S]*M0\.00,0\.00/);
  });

  // Finding 2: hideBacked used to suppress rects whenever showSymbols was
  // true, even for an asset set with no glyphs at all (assets.glyphs
  // undefined, e.g. the public SCHEMATIC_SET) — leaving glyphBacked
  // dwellings with nothing painted, contradicting scene-schema.md's
  // rect-fallback promise. It must fall back to the rect whenever the
  // active asset set can't paint a glyph, independent of `symbols`.
  it('a glyph-less asset set (SCHEMATIC_SET) paints the footprint rect and emits no glyph-sm-house def', () => {
    const scene = sceneWith([HOUSE_SYM]);
    scene.layers.buildings.push(HOUSE_RECT);
    const svg = assembleSvg(scene, { assetSet: SCHEMATIC_SET });
    expect(svg).toMatch(/<g id="buildings">[\s\S]*M0\.00,0\.00/);
    expect(svg).not.toContain('glyph-sm-house');
  });

  it.each(['missing', 'small', 'unlinked', 'wrong-building', 'overlay'])(
    '%s replacement keeps the footprint and its shadow', failure => {
      const symbol = { ...HOUSE_SYM };
      if (failure === 'missing') symbol.id = 'sm-nonexistent';
      if (failure === 'small') symbol.scale = 0.01;
      if (failure === 'unlinked') symbol.buildingId = '';
      if (failure === 'wrong-building') symbol.buildingId = 'b1';
      const scene = sceneWith([{ ...symbol, zBand: failure === 'overlay' ? 'overlay' : 'structure' }]);
      scene.layers.buildings.push(HOUSE_RECT);
      const svg = assembleSvg(scene);
      expect(svg).toMatch(/<g id="buildings">[\s\S]*M0\.00,0\.00/);
      expect(svg).toMatch(/<g id="shadows"[^>]*>[\s\S]*M0\.00,0\.00/);
    },
  );

  it('an empty glyph collection keeps linked footprints', () => {
    const scene = sceneWith([HOUSE_SYM]);
    scene.layers.buildings.push(HOUSE_RECT);
    const svg = assembleSvg(scene, { assetSet: { name: 'empty', symbols: {}, glyphs: {} } });
    expect(svg).toContain('<g id="buildings">');
    expect(svg).toContain('<g id="shadows"');
    expect(svg).not.toContain('glyph-sm-house');
  });

  it('a legacy scene without explicit identity conservatively retains its footprint', () => {
    const scene = sceneWith([HOUSE_SYM]);
    scene.layers.buildings.push({ ...HOUSE_RECT, id: undefined });
    expect(assembleSvg(scene)).toContain('<g id="buildings">');
  });
});
