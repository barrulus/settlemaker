import { Point } from '../types/point.js';
import { Polygon } from '../geom/polygon.js';
import { ARTWORK_MANIFEST, cityGlyph } from '../assets/artwork.js';
import { blocksAccess, nearestOnSegment, type CityFrontage } from './city-frontage.js';
import type { WardLane } from '../wards/ward.js';
import polygonClipping from 'polygon-clipping';
import type { CityBlockPlan } from './city-blocks.js';

export type CityCompoundFamily = 'courtyard-u' | 'inn';
export interface CityCompound {
  family: CityCompoundFamily;
  site: Polygon;
  buildings: Polygon[];
  courts: Polygon[];
  frontage: CityFrontage;
  at: Point;
  canvas: number;
  rotationDeg: number;
  referenceWidth: number;
}

const ring = (p:Polygon)=>p.vertices.map(v=>[Math.round(v.x*1e8)/1e8,Math.round(v.y*1e8)/1e8] as [number,number]);

/** A compound may leave slender remainder strips. They are yards, not tiny
 * census houses; the ordinary density feedback must earn replacement supply. */
export function retainUsefulCompoundNeighbours(plan:CityBlockPlan,areaPerHouse:number):void {
  if(!plan.compounds?.length)return;
  const wings=new Set(plan.compounds.flatMap(c=>c.buildings));
  const minimumSide=Math.sqrt(areaPerHouse/1.15)*.5;
  const removed=new Set<Polygon>();
  for(const building of plan.buildings){
    if(wings.has(building))continue;
    const f=plan.frontages.get(building);
    if(!f)continue;
    const length=Point.distance(f.a,f.b),ax=(f.b.x-f.a.x)/length,ay=(f.b.y-f.a.y)/length;
    const xs=building.vertices.map(p=>ax*p.x+ay*p.y),ys=building.vertices.map(p=>-ay*p.x+ax*p.y);
    const shortSide=Math.min(Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys));
    if(Math.abs(building.square)>=areaPerHouse*.4 && shortSide>=minimumSide)continue;
    removed.add(building);plan.frontages.delete(building);
    (plan.gardens??=[]).push(building);
  }
  plan.buildings=plan.buildings.filter(b=>!removed.has(b));
  plan.runs=plan.runs.map(run=>run.filter(b=>!removed.has(b))).filter(run=>run.length);
}

/** Removing a reserved site can sever an old subdivision lane. Keep only
 * lane components that reach a real street, and do not count dependent lots. */
export function retainConnectedCompoundLanes(plan:CityBlockPlan,streets:Array<WardLane & {kind:'street'|'alley'}>):void {
  const reached:WardLane[]=[...streets],pending=new Set(plan.lanes);
  let changed=true;
  while(changed){
    changed=false;
    for(const lane of pending){
      const connects=[lane.a,lane.b].some(p=>reached.some(line=>{
        const at=nearestOnSegment(p,line.a,line.b),distance=Point.distance(p,at);
        return distance<1e-6 || distance<=line.width/2+1e-6 && !plan.buildings.some(b=>blocksAccess(p,at,b));
      }));
      if(connects){pending.delete(lane);reached.push(lane);changed=true;}
    }
  }
  if(!pending.size)return;
  plan.lanes=plan.lanes.filter(l=>!pending.has(l));
  const removed=new Set<Polygon>();
  for(const building of plan.buildings){
    const f=plan.frontages.get(building);
    if(f && !reached.some(line=>Point.distance(f.at,nearestOnSegment(f.at,line.a,line.b))<1e-6)){
      removed.add(building);plan.frontages.delete(building);(plan.gardens??=[]).push(building);
    }
  }
  plan.buildings=plan.buildings.filter(b=>!removed.has(b));
  plan.runs=plan.runs.map(run=>run.filter(b=>!removed.has(b))).filter(run=>run.length);
}

/** Reserve an actual multi-building street site before ordinary subdivision.
 * Component widths match the ordinary architectural grain; the whole compound
 * is never squeezed into a single existing house plot. No RNG or census weight. */
export function reserveCityCompound(
  site: Polygon, streets: Array<WardLane & {kind:'street'|'alley'}>,
  areaPerHouse: number, family: CityCompoundFamily, biome = 'temperate', fraction?:number,
): {compound:CityCompound;remaining:Polygon[];lanes:WardLane[];frontages:Map<Polygon,CityFrontage>} | null {
  const meta = ARTWORK_MANIFEST[cityGlyph(family,biome)];
  const components = meta.footprintPolygons!;
  const referenceWidth = Math.sqrt(areaPerHouse/1.15);
  const minimumComponent = Math.min(...components.map(points=>{
    const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
    return Math.min(Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys));
  }));
  const canvas = referenceWidth*64/minimumComponent;
  if (canvas*canvas>Math.abs(site.square)*.7) return null;
  const edges:Array<{a:Point;b:Point;length:number}>=[];
  site.forEdge((a,b)=>edges.push({a,b,length:Point.distance(a,b)}));
  const winding=Math.sign(site.square);
  for (const edge of edges.sort((a,b)=>b.length-a.length)) {
    if (edge.length<canvas+.1) continue;
    const ax=(edge.b.x-edge.a.x)/edge.length,ay=(edge.b.y-edge.a.y)/edge.length;
    const inwardX=-ay*winding,inwardY=ax*winding;
    const midpoint=new Point((edge.a.x+edge.b.x)/2,(edge.a.y+edge.b.y)/2);
    const source=streets.filter(line=>{
      const length=Point.distance(line.a,line.b);
      return length>1e-8 && Math.abs(ax*(line.b.y-line.a.y)-ay*(line.b.x-line.a.x))/length<1e-6;
    }).sort((a,b)=>Point.distance(midpoint,nearestOnSegment(midpoint,a.a,a.b))-Point.distance(midpoint,nearestOnSegment(midpoint,b.a,b.b)))[0];
    if(!source || Point.distance(midpoint,nearestOnSegment(midpoint,source.a,source.b))>Math.max(1.25,source.width*2))continue;
    for (const position of fraction===undefined?[.5,.25,.75]:[fraction]) {
      const along=canvas/2+(edge.length-canvas)*position;
      const entrance=new Point(edge.a.x+ax*along,edge.a.y+ay*along);
      const at=new Point(entrance.x+inwardX*canvas/2,entrance.y+inwardY*canvas/2);
      // Artwork's open entrance faces local south (+y), toward the street.
      const rotation=Math.atan2(inwardX,-inwardY);
      const cos=Math.cos(rotation),sin=Math.sin(rotation);
      const point=(x:number,y:number)=>new Point(at.x+(cos*(x-32)-sin*(y-32))*canvas/64,at.y+(sin*(x-32)+cos*(y-32))*canvas/64);
      const box=(left:number,top:number,right:number,bottom:number)=>new Polygon([point(left,top),point(right,top),point(right,bottom),point(left,bottom)]);
      const reserved=box(0,0,64,64);
      if(polygonClipping.difference([ring(reserved)],[ring(site)]).some(p=>Math.abs(new Polygon(p[0].slice(0,-1).map(([x,y])=>new Point(x,y))).square)>1e-7))continue;
      const difference=polygonClipping.difference([ring(site)],[ring(reserved)]);
      if(difference.some(p=>p.length!==1))continue;
      const remaining=difference.map(p=>new Polygon(p[0].slice(0,-1).map(([x,y])=>new Point(x,y))));
      const buildings=components.map(points=>new Polygon(points.map(([x,y])=>point(x,y))));
      const courts=(meta.courtyardVoids??[]).map(([x0,y0,x1,y1])=>box(x0,y0,x1,y1));
      const street=nearestOnSegment(entrance,source.a,source.b);
      const frontage:CityFrontage={...source,at:street};
      // A real central court lane reaches the rear wing and branches to each
      // side wing. It also serves surviving wings if a census trim dissolves art.
      const width=Math.min(source.width,referenceWidth*.12);
      const junction=point(32,32);
      const lanes:WardLane[]=[{a:street,b:junction,width},{a:junction,b:point(32,20),width},
        {a:point(family==='inn'?19:20,32),b:junction,width},{a:junction,b:point(family==='inn'?45:44,32),width}];
      const frontages=new Map<Polygon,CityFrontage>();
      for(const building of buildings){
        const candidates=[source,...lanes.map(l=>({...l,kind:'alley' as const}))]
          .map(line=>({...line,at:nearestOnSegment(building.centroid,line.a,line.b)}))
          .filter(f=>!buildings.some(other=>other!==building&&blocksAccess(building.centroid,f.at,other)))
          .sort((a,b)=>Point.distance(building.centroid,a.at)-Point.distance(building.centroid,b.at));
        if(candidates[0])frontages.set(building,candidates[0]);
      }
      if(frontages.size!==buildings.length)continue;
      return {compound:{family,site:reserved,buildings,courts,frontage,at,canvas,rotationDeg:rotation*180/Math.PI,referenceWidth},remaining,lanes,frontages};
    }
  }
  return null;
}
