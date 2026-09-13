import { Point } from '../types/point.js';
import { Polygon } from '../geom/polygon.js';
import { clipBlock, planCityBlock } from './city-blocks.js';
import { nearestOnSegment, polygonsOverlap, wardFrontages } from './city-frontage.js';
import { meanBuildingArea } from './generation-params.js';
import type { Ward } from '../wards/ward.js';
import { convexHull } from '../village/dressing/parcel-cut.js';
import polygonClipping from 'polygon-clipping';

/** A market or temple is a compact public site with occupied street fronts,
 * rather than a whole vacant neighbourhood. These buildings are commercial
 * premises / temple ancillary buildings, outside the residential census. */
export function buildCivicBlock(ward: Ward, temple: boolean): void {
  const site = ward.getCityBlock(), metres = ward.model.params.development!.metresPerUnit;
  const streets = wardFrontages(ward);
  const main = [...streets].sort((a,b)=>Point.distance(b.a,b.b)-Point.distance(a.a,a.b))[0];
  if (!main || site.length < 3) { ward.geometry = []; return; }
  const length = Point.distance(main.a,main.b), ax = (main.b.x-main.a.x)/length, ay = (main.b.y-main.a.y)/length;
  const c = site.centroid, cx = ax*c.x+ay*c.y, cy = -ay*c.x+ax*c.y;
  let half = Math.min((temple ? 24 : 18)/metres, Math.sqrt(Math.abs(site.square)*.3))/2;
  const envelope = site.isConvex() ? site : new Polygon(convexHull(site.vertices));
  envelope.forEdge((a,b)=>{
    const ex=b.x-a.x, ey=b.y-a.y, n=Math.hypot(ex,ey);
    const distance=Math.sign(site.square)*(ex*(c.y-a.y)-ey*(c.x-a.x))/n;
    half=Math.min(half,Math.max(0,distance-.2)/(Math.abs(ex*ay-ey*ax)/n+Math.abs(ex*ax+ey*ay)/n));
  });
  const point=(x:number,y:number)=>new Point(ax*x-ay*y,ay*x+ax*y);
  const square=()=>new Polygon([point(cx-half,cy-half),point(cx+half,cy-half),point(cx+half,cy+half),point(cx-half,cy+half)]);
  // A reflex notch is local, not an infinite half-plane through the whole
  // ward. Fit the court to its envelope, then verify the actual boundary.
  const ring=(p:Polygon)=>p.vertices.map(v=>[Math.round(v.x*1e8)/1e8,Math.round(v.y*1e8)/1e8] as [number,number]);
  if(envelope!==site)for(let trial=0;trial<16;trial++){
    if(!polygonClipping.difference([ring(square())],[ring(site)]).length)break;
    half*=.85;
  }
  ward.publicSpace = square();
  const laneWidth=.6*ward.insetScale;
  const area=meanBuildingArea(ward.model.params.development!.texturePopulation)*ward.model.minSqScale/.6;
  const plan=planCityBlock(site,streets,area,laneWidth,true);
  if (!plan) { ward.geometry=[]; return; }
  // Subtract the court from each lot, keeping real polygon footprints. A
  // narrow perimeter passage links all lanes that enter the public site.
  const h=half+laneWidth/2;
  const planes=[[ax,ay,cx+h],[-ax,-ay,-cx+h],[-ay,ax,cy+h],[ay,-ax,-cy+h]];
  ward.geometry=[];
  ward.buildingFrontages.clear();
  for(const lot of plan.buildings){
    let remaining=lot;
    for(const [nx,ny,k] of planes){
      if(remaining.length<3)break;
      const outside=clipBlock(remaining,-nx,-ny,-k);
      if(outside.length>=3 && Math.abs(outside.square)>=area*.32 && outside.compactness>=.35){
        ward.geometry.push(outside);
        const f=plan.frontages.get(lot)!;
        ward.buildingFrontages.set(outside,{...f,at:nearestOnSegment(outside.centroid,f.a,f.b)});
      }
      remaining=clipBlock(remaining,nx,ny,k);
    }
  }
  ward.lanes=[];
  for(const lane of plan.lanes){
    // Liang–Barsky interval inside the square; retain the two outside pieces.
    let lo=0,hi=1;
    for(const [nx,ny,boundary] of planes){
      const k=boundary-laneWidth/2;
      const start=nx*lane.a.x+ny*lane.a.y-k, delta=nx*(lane.b.x-lane.a.x)+ny*(lane.b.y-lane.a.y);
      if(Math.abs(delta)<1e-10){if(start>0){lo=1;hi=0;}continue;}
      if(delta>0)hi=Math.min(hi,-start/delta);else lo=Math.max(lo,-start/delta);
    }
    if(lo>=hi){ward.lanes.push(lane);continue;}
    const at=(t:number)=>new Point(lane.a.x+(lane.b.x-lane.a.x)*t,lane.a.y+(lane.b.y-lane.a.y)*t);
    if(lo>1e-8)ward.lanes.push({...lane,b:at(lo)});
    if(hi<1-1e-8)ward.lanes.push({...lane,a:at(hi)});
  }
  // Small precincts may need no subdivision lane at all. Reserve an entry
  // from an existing street so their court is never an isolated circuit.
  const court=ward.publicSpace;
  const onCourt=(p:Point)=>court.vertices.some((a,i)=>Point.distance(p,nearestOnSegment(p,a,court.vertices[(i+1)%court.length]))<1e-6);
  if(!ward.lanes.some(l=>onCourt(l.a)||onCourt(l.b))){
    const entries=streets.map(street=>{
      const b=nearestOnSegment(c,street.a,street.b);
      const a=court.vertices.map((p,i)=>nearestOnSegment(b,p,court.vertices[(i+1)%court.length]))
        .sort((p,q)=>Point.distance(p,b)-Point.distance(q,b))[0];
      const length=Point.distance(a,b), nx=(a.y-b.y)/length*laneWidth/2, ny=(b.x-a.x)/length*laneWidth/2;
      const corridor=new Polygon([new Point(a.x+nx,a.y+ny),new Point(b.x+nx,b.y+ny),new Point(b.x-nx,b.y-ny),new Point(a.x-nx,a.y-ny)]);
      const blocked=ward.geometry.filter(lot=>polygonsOverlap(lot,corridor));
      return {a,b,blocked,score:blocked.reduce((s,lot)=>s+Math.abs(lot.square),0)+length*.1};
    }).sort((a,b)=>a.score-b.score);
    const entry=entries[0];
    ward.geometry=ward.geometry.filter(b=>!entry.blocked.includes(b));
    for(const b of entry.blocked)ward.buildingFrontages.delete(b);
    ward.lanes.push({a:entry.a,b:entry.b,width:laneWidth});
  }
  // Draw on the cut boundary so every lane mouth meets the court circuit.
  ward.publicSpace.forEdge((a,b)=>ward.lanes.push({a,b,width:laneWidth}));
}
