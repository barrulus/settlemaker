import { describe, expect, it } from 'vitest';
import { Point } from '../../src/types/point.js';
import { roadSurfaceClips } from '../../src/village/road-surface.js';
import type { Lane } from '../../src/village/types.js';
const lane = (id: string, width: number, coords: number[][]): Lane => ({
  id, type: 'local', widthM: width + 0.4, surfaceWidthM: width,
  points: coords.map(([x, y]) => new Point(x, y)),
});
describe('road surface transitions', () => {
  it('narrows a wider terminating road smoothly into the narrower continuation', () => {
    const broad = lane('broad', 6, [[-30, 0], [0, 0]]);
    const small = lane('small', 2, [[0, 0], [20, 0]]);
    const original = JSON.stringify([broad, small]);
    const clips = roadSurfaceClips([broad, small]);
    const shape = clips.get('broad')!;
    expect(shape).toBeDefined();
    expect(clips.has('small')).toBe(false);
    expect(Math.max(...shape.filter(p => Math.abs(p.x) < 0.01).map(p => Math.abs(p.y)))).toBeCloseTo(1.02);
    expect(Math.max(...shape.filter(p => p.x < -15).map(p => Math.abs(p.y)))).toBeCloseTo(3.02);
    expect(JSON.stringify([broad, small])).toBe(original);
  });
  it('keeps the main street width when a small path joins its side', () => {
    const roads = [lane('main', 6, [[-30, 0], [30, 0]]), lane('path', 1, [[0, 0], [0, 20]])];
    expect(roadSurfaceClips(roads).size).toBe(0);
  });
});
