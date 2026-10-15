import {describe,expect,it} from 'vitest';
import {Point} from '../src/types/point.js';
import {Polygon} from '../src/geom/polygon.js';
import {regularizeCityFootprints} from '../src/generator/city-footprints.js';
import {blocksAccess} from '../src/generator/city-frontage.js';
import type {CityBlockPlan} from '../src/generator/city-blocks.js';
import polygonClipping from 'polygon-clipping';

const polygon = (xy:number[][])=>new Polygon(xy.map(([x,y])=>new Point(x,y)));
const ring = (p:Polygon)=>p.vertices.map(v=>[v.x,v.y] as [number,number]);
const area = (polys:ReturnType<typeof polygonClipping.intersection>)=>polys.reduce((sum,p)=>sum+Math.abs(polygon(p[0]).square),0);
function fixture():CityBlockPlan {
  const wedge=polygon([[0,0],[10,0],[1,8],[0,8]]), rectangle=polygon([[15,0],[21,0],[21,7],[15,7]]);
  const frontage={a:new Point(0,0),b:new Point(22,0),width:.6,kind:'street' as const,at:new Point(3,0)};
  return {buildings:[wedge,rectangle],frontages:new Map([[wedge,frontage],[rectangle,{...frontage,at:new Point(18,0)}]]),lanes:[],runs:[[wedge,rectangle]]};
}

describe('architectural footprints inside clipped end parcels',()=>{
  it('keeps a useful street house, explicit disjoint yards and unchanged regular neighbours',()=>{
    const plan=fixture(), [parcel,regular]=plan.buildings;
    regularizeCityFootprints(plan,40,3,16);
    expect(plan.buildings).toHaveLength(2);
    const house=plan.buildings[0];
    expect(house).not.toBe(parcel);
    expect(house.length).toBe(4);
    expect(Math.abs(house.square)).toBeGreaterThanOrEqual(16);
    expect(plan.buildings[1]).toBe(regular);
    expect(plan.runs[0]).toEqual(plan.buildings);
    expect(plan.frontages.has(parcel)).toBe(false);
    expect(plan.frontages.has(house)).toBe(true);
    expect(area(polygonClipping.difference([ring(house)],[ring(parcel)]))).toBeLessThan(1e-7);
    const pieces=[house,...plan.gardens!];
    expect(pieces.reduce((sum,p)=>sum+Math.abs(p.square),0)).toBeCloseTo(Math.abs(parcel.square),6);
    for(let i=0;i<pieces.length;i++)for(let j=i+1;j<pieces.length;j++)
      expect(area(polygonClipping.intersection([ring(pieces[i])],[ring(pieces[j])]))).toBeLessThan(1e-7);
    expect(blocksAccess(house.centroid,plan.frontages.get(house)!.at,regular)).toBe(false);
  });

  it('does not replace a parcel when the useful-size floor or a protected access cut prevents it',()=>{
    const tooSmall=fixture(), smallParcel=tooSmall.buildings[0];
    regularizeCityFootprints(tooSmall,40,3,30);
    expect(tooSmall.buildings[0]).toBe(smallParcel);
    const blocked=fixture(), blockedParcel=blocked.buildings[0];
    blocked.exclusions=[polygon([[-1,.5],[11,.5],[11,1],[-1,1]]).vertices];
    regularizeCityFootprints(blocked,40,3,16);
    expect(blocked.buildings[0]).toBe(blockedParcel);
    expect(blocked.gardens).toBeUndefined();
  });
});
