import { describe, expect, it } from 'vitest';
import { planSuburbanCommons } from '../src/generator/city-neighbourhoods.js';
import { Patch } from '../src/generator/patch.js';
import type { Model } from '../src/generator/model.js';
import { Point } from '../src/types/point.js';
import { createSettlementModel } from '../src/settlement/generate.js';
import { reviewSettlementGround } from '../src/settlement/quality.js';
import type { Scene } from '../src/scene/scene.js';

const box=(x:number,y:number,w:number,h=w)=>[new Point(x,y),new Point(x+w,y),new Point(x+w,y+h),new Point(x,y+h)];
const suburbs=(sizes:number[])=>({patches:sizes.map((size,i)=> {
  const patch=new Patch(box(i%10*20,Math.floor(i/10)*20,size));patch.zone='suburb';return patch;
}),roads:[],params:{seed:2}} as unknown as Model);

describe('suburban green area and access planning',()=> {
  it('targets land area even when district areas differ substantially',()=> {
    const model=suburbs([...Array(99).fill(10),100]);
    const plan=planSuburbanCommons(model);
    expect(plan.targetArea).toBe(plan.eligibleArea*.04);
    expect(plan.reservedArea).toBeGreaterThanOrEqual(plan.targetArea*.9);
    expect(plan.reservedArea).toBeLessThanOrEqual(plan.targetArea*1.5);
    expect(plan.selected.size).toBeGreaterThan(4); // Four percent of patch count would fail.
    expect([...plan.selected]).toEqual([...planSuburbanCommons(model).selected]);
  });
  it('distributes commons across previously unserved neighbourhoods',()=> {
    const plan=planSuburbanCommons(suburbs(Array(100).fill(10)));
    expect(plan.reservedArea).toBe(400);
    expect(plan.servedArea).toBeGreaterThanOrEqual(3000);
    for(const a of plan.selected)for(const b of plan.selected)if(a!==b)
      expect(Point.distance(a.shape.centroid,b.shape.centroid)).toBeGreaterThanOrEqual(plan.accessRadius);
  });
  it('does not over-reserve a small suburb to satisfy an unattainable whole-district target',()=> {
    const plan=planSuburbanCommons(suburbs(Array(8).fill(10)));
    expect(plan.targetArea).toBe(32);
    expect(plan.reservedArea).toBe(0);
  });
});

describe('offline ground accounting',()=> {
  it('bounds deterministic sampling of a generated physical city',()=> {
    const model=createSettlementModel({name:'Ground review',population:2000,biome:'temperate',walls:true,plaza:true,temple:true,
      port:false,citadel:false,shanty:false,capital:false,roadBearings:[20,145,270]},{seed:2,development:{preset:'city'}});
    const review=reviewSettlementGround(model,{maxSamplesPerDistrict:256});
    expect(review).toEqual(reviewSettlementGround(model,{maxSamplesPerDistrict:256}));
    for(const d of review.districts) {
      expect(d.sampleCount).toBeGreaterThan(0);
      expect(d.sampleCount).toBeLessThanOrEqual(256);
      expect(Object.values(d.estimatedAreasM2).reduce((a,b)=>a+b,0)).toBeCloseTo(d.groundAreaM2,5);
      expect(d.estimatedLargestResidualAreaM2).toBeLessThanOrEqual(d.estimatedAreasM2.residual+1e-6);
    }
  });
  it('partitions known reservations without calling unexplained residuals failed placements',()=> {
    const scene:Scene={version:2,seed:2,population:100,bounds:{min_x:0,min_y:0,max_x:100,max_y:100},layers:{
      water:{rings:[],synthetic:false},fields:[],furrows:[],vegetation:[],piers:[],walls:[],
      buildings:[{id:'home',kind:'craftsmen',landmark:false,ring:box(0,0,64)}],
      symbols:[{id:'sm-city-courtyard-u',buildingId:'home',at:new Point(32,32),scale:64,rotationDeg:0,zBand:'structure'}],
      roads:[{path:[new Point(70,0),new Point(70,100)],width:10,kind:'road'}],
      greens:[{ring:box(80,0,20),purpose:'public'},{ring:box(80,20,20),purpose:'private'},{ring:box(80,40,20),purpose:'civic'}],
    }};
    const district={id:'d',boundary:box(0,0,100),urbanity:1,insideWalls:true};
    const before=JSON.stringify(scene);
    const result=reviewSettlementGround({scene,districts:[district]},{maxSamplesPerDistrict:10000});
    const review=result.districts[0];
    expect(review.estimatedAreasM2.courtyard).toBe(24*40);
    expect(review.estimatedAreasM2.buildingFootprint).toBe(64*64-24*40);
    expect(review.estimatedAreasM2.road).toBe(1000);
    expect(review.estimatedAreasM2.publicGreen).toBe(400);
    expect(review.estimatedAreasM2.privateGarden).toBe(400);
    expect(review.estimatedAreasM2.civic).toBe(400);
    expect(Object.values(review.estimatedAreasM2).reduce((a,b)=>a+b,0)).toBeCloseTo(10000,6);
    expect(review.estimatedAreasM2.residual).toBeGreaterThan(0);
    expect(review.failedPlacementAreaM2).toBeNull();
    expect(JSON.stringify(scene)).toBe(before);
  });
});
