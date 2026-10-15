import { describe, expect, it } from 'vitest';
import { createCityModel } from '../src/output/legacy-model.js';
import { createSettlementModel } from '../src/settlement/generate.js';
import { cityMetersPerUnit, placeCityGlyphs } from '../src/generator/city-glyphs.js';
import { ARTWORK_MANIFEST, ARTWORK_INK } from '../src/assets/artwork.js';
import { buildScene } from '../src/scene/build-scene.js';
import { polygonsOverlap } from '../src/generator/city-frontage.js';
import { Point } from '../src/types/point.js';
import { Polygon } from '../src/geom/polygon.js';
import type { AzgaarBurgInput } from '../src/input/azgaar-input.js';

const input: AzgaarBurgInput = {
  name:'Aldford',population:1200,port:false,citadel:false,walls:true,plaza:true,
  temple:false,shanty:false,capital:false,
  roadBearings:[{bearing_deg:316,kind:'local'},{bearing_deg:146,kind:'local'},{bearing_deg:282,kind:'footpath'}],
};
const fixtures = [
  {input,seed:353956},
  {input:{...input,population:3400,roadBearings:[{bearing_deg:355,kind:'trail'},{bearing_deg:135,kind:'market'},{bearing_deg:236,kind:'market'}]} as AzgaarBurgInput,seed:60891},
];

describe('city wells at architectural scale', () => {
  it.each(fixtures)('uses the completed city scale without changing the reserved lots, seed $seed', ({input,seed}) => {
    const {model}=createCityModel(input,{seed});
    const metres=cityMetersPerUnit(model), wells=model.symbols.filter(s=>s.id==='sm-well');
    expect(wells.length).toBeGreaterThan(0);
    for(const well of wells) {
      expect(well.scale*metres).toBeCloseTo(3.6,8);
      const site=model.claimedSites.find(site=>site.at===well.at)!;
      expect(site).toBeDefined();
      expect(site.radius*metres).toBeLessThan(1.7);
      expect(site.radius*metres).toBeGreaterThan(1.1);
    }
    const geometry=model.patches.map(p=>p.ward?.geometry.map(b=>b.vertices));
    const budget=model.getBuildingCapacity(),wellBudget=model.wellBudget;
    const scene=JSON.stringify(buildScene(model));
    placeCityGlyphs(model);
    expect(JSON.stringify(buildScene(model))).toBe(scene);
    expect(model.patches.map(p=>p.ward?.geometry.map(b=>b.vertices))).toEqual(geometry);
    expect(model.getBuildingCapacity()).toEqual(budget);
    expect(model.wellBudget).toBe(wellBudget);
  });

  it.each(['temperate','desert','tundra','tropical','coastal'])('contains the complete %s well artwork outside neighbouring houses', biome => {
    const {model}=createCityModel({...input,biome},{seed:353956});
    const scene=buildScene(model),metres=cityMetersPerUnit(model);
    const wells=scene.layers.symbols.filter(s=>s.id.startsWith('sm-well'));
    expect(wells.length).toBeGreaterThan(0);
    for(const well of wells) {
      const meta=ARTWORK_MANIFEST[well.id],ink=ARTWORK_INK[well.id];
      expect(well.scale*metres).toBeCloseTo(Math.max(...meta.footprint!),8);
      const [x0,y0,x1,y1]=ink.bounds,r=well.rotationDeg*Math.PI/180;
      const painted=new Polygon([[x0,y0],[x1,y0],[x1,y1],[x0,y1]].map(([x,y])=>{
        const dx=(x-meta.anchor[0])*well.scale/64,dy=(y-meta.anchor[1])*well.scale/64;
        return new Point(well.at.x+dx*Math.cos(r)-dy*Math.sin(r),well.at.y+dx*Math.sin(r)+dy*Math.cos(r));
      }));
      for(const building of scene.layers.buildings)
        expect(polygonsOverlap(painted,new Polygon(building.ring.map(p=>new Point(p.x,p.y))))).toBe(false);
    }
  });

  it('uses the same physical well size in the metre-based city without changing resident capacity', () => {
    const model=createSettlementModel({...input,name:'Rural',population:10000,plaza:false,roadBearings:undefined},
      {seed:2,development:{preset:'city',corePopulation:5000,ruralPopulation:1000}});
    const wells=model.scene.layers.symbols.filter(s=>s.id.startsWith('sm-well'));
    expect(wells.length).toBeGreaterThan(0);
    for(const well of wells)expect(well.scale).toBeCloseTo(3.6,8);
    expect(model.residents.assigned).toBe(10000);
    expect(model.buildings.reduce((sum,b)=>sum+b.residents,0)).toBe(10000);
  });
});
