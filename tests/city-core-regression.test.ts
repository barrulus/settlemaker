import { describe, expect, it } from 'vitest';
import { createCityModel } from '../src/output/legacy-model.js';
import { createSettlementModel } from '../src/settlement/generate.js';
import { cityMetersPerUnit, fitCityGlyph } from '../src/generator/city-glyphs.js';
import { planCityBlock } from '../src/generator/city-blocks.js';
import { blocksAccess, polygonsOverlap } from '../src/generator/city-frontage.js';
import { CommonWard } from '../src/wards/common-ward.js';
import { WardType } from '../src/types/interfaces.js';
import { Point } from '../src/types/point.js';
import { Polygon } from '../src/geom/polygon.js';
import type { AzgaarBurgInput } from '../src/input/azgaar-input.js';

// Exact legacy URL that exposed empty market districts, sparse concave blocks
// and a whole patriciate neighbourhood falling back to polygon roofs.
const aldford: AzgaarBurgInput = {
  name:'Aldford', population:3400, walls:true, plaza:true, temple:false,
  port:false, citadel:false, shanty:false, capital:false,
  roadBearings:[{bearing_deg:355,kind:'trail',through:false},
    {bearing_deg:135,kind:'market',through:false},{bearing_deg:236,kind:'market',through:false}],
};

describe('inhabited city cores', () => {
  it('fits a real rectangular lot beside an oblique street while keeping its doorway street-facing', () => {
    const site=new Polygon([new Point(0,0),new Point(8,0),new Point(8,16),new Point(0,16)]);
    const a=new Point(-6,18), b=new Point(14,25.28), at=new Point(4,21.64);
    const fitted=fitCityGlyph(site,'sm-city-row-house-a',1,{a,b,at,width:1,kind:'street'})!;
    expect(fitted).not.toBeNull();
    expect(Math.abs(fitted.rotationDeg%90)).toBeLessThan(1e-6);
    const r=fitted.rotationDeg*Math.PI/180, c=site.centroid;
    expect(-Math.sin(r)*(at.x-c.x)+Math.cos(r)*(at.y-c.y)).toBeGreaterThan(0);
    expect(fitted.paintedArea).toBeGreaterThan(Math.abs(site.square)*.7);
  });

  it('replaces most of the reported 1200-person city filler without dropping inhabited lots', () => {
    const input={...aldford,population:1200,roadBearings:[
      {bearing_deg:316,kind:'local' as const,through:false},
      {bearing_deg:146,kind:'local' as const,through:false},
      {bearing_deg:282,kind:'footpath' as const,through:false},
    ]};
    const {model}=createCityModel(input,{seed:353956});
    const buildings=model.patches.filter(p=>p.ward && ![WardType.Park,WardType.Water,WardType.Empty].includes(p.ward.type)).flatMap(p=>p.ward!.geometry);
    expect(buildings).toHaveLength(216);
    // Previously46 were plain. Contained artwork and explicit end-lot yards
    // replace most filler without lowering the painted coverage floor.
    expect(buildings.filter(b=>!model.glyphBackedBuildings.has(b)).length).toBeLessThanOrEqual(10);
    for(const symbol of model.symbols.filter(s=>s.building && s.paintedArea)) {
      const ward=model.patches.find(p=>p.ward?.geometry.includes(symbol.building!))!.ward!;
      for(const other of ward.geometry)if(other!==symbol.building && symbol.frontage)
        expect(blocksAccess(symbol.building!.centroid,symbol.frontage.at,other)).toBe(false);
    }
  });

  it('gives the reported legacy core real dense artwork and occupied concave blocks', () => {
    const {model}=createCityModel(aldford,{seed:60891});
    const wealthy=model.patches.find(p=>p.ward?.type===WardType.Patriciate)!.ward!;
    expect(wealthy.geometry.filter(b=>model.glyphBackedBuildings.has(b)).length).toBeGreaterThan(wealthy.geometry.length*.75);
    const notched=model.patches.filter(p=>p.withinWalls && p.ward instanceof CommonWard
      && p.ward.type===WardType.Craftsmen && !p.ward.getCityBlock().isConvex());
    expect(notched.length).toBeGreaterThan(0);
    for(const p of notched) {
      const ward=p.ward as CommonWard;
      expect(ward.geometry.length).toBeGreaterThan(ward.cityBuildingTarget!*.7);
      expect(ward.geometry.reduce((s,b)=>s+Math.abs(b.square),0)/Math.abs(ward.getCityBlock().square)).toBeGreaterThan(.45);
    }
    const buildings=model.patches.filter(p=>p.ward && ![WardType.Park,WardType.Water,WardType.Empty].includes(p.ward.type)).flatMap(p=>p.ward!.geometry);
    expect(buildings).toHaveLength(449);
    expect(buildings.filter(b=>!model.glyphBackedBuildings.has(b)).length).toBeLessThanOrEqual(20);
    const dense=model.symbols.filter(s=>s.id==='sm-city-tenement');
    expect(dense.length).toBeGreaterThan(10);
    for(const s of dense)expect(Math.min(s.scale,s.scaleY!)*cityMetersPerUnit(model)).toBeGreaterThanOrEqual(10.4);
    expect(model.getBuildingCapacity()).toMatchObject({placed:417,target:417,shortfall:0});
  });

  it('reserves compact accessible market courts with inhabited commercial frontages', () => {
    const {model}=createCityModel(aldford,{seed:60891});
    const markets=model.patches.filter(p=>p.ward?.type===WardType.Market);
    expect(markets).toHaveLength(2);
    for(const {ward:w} of markets) {
      const ward=w!, court=ward.publicSpace!;
      expect(court).not.toBeNull();
      expect(Math.abs(court.square)/Math.abs(ward.getCityBlock().square)).toBeLessThanOrEqual(.181);
      expect(ward.geometry.reduce((s,b)=>s+Math.abs(b.square),0)/Math.abs(ward.getCityBlock().square)).toBeGreaterThan(.4);
      expect(ward.lanes.length).toBeGreaterThan(4);
      for(const b of ward.geometry) {
        expect(polygonsOverlap(b,court)).toBe(false);
        for(const l of ward.lanes)expect(blocksAccess(l.a,l.b,b)).toBe(false);
      }
    }
  });

  it('plans substantial tenement sites in the physical core without changing occupancy', () => {
    const model=createSettlementModel({...aldford,population:10000},{seed:60891,development:{preset:'city'}});
    const dense=model.scene.layers.symbols.filter(s=>s.id==='sm-city-tenement');
    expect(dense.length).toBeGreaterThan(50);
    const buildings=new Map(model.buildings.map(b=>[b.id,b]));
    for(const s of dense) {
      expect(Math.min(s.scale,s.scaleY!)).toBeGreaterThanOrEqual(10.4);
      expect(Math.max(s.scale,s.scaleY!)).toBeLessThanOrEqual(16*1.35);
      const b=buildings.get(s.buildingId!)!;
      expect(b).toBeDefined();
      expect(b.capacity).toBe(8);
      expect(b.residents).toBeLessThanOrEqual(b.capacity);
    }
    expect(model.residents.insideWalls).toMatchObject({requested:8000,assigned:8000,unassigned:0});
    expect(model.residents.assigned).toBe(10000);
    expect(model.buildings.reduce((n,b)=>n+b.residents,0)).toBe(10000);
  });

  it('reduces physical city filler while retaining the requested urban and rural residents', () => {
    const model=createSettlementModel({...aldford,name:'Rural',population:10000,plaza:false,roadBearings:undefined},
      {seed:2,development:{preset:'city',corePopulation:5000,ruralPopulation:1000}});
    const buildings=model.scene.layers.buildings;
    // The reported fixture had360 plain footprints among2286 buildings.
    // Guard the improvement and the supply: removing inhabited buildings
    // wholesale must not satisfy the artwork-completeness assertion.
    expect(buildings.length).toBeGreaterThan(2200);
    expect(buildings.filter(b=>!b.glyphBacked).length).toBeLessThanOrEqual(170);
    const administration=buildings.filter(b=>b.kind===WardType.Administration);
    expect(administration).toHaveLength(30);
    expect(administration.filter(b=>b.glyphBacked).length).toBeGreaterThan(administration.length*.8);
    const adminIds=new Set(administration.map(b=>b.id));
    for(const b of model.buildings.filter(b=>adminIds.has(b.id)))expect(b.capacity).toBe(8);
    const adminSymbols=model.scene.layers.symbols.filter(s=>s.buildingId && adminIds.has(s.buildingId));
    expect(adminSymbols.some(s=>s.id.startsWith('sm-city-row-house'))).toBe(true);
    for(const s of adminSymbols.filter(s=>s.id==='sm-city-tenement'))
      expect(Math.min(s.scale,s.scaleY!)).toBeGreaterThanOrEqual(10.4);
    expect(model.residents.assigned).toBe(10000);
    expect(model.buildings.reduce((sum,b)=>sum+b.residents,0)).toBe(10000);
  });

  it('keeps mixed dense sites disjoint and connected without enlarging every street house', () => {
    const site=new Polygon([new Point(0,0),new Point(36,0),new Point(36,18),new Point(0,18)]);
    const streets=site.vertices.map((a,i)=>({a,b:site.vertices[(i+1)%site.length],width:.6,kind:'street' as const}));
    const plan=planCityBlock(site,streets,4.515,.36,true,true,undefined,true)!;
    const ordinary=plan.buildings.filter(b=>Math.abs(b.square)<6), dense=plan.buildings.filter(b=>Math.abs(b.square)>8);
    expect(ordinary.length).toBeGreaterThan(dense.length*2);
    expect(dense.length).toBeGreaterThan(8);
    for(const b of plan.buildings) {
      const frontage=plan.frontages.get(b)!;
      for(const other of plan.buildings)if(other!==b) {
        expect(polygonsOverlap(b,other)).toBe(false);
        expect(blocksAccess(b.centroid,frontage.at,other)).toBe(false);
      }
      for(const lane of plan.lanes)expect(blocksAccess(lane.a,lane.b,b)).toBe(false);
    }
  });
});
