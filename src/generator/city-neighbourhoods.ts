import { landscapeHash } from '../assets/landscape-placement.js';
import { cityUrbanity } from './city-character.js';
import { nearestOnSegment } from './city-frontage.js';
import { Point } from '../types/point.js';
import type { Model } from './model.js';
import type { Patch } from './patch.js';

export type NeighbourhoodCharacter = 'terraces' | 'workshops' | 'gardens' | 'crofts';

export function isNaturalCommon(model: Model, patch: Patch): boolean {
  const c = patch.shape.centroid;
  const urbanity=cityUrbanity(model,patch);
  return !!model.params.development && patch.zone !== 'core' && (urbanity < .25 || (urbanity < .4
    && landscapeHash(Math.round(c.x),Math.round(c.y),model.params.seed^0x4e415455) < .35));
}

/** A district owns a coherent layout grammar; choices never consume layout RNG. */
export function neighbourhoodCharacter(model: Model, patch: Patch): NeighbourhoodCharacter {
  if (patch.zone === 'core') return 'terraces';
  const urbanity = cityUrbanity(model, patch);
  const c = patch.shape.centroid;
  const roll = landscapeHash(Math.round(c.x), Math.round(c.y), model.params.seed ^ 0x4e454947);
  const nearApproach = model.roads.some(r => r.vertices.slice(1).some((b, i) =>
    Point.distance(c, nearestOnSegment(c, r.vertices[i], b)) < Math.sqrt(Math.abs(patch.shape.square)) * .65));
  if (nearApproach && roll < .65) return 'workshops';
  if (urbanity > .6 || (urbanity > .3 && roll < .4)) return 'terraces';
  return urbanity < .2 && roll < .6 ? 'crofts' : 'gardens';
}

export interface CommonsPlan {
  selected: Set<Patch>;
  eligibleArea: number;
  targetArea: number;
  reservedArea: number;
  /** Euclidean district-centre access proxy, in mesh units; not walking distance. */
  accessRadius: number;
  servedArea: number;
}

/** Reserve four percent of eligible suburban land before allocating housing.
 * Whole districts cannot always meet the target: accept at most 50% overshoot,
 * and leave very small suburbs alone when no district fits that area budget.
 * Each next common favours the greatest previously unserved land area, with
 * nearby approach access and seeded variation breaking similar choices. */
export function planSuburbanCommons(model: Model): CommonsPlan {
  const candidates = model.patches.filter(p => p.zone === 'suburb' && !p.ward);
  const areas = candidates.map(p => Math.abs(p.shape.square));
  const eligibleArea = areas.reduce((a,b) => a+b,0), targetArea = eligibleArea * .04;
  const sortedAreas = [...areas].sort((a,b) => a-b);
  const accessRadius = Math.sqrt(sortedAreas[Math.floor(sortedAreas.length/2)] ?? 0) * 3;
  const plan: CommonsPlan = {selected:new Set(),eligibleArea,targetArea,reservedArea:0,accessRadius,servedArea:0};
  if (!targetArea) return plan;
  const served = new Set<number>();
  const centres = candidates.map(p => p.shape.centroid);
  const neighbours = centres.map(c => centres.flatMap((q,j) => Point.distance(c,q)<=accessRadius ? [j] : []));
  const roadAccess = centres.map(c => model.roads.some(r => r.vertices.slice(1).some((b,i) =>
    Point.distance(c,nearestOnSegment(c,r.vertices[i],b))<=accessRadius/2)));
  while (plan.reservedArea < targetArea) {
    let best = -1, bestScore = -Infinity;
    for (let i=0;i<candidates.length;i++) {
      if (plan.selected.has(candidates[i]) || plan.reservedArea+areas[i]>targetArea*1.5) continue;
      if (Math.abs(targetArea-plan.reservedArea-areas[i])>=targetArea-plan.reservedArea) continue;
      const unservedArea = neighbours[i].reduce((n,j) => n+(served.has(j)?0:areas[j]),0);
      const distance = plan.selected.size ? Math.min(...[...plan.selected].map(p=>Point.distance(p.shape.centroid,centres[i]))) : accessRadius;
      const separation = Math.min(1,distance/accessRadius);
      const hash = landscapeHash(Math.round(centres[i].x),Math.round(centres[i].y),model.params.seed^0x47524545);
      const score = unservedArea / eligibleArea * separation + (roadAccess[i] ? .02 : 0) + hash*.001;
      if (score>bestScore) {best=i;bestScore=score;}
    }
    if (best<0) break;
    plan.selected.add(candidates[best]);plan.reservedArea+=areas[best];
    for (const i of neighbours[best]) served.add(i);
  }
  plan.servedArea = [...served].reduce((n,i)=>n+areas[i],0);
  return plan;
}

export function suburbanCommons(model: Model): Set<Patch> {
  return planSuburbanCommons(model).selected;
}
