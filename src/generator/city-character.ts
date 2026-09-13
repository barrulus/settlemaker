import type { Model } from './model.js';
import type { Patch } from './patch.js';
import { buildAdjacency } from './adjacency.js';

const physicalFields = new WeakMap<Model, { patches: Patch[]; adjacency: Model['adjacency']; values: Map<Patch,number> }>();

/** Measure through the occupied neighbourhood graph. A short side, an inlet
 * and the end of a long approach all have their own low-density boundary. */
function physicalUrbanity(model: Model, patch: Patch): number {
  let cached=physicalFields.get(model);
  if (!cached || cached.patches!==model.patches || cached.adjacency!==model.adjacency) {
    const water=new Set(model.waterbody);
    const built=model.patches.filter(p=>['core','suburb','satellite'].includes(p.zone) && !water.has(p));
    const occupied=new Set(built), adjacency=model.adjacency??buildAdjacency(model.patches);
    const edges=built.filter(p=>adjacency.neighboursOf(p).some(n=>!occupied.has(n)));
    const distances=(seeds:Patch[])=>{
      const result=new Map(seeds.map(p=>[p,0])), queue=[...seeds];
      for(let i=0;i<queue.length;i++)for(const n of adjacency.neighboursOf(queue[i])){
        if(occupied.has(n)&&!result.has(n)){result.set(n,result.get(queue[i])!+1);queue.push(n);}
      }
      return result;
    };
    const toEdge=distances(edges), toCore=distances(built.filter(p=>p.zone==='core'));
    const values=new Map(built.map(p=>{
      const edge=toEdge.get(p)??0, core=toCore.get(p)??Infinity;
      const t=p.zone==='core'?1:(edge+.25)/(edge+core+.25);
      return [p,t*t*(3-2*t)] as const;
    }));
    cached={patches:model.patches,adjacency:model.adjacency,values};
    physicalFields.set(model,cached);
  }
  return cached.values.get(patch)??0;
}

/** Continuous centre-to-edge character, shared by demand, roofs and gardens. */
export function cityUrbanity(model: Model, patch: Patch): number {
  // The enclosed core uses urban spacing as well as urban occupancy. Its
  // edge must not become detached housing merely because the city is small.
  if (model.params.development && patch.zone === 'core') return 1;
  if (model.params.development) return physicalUrbanity(model,patch);
  const built=model.patches.filter(p=>p.withinCity && !model.waterbody.includes(p));
  const reach=Math.max(1,...built.map(p=>p.shape.centroid.length));
  const r=Math.min(1,patch.shape.centroid.length/reach);
  return 1-r*r*(3-2*r);
}
