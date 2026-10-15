import { blockLayout } from '../src/settlement/layouts.js';
import { addRuralHousing } from '../src/settlement/rural.js';
import { dressSettlement } from '../src/settlement/landscape.js';
import { growApronPath } from '../src/village/skeleton/apron.js';
import { roadCorridor } from '../src/geom/road-corridor.js';
import { describe, expect, it } from 'vitest';
import { createSettlementModel } from '../src/settlement/generate.js';
import { exportSettlement } from '../src/settlement/output.js';
import { resolveDevelopment } from '../src/settlement/development.js';
import { allocateResidents, type SettlementBuilding } from '../src/settlement/model.js';
import { Polygon } from '../src/geom/polygon.js';
import { Point } from '../src/types/point.js';
import { polygonsOverlap, overlapsWater, nearestOnSegment, drySegments } from '../src/generator/city-frontage.js';
import { PlacementIndex, placementBounds } from '../src/generator/placement-index.js';
import type { AzgaarBurgInput } from '../src/input/azgaar-input.js';

const input: AzgaarBurgInput = { name: 'Character review', population: 2000, biome: 'temperate', roadBearings: [20,145,270],
  walls: true, plaza: true, temple: true, port: false, citadel: false, shanty: false, capital: false };
const polygon = (ring: Array<{x:number;y:number}>) => new Polygon(ring.map(p=>new Point(p.x,p.y)));
const median = (values: number[]) => values.sort((a,b)=>a-b)[Math.floor(values.length/2)];

describe('physical neighbourhood character', () => {
  it('keeps fringe houses at a comparable physical size while reserving suburban commons', () => {
    const model = createSettlementModel({...input,population:20000},{seed:2,development:{preset:'city'}});
    const core = model.buildings.filter(b=>b.insideWalls);
    const fringe = model.buildings.filter(b=>!b.insideWalls && b.urbanity<.05 && b.settlementRole==='urban');
    expect(fringe.length).toBeGreaterThan(50);
    expect(median(fringe.map(b=>Math.abs(polygon(b.footprint).square))) / median(core.map(b=>Math.abs(polygon(b.footprint).square)))).toBeGreaterThan(.6);
    expect(model.residents.unassigned).toBe(0);
    const characters = new Set(model.districts.filter(d=>!d.insideWalls).map(d=>d.character));
    expect(characters.has('workshops')).toBe(true);
    expect(characters.has('gardens')).toBe(true);
    expect(characters.has('crofts')).toBe(true);
    expect(characters.has('green')).toBe(true);
    expect(model.scene.layers.greens.some(g=>g.purpose==='natural')).toBe(true);
    expect(model.scene.layers.greens.some(g=>g.purpose==='public')).toBe(true);
    const buildings = new PlacementIndex<Polygon>();
    for(const b of model.scene.layers.buildings) { const p=polygon(b.ring); buildings.insert(placementBounds(p.vertices),p); }
    for(const g of model.scene.layers.greens.filter(g=>g.purpose==='public'||g.purpose==='natural')) {
      const p=polygon(g.ring);
      expect(buildings.query(placementBounds(p.vertices)).some(b=>polygonsOverlap(p,b))).toBe(false);
    }
  });

  it('conserves an explicit rural allocation with adopted farm houses and connected new hamlets', () => {
    const model=createSettlementModel(input,{seed:2,development:{preset:'city',corePopulation:1000,ruralPopulation:400}});
    expect(model.residents.insideWalls.assigned).toBe(1000);
    expect(model.residents.rural).toMatchObject({requested:400,assigned:400,unassigned:0});
    expect(model.residents.urban).toMatchObject({requested:1600,assigned:1600,unassigned:0});
    expect(model.residents.assigned).toBe(2000);
    expect(model.buildings.reduce((n,b)=>n+b.residents,0)).toBe(2000);
    expect(new Set(model.buildings.map(b=>b.id)).size).toBe(model.buildings.length);
    expect(model.buildings.every(b=>b.residents>=0&&b.residents<=b.capacity)).toBe(true);
    const rural = model.buildings.filter(b=>b.id.startsWith('building:rural:'));
    expect(rural.length).toBeGreaterThan(20);
    expect(model.buildings.some(b=>b.settlementRole==='rural'&&!b.id.startsWith('building:rural:'))).toBe(true);
    const obstacles = new PlacementIndex<{id:string;polygon:Polygon}>();
    for(const b of model.scene.layers.buildings) { const p=polygon(b.ring);obstacles.insert(placementBounds(p.vertices),{id:b.id!,polygon:p}); }
    const fields = new PlacementIndex<Polygon>();
    for(const f of model.scene.layers.fields){const p=polygon(f.ring);fields.insert(placementBounds(p.vertices),p);}
    for(const b of rural) {
      const p=polygon(b.footprint);
      expect(obstacles.query(placementBounds(p.vertices)).some(o=>o.id!==b.id&&polygonsOverlap(p,o.polygon))).toBe(false);
      expect(fields.query(placementBounds(p.vertices)).some(f=>polygonsOverlap(p,f))).toBe(false);
      const distance=Math.min(...model.scene.layers.roads.flatMap(r=>r.path.slice(1).map((q,i)=>Point.distance(p.centroid,nearestOnSegment(p.centroid,new Point(r.path[i].x,r.path[i].y),new Point(q.x,q.y))))));
      expect(distance).toBeLessThan(9);
    }
    const hamletRoads=model.scene.layers.roads.filter(r=>r.id?.startsWith('street:rural:'));
    expect(hamletRoads.length).toBeGreaterThan(1);
    const exported = exportSettlement(model);
    for (const road of hamletRoads) expect(exported.features.find(f=>f.id===road.id)?.properties?.street_id).toBe(road.id);
    for(const r of hamletRoads)expect(model.scene.layers.roads.some(other=>other!==r&&other.path.some(p=>p.x===r.path[0].x&&p.y===r.path[0].y))).toBe(true);
  });

  it('keeps the default free of newly allocated hamlets and delivers timing out of band', () => {
    const events:Array<{stage:string;durationMs:number}>=[];
    const options={seed:7,development:{preset:'city' as const}};
    const a=createSettlementModel(input,options);
    const b=createSettlementModel(input,{...options,onStageTiming:t=>events.push(t)});
    expect(a).toEqual(b);
    expect(a.buildings.some(b=>b.id.startsWith('building:rural:'))).toBe(false);
    expect(events.some(t=>t.stage==='topology')).toBe(true);
    expect(events.some(t=>t.stage==='landscape')).toBe(true);
    expect(events.every(t=>Number.isFinite(t.durationMs)&&t.durationMs>=0)).toBe(true);
  });

  it('keeps rural houses and their new access lanes dry on a coastal site', () => {
    const water=[[new Point(500,-10000),new Point(10000,-10000),new Point(10000,10000),new Point(500,10000)]];
    const model=createSettlementModel({...input,coastlineGeometry:water},{seed:7,development:{preset:'city',corePopulation:1000,ruralPopulation:400}});
    const rural=model.buildings.filter(b=>b.id.startsWith('building:rural:'));
    expect(rural.length).toBeGreaterThan(10);
    for(const b of rural)expect(overlapsWater(polygon(b.footprint),water)).toBe(false);
    for(const r of model.scene.layers.roads.filter(r=>r.id?.startsWith('street:rural:'))) {
      const a=new Point(r.path[0].x,r.path[0].y),b=new Point(r.path[1].x,r.path[1].y);
      expect(drySegments(a,b,water)).toEqual([[a,b]]);
    }
    expect(model.residents.assigned+model.residents.unassigned).toBe(input.population);
  });

  it('keeps a rural approach stopped at occupied ground during final landscaping', () => {
    const profile=resolveDevelopment(2000,true,{preset:'city',corePopulation:1000,ruralPopulation:400});
    const layout=blockLayout({...input,population:1600},2,profile);
    const road=layout.scene.layers.roads.find(r=>r.kind==='road')!;
    if(Math.hypot(road.path[0].x,road.path[0].y)>Math.hypot(road.path.at(-1)!.x,road.path.at(-1)!.y))road.path.reverse();
    const extension=growApronPath({id:'rural:2:0',type:'local',widthM:road.width??3,points:road.path.map(p=>new Point(p.x,p.y))},100);
    const at=extension[2],obstacle=polygon([{x:at.x-10,y:at.y-10},{x:at.x+10,y:at.y-10},{x:at.x+10,y:at.y+10},{x:at.x-10,y:at.y+10}]);
    layout.scene.layers.buildings.push({id:'test:obstacle',ring:obstacle.vertices,kind:'workshop',landmark:false});
    const hits=()=>road.path.slice(1).some((b,i)=>polygonsOverlap(roadCorridor(road.path[i],b,road.width??3),obstacle));
    addRuralHousing(layout,profile,2);
    expect(hits()).toBe(false);
    dressSettlement(layout,2);
    expect(hits()).toBe(false);
  });

  it('does not borrow rural demand from the walled core or inflate capacity on shortage', () => {
    const make=(id:string,insideWalls:boolean,settlementRole:'urban'|'rural'):SettlementBuilding=>({id,districtId:id,footprint:[],insideWalls,settlementRole,capacity:4,residents:0,urbanity:0});
    const buildings=[make('core',true,'urban'),make('outer',false,'urban'),make('farm',false,'rural')];
    const account=allocateResidents(buildings,20,8,8);
    expect(account.insideWalls).toMatchObject({requested:8,assigned:4,unassigned:4});
    expect(account.rural).toMatchObject({requested:8,assigned:4,unassigned:4});
    expect(account.assigned+account.unassigned).toBe(20);
    expect(buildings.every(b=>b.capacity===4&&b.residents===4)).toBe(true);
  });

  it.each([-1,1.5,NaN,Infinity,2000])('rejects invalid rural target %s', ruralPopulation => {
    expect(()=>resolveDevelopment(2000,true,{preset:'city',corePopulation:1000,ruralPopulation})).toThrow(RangeError);
  });
  it('requires a city and leaves core demand intact', () => {
    expect(()=>resolveDevelopment(2000,true,{preset:'village',ruralPopulation:100})).toThrow(RangeError);
    expect(()=>resolveDevelopment(2000,true,{preset:'city',ruralPopulation:401})).toThrow(RangeError);
  });
});
