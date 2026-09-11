import { Point } from '../types/point.js';
import { drySegments } from '../generator/city-frontage.js';
import { roadCrossSection } from './cross-section.js';
import type { Lane } from './types.js';
import type { WallFeature } from '../scene/scene.js';

/** The farmland's inner boundary already encloses the surveyed village.
 * Reuse that irregular line; cut a real gate wherever a lane crosses it. */
export function villageWall(boundary:Point[],lanes:Lane[],water:Point[][],biome:string):WallFeature {
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
