import { describe, expect, it } from 'vitest';
import { Point, mapToGenerationParams } from '../src/index.js';
import { Model } from '../src/generator/model.js';
import { Patch } from '../src/generator/patch.js';
import { buildAdjacency } from '../src/generator/adjacency.js';
import { cityUrbanity } from '../src/generator/city-character.js';
import { assignSprawl } from '../src/generator/zoning.js';

function grid(radius: number) {
  const vertices = new Map<string, Point>();
  const vertex = (x: number, y: number) => {
    const key = `${x},${y}`;
    if (!vertices.has(key)) vertices.set(key, new Point(x, y));
    return vertices.get(key)!;
  };
  const patches: Patch[] = [];
  for (let y = -radius; y <= radius; y++) for (let x = -radius; x <= radius; x++) {
    patches.push(new Patch([vertex(x,y), vertex(x+1,y), vertex(x+1,y+1), vertex(x,y+1)]));
  }
  return patches;
}

describe('physical city outskirts', () => {
  it('tapers every boundary of an asymmetric city, including its short sides', () => {
    const params = mapToGenerationParams({ name: 'Uneven city', population: 200000 }, 2);
    params.development = { coreBuildings: 100, texturePopulation: 10000, metresPerUnit: 3, landScale: 1 };
    const model = new Model(params);
    model.patches = grid(16);
    for (const p of model.patches) {
      const { x, y } = p.shape.centroid;
      p.zone = Math.abs(x)<1 && Math.abs(y)<1 ? 'core'
        : x>-5 && x<5 && y>-13 && y<5 ? 'suburb' : 'wilderness';
      p.withinCity = p.zone !== 'wilderness';
    }
    model.adjacency = buildAdjacency(model.patches);
    const edge = model.patches.filter(p => p.zone==='suburb'
      && model.adjacency!.neighboursOf(p).some(n=>!n.withinCity));
    expect(edge.length).toBeGreaterThan(40);
    for (const p of edge) expect(cityUrbanity(model,p)).toBeLessThan(.05);
    const core = model.patches.find(p=>p.zone==='core')!;
    expect(cityUrbanity(model,core)).toBe(1);
    const nearCore = model.patches.find(p=>p.shape.centroid.x===1.5 && p.shape.centroid.y===.5)!;
    expect(cityUrbanity(model,nearCore)).toBeGreaterThan(.8);
  });

  it.each([[1,0], [0,-1], [-1,0], [0,1]])('grows along the supplied route (%s, %s)', (x,y) => {
    const patches = grid(25), adjacency = buildAdjacency(patches);
    const inner = patches.filter(p=>p.shape.centroid.length<2);
    assignSprawl({ patches, inner, adjacency, coreRadius: 2, population: 200000,
      roads: [{direction: new Point(x,y), weight: 1, rawWeight: 1}],
      isBuildable: ()=>true, budget: 350, compact: true, seed: 2 });
    const built = patches.filter(p=>p.zone==='suburb' || p.zone==='core');
    const projection = built.map(p=>p.shape.centroid.x*x+p.shape.centroid.y*y);
    expect(Math.max(...projection)/-Math.min(...projection)).toBeGreaterThan(1.6);
    expect(built).toHaveLength(inner.length+350);
    const occupied = new Set(built), connected = new Set(inner), queue = [...inner];
    for (let i=0;i<queue.length;i++) for (const n of adjacency.neighboursOf(queue[i])) {
      if (occupied.has(n) && !connected.has(n)) { connected.add(n); queue.push(n); }
    }
    expect(connected.size).toBe(built.length);
  });
});
