import { describe, expect, it } from 'vitest';
import { createSettlementModel } from '../src/settlement/generate.js';
import { blockLayout } from '../src/settlement/layouts.js';
import { countrysidePlan } from '../src/settlement/countryside.js';
import { resolveDevelopment } from '../src/settlement/development.js';
import { Polygon } from '../src/geom/polygon.js';
import { Point } from '../src/types/point.js';
import { roadCorridor } from '../src/geom/road-corridor.js';
import { nearestOnSegment, polygonsOverlap, overlapsWater } from '../src/generator/city-frontage.js';
import { PlacementIndex, placementBounds } from '../src/generator/placement-index.js';
import { segmentIntersection } from '../src/village/geometry.js';
import { buildFields } from '../src/village/dressing/fields.js';
import { SeededRandom } from '../src/utils/random.js';

const input={name:'Rural',population:10000,walls:true,plaza:false,temple:false,port:false,citadel:false,shanty:false,capital:false};
const development={preset:'city' as const,corePopulation:5000,ruralPopulation:1000};
const polygon=(ring:Array<{x:number;y:number}>)=>new Polygon(ring.map(p=>new Point(p.x,p.y)));
const length=(path:Array<{x:number;y:number}>)=>path.slice(1).reduce((n,b,i)=>n+Math.hypot(b.x-path[i].x,b.y-path[i].y),0);

describe('inhabited cultivated countryside',()=> {
  it('locally refines obstructed coarse fields without rerolling distant parcels',()=> {
    const box=(x:number,y:number,w:number,h=w)=>[new Point(x,y),new Point(x+w,y),new Point(x+w,y+h),new Point(x,y+h)];
    const house=box(137,17,7),track=box(117,-150,6,300),claims=[house,track];
    const site={population:10000,biome:'temperate' as const,routes:[],water:[],flags:{walls:false,port:false,temple:false,trade:false}};
    const green={centre:new Point(0,0),diameter:20,bearingDeg:0,shape:'sm-green-round',variant:'a' as const};
    const options={regionPlan:{belt:box(-30,-30,60),region:box(-300,-300,600),fabricRadius:40},parcelAreaM2:12000};
    const coarse=buildFields(site,green,[],[],[],new SeededRandom(2),undefined,claims,options);
    const refined=buildFields(site,green,[],[],[],new SeededRandom(2),undefined,claims,
      {...options,refineAround:{claims,targetAreaM2:1200,maxDepth:5}});
    expect(refined.blocks.some(b=>b.id.startsWith('field:R'))).toBe(true);
    const distant=coarse.blocks.filter(b=>b.polygon.every(p=>p.x<0));
    expect(distant.length).toBeGreaterThan(5);
    for(const block of distant)expect(refined.blocks.find(b=>b.id===block.id)).toEqual(block);
    for(const block of refined.blocks)for(const claim of claims)
      expect(polygonsOverlap(new Polygon(block.polygon),new Polygon(claim))).toBe(false);
  });

  it('retains cultivated parcels around a large rural allocation with full clearance',()=> {
    const model=createSettlementModel({...input,population:200000},{seed:2,development:{preset:'city',corePopulation:10000,ruralPopulation:20000}});
    expect(model.residents.assigned).toBe(200000);
    expect(model.residents.rural?.assigned).toBe(20000);
    const fields=new PlacementIndex<Polygon>();
    for(const f of model.scene.layers.fields){const p=polygon(f.ring);fields.insert(placementBounds(p.vertices),p);}
    const distances:number[]=[];
    for(const home of model.buildings.filter(b=>b.id.startsWith('building:rural:'))) {
      const p=polygon(home.footprint),at=p.centroid,nearby=fields.query(placementBounds([at],80));
      expect(nearby.some(f=>polygonsOverlap(p,f))).toBe(false);
      expect(nearby.length).toBeGreaterThan(0);
      distances.push(Math.min(...nearby.flatMap(f=>f.vertices.map((v,i)=>Point.distance(at,nearestOnSegment(at,f.vertices[(i+f.length-1)%f.length],v))))));
    }
    distances.sort((a,b)=>a-b);
    expect(distances[Math.floor(distances.length*.95)]).toBeLessThan(40);
    expect(distances.at(-1)).toBeLessThan(80);
    for(const track of model.scene.layers.roads.filter(r=>r.id?.startsWith('street:rural:')))for(let i=1;i<track.path.length;i++) {
      const corridor=roadCorridor(track.path[i-1],track.path[i],track.width??3);
      expect(fields.query(placementBounds(corridor.vertices)).some(f=>polygonsOverlap(corridor,f))).toBe(false);
    }
  },20000);

  it.each([5,6,8])('does not let a new track first leg cross unrelated roads, seed %s',seed=> {
    const model=createSettlementModel(input,{seed,development});
    const segments=new PlacementIndex<{a:Point;b:Point;road:typeof model.scene.layers.roads[number]}>();
    for(const road of model.scene.layers.roads)for(let i=1;i<road.path.length;i++) {
      const a=new Point(road.path[i-1].x,road.path[i-1].y),b=new Point(road.path[i].x,road.path[i].y);
      segments.insert(placementBounds([a,b]),{a,b,road});
    }
    for(const road of model.scene.layers.roads.filter(r=>r.id?.startsWith('street:rural:')))for(let i=1;i<road.path.length;i++) {
      const a=new Point(road.path[i-1].x,road.path[i-1].y),b=new Point(road.path[i].x,road.path[i].y);
      for(const other of segments.query(placementBounds([a,b])))if(other.road!==road)
        expect(segmentIntersection(a,b,other.a,other.b)).toBeNull();
    }
  });

  it('distributes the reported 10k fixture among fields on short connected tracks',()=> {
    const model=createSettlementModel(input,{seed:2,development});
    expect(model.residents.insideWalls.assigned).toBe(5000);
    expect(model.residents.rural).toMatchObject({requested:1000,assigned:1000,unassigned:0});
    expect(model.residents.assigned).toBe(10000);
    const homes=model.buildings.filter(b=>b.id.startsWith('building:rural:'));
    expect(model.buildings.some(b=>b.settlementRole==='rural'&&!b.id.startsWith('building:rural:'))).toBe(true);
    const fields=new PlacementIndex<Polygon>();
    for(const f of model.scene.layers.fields){const p=polygon(f.ring);fields.insert(placementBounds(p.vertices),p);}
    const distances:number[]=[],groups=new Map<string,number>(),sectors=new Set<number>(),radii:number[]=[];
    for(const b of homes) {
      const p=polygon(b.footprint),at=p.centroid;
      groups.set(b.districtId,(groups.get(b.districtId)??0)+1);
      sectors.add(Math.floor((Math.atan2(at.y,at.x)+Math.PI)*4/Math.PI));radii.push(at.length);
      expect(fields.query(placementBounds(p.vertices)).some(f=>polygonsOverlap(p,f))).toBe(false);
      const nearby=fields.query(placementBounds([at],70));
      expect(nearby.length).toBeGreaterThan(0);
      distances.push(Math.min(...nearby.flatMap(f=>f.vertices.map((v,i)=>Point.distance(at,nearestOnSegment(at,f.vertices[(i+f.length-1)%f.length],v))))));
    }
    distances.sort((a,b)=>a-b);
    expect(distances[Math.floor(distances.length*.95)]).toBeLessThan(40);
    expect(distances.at(-1)).toBeLessThan(70);
    expect(sectors.size).toBeGreaterThanOrEqual(6);
    radii.sort((a,b)=>a-b);
    expect(radii[Math.floor(radii.length*.9)]/radii[Math.floor(radii.length*.1)]).toBeGreaterThan(1.7);
    expect([...groups.values()].filter(n=>n<=3).length/groups.size).toBeGreaterThan(.55);
    expect(Math.max(...groups.values())).toBeLessThanOrEqual(12);
    const tracks=model.scene.layers.roads.filter(r=>r.id?.startsWith('street:rural:'));
    for(const track of tracks) {
      expect(length(track.path)).toBeLessThan(190);
      expect(model.scene.layers.roads.some(r=>r!==track&&r.path.some(p=>p.x===track.path[0].x&&p.y===track.path[0].y))).toBe(true);
      for(let i=1;i<track.path.length;i++) {
        const corridor=roadCorridor(track.path[i-1],track.path[i],track.width??3);
        expect(fields.query(placementBounds(corridor.vertices)).some(f=>polygonsOverlap(corridor,f))).toBe(false);
      }
    }
  });

  it('shares a non-convex cultivation envelope rather than a square-ended field hull',()=> {
    const profile=resolveDevelopment(10000,true,development);
    const layout=blockLayout({...input,population:9000},2,profile);layout.site.population=10000;
    const first=countrysidePlan(layout,2),second=countrysidePlan(layout,2);
    expect(first).toBe(second);
    const boundary=first.plan.cultivatedBoundary!;
    const area=Math.abs(new Polygon(boundary).square),hull=Math.abs(new Polygon(first.plan.region).square);
    expect(area/hull).toBeLessThan(.97);
    expect(area/hull).toBeGreaterThan(.7);
    const perimeter=length([...boundary,boundary[0]]);
    expect(Math.max(...boundary.map((b,i)=>Point.distance(b,boundary[(i+1)%boundary.length])))/perimeter).toBeLessThan(.04);
  });

  it('keeps complete rural track corridors and houses off coastal water',()=> {
    const water=[[new Point(500,-10000),new Point(10000,-10000),new Point(10000,10000),new Point(500,10000)]];
    const model=createSettlementModel({...input,coastlineGeometry:water},{seed:7,development});
    expect(model.residents.assigned+model.residents.unassigned).toBe(10000);
    for(const b of model.buildings.filter(b=>b.id.startsWith('building:rural:')))expect(overlapsWater(polygon(b.footprint),water)).toBe(false);
    for(const r of model.scene.layers.roads.filter(r=>r.id?.startsWith('street:rural:')))for(let i=1;i<r.path.length;i++)
      expect(overlapsWater(roadCorridor(r.path[i-1],r.path[i],r.width??3),water)).toBe(false);
  });
});
