import { describe, test, expect } from 'vitest';
import { Model, mapToGenerationParams } from '../src/index.js';
import { Point } from '../src/types/point.js';

function connectedComponents(polylines: Point[][]): number {
  // Union endpoints by identity of coordinates (streets share vertex objects,
  // but roads may duplicate coords) — join vertices closer than 0.5 units.
  const nodes: Point[] = [];
  const parent: number[] = [];
  const find = (i: number): number => parent[i] === i ? i : (parent[i] = find(parent[i]));
  const idOf = (p: Point): number => {
    for (let i = 0; i < nodes.length; i++) if (Math.hypot(nodes[i].x - p.x, nodes[i].y - p.y) < 0.5) return i;
    nodes.push(p); parent.push(nodes.length - 1); return nodes.length - 1;
  };
  for (const line of polylines) {
    let prev = idOf(line[0]);
    for (let i = 1; i < line.length; i++) {
      const cur = idOf(line[i]);
      parent[find(prev)] = find(cur);
      prev = cur;
    }
  }
  const roots = new Set<number>();
  for (let i = 0; i < nodes.length; i++) roots.add(find(i));
  return roots.size;
}

describe('road continuity', () => {
  test('all streets+roads form ONE connected network (hamlet, village, town)', () => {
    for (const pop of [300, 1200, 4000]) {
      const m = new Model(mapToGenerationParams({
        name: `C${pop}`, population: pop, port: false, citadel: false, walls: pop >= 1000,
        plaza: true, temple: false, shanty: false, capital: false, roadBearings: [0, 120, 240],
      }, 3)).generate();
      const lines = [...m.arteries].map(a => a.vertices);
      expect(connectedComponents(lines)).toBe(1);
    }
  });
});
