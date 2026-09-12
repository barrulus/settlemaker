import { convexHull } from './dressing/parcel-cut.js';
import { inkExtent, nominalFootprint } from './glyphs.js';
import type { Building, Poi } from './types.js';
import polygonClipping from 'polygon-clipping';
import { Point } from '../types/point.js';
import { drySegments } from '../generator/city-frontage.js';
import { roadCrossSection } from './cross-section.js';
import type { Lane } from './types.js';
import type { WallFeature } from '../scene/scene.js';

/** Follow the occupied enclosure; cut a real gate wherever a lane crosses it. */
export function villageWall(boundary:Point[],lanes:Lane[],water:Point[][],biome:string,reservations:Point[][]=[]):WallFeature {
  // Enclose any reserved clearing that straddles the occupied enclosure. The
  // union adds only its reserved ground, leaving neighbouring fields intact.
  if (boundary.length >= 3 && reservations.length) {
    const connected = reservations.filter(r => polygonClipping.intersection([boundary.map(p => [p.x,p.y] as [number,number])], [r.map(p => [p.x,p.y] as [number,number])]).length > 0);
    const rings = [boundary, ...connected].map(r => [r.map(p => [p.x,p.y] as [number,number])]);
    const union = polygonClipping.union(rings[0], ...rings.slice(1));
    const area = (r: number[][]) => Math.abs(r.reduce((sum,p,i) => {const q=r[(i+1)%r.length];return sum+p[0]*q[1]-q[0]*p[1];},0));
    const outline = union.map(p=>p[0]).sort((a,b)=>area(b)-area(a))[0];
    if(outline)boundary=outline.slice(0,-1).map(([x,y])=>new Point(x,y));
  }
  const wall:WallFeature={polylines:[],gates:[],towers:[],large:false,material:biome==='desert'?'rubble':'palisade'};
  for(let i=0;i<boundary.length;i++){
    const a=boundary[i],b=boundary[(i+1)%boundary.length],dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy);
    for(const segment of drySegments(a,b,water)){
      const last=wall.polylines.at(-1);
      if(last&&Math.hypot(last.at(-1)!.x-segment[0].x,last.at(-1)!.y-segment[0].y)<1e-6)last.push(segment[1]);
      else wall.polylines.push([...segment]);
    }
    for(const lane of lanes)for(let j=1;j<lane.points.length;j++){
      const p=lane.points[j-1],q=lane.points[j],ex=q.x-p.x,ey=q.y-p.y,den=dx*ey-dy*ex;
      if(Math.abs(den)<1e-8)continue;
      const t=((p.x-a.x)*ey-(p.y-a.y)*ex)/den,u=((p.x-a.x)*dy-(p.y-a.y)*dx)/den;
      if(t<0||t>1||u<0||u>1)continue;
      const x=a.x+t*dx,y=a.y+t*dy;
      if(wall.gates.some(g=>Math.hypot((g.p1.x+g.p2.x)/2-x,(g.p1.y+g.p2.y)/2-y)<.5))continue;
      const sine=Math.abs(den)/(len*Math.hypot(ex,ey)),half=(roadCrossSection(lane).surfaceM+1)/2/Math.max(.12,sine);
      wall.gates.push({p1:{x:x-dx/len*half,y:y-dy/len*half},p2:{x:x+dx/len*half,y:y+dy/len*half},routeIds:lane.sourceRouteIds??[]});
    }
  }
  return wall;
}

/** Close enclosure around occupied roofs, with room to walk behind them. */
export function villageWallBoundary(buildings: Building[], pois: Poi[], fallback: Point[]): Point[] {
  const points: Point[]=[];
  for(const item of [...buildings,...pois.filter(p=>!['stone-circle','boathouse'].includes(p.kind))]) {
    const fp='footprint' in item?item.footprint:nominalFootprint(item.glyph);
    const extent=inkExtent(item.glyph,fp),a=item.bearingDeg*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
    for(const x of [-extent.width/2,extent.width/2])for(const y of [-extent.depth/2,extent.depth/2])points.push(new Point(item.position.x+x*c-y*s,item.position.y+y*c+x*s));
  }
  const hull=convexHull(points);
  if(hull.length<3)return fallback;
  // Intersect adjacent offset support lines. insetConvex only shrinks and
  // deliberately ignores negative distances, so it cannot form an enclosure.
  return hull.map((p,i)=>{
    const a=hull[(i+hull.length-1)%hull.length],b=hull[(i+1)%hull.length];
    const l1=Point.distance(a,p),l2=Point.distance(p,b);
    const n1={x:(p.y-a.y)/l1,y:(a.x-p.x)/l1},n2={x:(b.y-p.y)/l2,y:(p.x-b.x)/l2};
    const k=3.5/(1+n1.x*n2.x+n1.y*n2.y);
    return new Point(p.x+(n1.x+n2.x)*k,p.y+(n1.y+n2.y)*k);
  });
}
