import { describe, it, expect } from 'vitest';
import { assembleSvg } from '../src/output/assemble-svg.js';
import { buildScene } from '../src/scene/build-scene.js';
import { SCENE_VERSION, type Scene } from '../src/scene/scene.js';
import { Point } from '../src/types/point.js';
import type { OriginShift } from '../src/generator/origin-shift.js';
import { Model, mapToGenerationParams, type AzgaarBurgInput } from '../src/index.js';

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
    const svg = assembleSvg(sceneWith([WELL, MARK, { ...WELL, id: 'sm-nonexistent' }], [TREE]));
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

  it('every glyph symbol def carries width/height equal to its own viewBox dimensions', () => {
    // Root cause: use->symbol with auto width/height on both renders the
    // symbol at 100% of the nearest viewport (the whole map), not its
    // viewBox size, before glyphTransform's scale shrinks it. Explicit
    // width/height on the <symbol> fixes sizing for every <use> of it
    // (shadows, #symbols, #marks, #canopy) in one place.
    const svg = assembleSvg(sceneWith([WELL, MARK], [TREE]));
    const defRe = /<symbol id="glyph-[^"]*"([^>]*)>/g;
    const matches = [...svg.matchAll(defRe)];
    expect(matches.length).toBeGreaterThan(0);
    for (const m of matches) {
      const attrs = m[1];
      const vbMatch = attrs.match(/viewBox="([\d.\-]+) ([\d.\-]+) ([\d.\-]+) ([\d.\-]+)"/);
      expect(vbMatch).not.toBeNull();
      const [, , , vbW, vbH] = vbMatch!;
      const wMatch = attrs.match(/width="([\d.\-]+)"/);
      const hMatch = attrs.match(/height="([\d.\-]+)"/);
      expect(wMatch, `missing width in: ${m[0]}`).not.toBeNull();
      expect(hMatch, `missing height in: ${m[0]}`).not.toBeNull();
      expect(wMatch![1]).toBe(vbW);
      expect(hMatch![1]).toBe(vbH);
    }
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
  const HOUSE_RECT = { ring: [{x:0,y:0},{x:6,y:0},{x:6,y:6},{x:0,y:6}], kind: 'craftsmen', landmark: false, glyphBacked: true as const };
  const HOUSE_SYM = { id: 'sm-house', at: { x: 3, y: 3 }, scale: 6, rotationDeg: 0, zBand: 'structure' as const };

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
});
