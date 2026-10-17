import { describe, expect, it } from 'vitest';
import { createSettlementModel, type AzgaarBurgInput } from '../src/index.js';
import { reachableDryGround } from '../src/settlement/countryside-access.js';
import { Point } from '../src/types/point.js';
import { riverPolygons } from '../src/village/rivers.js';
import smooth from './fixtures/silahla-smooth-river.json';

const input=smooth.burg as AzgaarBurgInput;
const domain=[new Point(-3990,-3990),new Point(3990,-3990),new Point(3990,3990),new Point(-3990,3990)];

describe('cultivation on the banks of the smooth imported river',()=>{
  it('populates and cultivates the far bank when the town has a connected bridge',()=>{
    const model=createSettlementModel(input,{seed:smooth.seed}),L=model.scene.layers;
    expect(L.bridges?.length).toBeGreaterThan(0);
    const offset=model.placement!.offsetM,origin=new Point(offset.x,offset.y);
    const water=riverPolygons(input,smooth.seed);
    const mainland=reachableDryGround(domain,water,origin,[],[]);
    const connected=reachableDryGround(domain,water,origin,L.roads,L.bridges);
    const farFields=L.fields.filter(f=>f.ring.every(p=>!mainland(new Point(p.x,p.y))));
    expect(farFields.length).toBeGreaterThan(20);
    for(const f of L.fields)for(const p of f.ring)expect(connected(new Point(p.x,p.y))).toBe(true);
    const farResidents=model.buildings.filter(b=>b.footprint.every(p=>!mainland(new Point(p.x,p.y))))
      .reduce((n,b)=>n+b.residents,0);
    expect(farResidents / input.population).toBeGreaterThan(.12);
    expect(farResidents / input.population).toBeLessThan(.2);
    expect(model.residents.assigned).toBe(input.population);
    expect(model.residents.insideWalls.assigned).toBe(Math.ceil(input.population * .8));
  },30000);

  it('preserves an explicit walled population when expanding the opposite bank',()=>{
    const model=createSettlementModel(input,{seed:smooth.seed,development:{preset:'city',corePopulation:9000}});
    expect(model.scene.layers.bridges).toHaveLength(1);
    expect(model.residents.insideWalls.assigned).toBe(9000);
    expect(model.residents.outsideWalls.assigned).toBe(input.population-9000);
    expect(model.residents.assigned).toBe(input.population);
    expect(model.residents.unassigned).toBe(0);
  },30000);

  it('leaves inaccessible far-bank land uncultivated when there is no crossing',()=>{
    const model=createSettlementModel({...input,port:false,harbourSize:undefined},{seed:smooth.seed}),L=model.scene.layers;
    expect(L.bridges??[]).toHaveLength(0);
    const accessible=reachableDryGround(domain,riverPolygons(input,smooth.seed),new Point(0,0),[],[]);
    expect(L.fields.length).toBeGreaterThan(20);
    for(const f of L.fields)for(const p of f.ring)expect(accessible(new Point(p.x,p.y))).toBe(true);
    for(const b of model.buildings.filter(b=>b.settlementRole==='rural'))
      for(const p of b.footprint)expect(accessible(new Point(p.x,p.y))).toBe(true);
  },30000);

  it('preserves the already smooth source course independently of the settlement seed',()=>{
    expect(input.rivers![0].courseSource).toBe('fmg-catmull-rom-0.1');
    expect(input.rivers![0].centreline.length).toBeGreaterThan(60);
    expect(riverPolygons(input,1)).toEqual(riverPolygons(input,999));
  });
});
