import { describe, expect, it } from 'vitest';
import { shapeVillageApproaches } from '../src/settlement/approaches.js';
import type { RoadFeature } from '../src/scene/scene.js';

const road=(start:number,end:number):RoadFeature=>({kind:'road',width:3,routeIds:['main'],
  path:Array.from({length:21},(_,i)=>({x:start+(end-start)*i/20,y:0}))});

describe('physical village approaches',()=>{
  it('joins the approach and apron into one gently bending road with fixed ends',()=>{
    const roads=[road(100,200),road(200,300)];
    const before=JSON.stringify(roads),result=shapeVillageApproaches(roads,2);
    expect(result).toHaveLength(1);
    expect(result[0].path[0]).toEqual({x:100,y:0});
    expect(result[0].path.at(-1)!.x).toBe(300);
    expect(result[0].path.at(-1)!.y).toBeCloseTo(0);
    expect(Math.max(...result[0].path.map(p=>Math.abs(p.y)))).toBeGreaterThan(15);
    expect(result[0].routeIds).toEqual(['main']);
    expect(JSON.stringify(roads)).toBe(before);
    expect(shapeVillageApproaches(roads,2)).toEqual(result);
  });
  it('preserves branching junctions instead of joining through them',()=>{
    const branch:RoadFeature={kind:'alley',width:2,path:[{x:200,y:0},{x:200,y:40}]};
    const result=shapeVillageApproaches([road(100,200),road(200,300),branch],2);
    expect(result).toHaveLength(3);
    for(const r of result)expect(r.path.some(p=>Math.hypot(p.x-200,p.y)<1e-6)).toBe(true);
    expect(result.find(r=>r.kind==='alley')).toEqual(branch);
  });
});
