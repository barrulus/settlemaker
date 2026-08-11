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

  it('does not link patches sharing only a corner', () => {
    const p00 = new Point(0, 0), p10 = new Point(1, 0);
    const p11 = new Point(1, 1), p01 = new Point(0, 1);
    const p20 = new Point(2, 0), p21 = new Point(2, 1);
    const p22 = new Point(2, 2);
    // a: [p00, p10, p11, p01] — square at (0,0) to (1,1)
    // c: [p10, p20, p21, p22] — corners at (1,0), (2,0), (2,1), (2,2)
    // They share only p10 (a corner touch at (1,0)), not an edge.
    const a = new Patch([p00, p10, p11, p01]);
    const c = new Patch([p10, p20, p21, p22]);
    const adj = buildAdjacency([a, c]);
    expect(adj.neighboursOf(a)).not.toContain(c);
    expect(adj.neighboursOf(c)).not.toContain(a);
  });

  it('does not double-count duplicate vertices in own array', () => {
    const p10 = new Point(1, 0), p20 = new Point(2, 0);
    const p21 = new Point(2, 1), p23 = new Point(2, 3);
    const p24 = new Point(2, 4), p30 = new Point(3, 0);
    // d: [p10, p10, p23, p24] — p10 appears twice in the same patch
    // e: [p10, p30, p31, p32] — shares only p10 with d
    // Despite p10 being in d's array twice, they share only one unique vertex,
    // so they should NOT be neighbours.
    const d = new Patch([p10, p10, p23, p24]);
    const e = new Patch([p10, p30, new Point(3, 1), new Point(3, 2)]);
    const adj = buildAdjacency([d, e]);
    expect(adj.neighboursOf(d)).not.toContain(e);
    expect(adj.neighboursOf(e)).not.toContain(d);
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
