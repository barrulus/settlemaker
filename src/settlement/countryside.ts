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
import { reachableDryGround } from './countryside-access.js';
import { polygonArea } from '../village/dressing/parcel-cut.js';

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
  const centre=layout.green.centre;
  const coast = (layout.site.shorelines ?? []).flatMap(path => path.slice(1).map((b,i) => [path[i],b] as const));
  const nearestCoast = coast.map(([a,b]) => nearestOnSegment(centre,a,b))
    .sort((a,b) => Point.distance(centre,a)-Point.distance(centre,b))[0];
  const shoreDistance = (p: Point) => Math.min(Infinity, ...coast.map(([a,b]) => Point.distance(p,nearestOnSegment(p,a,b))));
  const coastalAccess = nearestCoast ? Math.exp(-Point.distance(centre,nearestCoast)/250) : 0;
  const towardShore = nearestCoast?.subtract(centre).norm();
  // Fishing and shore trade share the food supply. This changes only the
  // illustrated crop hinterland; census, housing and occupancy stay physical.
  const cropDemandFraction = 1-.4*coastalAccess;
  const plan=planFieldRegion(layout.site,layout.green,urbanLots,[],new SeededRandom(seed^0x51f15e),
    new Set(urbanLots.map(l=>l.id)),Math.max(200,Math.sqrt(layout.site.population*150)),cropDemandFraction);
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
    const seaward = towardShore ? Math.max(0,Math.cos(angle)*towardShore.x+Math.sin(angle)*towardShore.y) : 0;
    // Preserve the occupied envelope, but put the remaining farm depth on
    // its inland side instead of wrapping crops along the fishing waterfront.
    const radius=coastalAccess>0 ? Math.max(floor,floor+(reach*factor-floor)*(1-.65*coastalAccess*seaward))
      : Math.max(floor,reach*factor);
    return new Point(centre.x+Math.cos(angle)*radius,centre.y+Math.sin(angle)*radius);
  });
  plan.cultivatedBoundary=cultivatedBoundary;
  plan.region=convexHull(cultivatedBoundary);
  const accessible=reachableDryGround(plan.region,layout.site.water,centre,layout.scene.layers.roads,layout.scene.layers.bridges);
  const cultivable=(point:Point)=>accessible(point)&&shoreDistance(point)>=45*coastalAccess;
  const farmable=(point:Point,margin=0)=>cultivable(point)&&pointInPolygon(point,cultivatedBoundary)&&!pointInPolygon(point,plan.belt)
    && (margin<=0 || Math.min(...cultivatedBoundary.map((b,i)=>Point.distance(point,nearestOnSegment(point,cultivatedBoundary[(i+n-1)%n],b))))>margin);
  return {plan,urbanLots,farmable,accessible,cultivable};
}

const plans=new WeakMap<Layout,ReturnType<typeof prepare>>();
/** One envelope shared by rural residence siting and later field subdivision. */
export function countrysidePlan(layout: Layout,seed:number):ReturnType<typeof prepare> {
  let plan=plans.get(layout);
  if(!plan){plan=prepare(layout,seed);plans.set(layout,plan);}
  return plan;
}

/** Existing farm wards must obey the same access rule as later farmsteads.
 * Run before allocating residents so removed capacity is never counted. */
export function pruneUnreachableRural(layout: Layout, seed: number): void {
  if (!layout.site.water.length || !layout.buildings.some(b => b.settlementRole === 'rural')) return;
  const { accessible } = countrysidePlan(layout, seed);
  const removed = new Set(layout.buildings.filter(b => b.settlementRole === 'rural'
    && b.footprint.some(p => !accessible(new Point(p.x, p.y)))).map(b => b.id));
  if (!removed.size) return;
  layout.buildings = layout.buildings.filter(b => !removed.has(b.id));
  const layers = layout.scene.layers;
  layers.buildings = layers.buildings.filter(b => !b.id || !removed.has(b.id));
  const lostGlyphs = new Set<string>();
  layers.symbols = layers.symbols.filter(symbol => {
    const linked = [...(symbol.buildingId ? [symbol.buildingId] : []), ...(symbol.buildingIds ?? [])];
    if (!linked.some(id => removed.has(id))) return true;
    for (const id of linked) if (!removed.has(id)) lostGlyphs.add(id);
    return false;
  });
  // Shared compound artwork can cover several roofs. If one inaccessible
  // roof invalidates it, retain surviving geometry without painting fallback blocks.
  for (const building of layers.buildings) if (building.id && lostGlyphs.has(building.id)) building.glyphBacked = false;
  layout.districts = layout.districts.filter(district => {
    if (district.settlementRole !== 'rural') return true;
    const members = layout.buildings.filter(b => b.districtId === district.id);
    if (!members.length) return false;
    district.occupiedAreaM2 = members.reduce((area, building) => area
      + polygonArea(building.footprint.map(p => new Point(p.x, p.y))), 0);
    return true;
  });
  layout.diagnostics.push(`${removed.size} rural buildings omitted because their bank has no usable crossing to the town`);
}
