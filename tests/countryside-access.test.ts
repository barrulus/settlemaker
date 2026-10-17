import { describe, expect, it } from 'vitest';
import { reachableDryGround } from '../src/settlement/countryside-access.js';
import { Point } from '../src/types/point.js';
import type { RoadFeature, Scene } from '../src/scene/scene.js';
import { pruneUnreachableRural } from '../src/settlement/countryside.js';
import type { Layout } from '../src/settlement/layouts.js';

const box = (x0: number, y0: number, x1: number, y1: number) =>
  [[x0,y0],[x1,y0],[x1,y1],[x0,y1]].map(([x,y]) => new Point(x,y));
const region = box(-100,-100,100,100), origin = new Point(-70,0);
const road: RoadFeature = { kind:'road', width:4, path:[{x:-80,y:0},{x:80,y:0}] };
const bridge = (x0:number,x1:number): NonNullable<Scene['layers']['bridges']>[number] =>
  ({id:`bridge:${x0}`,width:4,path:[{x:x0,y:0},{x:x1,y:0}]});

describe('farmland access across water', () => {
  it('keeps unbridged far-bank ground inaccessible without walking around survey ends', () => {
    const access=reachableDryGround(region,[box(-5,-200,5,200)],origin,[road]);
    expect(access(new Point(-50,50))).toBe(true);
    expect(access(new Point(50,50))).toBe(false);
    expect(access(new Point(0,0))).toBe(false);
  });

  it('opens the other bank only with a bridge on a road and dry landfalls', () => {
    const water=[box(-5,-200,5,200)];
    expect(reachableDryGround(region,water,origin,[road],[bridge(-8,8)])(new Point(50,50))).toBe(true);
    expect(reachableDryGround(region,water,origin,[],[bridge(-8,8)])(new Point(50,50))).toBe(false);
    expect(reachableDryGround(region,water,origin,[road],[bridge(-8,0)])(new Point(50,50))).toBe(false);
  });

  it('requires every crossing in a chain of channels', () => {
    const water=[box(-35,-200,-25,200),box(25,-200,35,200)];
    const first=bridge(-40,-20),second=bridge(20,40);
    const partial=reachableDryGround(region,water,origin,[road],[first]);
    expect(partial(new Point(0,50))).toBe(true);
    expect(partial(new Point(60,50))).toBe(false);
    const complete=reachableDryGround(region,water,origin,[road],[second,first]);
    expect(complete(new Point(60,50))).toBe(true);
  });

  it('recognizes dry access around a bend rather than demanding a straight path', () => {
    // An inlet ends inside the region, so its shores are connected around its head.
    const access=reachableDryGround(region,[box(-5,-200,5,20)],origin,[]);
    expect(access(new Point(50,0))).toBe(true);
    expect(access(new Point(0,60))).toBe(true);
    expect(access(new Point(0,-50))).toBe(false);
  });

  it('does not treat an island inside a water ring as accessible mainland', () => {
    const water=[box(-30,-30,30,-10),box(-30,10,30,30),box(-30,-10,-10,10),box(10,-10,30,10)];
    const access=reachableDryGround(region,water,origin,[]);
    expect(access(new Point(0,0))).toBe(false);
    expect(access(new Point(60,0))).toBe(true);
    const connected=reachableDryGround(region,water,origin,[road],[bridge(-35,-5)]);
    expect(connected(new Point(0,0))).toBe(true);
  });

  it('removes inaccessible existing farm capacity and shared artwork before allocation', () => {
    const footprints=[box(-55,-5,-45,5),box(-85,25,-75,35),box(75,25,85,35)];
    const buildings=footprints.map((footprint,i)=>({id:`b${i}`,districtId:`d${i}`,footprint,
      capacity:4,residents:0,insideWalls:false,urbanity:i===0?1:0,settlementRole:i===0?'urban' as const:'rural' as const}));
    const layout:Layout={
      site:{population:100,biome:'temperate',routes:[],water:[box(-5,-2000,5,2000)],
        flags:{port:false,walls:false,temple:false,trade:false}},
      green:{centre:new Point(-50,0),diameter:20,bearingDeg:0,shape:'sm-green-round',variant:'a'},
      buildings,districts:buildings.map(b=>({id:b.districtId,boundary:b.footprint,urbanity:b.urbanity,
        insideWalls:false,settlementRole:b.settlementRole})),diagnostics:[],
      scene:{version:2,seed:1,population:100,bounds:{min_x:-100,min_y:-100,max_x:100,max_y:100},layers:{
        water:{rings:[],synthetic:false},fields:[],furrows:[],greens:[],vegetation:[],roads:[],piers:[],walls:[],
        buildings:buildings.map(b=>({id:b.id,ring:b.footprint,kind:'farm',landmark:false,glyphBacked:true})),
        symbols:[{id:'shared-farm',at:new Point(-80,30),scale:10,rotationDeg:0,zBand:'structure',buildingIds:['b1','b2']}],
      }},
    };
    pruneUnreachableRural(layout,1);
    expect(layout.buildings.map(b=>b.id)).toEqual(['b0','b1']);
    expect(layout.scene.layers.buildings.map(b=>b.id)).toEqual(['b0','b1']);
    expect(layout.districts.map(d=>d.id)).toEqual(['d0','d1']);
    expect(layout.scene.layers.symbols).toEqual([]);
    expect(layout.scene.layers.buildings[1].glyphBacked).toBeUndefined();
  });
});
