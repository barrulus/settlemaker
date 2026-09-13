import type { RoadFeature } from '../scene/scene.js';
import { Point } from '../types/point.js';

/** Join serial approach/apron pieces before shaping open-country roads.
 * Junctions and route identities survive; the two ends stay fixed. */
export function shapeVillageApproaches(roads: RoadFeature[], seed: number): RoadFeature[] {
  const result = roads.map(r=>({...r,path:r.path.map(p=>({...p}))}));
  const same = (a: {x:number;y:number},b: {x:number;y:number}) => Math.hypot(a.x-b.x,a.y-b.y)<1e-6;
  let joined = true;
  while(joined) {
    joined=false;
    for(let i=0;i<result.length&&!joined;i++) {
      const a=result[i];if(a.kind!=='road'||a.path.length<2)continue;
      for(let j=i+1;j<result.length;j++) {
        const b=result[j];if(b.kind!=='road'||b.path.length<2||b.width!==a.width)continue;
        if(same(a.path[0],b.path[0]))a.path.reverse();
        if(same(a.path.at(-1)!,b.path.at(-1)!))b.path.reverse();
        if(same(a.path[0],b.path.at(-1)!)){a.path.reverse();b.path.reverse();}
        if(!same(a.path.at(-1)!,b.path[0]))continue;
        const joint=b.path[0];
        if(result.some((r,k)=>k!==i&&k!==j&&r.path.some(p=>same(p,joint))))continue;
        a.path.push(...b.path.slice(1));a.routeIds=[...new Set([...(a.routeIds??[]),...(b.routeIds??[])])];
        result.splice(j,1);joined=true;break;
      }
    }
  }
  for(const [index,road] of result.entries()) {
    if(road.kind!=='road'||road.path.length<2)continue;
    if(Math.hypot(road.path[0].x,road.path[0].y)>Math.hypot(road.path.at(-1)!.x,road.path.at(-1)!.y))road.path.reverse();
    const start=road.path[0],end=road.path.at(-1)!;
    const dx=end.x-start.x,dy=end.y-start.y,length=Math.hypot(dx,dy);
    if(length<70)continue;
    // Keep deliberate routing and every intermediate junction. This operates
    // only on the straight, isolated stretches left across dry farmland.
    if(road.path.some(p=>Math.abs((p.x-start.x)*dy-(p.y-start.y)*dx)/length>length*.15))continue;
    if(road.path.slice(1,-1).some(p=>result.some(other=>other!==road&&other.path.some(q=>same(p,q)))))continue;
    const amplitude=Math.min(30,length*.1)*(((seed+index)%2)?1:-1);
    const travelled=[0];
    for(let i=1;i<road.path.length;i++)travelled.push(travelled[i-1]+Math.hypot(road.path[i].x-road.path[i-1].x,road.path[i].y-road.path[i-1].y));
    road.path=road.path.map((p,i)=>{
      const t=travelled[i]/travelled.at(-1)!,offset=amplitude*Math.pow(Math.sin(Math.PI*t),2);
      return new Point(p.x-dy/length*offset,p.y+dx/length*offset);
    });
  }
  return result;
}
