import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { assembleSvg } from '../src/output/assemble-svg.js';
import type { Scene, SymbolInstance } from '../src/scene/scene.js';

function fixture(id: string, rotationDeg: number): Scene {
  return {
    version: 2, seed: 1, population: 0, biome: 'temperate',
    bounds: { min_x: -64, min_y: -64, max_x: 64, max_y: 64 },
    layers: {
      water: { rings: [], synthetic: false }, fields: [], furrows: [], greens: [],
      vegetation: [], roads: [], buildings: [], piers: [], walls: [],
      symbols: [{ id, rotationDeg, at: { x: 0, y: 0 }, scale: 64, scaleY: 96,
        zBand: 'structure', artworkVariant: 0, materialVariant: 4 }],
    },
  };
}

describe('roof lighting in world space', () => {
  it.each(['sm-city-row-house-a', 'sm-city-row-house-b'])('lights the sunward face of rotated and stretched %s in raster output', async id => {
    const cross = id.endsWith('-b');
    for (const rotation of [0, 90, 180, 270, 37, 127]) for (const direction of [1, -1]) {
      const scene = fixture(id, rotation);
      const shadowOffset = { dx: .4 * direction, dy: .6 * direction };
      const svg = assembleSvg(scene, { theme: { shadowOffset } });
      expect(svg).toContain(`<g id="shadows" transform="translate(${shadowOffset.dx.toFixed(2)},${shadowOffset.dy.toFixed(2)})">`);
      const { data, info } = await sharp(Buffer.from(svg.replace(/var\(--[^,]+,\s*([^\)]+)\)/g, '$1')))
        .resize(512, 512).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const angle = rotation * Math.PI / 180;
      // Sample well inside each actual roof plane, away from stacks and ridges.
      const brightness = (x: number, y: number) => {
        const lx = x - 32, ly = (y - 32) * 1.5;
        const px = Math.round((64 + lx * Math.cos(angle) - ly * Math.sin(angle)) * 4);
        const py = Math.round((64 + lx * Math.sin(angle) + ly * Math.cos(angle)) * 4);
        let sum = 0;
        for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
          const i = ((py + dy) * info.width + px + dx) * info.channels;
          sum += (data[i] + data[i + 1] + data[i + 2]) / 3;
        }
        return sum / 49;
      };
      const negative = cross ? brightness(32, 20) : brightness(24, 35);
      const positive = cross ? brightness(32, 44) : brightness(40, 35);
      const normal = angle + (cross ? Math.PI / 2 : 0);
      const sunward = shadowOffset.dx * Math.cos(normal) + shadowOffset.dy * Math.sin(normal);
      expect((negative - positive) * Math.sign(sunward), `${id} at ${rotation}°, direction ${direction}`).toBeGreaterThan(2);
    }
  });

  it('shares detailed glyphs across rotations and leaves ground shadows independent of roof paints', () => {
    const scene = fixture('sm-city-row-house-a', 0);
    const home = scene.layers.symbols[0];
    scene.layers.symbols = [0, 90, 180, 270].map(rotationDeg => ({ ...home, rotationDeg }));
    const svg = assembleSvg(scene);
    expect(svg.match(/<g id="glyph-sm-city-row-house-a-shape-0-tone-4">/g)).toHaveLength(1);
    const shadows = svg.match(/<g id="shadows"[^>]*>([\s\S]*?)<\/g>/)![1];
    expect(shadows.match(/<use /g)).toHaveLength(4);
    expect(shadows).not.toMatch(/\b(?:fill|color)="/);
    const unlit = assembleSvg(scene, { theme: { shadowOffset: { dx: 0, dy: 0 } } });
    const paints = [...unlit.matchAll(/<use [^>]*fill="([^"]+)" color="([^"]+)"/g)];
    expect(paints).toHaveLength(4);
    for (const [, negative, positive] of paints) expect(negative).toBe(positive);
  });

  it('lights older scenes without stored variation selections', () => {
    const scene = fixture('sm-city-row-house-b', 180);
    const home: SymbolInstance = scene.layers.symbols[0];
    delete home.artworkVariant;
    delete home.materialVariant;
    expect(assembleSvg(scene)).toMatch(/<use href="#glyph-sm-city-row-house-b" fill="#[\da-f]+" color="#[\da-f]+"/);
  });
});
