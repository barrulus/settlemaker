import { roadCorridor } from '../geom/road-corridor.js';
import { Point } from '../types/point.js';
import { Polygon } from '../geom/polygon.js';
import { SeededRandom } from '../utils/random.js';
import { landscapeHash } from '../assets/landscape-placement.js';
import { resolveGlyphFor } from '../village/deck.js';
import { growApronPath } from '../village/skeleton/apron.js';
import { convexHull } from '../village/dressing/parcel-cut.js';
import { fitCityGlyph } from '../generator/city-glyphs.js';
import { drySegments, overlapsWater, polygonsOverlap } from '../generator/city-frontage.js';
import { PlacementIndex, placementBounds } from '../generator/placement-index.js';
import type { Layout } from './layouts.js';
import type { DevelopmentProfile } from './development.js';
import type { RoadFeature } from '../scene/scene.js';

/** Rectangle in the road's orthonormal frame, used for both houses and access claims. */
function rectangle(at: Point, ux: number, uy: number, along: number, across: number): Polygon {
  return new Polygon([[-along/2,-across/2],[along/2,-across/2],[along/2,across/2],[-along/2,across/2]]
    .map(([x,y]) => new Point(at.x + ux*x - uy*y, at.y + uy*x + ux*y)));
}

/** Small frontage clusters, not recursively generated villages. Existing farm
 * residences count first. All accepted ground is reserved before fields run. */
export function addRuralHousing(layout: Layout, profile: DevelopmentProfile, seed: number): void {
  if (!profile.ruralPopulation) return;
  let capacity = layout.buildings.filter(b => b.settlementRole === 'rural' && !b.insideWalls).reduce((n,b)=>n+b.capacity,0);
  if (capacity >= profile.ruralPopulation) return;
  const L = layout.scene.layers;
  const claimed = new PlacementIndex<Polygon>();
  for (const ring of [...L.buildings.map(b=>b.ring), ...L.greens.map(g=>g.ring), ...L.piers.map(p=>p.ring)]) {
    const p = new Polygon(ring.map(v=>new Point(v.x,v.y)));
    claimed.insert(placementBounds(p.vertices,1),p);
  }
  for (const wall of L.walls) for (const path of wall.polylines) for (let i=1;i<path.length;i++) {
    const a=path[i-1],b=path[i],length=Math.hypot(b.x-a.x,b.y-a.y);
    if (!length) continue;
    const p=roadCorridor(a,b,3);
    claimed.insert(placementBounds(p.vertices),p);
  }
  const roads = new PlacementIndex<Polygon>();
  const reserveRoad = (road: RoadFeature) => {
    for(let i=1;i<road.path.length;i++) {
      const a=road.path[i-1],b=road.path[i],length=Math.hypot(b.x-a.x,b.y-a.y);
      if(!length)continue;
      const p=roadCorridor(a,b,(road.width??3)+1);
      roads.insert(placementBounds(p.vertices),p);
    }
  };
  for(const r of L.roads)reserveRoad(r);
  const clear = (p: Polygon, checkRoads = true) => !overlapsWater(p,layout.site.water)
    && !claimed.query(placementBounds(p.vertices,1)).some(other=>polygonsOverlap(p,other))
    && (!checkRoads || !roads.query(placementBounds(p.vertices)).some(other=>polygonsOverlap(p,other)));
  const approaches = L.roads.filter(r=>r.kind==='road' && r.path.length>1);
  if (!approaches.length) { layout.diagnostics.push('rural housing has no connected approach frontage'); return; }
  const needed = Math.ceil((profile.ruralPopulation-capacity)/profile.edgeOccupancy);
  // Large regional allocations use some outlying villages, rather than
  // stretching thousands of tiny farmsteads indefinitely along each approach.
  const clusterScale = Math.max(1, Math.min(3.2, Math.sqrt(profile.ruralPopulation / 4000)));
  const reach = Math.min(12000, Math.max(300, Math.ceil(needed / (24 * clusterScale * approaches.length)) * 180));
  const candidates: Array<{at:Point;ux:number;uy:number;route:number;step:number}> = [];
  for (const [route,road] of approaches.entries()) {
    if(Math.hypot(road.path[0].x,road.path[0].y)>Math.hypot(road.path.at(-1)!.x,road.path.at(-1)!.y))road.path.reverse();
    const extension=growApronPath({id:`rural:${seed}:${route}`,type:'local',widthM:road.width??3,points:road.path.map(p=>new Point(p.x,p.y))},reach);
    let distance=0,next=40,step=0;
    for(let i=1;i<extension.length;i++) {
      const a=extension[i-1],b=extension[i],length=Point.distance(a,b);
      if(!length)continue;
      const dry=drySegments(a,b,layout.site.water);
      if(dry.length!==1||dry[0][0]!==a||dry[0][1]!==b)break;
      const corridor=roadCorridor(a,b,road.width??3);
      if(!clear(corridor,false))break;
      road.path.push(b);
      reserveRoad({path:[a,b],kind:'road',width:road.width});
      distance+=length;
      if(distance>=next){candidates.push({at:b,ux:(b.x-a.x)/length,uy:(b.y-a.y)/length,route,step:step++});next+=150;}
    }
  }
  // Work outward across routes, keeping the first hamlets near the urban edge.
  candidates.sort((a,b)=>a.step-b.step||a.route-b.route);
  const rng = new SeededRandom(seed ^ 0x52555241);
  for (const [ordinal,candidate] of candidates.entries()) {
    if(capacity>=profile.ruralPopulation)break;
    const {at,ux,uy}=candidate;
    const roll=landscapeHash(candidate.route,candidate.step,seed^0x48414d4c);
    const count=Math.min(Math.ceil((profile.ruralPopulation-capacity)/profile.edgeOccupancy),roll<.18?4:Math.round((roll<.55?24:40)*clusterScale));
    const side=ordinal%2?1:-1, dx=-uy*side,dy=ux*side;
    const pitch=roll<.18?23:13+roll*4;
    const length=24+Math.ceil(count/2)*pitch;
    const end=new Point(at.x+dx*length,at.y+dy*length);
    const corridor=rectangle(new Point((at.x+end.x)/2,(at.y+end.y)/2),dx,dy,length,4);
    if(!clear(corridor,false))continue;
    const districtId=`district:rural:${ordinal}`, placed:Polygon[]=[];
    const branch:RoadFeature={id:`street:rural:${ordinal}`,path:[at,end],kind:'alley',role:'street',width:3};
    for(let i=0;i<count;i++) {
      const flank=i%2?1:-1,along=20+Math.floor(i/2)*pitch;
      const width=6.5+rng.float(),depth=6+rng.float();
      const centre=new Point(at.x+dx*along-dy*flank*(3.5+depth/2),at.y+dy*along+dx*flank*(3.5+depth/2));
      const footprint=rectangle(centre,dx,dy,width,depth);
      if(!clear(footprint))continue;
      const frontage={a:at,b:end,at:new Point(at.x+dx*along,at.y+dy*along),width:3,kind:'street' as const};
      const glyph=resolveGlyphFor(layout.site.biome,roll<.5?'sm-house':'sm-house-tiled');
      const symbol=fitCityGlyph(footprint,glyph,1,frontage,.35,1.35,1.25);
      const id=`building:rural:${ordinal}:${i}`;
      L.buildings.push({id,ring:footprint.vertices,kind:'farm',landmark:false,...(symbol?{glyphBacked:true as const}:{})});
      if(symbol)L.symbols.push({id:symbol.id,at:symbol.at,scale:symbol.scale,scaleY:symbol.scaleY,rotationDeg:symbol.rotationDeg,zBand:'structure',buildingId:id});
      layout.buildings.push({id,districtId,footprint:footprint.vertices,capacity:profile.edgeOccupancy,residents:0,insideWalls:false,urbanity:0,settlementRole:'rural'});
      claimed.insert(placementBounds(footprint.vertices,1),footprint);
      placed.push(footprint);
      capacity+=profile.edgeOccupancy;
    }
    if(!placed.length)continue;
    L.roads.push(branch);reserveRoad(branch);
    const boundary=convexHull([at,end,...placed.flatMap(p=>p.vertices)]);
    const polygon=new Polygon(boundary);
    layout.districts.push({id:districtId,boundary,urbanity:0,insideWalls:false,settlementRole:'rural',character:'rural',
      occupiedAreaM2:placed.reduce((n,p)=>n+Math.abs(p.square),0),areaM2:Math.abs(polygon.square)});
  }
  if(capacity<profile.ruralPopulation)layout.diagnostics.push(`rural frontage could provide ${capacity} of ${profile.ruralPopulation} requested resident capacity`);
}
