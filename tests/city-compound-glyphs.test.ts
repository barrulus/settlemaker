import { describe, expect, it } from 'vitest';
import { createCityModel } from '../src/output/legacy-model.js';
import { placeCityGlyphs } from '../src/generator/city-glyphs.js';
import { ARTWORK_MANIFEST } from '../src/assets/artwork.js';
import { buildScene } from '../src/scene/build-scene.js';
import { buildingIds, IdAllocator } from '../src/output/id-allocator.js';
import { selectPois } from '../src/poi/poi-selector.js';
import { blocksAccess } from '../src/generator/city-frontage.js';
import type { AzgaarBurgInput } from '../src/input/azgaar-input.js';

const input: AzgaarBurgInput = {name:'Aldford',population:1200,port:false,citadel:false,walls:true,plaza:true,
  temple:false,shanty:false,capital:false,roadBearings:[
    {bearing_deg:316,kind:'local'},{bearing_deg:146,kind:'local'},{bearing_deg:282,kind:'footpath'}]};

describe('planned compound artwork', () => {
  it('replaces five actual inn wings once, at their planned scale, with one coherent POI', () => {
    const {model}=createCityModel(input,{seed:353956});
    const symbol=model.symbols.find(s=>s.id==='sm-city-inn' && s.buildings)!;
    expect(symbol).toBeDefined();
    const ward=model.patches.find(p=>p.ward?.compounds.some(c=>c.buildings[0]===symbol.building))!.ward!;
    const compound=ward.compounds.find(c=>c.buildings[0]===symbol.building)!;
    expect(symbol.buildings).toHaveLength(5);
    expect(symbol.buildings).toEqual(compound.buildings);
    expect(symbol.scale).toBe(compound.canvas);
    expect(symbol.scaleY).toBe(symbol.scale);
    expect(symbol.rotationDeg).toBe(compound.rotationDeg);
    expect(ARTWORK_MANIFEST[symbol.id].representedBuildings).toBe(compound.buildings.length);
    const meta=ARTWORK_MANIFEST[symbol.id],angle=symbol.rotationDeg*Math.PI/180;
    for(let i=0;i<compound.buildings.length;i++) {
      const building=compound.buildings[i];
      expect(ward.geometry.includes(building)).toBe(true);
      expect(model.glyphBackedBuildings.has(building)).toBe(true);
      const frontage=ward.buildingFrontages.get(building)!;
      expect(frontage).toBeDefined();
      for(const other of ward.geometry)if(other!==building)
        expect(blocksAccess(building.centroid,frontage.at,other)).toBe(false);
      expect(model.symbols.filter(s=>s.building===building || s.buildings?.includes(building))).toHaveLength(1);
      for(let j=0;j<building.length;j++) {
        const [x,y]=meta.footprintPolygons![i][j];
        const dx=(x-meta.anchor[0])*symbol.scale/64,dy=(y-meta.anchor[1])*symbol.scale/64;
        expect(building.vertices[j].x).toBeCloseTo(symbol.at.x+dx*Math.cos(angle)-dy*Math.sin(angle),8);
        expect(building.vertices[j].y).toBeCloseTo(symbol.at.y+dx*Math.sin(angle)+dy*Math.cos(angle),8);
      }
    }
    const ids=buildingIds(model),wingIds=new Set(compound.buildings.map(b=>ids.get(b)!));
    const pois=selectPois(model,input.population,new IdAllocator(),ids);
    const compoundPois=pois.filter(p=>p.buildingId && wingIds.has(p.buildingId));
    expect(compoundPois).toHaveLength(1);
    expect(compoundPois[0]).toMatchObject({kind:'inn',buildingId:ids.get(compound.buildings[0])});
    expect(model.getBuildingCapacity().shortfall).toBe(0);
    const before=JSON.stringify(buildScene(model));
    placeCityGlyphs(model);
    expect(JSON.stringify(buildScene(model))).toBe(before);
  });

  it('rejects whole compound artwork when water occupies its reserved court', () => {
    const {model}=createCityModel(input,{seed:353956});
    const ward=model.patches.find(p=>p.ward?.compounds.some(c=>c.family==='inn'))!.ward!;
    const compound=ward.compounds.find(c=>c.family==='inn')!;
    const original=model.getWaterRings.bind(model);
    model.getWaterRings=()=>[...original(),compound.courts[0].vertices];
    placeCityGlyphs(model);
    expect(model.symbols.some(s=>s.buildings?.some(b=>compound.buildings.includes(b)))).toBe(false);
    expect(compound.buildings.every(b=>ward.geometry.includes(b))).toBe(true);
  });

  it('dissolves grouped artwork and POI reservation when any wing is trimmed', () => {
    const {model}=createCityModel(input,{seed:353956});
    const ward=model.patches.find(p=>p.ward?.compounds.some(c=>c.family==='inn'))!.ward!;
    const compound=ward.compounds.find(c=>c.family==='inn')!;
    const removed=compound.buildings[0],survivors=compound.buildings.slice(1);
    ward.geometry=ward.geometry.filter(b=>b!==removed);
    placeCityGlyphs(model);
    expect(model.symbols.some(s=>s.buildings?.some(b=>compound.buildings.includes(b)))).toBe(false);
    expect(model.glyphBackedBuildings.has(removed)).toBe(false);
    for(const b of survivors)expect(ward.geometry.includes(b)).toBe(true);
    const ids=buildingIds(model),validIds=new Set(ids.values());
    const pois=selectPois(model,input.population,new IdAllocator(),ids);
    expect(pois.filter(p=>p.kind==='inn')).toHaveLength(1);
    for(const poi of pois)if(poi.buildingId)expect(validIds.has(poi.buildingId)).toBe(true);
    // Existing single-building POI identity survives through suitable house
    // artwork, never a five-wing miniature fitted inside one survivor.
    expect(model.symbols.some(s=>s.id==='sm-city-inn' && !s.buildings)).toBe(false);
    expect(model.symbols.some(s=>s.id==='sm-city-courtyard-u' && !s.buildings)).toBe(false);
  });
});
