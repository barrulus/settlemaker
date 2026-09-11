import type { Model } from './model.js';
import type { Patch } from './patch.js';

/** Continuous centre-to-edge character, shared by demand, roofs and gardens. */
export function cityUrbanity(model: Model, patch: Patch): number {
  const built=model.patches.filter(p=>p.withinCity && !model.waterbody.includes(p));
  const reach=Math.max(1,...built.map(p=>p.shape.centroid.length));
  const r=Math.min(1,patch.shape.centroid.length/reach);
  return 1-r*r*(3-2*r);
}
