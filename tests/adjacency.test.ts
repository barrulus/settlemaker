import { describe, it, expect } from 'vitest';
import { buildAdjacency } from '../src/generator/adjacency.js';
import { Patch } from '../src/generator/patch.js';
import { Point } from '../src/types/point.js';

/** Two unit squares sharing the edge x=1, plus a detached third square. */
function grid(): { a: Patch; b: Patch; far: Patch } {
  const p00 = new Point(0, 0), p10 = new Point(1, 0);
  const p11 = new Point(1, 1), p01 = new Point(0, 1);
  const p20 = new Point(2, 0), p21 = new Point(2, 1);
  // Shared vertices are the SAME object — Polygon compares by identity.
  const a = new Patch([p00, p10, p11, p01]);
  const b = new Patch([p10, p20, p21, p11]);
  const far = new Patch([new Point(9, 9), new Point(10, 9), new Point(10, 10)]);
  return { a, b, far };
}

describe('patch adjacency', () => {
  it('links patches that share an edge', () => {
    const { a, b, far } = grid();
    const adj = buildAdjacency([a, b, far]);
    expect(adj.neighboursOf(a)).toContain(b);
    expect(adj.neighboursOf(b)).toContain(a);
  });

  it('does not link detached patches', () => {
    const { a, b, far } = grid();
    const adj = buildAdjacency([a, b, far]);
    expect(adj.neighboursOf(far)).toHaveLength(0);
  });

  it('computes hop distance from seeds', () => {
    const { a, b, far } = grid();
    const adj = buildAdjacency([a, b, far]);
    const d = adj.hopDistances([a], 5);
    expect(d.get(a)).toBe(0);
    expect(d.get(b)).toBe(1);
    expect(d.has(far)).toBe(false);
  });

  it('respects maxHops', () => {
    const { a, b, far } = grid();
    const adj = buildAdjacency([a, b, far]);
    const d = adj.hopDistances([a], 0);
    expect(d.get(a)).toBe(0);
    expect(d.has(b)).toBe(false);
  });
});
