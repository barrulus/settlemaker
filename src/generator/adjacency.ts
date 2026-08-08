import type { Patch } from './patch.js';
import type { Point } from '../types/point.js';

export interface PatchAdjacency {
  /** Patches sharing an edge. Stable order: the order given to buildAdjacency. */
  neighboursOf(patch: Patch): Patch[];
  /** BFS hop counts from any seed, inclusive of seeds at 0. Unreachable patches are absent. */
  hopDistances(seeds: Patch[], maxHops: number): Map<Patch, number>;
}

export function buildAdjacency(patches: Patch[]): PatchAdjacency {
  const index = new Map<Patch, number>();
  patches.forEach((p, i) => index.set(p, i));

  // Vertex identity → patches touching it.
  const byVertex = new Map<Point, Patch[]>();
  for (const patch of patches) {
    // Deduplicate this patch's vertices to avoid adding it multiple times per vertex.
    const uniqueVertices = new Set(patch.shape.vertices);
    for (const v of uniqueVertices) {
      const bucket = byVertex.get(v);
      if (bucket === undefined) byVertex.set(v, [patch]);
      else bucket.push(patch);
    }
  }

  const neighbours = new Map<Patch, Patch[]>();
  for (const patch of patches) {
    const shared = new Map<Patch, number>();
    // Deduplicate this patch's vertices by identity to avoid double-counting.
    const uniqueVertices = new Set(patch.shape.vertices);
    for (const v of uniqueVertices) {
      for (const other of byVertex.get(v) ?? []) {
        if (other === patch) continue;
        shared.set(other, (shared.get(other) ?? 0) + 1);
      }
    }
    // Two or more shared vertices means a shared edge, not a corner touch.
    const list = [...shared.entries()]
      .filter(([, count]) => count >= 2)
      .map(([p]) => p)
      .sort((x, y) => index.get(x)! - index.get(y)!);
    neighbours.set(patch, list);
  }

  return {
    neighboursOf: (patch: Patch) => neighbours.get(patch) ?? [],
    hopDistances(seeds: Patch[], maxHops: number): Map<Patch, number> {
      const dist = new Map<Patch, number>();
      let frontier: Patch[] = [];
      for (const s of seeds) {
        if (!dist.has(s)) { dist.set(s, 0); frontier.push(s); }
      }
      for (let hop = 1; hop <= maxHops && frontier.length > 0; hop++) {
        const next: Patch[] = [];
        for (const p of frontier) {
          for (const n of neighbours.get(p) ?? []) {
            if (!dist.has(n)) { dist.set(n, hop); next.push(n); }
          }
        }
        frontier = next;
      }
      return dist;
    },
  };
}
