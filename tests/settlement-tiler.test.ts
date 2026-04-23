import { describe, it, expect } from 'vitest';
import {
  parseSvgViewBox,
  computeSettlementScale,
  computeTileInfo,
  cropSvgToTile,
  enumerateTiles,
  totalTileCount,
  generateFromBurg,
  type AzgaarBurgInput,
} from '../src/index.js';

describe('parseSvgViewBox', () => {
  it('parses a standard viewBox', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="10 20 100 200"></svg>';
    expect(parseSvgViewBox(svg)).toEqual({ x: 10, y: 20, width: 100, height: 200 });
  });

  it('parses negative coordinates', () => {
    const svg = '<svg viewBox="-45.2 -38.7 90.4 77.4"></svg>';
    expect(parseSvgViewBox(svg)).toEqual({ x: -45.2, y: -38.7, width: 90.4, height: 77.4 });
  });

  it('handles comma-separated values', () => {
    const svg = '<svg viewBox="0,0,100,100"></svg>';
    expect(parseSvgViewBox(svg)).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });

  it('handles extra whitespace', () => {
    const svg = '<svg viewBox="  10   20   100   200  "></svg>';
    expect(parseSvgViewBox(svg)).toEqual({ x: 10, y: 20, width: 100, height: 200 });
  });

  it('returns null for missing viewBox', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"></svg>';
    expect(parseSvgViewBox(svg)).toBeNull();
  });

  it('returns null for invalid viewBox values', () => {
    const svg = '<svg viewBox="a b c d"></svg>';
    expect(parseSvgViewBox(svg)).toBeNull();
  });
});

describe('computeSettlementScale', () => {
  it('computes scale for a small village (pop 50)', () => {
    const s = computeSettlementScale(50);
    expect(s.diameterMeters).toBeCloseTo(152.0, 0);
    expect(s.maxZoom).toBe(3);
  });

  it('computes scale for a town (pop 500)', () => {
    const s = computeSettlementScale(500);
    expect(s.diameterMeters).toBeCloseTo(380.7, 0);
    expect(s.maxZoom).toBe(4);
  });

  it('computes scale for a city (pop 5000)', () => {
    const s = computeSettlementScale(5000);
    // 200 * (5000/100)^0.4 = 200 * 50^0.4 ≈ 956.35
    expect(s.diameterMeters).toBeCloseTo(956.35, 0);
    expect(s.maxZoom).toBe(5);
  });

  it('computes scale for a large city (pop 20000)', () => {
    const s = computeSettlementScale(20000);
    // 200 * (20000/100)^0.4 = 200 * 200^0.4 ≈ 1665.1
    expect(s.diameterMeters).toBeCloseTo(1665.1, 0);
    expect(s.maxZoom).toBe(6);
  });

  it('returns maxZoom 0 for very tiny populations', () => {
    const s = computeSettlementScale(1);
    expect(s.maxZoom).toBeGreaterThanOrEqual(0);
  });
});

describe('computeTileInfo', () => {
  it('pads non-square viewBox to square', () => {
    const vb = { x: -10, y: -5, width: 20, height: 10 };
    const info = computeTileInfo(vb, 500);
    expect(info.squareViewBox.width).toBe(20);
    expect(info.squareViewBox.height).toBe(20);
    // Original centered in square
    expect(info.squareViewBox.x).toBe(-10);
    expect(info.squareViewBox.y).toBe(-10);
  });

  it('preserves already-square viewBox', () => {
    const vb = { x: 0, y: 0, width: 100, height: 100 };
    const info = computeTileInfo(vb, 500);
    expect(info.squareViewBox).toEqual(vb);
  });

  it('computes metersPerUnit correctly', () => {
    const vb = { x: 0, y: 0, width: 100, height: 100 };
    const info = computeTileInfo(vb, 500);
    const expectedDiameter = 200 * Math.pow(500 / 100, 0.4);
    expect(info.metersPerUnit).toBeCloseTo(expectedDiameter / 100, 2);
  });

  it('preserves original viewBox', () => {
    const vb = { x: -10, y: -5, width: 20, height: 10 };
    const info = computeTileInfo(vb, 500);
    expect(info.originalViewBox).toEqual(vb);
  });
});

describe('cropSvgToTile', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-50 -50 100 100"><rect/></svg>';
  const vb = parseSvgViewBox(svg)!;
  const info = computeTileInfo(vb, 5000);

  it('z=0 covers full square extent', () => {
    const cropped = cropSvgToTile(svg, info, 0, 0, 0);
    const newVb = parseSvgViewBox(cropped)!;
    expect(newVb.x).toBeCloseTo(info.squareViewBox.x, 5);
    expect(newVb.y).toBeCloseTo(info.squareViewBox.y, 5);
    expect(newVb.width).toBeCloseTo(info.squareViewBox.width, 5);
    expect(newVb.height).toBeCloseTo(info.squareViewBox.height, 5);
  });

  it('z=1 produces four quadrants', () => {
    const tl = parseSvgViewBox(cropSvgToTile(svg, info, 1, 0, 0))!;
    const tr = parseSvgViewBox(cropSvgToTile(svg, info, 1, 1, 0))!;
    parseSvgViewBox(cropSvgToTile(svg, info, 1, 0, 1));
    const br = parseSvgViewBox(cropSvgToTile(svg, info, 1, 1, 1))!;

    const halfW = info.squareViewBox.width / 2;
    expect(tl.width).toBeCloseTo(halfW, 5);
    expect(tr.width).toBeCloseTo(halfW, 5);
    // Top-left starts at squareViewBox origin
    expect(tl.x).toBeCloseTo(info.squareViewBox.x, 5);
    expect(tl.y).toBeCloseTo(info.squareViewBox.y, 5);
    // Bottom-right starts at midpoint
    expect(br.x).toBeCloseTo(info.squareViewBox.x + halfW, 5);
    expect(br.y).toBeCloseTo(info.squareViewBox.y + halfW, 5);
  });

  it('injects width and height attributes', () => {
    const cropped = cropSvgToTile(svg, info, 0, 0, 0, 512);
    expect(cropped).toMatch(/width="512"/);
    expect(cropped).toMatch(/height="512"/);
  });

  it('replaces existing width/height', () => {
    const svgWithDims = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="800" height="600"><rect/></svg>';
    const vb2 = parseSvgViewBox(svgWithDims)!;
    const info2 = computeTileInfo(vb2, 500);
    const cropped = cropSvgToTile(svgWithDims, info2, 0, 0, 0, 256);
    expect(cropped).toMatch(/width="256"/);
    expect(cropped).toMatch(/height="256"/);
    // Should not contain old values
    expect(cropped).not.toMatch(/width="800"/);
    expect(cropped).not.toMatch(/height="600"/);
  });

  it('outputs valid SVG', () => {
    const cropped = cropSvgToTile(svg, info, 2, 1, 3);
    expect(cropped).toMatch(/^<svg /);
    expect(cropped).toMatch(/<\/svg>$/);
  });

  it('rewrites data-bg="paper" rect to cover the tile viewBox', () => {
    const withBg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-50 -25 100 50"><rect data-bg="paper" x="-50" y="-25" width="100" height="50" fill="#ccc"/></svg>';
    const vbBg = parseSvgViewBox(withBg)!;
    const infoBg = computeTileInfo(vbBg, 5000);

    // z=0: rect should match the full squareViewBox (square-padded), not the original non-square bounds
    const tileZ0 = cropSvgToTile(withBg, infoBg, 0, 0, 0);
    const rectMatch = tileZ0.match(/<rect[^>]*data-bg="paper"[^>]*\/>/)!;
    expect(rectMatch).not.toBeNull();
    const rectAttrs = rectMatch[0];
    expect(rectAttrs).toMatch(new RegExp(`x="${infoBg.squareViewBox.x}"`));
    expect(rectAttrs).toMatch(new RegExp(`y="${infoBg.squareViewBox.y}"`));
    expect(rectAttrs).toMatch(new RegExp(`width="${infoBg.squareViewBox.width}"`));
    expect(rectAttrs).toMatch(new RegExp(`height="${infoBg.squareViewBox.height}"`));
    // fill attribute preserved
    expect(rectAttrs).toMatch(/fill="#ccc"/);

    // z=1 top-left quadrant: rect matches the quadrant extent
    const tileZ1 = cropSvgToTile(withBg, infoBg, 1, 0, 0);
    const rectZ1 = tileZ1.match(/<rect[^>]*data-bg="paper"[^>]*\/>/)![0];
    const halfW = infoBg.squareViewBox.width / 2;
    expect(rectZ1).toMatch(new RegExp(`x="${infoBg.squareViewBox.x}"`));
    expect(rectZ1).toMatch(new RegExp(`y="${infoBg.squareViewBox.y}"`));
    expect(rectZ1).toMatch(new RegExp(`width="${halfW}"`));
    expect(rectZ1).toMatch(new RegExp(`height="${halfW}"`));
  });

  it('leaves rects without data-bg="paper" alone', () => {
    const svgWithDims = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-10 -10 20 20" width="800" height="600"><rect x="5" y="5" width="2" height="2" fill="red"/></svg>';
    const vb3 = parseSvgViewBox(svgWithDims)!;
    const info3 = computeTileInfo(vb3, 500);
    const cropped = cropSvgToTile(svgWithDims, info3, 0, 0, 0);
    // Non-bg rect should be preserved as-is (its x/y/width/height untouched by the bg rewrite)
    expect(cropped).toMatch(/<rect x="5" y="5" width="2" height="2" fill="red"\/>/);
  });
});

describe('enumerateTiles', () => {
  it('returns 1 tile for maxZoom=0', () => {
    const tiles = enumerateTiles(0);
    expect(tiles).toEqual([{ z: 0, x: 0, y: 0 }]);
  });

  it('returns 5 tiles for maxZoom=1', () => {
    const tiles = enumerateTiles(1);
    expect(tiles).toHaveLength(5);
    // z=0: 1 tile, z=1: 4 tiles
    expect(tiles.filter(t => t.z === 0)).toHaveLength(1);
    expect(tiles.filter(t => t.z === 1)).toHaveLength(4);
  });

  it('returns 21 tiles for maxZoom=2', () => {
    const tiles = enumerateTiles(2);
    expect(tiles).toHaveLength(21);
    expect(tiles.filter(t => t.z === 2)).toHaveLength(16);
  });
});

describe('totalTileCount', () => {
  it('returns 1 for maxZoom=0', () => {
    expect(totalTileCount(0)).toBe(1);
  });

  it('returns 5 for maxZoom=1', () => {
    expect(totalTileCount(1)).toBe(5);
  });

  it('returns 21 for maxZoom=2', () => {
    expect(totalTileCount(2)).toBe(21);
  });

  it('returns 85 for maxZoom=3', () => {
    expect(totalTileCount(3)).toBe(85);
  });

  it('returns 341 for maxZoom=4', () => {
    expect(totalTileCount(4)).toBe(341);
  });

  it('matches enumerateTiles count', () => {
    for (let z = 0; z <= 5; z++) {
      expect(totalTileCount(z)).toBe(enumerateTiles(z).length);
    }
  });
});

describe('Round-trip integration', () => {
  function makeBurg(overrides: Partial<AzgaarBurgInput> = {}): AzgaarBurgInput {
    return {
      name: 'TileBurg',
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

  it('generateFromBurg → parse → compute → crop produces valid SVG tiles', () => {
    const result = generateFromBurg(makeBurg(), { seed: 99 });
    const vb = parseSvgViewBox(result.svg);
    expect(vb).not.toBeNull();

    const info = computeTileInfo(vb!, 5000);
    expect(info.maxZoom).toBeGreaterThan(0);
    expect(info.squareExtent).toBeGreaterThan(0);

    // Crop z=0 tile
    const tile0 = cropSvgToTile(result.svg, info, 0, 0, 0);
    expect(tile0).toMatch(/^<svg /);
    expect(tile0).toMatch(/<\/svg>$/);
    const tileVb = parseSvgViewBox(tile0);
    expect(tileVb).not.toBeNull();
    expect(tileVb!.width).toBeCloseTo(info.squareViewBox.width, 5);

    // Crop a deeper tile
    const tile1 = cropSvgToTile(result.svg, info, 1, 0, 0);
    const tileVb1 = parseSvgViewBox(tile1);
    expect(tileVb1!.width).toBeCloseTo(info.squareViewBox.width / 2, 5);
  });

  it('total tile count matches expected for different populations', () => {
    for (const pop of [50, 500, 5000, 20000]) {
      const scale = computeSettlementScale(pop);
      const count = totalTileCount(scale.maxZoom);
      expect(count).toBe(enumerateTiles(scale.maxZoom).length);
    }
  });
});
