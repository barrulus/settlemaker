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

/**
 * clipRoadsAtWater regression (2026-08-11 fix-wave): `Graph.aStar`'s
 * buildPath reconstructs goal-backward, and roads are built as
 * `buildPath(start, gate)` (model.ts buildStreets), so `road.vertices[0]`
 * IS the gate and the tail runs out to the far countryside end. The old
 * clip kept `vertices.slice(lastWet + 1)` believing roads ended at the
 * gate — on a dry-wet-dry coastline (e.g. a cove) that keeps the far dry
 * fragment beyond the water and drops the gate-side head, leaving a road
 * that touches no gate. pop 4000 seed 2 (walled port, small harbour) is a
 * measured repro: 17/80 walled-port runs (pops 300/1200/4000/20000 x
 * seeds 1-20) produced a gate-less road fragment before the fix.
 */
describe('walled port: every road reaches a gate', () => {
  function makeWalledPort(pop: number) {
    return {
      name: `Port${pop}`, population: pop, port: true, citadel: false, walls: true,
      plaza: true, temple: false, shanty: false, capital: false,
      roadBearings: [0, 240], oceanBearing: 90,
      harbourSize: (pop === 4000 ? 'small' : 'large') as 'small' | 'large',
    };
  }

  function everyArteryComponentTouchesAGate(m: Model): boolean {
    const gates = m.gates;
    const nodes: Point[] = [];
    const parent: number[] = [];
    const find = (i: number): number => parent[i] === i ? i : (parent[i] = find(parent[i]));
    const idOf = (p: Point): number => {
      for (let i = 0; i < nodes.length; i++) if (Math.hypot(nodes[i].x - p.x, nodes[i].y - p.y) < 0.5) return i;
      nodes.push(p); parent.push(nodes.length - 1); return nodes.length - 1;
    };
    for (const line of m.arteries) {
      const verts = line.vertices;
      let prev = idOf(verts[0]);
      for (let i = 1; i < verts.length; i++) {
        const cur = idOf(verts[i]);
        parent[find(prev)] = find(cur);
        prev = cur;
      }
    }
    const gateIds = new Set(gates.map(g => idOf(g)));
    const rootToNodes = new Map<number, number[]>();
    for (let i = 0; i < nodes.length; i++) {
      const r = find(i);
      if (!rootToNodes.has(r)) rootToNodes.set(r, []);
      rootToNodes.get(r)!.push(i);
    }
    for (const [, ids] of rootToNodes) {
      if (!ids.some(id => gateIds.has(id))) return false;
    }
    return true;
  }

  test('pop 4000 seed 2 (measured orphan repro)', () => {
    const m = new Model(mapToGenerationParams(makeWalledPort(4000), 2)).generate();
    expect(everyArteryComponentTouchesAGate(m)).toBe(true);
  });

  test('sweep: pops 300/1200/4000/20000 x seeds 1-20 — zero gate-less road components', () => {
    let orphaned = 0;
    for (const pop of [300, 1200, 4000, 20000]) {
      for (let seed = 1; seed <= 20; seed++) {
        const m = new Model(mapToGenerationParams(makeWalledPort(pop), seed)).generate();
        if (!everyArteryComponentTouchesAGate(m)) orphaned++;
      }
    }
    expect(orphaned).toBe(0);
  }, 30000);
});
