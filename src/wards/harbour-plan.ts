import { Point } from '../types/point.js';
import { Polygon } from '../geom/polygon.js';
import { pointInPolygon } from '../geom/point-in-polygon.js';
import { roadCorridor } from '../geom/road-corridor.js';
import { drySegments, nearestOnSegment, overlapsWater, polygonsOverlap, segmentInside } from '../generator/city-frontage.js';
import { coverageExceeded } from '../input/water-context.js';

export interface HarbourPlan {
  kind: 'protected' | 'natural' | 'river' | 'lake' | 'landing';
  basin: Point[];
  entrance: [Point, Point];
  approach: Point[];
  navigationWidth: number;
  quays: Array<{ ring: Point[]; edge: Point[] }>;
  breakwaters: Array<{ ring: Point[]; path: Point[]; width: number }>;
  berths: Polygon[];
  warehouses: Polygon[];
  access: Point[][];
  fixtures: Array<{ kind: 'bollard' | 'crane' | 'boat' | 'beacon'; at: Point; angle: number }>;
}

export interface HarbourSite {
  patch: Polygon;
  water: Point[][];
  /** Open exposed banks only; survey cuts and internal water seams are excluded. */
  shorelines: Point[][];
  /** Berthing candidates only; all banks still constrain navigation geometry. */
  berthingShorelines?: Point[][];
  gate?: Point;
  large: boolean;
  waterKind?: 'ocean' | 'lake' | 'river';
  metresPerUnit: number;
  surveyRadius?: number;
  surveyOriginOffsetM?: number;
}

/** Prefer useful working provision; empty water area is a cost, not a prize. */
export function harbourPlanScore(plan: HarbourPlan): number {
  return (plan.kind === 'landing' ? 0 : 10000) + Math.min(4,plan.warehouses.length)*150
    + Math.min(4,plan.berths.length)*100 - Math.abs(new Polygon(plan.basin).square)*.5;
}

/** A harbour reserves working ground and a connected navigable water area.
 * Structures occupy existing land/water; the supplied coast is never excavated,
 * straightened or moved. All geometry is in the caller's mesh coordinates. */
export function planHarbour(site: HarbourSite): HarbourPlan | null {
  const wet = (p: Point) => {
    if (site.surveyRadius !== undefined && p.length > site.surveyRadius + 1e-6) coverageExceeded(p.length * site.metresPerUnit + (site.surveyOriginOffsetM ?? 0));
    return site.water.filter(r => pointInPolygon(p, r)).length % 2 === 1;
  };
  const centre = site.patch.centroid;
  const searchRadius = Math.max(...site.patch.vertices.map(p=>Point.distance(p,centre))) + 100/site.metresPerUnit;
  const shoreCandidates: Array<{ at: Point; tangent: Point; normal: Point; distance: number }> = [];
  for (const path of site.berthingShorelines ?? site.shorelines) for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], tangent = b.subtract(a).norm();
    if (Point.distance(a, b) < 1e-5) continue;
    const at = nearestOnSegment(centre, a, b), normal = tangent.rotate90();
    if (Point.distance(at,centre)>searchRadius) continue;
    const epsilon = .15 / site.metresPerUnit;
    if (wet(at.add(normal.scale(epsilon))) === wet(at.subtract(normal.scale(epsilon)))) continue;
    if (!wet(at.add(normal.scale(epsilon)))) normal.scaleEq(-1);
    shoreCandidates.push({ at, tangent, normal, distance: Point.distance(at, centre) });
  }
  shoreCandidates.sort((a, b) => a.distance - b.distance);
  const distinct: typeof shoreCandidates = [];
  for (const candidate of shoreCandidates) {
    if (distinct.some(p => Point.distance(p.at, candidate.at) < 8 / site.metresPerUnit && p.normal.dot(candidate.normal) > .98)) continue;
    distinct.push(candidate);
    if (distinct.length === 5) break;
  }
  let best: HarbourPlan | null = null, bestScore = -Infinity;
  for (const candidate of distinct) {
    const plan = planAtShore(site, candidate.at, candidate.tangent, candidate.normal, wet);
    if (!plan) continue;
    const score = harbourPlanScore(plan);
    if (score > bestScore) { best = plan; bestScore = score; }
  }
  return best;
}

function planAtShore(site: HarbourSite, origin: Point, tangent: Point, normal: Point, wet: (p: Point) => boolean): HarbourPlan | null {
  const unit = (metres: number) => metres / site.metresPerUnit;
  const bodyKind=site.waterKind??'ocean';
  const at = (t: number, s: number) => origin.add(tangent.scale(t)).add(normal.scale(s));
  const local = (p: Point) => { const d = p.subtract(origin); return { t: d.dot(tangent), s: d.dot(normal) }; };
  const rectangle = (t0: number, s0: number, t1: number, s1: number) => new Polygon([at(t0,s0),at(t1,s0),at(t1,s1),at(t0,s1)]);
  const dryInside = (ring: Point[]) => ring.every(p => pointInPolygon(p, site.patch.vertices))
    && ring.every((p,i) => segmentInside(p, ring[(i+1)%ring.length], site.patch))
    && !overlapsWater(new Polygon(ring), site.water);
  const allWet = (ring: Point[]) => ring.every(wet) && ring.every((p,i) => drySegments(p,ring[(i+1)%ring.length],site.water).length === 0)
    && !site.shorelines.some(path => path.some(p => pointInPolygon(p,ring)));
  const projected = site.shorelines.flatMap(path => path.slice(1).map((b,i) => [local(path[i]),local(b)] as const));
  const shoreAt = (t: number): number | null => {
    const crossings: number[] = [];
    for (const [a,b] of projected) {
      if (Math.abs(b.t-a.t)<1e-8 || t<Math.min(a.t,b.t)-1e-8 || t>Math.max(a.t,b.t)+1e-8) continue;
      const s=a.s+(b.s-a.s)*(t-a.t)/(b.t-a.t);
      if (Math.abs(s)>unit(90)) continue;
      if (!wet(at(t,s-unit(.1))) && wet(at(t,s+unit(.1)))) crossings.push(s);
    }
    return crossings.sort((a,b)=>Math.abs(a)-Math.abs(b))[0] ?? null;
  };
  const ts = site.patch.vertices.map(p=>local(p).t);
  const low = Math.max(Math.min(...ts)+unit(1), -unit(site.large?70:35));
  const high = Math.min(Math.max(...ts)-unit(1), unit(site.large?70:35));
  let stations: Array<{t:number;s:number}> = [], depth = unit(site.large?8:5);
  for (const apronM of site.large?[8,6,4]:[5,4]) {
    const apron=unit(apronM), runs: typeof stations[] = []; let run: typeof stations=[];
    for(let t=low;t<=high;t+=unit(2)) {
      const s=shoreAt(t);
      const strip=s===null?null:[at(t-unit(.1),s-unit(.3)),at(t+unit(.1),s-unit(.3)),at(t+unit(.1),s-apron),at(t-unit(.1),s-apron)];
      if(strip && dryInside(strip))run.push({t,s:s!});
      else {if(run.length)runs.push(run);run=[];}
    }
    if(run.length)runs.push(run);
    const longest=runs.sort((a,b)=>b.length-a.length)[0]??[];
    if(longest.length>stations.length){stations=longest;depth=apron;}
    if(longest.length>= (site.large?18:10))break;
  }
  if(stations.length<6)return null;
  const waterside=stations.map(p=>at(p.t,p.s-unit(.3)));
  const landside=stations.map(p=>at(p.t,p.s-depth));
  const quay=[...waterside,...landside.slice().reverse()];
  if(!dryInside(quay))return null;
  const left=stations[0].t, right=stations.at(-1)!.t, width=right-left;
  const near=Math.max(...stations.map(p=>p.s));
  const quayLine=stations.map(p=>at(p.t,p.s-depth*.55));
  const centreQuay=quayLine[Math.floor(quayLine.length/2)];
  const access:Point[][]=[quayLine];
  // A reserved cart route reaches the city's gate or a dry shared patch edge.
  const gate=site.gate??site.patch.vertices.filter(p=>!wet(p)).sort((a,b)=>Point.distance(a,centreQuay)-Point.distance(b,centreQuay))[0];
  if(!gate)return null;
  const entry=gate.add(centreQuay.subtract(gate).norm(unit(.6)));
  const accessTargets=[centreQuay,...quayLine.filter((_,i)=>i%3===0)].sort((a,b)=>Point.distance(a,entry)-Point.distance(b,entry));
  const target=accessTargets.find(p=>segmentInside(entry,p,site.patch)&&drySegments(entry,p,site.water).length===1);
  if(!target)return null;
  access.push([gate,entry,target]);
  const accessWidth=unit(3.5);
  const reserved=access.flatMap(path=>path.slice(1).map((p,i)=>roadCorridor(path[i],p,accessWidth)));
  let warehouses:Polygon[]=[];
  // Equal frontages with service gaps: no recursive alley subdivision. Both
  // feet and the full access corridor fit the reserved dry harbour patch.
  let warehouseAccess:Point[][]=[];
  for(const [widthM,depthM] of site.large?[[14,10],[12,8],[10,8]]:[[10,8]]){
    const warehouseW=unit(widthM),warehouseD=unit(depthM),placed:Polygon[]=[],connections:Point[][]=[];
    for(let row=0;row<3;row++)for(let t=left+warehouseW/2+unit(1);t+warehouseW/2<right-unit(1);t+=unit(2)){
      const s=shoreAt(t);if(s===null)continue;
      const front=s-depth-unit(1+row*5),back=front-warehouseD;
      const box=rectangle(t-warehouseW/2,back,t+warehouseW/2,front);
      const yard=rectangle(t-warehouseW/2-unit(1),back-unit(.5),t+warehouseW/2+unit(1),front+unit(.5));
      const door=at(t,front),lane=at(t,s-depth*.55),connection=roadCorridor(door,lane,unit(2.5));
      if(!dryInside(box.vertices)||!dryInside(connection.vertices)||reserved.some(r=>polygonsOverlap(r,box))
        ||placed.some(p=>polygonsOverlap(p,yard)||polygonsOverlap(p,connection))
        ||connections.some(path=>polygonsOverlap(roadCorridor(path[0],path[1],unit(2.5)),box)))continue;
      placed.push(box);connections.push([door,lane]);
    }
    if(placed.length>warehouses.length){warehouses=placed;warehouseAccess=connections;}
  }
  access.push(...warehouseAccess);
  let berths:Polygon[]=[];
  const berthLength=unit(bodyKind==='river'?8:site.large?15:10), berthWidth=unit(3), berthSpacing=unit(14);
  const berthAt=(t:number):Polygon|null=>{
    const s=shoreAt(t);if(s===null)return null;
    const pier=rectangle(t-berthWidth/2,s-unit(1),t+berthWidth/2,s+berthLength);
    const root=at(t,s-unit(1)), tip=at(t,s+berthLength);
    if(wet(root)||wet(pier.vertices[0])||wet(pier.vertices[1])||!wet(tip)
      ||!allWet([at(t-berthWidth/2,s+unit(.5)),at(t+berthWidth/2,s+unit(.5)),...pier.vertices.slice(2)]))return null;
    return pier;
  };
  for(let t=left+unit(8);t<right-unit(8);t+=berthSpacing){
    const pier=berthAt(t);if(pier)berths.push(pier);
  }
  const navigationWidth=unit(bodyKind==='river'?8:site.large?12:8);
  let basin:Point[]=[], entrance:[Point,Point]=[at(left,near),at(right,near)], approach:Point[]=[], breakwaters:HarbourPlan['breakwaters']=[];
  let kind:HarbourPlan['kind']='landing';
  const minDepth=near+berthLength+unit(4);
  // Work outward from berth tips and turning clearance. The first valid
  // enclosure wins; expanding empty water does not make a better harbour.
  const depthOptions=bodyKind==='river'?[22,28,35]:site.large?[35,38,40]:[28,32,35];
  for(const basinDepthM of depthOptions){
    const outer=near+unit(basinDepthM), innerLeft=left+unit(5), innerRight=right-unit(5);
    if(outer-minDepth<unit(10)||innerRight-innerLeft<navigationWidth*1.5)continue;
    const candidate=rectangle(innerLeft,minDepth,innerRight,outer-unit(4));
    if(!allWet(candidate.vertices))continue;
    const mouth=navigationWidth+unit(3), mouthCentre=left+width*.65;
    const mouthLeft=mouthCentre-mouth/2,mouthRight=mouthCentre+mouth/2;
    let entryPair:[Point,Point]=[at(mouthLeft,outer),at(mouthRight,outer)];
    const middle=at(mouthCentre,outer),turnDepth=(minDepth+outer-unit(4))/2;
    let route=[at(mouthCentre,outer+unit(20)),middle,
      at(mouthCentre,turnDepth),at((innerLeft+innerRight)/2,turnDepth)];
    if(bodyKind==='river'){
      const channel=(minDepth+outer-unit(4))/2;
      entryPair=[at(innerRight,channel-navigationWidth/2),at(innerRight,channel+navigationWidth/2)];
      route=[at(right+unit(30),channel),at(innerRight,channel),at((innerLeft+innerRight)/2,channel)];
    }
    if(route.slice(1).some((p,i)=>!allWet(roadCorridor(route[i],p,navigationWidth).vertices)))continue;
    const protectedByLand=[-1,1].every(side=>[.35,.65,.9].every(fraction=>
      !wet(at(side<0?left-unit(25):right+unit(25),near+unit(basinDepthM*fraction)))));
    const arms:HarbourPlan['breakwaters']=[];
    let plannedBerths=berths;
    if(bodyKind==='ocean'&&!protectedByLand){
      const armWidth=unit(3.5),leftRoot=left+unit(2.5),rightRoot=right-unit(2.5);
      if(mouthLeft-leftRoot<unit(5)||rightRoot-mouthRight<unit(3))continue;
      // Keep every berth behind a masonry return rather than directly behind
      // the entrance. Both sides of the basin connect back to the dry quay.
      plannedBerths=[];
      for(const [from,to] of [[left+unit(8),mouthLeft-unit(2)],[mouthRight+unit(2),right-unit(6)]]){
        for(let t=from;t<=to;t+=berthSpacing){const pier=berthAt(t);if(pier)plannedBerths.push(pier);}
      }
      if(!plannedBerths.length)continue;
      let valid=true;
      for(const [root,end] of [[leftRoot,mouthLeft],[rightRoot,mouthRight]]){
        const shore=shoreAt(root);if(shore===null){valid=false;break;}
        const path=[at(root,shore-unit(.6)),at(root,outer),at(end,outer)];
        const ring=strokePath(path,armWidth),solid=new Polygon(ring);
        const offshore=roadCorridor(at(root,shore+unit(3)),path[1],armWidth);
        if(!allWet(offshore.vertices)||!allWet(roadCorridor(path[1],path[2],armWidth).vertices)
          ||plannedBerths.some(p=>polygonsOverlap(p,solid))
          ||route.slice(1).some((p,i)=>polygonsOverlap(roadCorridor(route[i],p,navigationWidth),solid))){valid=false;break;}
        arms.push({ring,path,width:armWidth});
      }
      if(!valid||arms.length!==2)continue;
    }
    if(route.slice(1).some((p,i)=>plannedBerths.some(b=>polygonsOverlap(roadCorridor(route[i],p,navigationWidth),b))))continue;
    berths=plannedBerths;
    basin=candidate.vertices;entrance=entryPair;approach=route;breakwaters=arms;
    kind=bodyKind==='river'?'river':bodyKind==='lake'?'lake':arms.length?'protected':'natural';
    break;
  }
  // A narrow bank can still have an honest landing, but never claims a
  // sheltered basin or a navigable entrance that the surveyed water cannot fit.
  if(!basin.length){
    if(!berths.length)return null;
    const t=(left+right)/2,s=shoreAt(t)??near;
    entrance=[at(t-navigationWidth/2,s+berthLength+unit(2)),at(t+navigationWidth/2,s+berthLength+unit(2))];
    approach=[];
  }
  const angle=Math.atan2(normal.y,normal.x)*180/Math.PI;
  const fixtures:HarbourPlan['fixtures']=[];
  for(let i=2;i<waterside.length-2;i+=4)fixtures.push({kind:'bollard',at:waterside[i].subtract(normal.scale(unit(.7))),angle});
  if(width>unit(35)&&depth>=unit(6))fixtures.push({kind:'crane',at:at(left+unit(6),stations[Math.min(3,stations.length-1)].s-depth*.55),angle});
  for(const arm of breakwaters)fixtures.push({kind:'beacon',at:arm.path.at(-1)!,angle});
  if(basin.length&&berths.length){
    const pier=berths[0];const boat=midpoint(pier.vertices[2],pier.vertices[3]).subtract(normal.scale(unit(5))).add(tangent.scale(unit(4)));
    if(wet(boat))fixtures.push({kind:'boat',at:boat,angle});
  }
  return {kind,basin,entrance,approach,navigationWidth,quays:[{ring:quay,edge:waterside}],breakwaters,berths,warehouses,access,fixtures};
}

function midpoint(a:Point,b:Point):Point{return new Point((a.x+b.x)/2,(a.y+b.y)/2);}

/** Buffered masonry centreline with joined corners, not overlapping rectangles. */
function strokePath(path:Point[],width:number):Point[]{
  const normals=path.slice(1).map((p,i)=>p.subtract(path[i]).norm().rotate90());
  const offsets=path.map((_,i)=>{
    if(i===0)return normals[0].scale(width/2);
    if(i===path.length-1)return normals.at(-1)!.scale(width/2);
    const bisector=normals[i-1].add(normals[i]).norm();
    return bisector.scale(width/2/Math.max(.25,bisector.dot(normals[i])));
  });
  return [...path.map((p,i)=>p.add(offsets[i])),...path.map((p,i)=>p.subtract(offsets[i])).reverse()];
}
