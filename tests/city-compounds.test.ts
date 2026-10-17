import {describe,expect,it} from 'vitest';
import {Point} from '../src/types/point.js';
import {Polygon} from '../src/geom/polygon.js';
import {reserveCityCompound,retainUsefulCompoundNeighbours} from '../src/generator/city-compounds.js';
import {planCityBlock,coalesceCityRuns} from '../src/generator/city-blocks.js';
import {blocksAccess} from '../src/generator/city-frontage.js';
import { createCityModel } from '../src/output/legacy-model.js';
import { parseSettlementUrl } from '../src/index.js';
import { mapToGenerationParams } from '../src/input/azgaar-input.js';
import { Model } from '../src/generator/model.js';
import polygonClipping from 'polygon-clipping';

const polygon=(xy:number[][])=>new Polygon(xy.map(([x,y])=>new Point(x,y)));
const ring=(p:Polygon)=>p.vertices.map(v=>[v.x,v.y] as [number,number]);
const area=(polys:ReturnType<typeof polygonClipping.intersection>)=>polys.reduce((sum,p)=>sum+Math.abs(polygon(p[0]).square),0);

describe('full-size urban compounds',()=>{
  it('does not retry the city when a compound remainder has near-collinear hull edges',()=>{
    const params=mapToGenerationParams({name:'Aldford',population:1400,port:false,citadel:false,walls:true,plaza:true,temple:true,shanty:false,capital:false},9);
    const probe=new Model({...params,coastlineGeometry:undefined,harbourSize:undefined}).probeWallRadius();
    const full=new Model({...params,coastlineGeometry:undefined,harbourSize:undefined}).generate();
    expect(full.border!.getRadius()).toBeCloseTo(probe,6);
  });
  it.each(['inn','courtyard-u'] as const)('reserves a connected %s site with ordinary-sized wings before subdividing neighbours',family=>{
    const site=polygon([[0,0],[80,0],[80,60],[0,60]]);
    const streets=[{a:new Point(0,0),b:new Point(80,0),width:.6,kind:'street' as const}];
    const reserved=reserveCityCompound(site,streets,40,family)!;
    expect(reserved).not.toBeNull();
    const {compound}=reserved;
    expect(compound.buildings).toHaveLength(family==='inn'?5:3);
    for(const b of compound.buildings){
      const lengths=b.vertices.map((a,i)=>Point.distance(a,b.vertices[(i+1)%b.length]));
      expect(Math.min(...lengths)).toBeGreaterThanOrEqual(compound.referenceWidth-1e-7);
      expect(area(polygonClipping.difference([ring(b)],[ring(site)]))).toBeLessThan(1e-7);
      const f=reserved.frontages.get(b)!;
      for(const other of compound.buildings)if(other!==b)expect(blocksAccess(b.centroid,f.at,other)).toBe(false);
    }
    const plan=planCityBlock(site,streets,40,.6,true,true,undefined,true,{family})!;
    expect(plan.compounds).toHaveLength(1);
    const accepted=plan.compounds![0];
    const ordinary=plan.buildings.filter(b=>!accepted.buildings.includes(b));
    expect(ordinary.length).toBeGreaterThan(5);
    for(const b of ordinary)expect(area(polygonClipping.intersection([ring(b)],[ring(accepted.site)]))).toBeLessThan(1e-6);
    for(const b of plan.buildings)for(const lane of plan.lanes)expect(blocksAccess(lane.a,lane.b,b)).toBe(false);
    expect(plan.frontages.size).toBe(plan.buildings.length);
    expect(plan.runs.flat()).toEqual(expect.arrayContaining(plan.buildings));
  });

  it('keeps ordinary planning when a serviced site cannot contain useful-size wings',()=>{
    const site=polygon([[0,0],[12,0],[12,10],[0,10]]);
    const streets=[{a:new Point(0,0),b:new Point(12,0),width:.6,kind:'street' as const}];
    expect(reserveCityCompound(site,streets,40,'inn')).toBeNull();
    expect(planCityBlock(site,streets,40,.6,true,true,undefined,false,{family:'inn'}))
      .toEqual(planCityBlock(site,streets,40,.6,true));
  });

  it('reserves residual slivers as yards instead of counting undersized neighbour houses',()=>{
    const site=polygon([[0,0],[80,0],[80,60],[0,60]]);
    const streets=[{a:new Point(0,0),b:new Point(80,0),width:.6,kind:'street' as const}];
    const reserved=reserveCityCompound(site,streets,40,'inn')!;
    const small=polygon([[0,0],[2,0],[2,8],[0,8]]),normal=polygon([[5,0],[10,0],[10,8],[5,8]]);
    const frontage={...streets[0],at:new Point(1,0)};
    const plan={buildings:[...reserved.compound.buildings,small,normal],frontages:new Map([...reserved.frontages,[small,frontage],[normal,frontage]]),lanes:reserved.lanes,runs:[reserved.compound.buildings,[small,normal]],compounds:[reserved.compound],gardens:[] as Polygon[]};
    retainUsefulCompoundNeighbours(plan,40);
    expect(plan.buildings).toHaveLength(6);
    expect(plan.buildings).not.toContain(small);
    expect(plan.buildings).toContain(normal);
    expect(plan.gardens).toContain(small);
    expect(plan.frontages.has(small)).toBe(false);
    expect(plan.runs.flat()).toHaveLength(6);
  });

  it('preserves both a compound reservation and exterior notches when coalescing the remaining rows',()=>{
    const site=polygon([[0,0],[80,0],[80,60],[50,60],[50,45],[45,45],[45,60],[0,60]]);
    const streets=[{a:new Point(0,0),b:new Point(80,0),width:.6,kind:'street' as const},
      {a:new Point(0,60),b:new Point(80,60),width:.6,kind:'street' as const}];
    const plan=planCityBlock(site,streets,40,.6,true,true,undefined,false,{family:'inn'})!;
    expect(plan.compounds).toHaveLength(1);
    expect(plan.exclusions!.length).toBeGreaterThan(0);
    coalesceCityRuns(plan,plan.buildings.length-10);
    const compound=plan.compounds![0];
    for(const b of plan.buildings){
      expect(area(polygonClipping.difference([ring(b)],[ring(site)]))).toBeLessThan(1e-6);
      if(!compound.buildings.includes(b))expect(area(polygonClipping.intersection([ring(b)],[ring(compound.site)]))).toBeLessThan(1e-6);
    }
  });

  it.each([
    ['1200','353956','316:local,146:local,282:footpath',203],
    ['3400','60891','355:trail,135:market,236:market',417],
  ])('retains honest occupied capacity in the reported %s-person city',async(pop,seed,roads,target)=>{
    const parsed=await parseSettlementUrl(new URLSearchParams({name:'Aldford',pop:String(pop),seed:String(seed),walls:'1',plaza:'1',roads:String(roads)}));
    const {model}=createCityModel(parsed.burg,{seed:parsed.seedOverride});
    expect(model.getBuildingCapacity().placed).toBe(target);
    expect(model.countOrdinaryBuildingsPublic()).toBe(target);
    const groups=model.patches.flatMap(p=>p.ward?.compounds.filter(c=>c.buildings.every(b=>p.ward!.geometry.includes(b)))??[]);
    expect(groups.some(c=>c.family==='inn')).toBe(true);
    for(const c of groups)expect(c.buildings.length).toBe(c.family==='inn'?5:3);
  });
});
