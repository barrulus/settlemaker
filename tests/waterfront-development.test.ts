import { beforeAll, describe, expect, it } from 'vitest';
import { createSettlementModel, type AzgaarBurgInput, type SettlementModel } from '../src/index.js';
import { Point } from '../src/types/point.js';
import { Polygon } from '../src/geom/polygon.js';
import { drySegments, nearestOnSegment, overlapsWater, polygonsOverlap } from '../src/generator/city-frontage.js';
import { inferWaterfront } from '../src/input/waterfront.js';
import { roadCorridor } from '../src/geom/road-corridor.js';
import { polygonArea } from '../src/village/dressing/parcel-cut.js';
import { cityCrossings } from '../src/scene/crossings.js';

const point = (p: {x:number;y:number}) => new Point(p.x,p.y);
const base: AzgaarBurgInput = {
  name:'Outer shore port', population:18000, port:true, citadel:false, walls:true,
  plaza:true, temple:false, shanty:false, capital:false, roadBearings:[270],
};
const shore: AzgaarBurgInput = {
  ...base, harbourSize:'large', harbourWaterKind:'ocean',
  waterContext:{version:1,status:'measured',coordinateSpace:'burg-local-metres',surveyRadiusM:8000,geometryErrorM:.5,
    bodies:[{kind:'ocean',distanceM:400,bearingDeg:90,polygonIndices:[0]}]},
  coastlineGeometry:[[{x:400,y:-8000},{x:8000,y:-8000},{x:8000,y:8000},{x:400,y:8000}]],
};

describe('coastal neighbourhoods beyond the compact core', () => {
  let model: SettlementModel;
  beforeAll(() => { model=createSettlementModel(shore,{seed:2}); },30000);

  it('reserves a protected harbour and an unobstructed dry road to the existing town gate', () => {
    const L=model.scene.layers, harbour=L.harbours![0];
    expect(harbour.kind).toBe('protected');
    expect(harbour.berths.length).toBeGreaterThan(0);
    const entry=harbour.access[1][0];
    const connection=L.roads.find(r=>r.kind==='road'&&r.path.some(p=>Point.distance(point(p),point(entry))<1e-5));
    expect(connection).toBeDefined();
    expect(connection!.path.some(p=>p.x<200)).toBe(true);
    const water=L.water.rings.map(r=>r.map(point));
    for(let i=1;i<connection!.path.length;i++){
      const corridor=roadCorridor(connection!.path[i-1],connection!.path[i],connection!.width!*.9);
      expect(overlapsWater(corridor,water)).toBe(false);
      for(const building of L.buildings)
        expect(polygonsOverlap(corridor,new Polygon(building.ring.map(point)))).toBe(false);
    }
    expect(model.residents.assigned).toBe(shore.population);
    expect(model.waterContextResult?.issues).toEqual([]);
    expect(L.water.rings[0]).toEqual([...shore.coastlineGeometry![0],shore.coastlineGeometry![0][0]]);
  });

  it('puts more homes along the working coast and needs a smaller crop hinterland', () => {
    // Same physical obstacle without ocean/lake semantics is deliberately
    // neutral: it may be an arbitrary legacy water polygon, not fishing coast.
    const neutralInput={...shore,port:false};
    delete neutralInput.harbourSize;
    delete neutralInput.harbourWaterKind;
    delete neutralInput.waterContext;
    const neutral=createSettlementModel(neutralInput,{seed:2});
    const waterfrontHomes=(m:SettlementModel)=>m.buildings.filter(b=>b.settlementRole==='urban'
      && b.footprint.reduce((sum,p)=>sum+p.x,0)/b.footprint.length>250).length;
    const cropArea=(m:SettlementModel)=>m.scene.layers.fields.reduce((sum,f)=>sum+polygonArea(f.ring.map(point)),0);
    expect(waterfrontHomes(model)).toBeGreaterThan(waterfrontHomes(neutral)+100);
    expect(cropArea(model)).toBeLessThan(cropArea(neutral)*.95);
    expect(model.scene.layers.fields.every(f=>f.ring.every(p=>p.x<395))).toBe(true);
    expect(neutral.residents.assigned).toBe(shore.population);
  },30000);
});

it('connects a large non-port river city across a surveyed 270 metre channel', () => {
  const river: AzgaarBurgInput={...base,name:'Wide river city',population:100000,port:false,capital:true,roadBearings:[90,270],
    waterfront:{riverId:'main'},coastlineGeometry:[],
    rivers:[{id:'main',centreline:[{x:200,y:-10000},{x:200,y:10000}],widthM:270,meander:false}],
    waterContext:{version:1,status:'measured',coordinateSpace:'burg-local-metres',surveyRadiusM:10000,geometryErrorM:.5,bodies:[]}};
  const model=createSettlementModel(river,{seed:2}),L=model.scene.layers;
  expect(L.harbours??[]).toHaveLength(0);
  expect(L.bridges).toHaveLength(1);
  const bridge=L.bridges![0];
  expect(bridge.path).toHaveLength(2);
  const [a,b]=bridge.path.map(point);
  // Local bends can rotate the crossing; its span and dry landings remain
  // constrained by the actual channel rather than the source line's axis.
  expect(Point.distance(a,b)).toBeGreaterThan(270);
  expect(Point.distance(a,b)).toBeLessThan(280);
  const course=inferWaterfront(river,model.development,2).input.rivers![0].centreline.map(point);
  const bankSide=(p:Point)=>{
    let nearest=Infinity,side=0;
    for(let i=1;i<course.length;i++){
      const a=course[i-1],b=course[i],q=nearestOnSegment(p,a,b),distance=Point.distance(p,q);
      if(distance<nearest){nearest=distance;side=(p.x-q.x)*(b.y-a.y)-(p.y-q.y)*(b.x-a.x);}
    }
    return Math.sign(side);
  };
  const originSide=bankSide(new Point(0,0));
  expect(originSide).not.toBe(0);
  const far=model.buildings.filter(building=>building.footprint.every(p=>bankSide(point(p))===-originSide));
  // Require a substantial neighbourhood, allowing the available bank area to
  // vary with the inferred bends rather than fixing a straight-river census.
  expect(far.reduce((sum,building)=>sum+building.residents,0)).toBeGreaterThan(river.population*.09);
  expect(model.residents.assigned).toBe(river.population);
  const water=L.water.rings.map(r=>r.map(point));
  const dry=drySegments(a,b,water);
  expect(dry).toHaveLength(2);
  expect(Point.distance(...dry[0])).toBeGreaterThan(1);
  expect(Point.distance(...dry[1])).toBeGreaterThan(1);
},30000);

it('does not turn an arbitrary long road through water into an approved bridge', () => {
  const roads=[{kind:'road' as const,path:[{x:-50,y:0},{x:200,y:0},{x:400,y:0}],width:4}];
  const water=[[{x:0,y:-1000},{x:300,y:-1000},{x:300,y:1000},{x:0,y:1000}]];
  expect(cityCrossings(roads,water)).toHaveLength(0);
});
