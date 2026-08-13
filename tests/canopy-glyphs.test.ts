import { describe, it, expect } from 'vitest';
import { Model, mapToGenerationParams, type AzgaarBurgInput } from '../src/index.js';
import { buildScene } from '../src/scene/build-scene.js';
import { assembleSvg } from '../src/output/assemble-svg.js';
import { CANOPY_KINDS, assetSetFor } from '../src/assets/asset-sets.js';

// Canonical test-model helper (pattern from tests/degraded-generation.test.ts).
function mk(population: number, seed: number, overrides: Partial<AzgaarBurgInput> = {}): Model {
  return new Model(mapToGenerationParams({
    name: 'Test', population, port: false, citadel: false, walls: false,
    plaza: false, temple: false, shanty: false, capital: false, ...overrides,
  }, seed)).generate();
}

// Scan for a seed that yields a Park ward with trees, then pin behaviour on it.
function sceneWithTrees() {
  for (let seed = 1; seed <= 20; seed++) {
    const scene = buildScene(mk(4000, seed));
    if (scene.layers.vegetation.length >= 6) return scene;
  }
  throw new Error('no seed in 1..20 produced >=6 trees');
}

describe('canopy glyphs', () => {
  it('vegetation kinds are batch001 canopy ids with seeded variety', () => {
    const scene = sceneWithTrees();
    const kinds = new Set(scene.layers.vegetation.map(v => v.kind));
    for (const k of kinds) expect(CANOPY_KINDS).toContain(k);
    expect(kinds.size).toBeGreaterThan(1); // variety, not one kind
  });

  it('scene build is deterministic', () => {
    const a = buildScene(mk(4000, 7));
    const b = buildScene(mk(4000, 7));
    expect(JSON.stringify(a.layers.vegetation)).toBe(JSON.stringify(b.layers.vegetation));
  });

  it('assembler emits glyph defs and #canopy after #walls', () => {
    const scene = sceneWithTrees();
    const svg = assembleSvg(scene);
    const kind = scene.layers.vegetation[0].kind;
    expect(svg).toContain(`<symbol id="glyph-${kind}"`);
    expect(svg).toContain(`<symbol id="glyph-${kind}-sil"`);
    expect(svg).toContain('<g id="canopy">');
    const walls = svg.indexOf('<g id="walls">');
    if (walls !== -1) expect(svg.indexOf('<g id="canopy">')).toBeGreaterThan(walls);
    expect(svg.indexOf('<g id="canopy">')).toBeGreaterThan(svg.indexOf('<g id="buildings">'));
  });

  it('default asset set carries all 38 glyphs', () => {
    expect(Object.keys(assetSetFor().glyphs ?? {})).toHaveLength(38);
  });
});
