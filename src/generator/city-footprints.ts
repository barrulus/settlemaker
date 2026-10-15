import { Point } from '../types/point.js';
import { Polygon } from '../geom/polygon.js';
import { fitInscribedRectangle } from '../geom/inscribed-rectangle.js';
import { blocksAccess, drySegments, nearestOnSegment } from './city-frontage.js';
import type { CityBlockPlan } from './city-blocks.js';
import polygonClipping from 'polygon-clipping';

/** A clipped corner is a parcel, not a triangular roof. Keep ordinary lots
 * unchanged, but replace acute end parcels with a useful rectangular house
 * and explicitly reserve the remainder as yard. Runs and census identities
 * remain one-for-one. The accepted parcel already earned its area floor;
 * its smaller house must independently meet useful footprint dimensions. */
export function regularizeCityFootprints(
  plan: CityBlockPlan, areaPerHouse: number,
  minimumSide = Math.sqrt(areaPerHouse)*.25, minimumArea = areaPerHouse*.16,
): void {
  const replacements = new Map<Polygon, Polygon>();
  const ring = (p: Polygon) => p.vertices.map(v => [Math.round(v.x*1e8)/1e8, Math.round(v.y*1e8)/1e8] as [number, number]);
  for (const lot of plan.buildings) {
    const frontage = plan.frontages.get(lot);
    if (!frontage) continue;
    const length = Point.distance(frontage.a, frontage.b);
    if (length < 1e-8) continue;
    const ax = (frontage.b.x-frontage.a.x)/length, ay = (frontage.b.y-frontage.a.y)/length;
    const us = lot.vertices.map(p => ax*p.x+ay*p.y), vs = lot.vertices.map(p => -ay*p.x+ax*p.y);
    const u0 = Math.min(...us), u1 = Math.max(...us), v0 = Math.min(...vs), v1 = Math.max(...vs);
    const area = Math.abs(lot.square);
    if (area / ((u1-u0)*(v1-v0)) >= .65) continue;
    let best: { center: Point; width: number; depth: number; area: number } | undefined;
    for (const aspect of [.67, 1, 1.5]) {
      const fit = fitInscribedRectangle(lot, aspect, 1, Math.atan2(ay, ax));
      if (!fit) continue;
      const width = aspect*fit.scale, depth = fit.scale, fitArea = width*depth;
      // Area and short-side floors scale with the planned architectural grain.
      if (fitArea < Math.max(area*.4, minimumArea)
        || Math.min(width,depth) < minimumSide) continue;
      if (!best || fitArea > best.area) best = {center:fit.center,width,depth,area:fitArea};
    }
    if (!best) continue;
    const point = (u:number,v:number) => new Point(ax*u-ay*v,ay*u+ax*v);
    const box = (left:number,bottom:number,right:number,top:number) =>
      new Polygon([point(left,bottom),point(right,bottom),point(right,top),point(left,top)]);
    const cx = ax*best.center.x+ay*best.center.y, cy = -ay*best.center.x+ax*best.center.y;
    const left = cx-best.width/2, right = cx+best.width/2, bottom = cy-best.depth/2, top = cy+best.depth/2;
    const house = box(left,bottom,right,top);
    const center = house.centroid, at = nearestOnSegment(center,frontage.a,frontage.b);
    if (plan.buildings.some(other=>other!==lot && blocksAccess(center,at,other))) continue;
    const dry = drySegments(center,at,plan.exclusions??[]);
    if (dry.length!==1 || dry[0][0]!==center || dry[0][1]!==at) continue;
    // Four disjoint slabs partition the yard without creating a polygon hole.
    // Boolean intersection also preserves reflex corners and disconnected bits.
    const yards: Polygon[] = [];
    for (const bounds of [[u0,v0,left,v1],[right,v0,u1,v1],[left,v0,right,bottom],[left,top,right,v1]]) {
      if (bounds[2]-bounds[0]<1e-8 || bounds[3]-bounds[1]<1e-8) continue;
      const slab = box(bounds[0],bounds[1],bounds[2],bounds[3]);
      for (const part of polygonClipping.intersection([ring(lot)],[ring(slab)])) {
        if (part.length!==1) continue;
        const yard = new Polygon(part[0].slice(0,-1).map(([x,y])=>new Point(x,y)));
        if (Math.abs(yard.square)>1e-8) yards.push(yard);
      }
    }
    replacements.set(lot,house);
    plan.frontages.delete(lot);
    plan.frontages.set(house,{...frontage,at});
    (plan.gardens ??= []).push(...yards);
  }
  plan.buildings = plan.buildings.map(b=>replacements.get(b)??b);
  plan.runs = plan.runs.map(run=>run.map(b=>replacements.get(b)??b));
}
