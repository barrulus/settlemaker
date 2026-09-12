import { Point } from '../types/point.js';
import { drySegments } from '../generator/city-frontage.js';
import type { Scene, RoadFeature, ScenePoint } from './scene.js';

/** Only bounded wet runs between two dry road segments become bridges. Roads
 * terminating in open water are not silently converted into ocean viaducts. */
export function cityCrossings(roads:RoadFeature[],rings:ScenePoint[][]):NonNullable<Scene['layers']['bridges']>{
  const water=rings.map(r=>r.map(p=>new Point(p.x,p.y))),out:NonNullable<Scene['layers']['bridges']>=[];
  for(const [ri,road]of roads.entries()){
    if(road.kind==='alley')continue;
    const runs:Array<{a:Point;b:Point;wet:boolean}>=[];
    for(let i=1;i<road.path.length;i++){
      const a=new Point(road.path[i-1].x,road.path[i-1].y),b=new Point(road.path[i].x,road.path[i].y),dry=drySegments(a,b,water);let previous=a;
      for(const[start,end]of dry){if(Point.distance(previous,start)>1e-6)runs.push({a:previous,b:start,wet:true});runs.push({a:start,b:end,wet:false});previous=end;}
      if(Point.distance(previous,b)>1e-6)runs.push({a:previous,b,wet:true});
    }
    for(let i=0;i<runs.length;i++){
      if(!runs[i].wet)continue;
      const start=i,points=[runs[i].a];let length=0;
      while(i<runs.length&&runs[i].wet){length+=Point.distance(runs[i].a,runs[i].b);points.push(runs[i].b);i++;}
      if(start===0||i===runs.length||length>40||length<.1)continue;
      const c=points[Math.floor(points.length/2)];
      if(out.some(b=>b.path.some(p=>Math.hypot(p.x-c.x,p.y-c.y)<1)))continue;
      const width=road.width??(road.kind==='artery'?1.8:1.2);
      const extend=(p:Point,toward:Point)=>{const len=Point.distance(p,toward),d=Math.min(width*.5,len);return new Point(p.x+(toward.x-p.x)*d/(len||1),p.y+(toward.y-p.y)*d/(len||1));};
      points[0]=extend(points[0],runs[start-1].a);points[points.length-1]=extend(points.at(-1)!,runs[i].b);
      out.push({id:`bridge:${ri}:${start}`,path:points.map(p=>({x:p.x,y:p.y})),width});
    }
  }
  return out;
}
