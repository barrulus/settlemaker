import { describe, it, expect } from 'vitest';
import { Graph, Node } from '../src/geom/graph.js';

describe('Graph A*', () => {
  it('finds shortest path in a simple graph', () => {
    const g = new Graph();
    const a = g.add();
    const b = g.add();
    const c = g.add();
    const d = g.add();

    a.link(b, 1);
    a.link(c, 10);
    b.link(d, 1);
    c.link(d, 1);

    const path = g.aStar(a, d);
    expect(path).not.toBeNull();
    expect(path!.length).toBe(3); // d -> b -> a
    expect(path![0]).toBe(d);
    expect(path![2]).toBe(a);
  });

  it('returns null when no path exists', () => {
    const g = new Graph();
    const a = g.add();
    const b = g.add();
    // No link
    const path = g.aStar(a, b);
    expect(path).toBeNull();
  });

  it('respects exclude list', () => {
    const g = new Graph();
    const a = g.add();
    const b = g.add();
    const c = g.add();

    a.link(b, 1);
    b.link(c, 1);

    // Excluding b should prevent finding path
    const path = g.aStar(a, c, [b]);
    expect(path).toBeNull();
  });

  it('handles start === goal', () => {
    const g = new Graph();
    const a = g.add();
    const path = g.aStar(a, a);
    expect(path).not.toBeNull();
    expect(path!.length).toBe(1);
    expect(path![0]).toBe(a);
  });
});
