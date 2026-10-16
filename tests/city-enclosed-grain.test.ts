import {describe,expect,it} from 'vitest';
import {createCityModel,parseSettlementUrl} from '../src/index.js';
import {CommonWard} from '../src/wards/common-ward.js';
import {cityUrbanity} from '../src/generator/city-character.js';
import {cityMetersPerUnit} from '../src/generator/city-glyphs.js';
import {ARTWORK_INK} from '../src/assets/artwork.js';
import {Point} from '../src/types/point.js';
import {Polygon} from '../src/geom/polygon.js';
import polygonClipping from 'polygon-clipping';
import {roadCorridor} from '../src/geom/road-corridor.js';

describe('enclosed city grain',()=>{
  it('keeps the reported desert inner city occupied at the wall without inventing population or oversized houses',async()=>{
    const parsed=await parseSettlementUrl(new URLSearchParams('name=Aldford&pop=5000&seed=271401&walls=1&plaza=1&temple=1&capital=1&shanty=1&theme=ancient&roads=330:main,117:market,192:footpath,278:main&biome=desert'));
    const {model}=createCityModel(parsed.burg,{seed:parsed.seedOverride});
    const wards=model.patches.filter(p=>p.withinWalls&&p.ward instanceof CommonWard);
    const buildings=new Set(wards.flatMap(p=>p.ward!.geometry));
    const land=wards.reduce((s,p)=>s+Math.abs(p.shape.square),0);
    const roof=[...buildings].reduce((s,b)=>s+Math.abs(b.square),0);
    let painted=[...buildings].filter(b=>!model.glyphBackedBuildings.has(b)).reduce((s,b)=>s+Math.abs(b.square),0);
    for(const s of model.symbols)if(s.building&&buildings.has(s.building))painted+=(ARTWORK_INK[s.id]?.area??0)/4096*s.scale*(s.scaleY??s.scale);
    expect(roof/land).toBeGreaterThan(.6); // previously .456; shrinkage created artificial inner-edge yards
    expect(painted/land).toBeGreaterThan(.46); // previously .356: count visible roof paint, not just parcels
    expect(model.getBuildingCapacity()).toMatchObject({target:556,placed:556,corePlaced:459,outerPlaced:97,shortfall:0});
    expect([...buildings].filter(b=>!model.glyphBackedBuildings.has(b)).length).toBeLessThanOrEqual(20);
    const outer=model.patches.filter(p=>!p.withinWalls&&p.ward instanceof CommonWard);
    expect(outer.length).toBeGreaterThan(0);
    expect(outer.every(p=>cityUrbanity(model,p)<1)).toBe(true);
    const k=cityMetersPerUnit(model),areas=[...buildings].map(b=>Math.abs(b.square)*k*k).sort((a,b)=>a-b);
    expect(areas[Math.floor(areas.length/2)]).toBeLessThan(120);
    const ring=(p:Polygon)=>p.vertices.map(v=>[Math.round(v.x*1e8)/1e8,Math.round(v.y*1e8)/1e8] as [number,number]);
    for(const p of wards){
      expect(cityUrbanity(model,p)).toBe(1);
      for(const lane of p.ward!.lanes){
        const length=Point.distance(lane.a,lane.b);
        if(length<1e-8)continue;
        const corridor=roadCorridor(lane.a,lane.b,lane.width);
        for(const b of p.ward!.geometry){
          const overlap=polygonClipping.intersection([ring(corridor)],[ring(b)]);
          const area=overlap.reduce((s,p)=>s+Math.abs(new Polygon(p[0].slice(0,-1).map(([x,y])=>new Point(x,y))).square),0);
          expect(area).toBeLessThan(1e-6);
        }
      }
    }
    // The density change leaves the two deliberately allocated public parks.
    expect(model.patches.filter(p=>p.withinWalls&&p.ward?.type==='park')).toHaveLength(2);
  });
});
