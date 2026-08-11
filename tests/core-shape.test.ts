import { describe, test, expect } from 'vitest';
import { Model, mapToGenerationParams } from '../src/index.js';

function convexHullCompactness(vertices: {x:number;y:number}[]): number {
  // Andrew's monotone chain -> hull area & perimeter -> 4πA/P²
  const pts = [...vertices].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: any, a: any, b: any) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: any[] = [], upper: any[] = [];
  for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length-2], lower[lower.length-1], p) <= 0) lower.pop(); lower.push(p); }
  for (const p of [...pts].reverse()) { while (upper.length >= 2 && cross(upper[upper.length-2], upper[upper.length-1], p) <= 0) upper.pop(); upper.push(p); }
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
  let area = 0, per = 0;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    area += a.x * b.y - b.x * a.y;
    per += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return 4 * Math.PI * (Math.abs(area) / 2) / (per * per);
}

describe('round walled core', () => {
  test('wall outline hull compactness >= 0.85 and Rmin/Rmax >= 0.6 across seeds', () => {
    for (const seed of [1, 2, 3, 5, 8, 13]) {
      const m = new Model(mapToGenerationParams({
        name: 'Round', population: 4000, port: false, citadel: false, walls: true,
        plaza: true, temple: false, shanty: false, capital: false, roadBearings: [0, 120, 240],
      }, seed)).generate();
      const verts = m.border!.shape.vertices;
      expect(convexHullCompactness(verts)).toBeGreaterThanOrEqual(0.85);
      const rs = verts.map(v => Math.hypot(v.x, v.y));
      expect(Math.min(...rs) / Math.max(...rs)).toBeGreaterThanOrEqual(0.6); // TUNE: no deep notches
    }
  });
});
