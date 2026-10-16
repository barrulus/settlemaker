import { boundsOfPoints } from '../geom/bounds.js';
import { Point } from '../types/point.js';
import { SeededRandom } from '../utils/random.js';
import { landscapeHash } from '../assets/landscape-placement.js';
import { pointInPolygon } from '../geom/point-in-polygon.js';
import { nearestOnSegment } from '../generator/city-frontage.js';
import { planFieldRegion } from '../village/dressing/fields.js';
import { radialExtent } from '../village/dressing/extent.js';
import { convexHull } from '../village/dressing/parcel-cut.js';
import type { Lot } from '../village/types.js';
import type { Layout } from './layouts.js';

export function buildingLots(layout: Layout): Lot[] {
  return layout.scene.layers.buildings.map((b,i)=> {
    const {min_x:minX,max_x:maxX,min_y:minY,max_y:maxY}=boundsOfPoints(b.ring);
    return {id:b.id??`claim:${i}`,laneId:'',side:1,front:new Point((minX+maxX)/2,minY),bearingDeg:0,
      frontageM:maxX-minX,depthM:maxY-minY,score:0};
  });
}

function prepare(layout: Layout, seed: number) {
  const ruralIds=new Set(layout.buildings.filter(b=>b.settlementRole==='rural').map(b=>b.id));
  const urbanLots=buildingLots(layout).filter(l=>!ruralIds.has(l.id));
  const plan=planFieldRegion(layout.site,layout.green,urbanLots,[],new SeededRandom(seed^0x51f15e),
    new Set(urbanLots.map(l=>l.id)),Math.max(200,Math.sqrt(layout.site.population*150)));
  const centre=layout.green.centre;
  const edge=radialExtent(centre,plan.region,plan.fabricRadius);
  const inner=radialExtent(centre,plan.belt,plan.fabricRadius);
  const roads=layout.scene.layers.roads.filter(r=>r.kind==='road');
  const phase=landscapeHash(seed,0,0x434f554e)*Math.PI*2;
  const n=64,noise=Array.from({length:n},(_,i)=>landscapeHash(i,seed,0x45444745));
  const cultivatedBoundary=Array.from({length:n},(_,i)=> {
    const angle=i/n*Math.PI*2,deg=angle*180/Math.PI+90;
    const reach=edge.atBearing(deg),floor=inner.atBearing(deg)+90;
    const at=new Point(centre.x+Math.cos(angle)*reach,centre.y+Math.sin(angle)*reach);
    const roadDistance=Math.min(Infinity,...roads.flatMap(r=>r.path.slice(1).map((b,j)=>Point.distance(at,nearestOnSegment(at,r.path[j] as Point,b as Point)))));
    const access=Math.exp(-roadDistance/Math.max(80,reach*.16));
    const grain=(noise[(i+n-1)%n]+noise[i]*2+noise[(i+1)%n])/4-.5;
    const factor=.87+.12*Math.sin(angle*3+phase)+.08*Math.cos(angle*5-phase)+grain*.16+access*.14;
    const radius=Math.max(floor,reach*factor);
    return new Point(centre.x+Math.cos(angle)*radius,centre.y+Math.sin(angle)*radius);
  });
  plan.cultivatedBoundary=cultivatedBoundary;
  plan.region=convexHull(cultivatedBoundary);
  const farmable=(point:Point,margin=0)=>pointInPolygon(point,cultivatedBoundary)&&!pointInPolygon(point,plan.belt)
    && (margin<=0 || Math.min(...cultivatedBoundary.map((b,i)=>Point.distance(point,nearestOnSegment(point,cultivatedBoundary[(i+n-1)%n],b))))>margin);
  return {plan,urbanLots,farmable};
}

const plans=new WeakMap<Layout,ReturnType<typeof prepare>>();
/** One envelope shared by rural residence siting and later field subdivision. */
export function countrysidePlan(layout: Layout,seed:number):ReturnType<typeof prepare> {
  let plan=plans.get(layout);
  if(!plan){plan=prepare(layout,seed);plans.set(layout,plan);}
  return plan;
}
