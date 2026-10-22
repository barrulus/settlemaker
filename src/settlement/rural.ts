import { countrysidePlan } from './countryside.js';
import { roadCorridor } from '../geom/road-corridor.js';
import { Point } from '../types/point.js';
import { Polygon } from '../geom/polygon.js';
import { SeededRandom } from '../utils/random.js';
import { landscapeHash } from '../assets/landscape-placement.js';
import { resolveGlyphFor } from '../village/deck.js';
import { growApronPath } from '../village/skeleton/apron.js';
import { convexHull } from '../village/dressing/parcel-cut.js';
import { fitCityGlyph } from '../generator/city-glyphs.js';
import { overlapsWater, polygonsOverlap, nearestOnSegment } from '../generator/city-frontage.js';
import { PlacementIndex, placementBounds } from '../generator/placement-index.js';
import type { Layout } from './layouts.js';
import type { DevelopmentProfile } from './development.js';
import type { RoadFeature } from '../scene/scene.js';
import { harbourSolidRings } from '../scene/harbours.js';

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
  for (const ring of [...L.buildings.map(b=>b.ring), ...L.greens.map(g=>g.ring), ...L.piers.map(p=>p.ring), ...harbourSolidRings(L.harbours)]) {
    const p = new Polygon(ring.map(v=>new Point(v.x,v.y)));
    claimed.insert(placementBounds(p.vertices,1),p);
  }
  for (const wall of L.walls) for (const path of wall.polylines) for (let i=1;i<path.length;i++) {
    const a=path[i-1],b=path[i],length=Math.hypot(b.x-a.x,b.y-a.y);
    if (!length) continue;
    const p=roadCorridor(a,b,3);
    claimed.insert(placementBounds(p.vertices),p);
  }
  const roads = new PlacementIndex<{polygon:Polygon;a:Point;b:Point}>();
  const reserveRoad = (road: RoadFeature) => {
    for(let i=1;i<road.path.length;i++) {
      const a=road.path[i-1],b=road.path[i],length=Math.hypot(b.x-a.x,b.y-a.y);
      if(!length)continue;
      const p=roadCorridor(a,b,(road.width??3)+1);
      roads.insert(placementBounds(p.vertices),{polygon:p,a:new Point(a.x,a.y),b:new Point(b.x,b.y)});
    }
  };
  for(const r of L.roads)reserveRoad(r);
  const clear = (p: Polygon, checkRoads = true) => !overlapsWater(p,layout.site.water)
    && !claimed.query(placementBounds(p.vertices,1)).some(other=>polygonsOverlap(p,other))
    && (!checkRoads || !roads.query(placementBounds(p.vertices)).some(other=>polygonsOverlap(p,other.polygon)));
  const approaches = L.roads.filter(r=>r.kind==='road' && r.path.length>1);
  if (!approaches.length) { layout.diagnostics.push('rural housing has no connected approach frontage'); return; }
  const countryside=countrysidePlan(layout,seed);
  const needed=Math.ceil((profile.ruralPopulation-capacity)/profile.edgeOccupancy);
  // Existing approaches already cross cultivated ground. Extending only their
  // far endpoints put every home beyond the fields. Grow short approaches only
  // as far as the SAME field plan, then sample the entire accepted path.
  const regionReach=Math.max(...countryside.plan.region.map(p=>Point.distance(p,layout.green.centre)));
  for(const [route,road] of approaches.entries()) {
    if(Point.distance(road.path[0] as Point,layout.green.centre)>Point.distance(road.path.at(-1)! as Point,layout.green.centre)){ road.path.reverse(); if (road.taper) road.taper.reverse(); }
    const extension=growApronPath({id:`rural:${seed}:${route}`,type:'local',widthM:road.width??3,points:road.path.map(p=>new Point(p.x,p.y))},
      Math.max(0,regionReach-Point.distance(road.path.at(-1)! as Point,layout.green.centre)));
    for(let i=1;i<extension.length;i++) {
      const a=extension[i-1],b=extension[i],corridor=roadCorridor(a,b,road.width??3);
      if(!clear(corridor,false))break;
      road.path.push(b);reserveRoad({path:[a,b],kind:'road',width:road.width});
    }
  }
  const candidates:Array<{at:Point;ux:number;uy:number;road:RoadFeature;route:number;step:number;side:number;score:number;depth?:number}>=[];
  const spacing=Math.max(28,Math.min(60,regionReach*approaches.length*2/Math.max(1,needed)));
  for(const [route,road] of approaches.entries()) {
    let walked=0,next=spacing*(.25+landscapeHash(route,seed,0x4641524d)),step=0;
    for(let i=1;i<road.path.length;i++) {
      const a=road.path[i-1],b=road.path[i],length=Math.hypot(b.x-a.x,b.y-a.y);
      if(!length)continue;
      while(next<=walked+length) {
        const t=(next-walked)/length,at=new Point(a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t);
        if(countryside.farmable(at,65))for(const side of [-1,1]) candidates.push({at,ux:(b.x-a.x)/length,uy:(b.y-a.y)/length,road,route,step,side,
          score:landscapeHash(route*2+(side+1)/2,step,seed^0x53495445)});
        next+=spacing;step++;
      }
      walked+=length;
    }
  }
  // Derived ordering distributes accepted residences across cultivated routes
  // and radial bands, instead of filling one distant ribbon before the next.
  candidates.sort((a,b)=>a.score-b.score||a.route-b.route||a.step-b.step||a.side-b.side);
  const rng = new SeededRandom(seed ^ 0x52555241);
  const candidateLimit=Math.max(candidates.length,Math.min(60000,needed*12));
  for(const [ordinal,candidate] of candidates.entries()) {
    if(ordinal>=candidateLimit)break;
    if(capacity>=profile.ruralPopulation)break;
    const {at,ux,uy,side}=candidate;
    const roll=landscapeHash(candidate.route*2+(side+1)/2,candidate.step,seed^0x48414d4c);
    const hamlet=roll<.16;
    const count=Math.min(Math.ceil((profile.ruralPopulation-capacity)/profile.edgeOccupancy),hamlet?6+Math.floor(roll/.16*7):1+Math.floor((roll-.16)/.84*3));
    // Farm tracks reach into the fields; a minority of sites become compact
    // bent-lane hamlets. Neither form grows a demand-scaled straight row.
    const dx=-uy*side,dy=ux*side;
    const reach=hamlet?85+roll*160:28+landscapeHash(ordinal,seed,0x54524143)*150;
    const drift=(landscapeHash(ordinal,seed,0x42454e44)-.5)*45;
    const end=new Point(at.x+dx*reach+ux*drift,at.y+dy*reach+uy*drift);
    const path=[at,new Point(at.x+dx*reach*.35+ux*(drift*.2+12),at.y+dy*reach*.35+uy*(drift*.2+12)),
      new Point(at.x+dx*reach*.7+ux*(drift*.65-8),at.y+dy*reach*.7+uy*(drift*.65-8)),end];
    if(path.slice(1).some(p=>!countryside.farmable(p,45)))continue;
    const corridors=path.slice(1).map((b,i)=>roadCorridor(path[i],b,3));
    if(corridors.some(p=>!clear(p,false)))continue;
    // Only the intended shared junction may overlap a reserved road. The
    // first leg is not a blanket exemption for unrelated track crossings.
    if(corridors.some((p,i)=>roads.query(placementBounds(p.vertices)).some(other=> {
      if(!polygonsOverlap(p,other.polygon))return false;
      if(i!==0||Point.distance(at,nearestOnSegment(at,other.a,other.b))>1e-5)return true;
      const firstLength=Point.distance(path[0],path[1]),t=Math.min(1,8/firstLength);
      const beyondJunction=new Point(at.x+(path[1].x-at.x)*t,at.y+(path[1].y-at.y)*t);
      return polygonsOverlap(roadCorridor(beyondJunction,path[1],3),other.polygon);
    })))continue;
    const districtId=`district:rural:${ordinal}`,placed:Polygon[]=[];
    const branch:RoadFeature={id:`street:rural:${ordinal}`,path,kind:'alley',role:hamlet?'street':'service',width:3};
    const lengths=path.slice(1).map((b,i)=>Point.distance(path[i],b)),totalLength=lengths.reduce((a,b)=>a+b,0);
    for(let i=0;i<count;i++) {
      const flank=i%2?1:-1;
      const back=hamlet?Math.floor(i/2)*(11+roll*9):Math.floor(i/2)*13;
      const along=Math.max(18,totalLength-7-back-rng.float()*4);
      let segment=0,remaining=along;
      while(segment<lengths.length-1&&remaining>lengths[segment])remaining-=lengths[segment++];
      const a=path[segment],b=path[segment+1],tx=(b.x-a.x)/lengths[segment],ty=(b.y-a.y)/lengths[segment];
      const front=new Point(a.x+tx*remaining,a.y+ty*remaining);
      const width=6.5+rng.float(),depth=6+rng.float(),setback=3.7+rng.float()*1.5;
      const centre=new Point(front.x-ty*flank*(setback+depth/2),front.y+tx*flank*(setback+depth/2));
      const footprint=rectangle(centre,tx,ty,width,depth);
      if(!clear(footprint)||!footprint.vertices.every(p=>countryside.farmable(p,25))||corridors.some(p=>polygonsOverlap(p,footprint)))continue;
      const frontage={a,b,at:front,width:3,kind:'street' as const};
      const glyph=resolveGlyphFor(layout.site.biome,roll<.5?'sm-house':'sm-house-tiled');
      const symbol=fitCityGlyph(footprint,glyph,1,frontage,.35,1.35,1.25);
      const id=`building:rural:${ordinal}:${i}`;
      L.buildings.push({id,ring:footprint.vertices,kind:'farm',landmark:false,...(symbol?{glyphBacked:true as const}:{})});
      if(symbol)L.symbols.push({id:symbol.id,at:symbol.at,scale:symbol.scale,scaleY:symbol.scaleY,rotationDeg:symbol.rotationDeg,zBand:'structure',buildingId:id});
      layout.buildings.push({id,districtId,footprint:footprint.vertices,capacity:profile.edgeOccupancy,residents:0,insideWalls:false,urbanity:0,settlementRole:'rural'});
      claimed.insert(placementBounds(footprint.vertices,1),footprint);
      placed.push(footprint);capacity+=profile.edgeOccupancy;
    }
    if(!placed.length)continue;
    // Insert the attachment into the parent polyline, preserving a real shared
    // network vertex even when the candidate was sampled between old vertices.
    for(let i=1;i<candidate.road.path.length;i++) {
      const a=candidate.road.path[i-1],b=candidate.road.path[i];
      if(Math.abs(Math.hypot(at.x-a.x,at.y-a.y)+Math.hypot(b.x-at.x,b.y-at.y)-Math.hypot(b.x-a.x,b.y-a.y))<1e-5) {
        if(Math.hypot(at.x-a.x,at.y-a.y)>1e-5&&Math.hypot(at.x-b.x,at.y-b.y)>1e-5)candidate.road.path.splice(i,0,at);break;
      }
    }
    L.roads.push(branch);reserveRoad(branch);
    // If more households are needed, extend the connected farm-track network
    // through cultivated ground, not the length or house count of this row.
    // Children start at a real accepted junction and keep their own short form.
    if((candidate.depth??0)<12)for(const hand of [-1,1]) {
      const last=path.at(-2)!,heading=Math.atan2(end.y-last.y,end.x-last.x)+hand*(.45+roll*.35);
      const fx=Math.cos(heading),fy=Math.sin(heading);
      candidates.push({at:end,ux:fy,uy:-fx,road:branch,route:candidate.route,step:100000+ordinal*2+(hand+1)/2,
        side:1,score:0,depth:(candidate.depth??0)+1});
    }
    const boundary=convexHull([...path,...placed.flatMap(p=>p.vertices)]),polygon=new Polygon(boundary);
    layout.districts.push({id:districtId,boundary,urbanity:0,insideWalls:false,settlementRole:'rural',character:'rural',
      occupiedAreaM2:placed.reduce((n,p)=>n+Math.abs(p.square),0),areaM2:Math.abs(polygon.square)});
  }
  if(capacity<profile.ruralPopulation)layout.diagnostics.push(`rural frontage could provide ${capacity} of ${profile.ruralPopulation} requested resident capacity`);
}
