import { describe, it, expect } from 'vitest';
import { assembleSvg } from '../src/output/assemble-svg.js';
import { SCENE_VERSION, type Scene } from '../src/scene/scene.js';

function sceneWith(symbols: Scene['layers']['symbols']): Scene {
  return {
    version: SCENE_VERSION, seed: 1, population: 500,
    bounds: { min_x: -50, min_y: -50, max_x: 50, max_y: 50 },
    layers: {
      water: { rings: [], synthetic: false },
      fields: [], furrows: [], greens: [], vegetation: [],
      roads: [], buildings: [], piers: [], walls: [],
      symbols,
    },
  };
}

const WELL = { id: 'sm-well', at: { x: 0, y: 0 }, scale: 3.2, rotationDeg: 45, zBand: 'structure' as const };
const MARK = { id: 'sm-mark-church', at: { x: 5, y: 5 }, scale: 4, rotationDeg: 0, zBand: 'overlay' as const };

describe('assembler symbol path', () => {
  it('structure symbols land in #symbols with a sil shadow, offset outside rotation', () => {
    const svg = assembleSvg(sceneWith([WELL]));
    expect(svg).toContain('<g id="symbols">');
    expect(svg).toContain('href="#glyph-sm-well"');
    // sil in shadows: the rotation lives on the use transform, the offset on the group
    expect(svg).toMatch(/<g id="shadows" transform="translate\([^)]*\)">[\s\S]*href="#glyph-sm-well-sil"/);
  });

  it('marks land in #marks after #canopy-position (last group)', () => {
    const svg = assembleSvg(sceneWith([WELL, MARK]));
    const marks = svg.indexOf('<g id="marks">');
    expect(marks).toBeGreaterThan(svg.indexOf('<g id="symbols">'));
    expect(svg.slice(marks)).toContain('href="#glyph-sm-mark-church"');
    // marks never shadow
    expect(svg).not.toMatch(/shadows[\s\S]*sm-mark-church-sil/);
  });

  it('minScale gate drops sub-floor fixed instances', () => {
    // sm-well minScale is 0.35 with footprint 3.2 → scale 0.5 gives ratio ~0.16
    const svg = assembleSvg(sceneWith([{ ...WELL, scale: 0.5 }]));
    expect(svg).not.toContain('glyph-sm-well');
  });

  it('symbols:false removes symbol groups and their defs, keeps everything else', () => {
    const svg = assembleSvg(sceneWith([WELL, MARK]), { symbols: false });
    expect(svg).not.toContain('<g id="symbols">');
    expect(svg).not.toContain('<g id="marks">');
    expect(svg).not.toContain('glyph-sm-well');
  });
});
