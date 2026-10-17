import { describe, expect, it } from 'vitest';
import { planHarbour, type HarbourSite } from '../src/wards/harbour-plan.js';
import { Point } from '../src/types/point.js';
import { Polygon } from '../src/geom/polygon.js';
import { pointInPolygon } from '../src/geom/point-in-polygon.js';
import { roadCorridor } from '../src/geom/road-corridor.js';
import { blocksAccess, drySegments, polygonsOverlap } from '../src/generator/city-frontage.js';

const points=(pairs:number[][])=>pairs.map(([x,y])=>new Point(x,y));
function site(kind:HarbourSite['waterKind']='ocean'):HarbourSite{
  return {patch:new Polygon(points([[-30,-20],[30,-20],[30,10],[-30,10]])),
    water:[points([[-200,0],[200,0],[200,200],[-200,200]])],
    shorelines:[points([[-200,0],[200,0]])],gate:new Point(0,-20),large:true,waterKind:kind,metresPerUnit:3};
}

describe('planned harbour ground and navigation',()=>{
  it('reserves a connected dry quay, warehouse service, sheltered basin and an open entrance',()=>{
    const input=site(),before=JSON.stringify(input.water),p=planHarbour(input)!;
    expect(p.kind).toBe('protected');expect(p.breakwaters).toHaveLength(2);
    expect(p.warehouses.length).toBeGreaterThanOrEqual(2);
    expect(p.basin.length).toBeGreaterThanOrEqual(4);
    expect(Point.distance(...p.entrance)).toBeGreaterThan(p.navigationWidth);
    expect(Point.distance(...p.entrance)-p.navigationWidth).toBeCloseTo(3/input.metresPerUnit);
    for(const arm of p.breakwaters){
      expect(pointInPolygon(arm.path[0],p.quays[0].ring)).toBe(true);
      expect(Point.distance(arm.path[0],arm.path[1])*input.metresPerUnit).toBeLessThanOrEqual(41);
      expect(arm.path).toHaveLength(3);
    }
    const seaward=p.breakwaters[0].path[1].subtract(p.breakwaters[0].path[0]).norm();
    for(const berth of p.berths)for(const tip of berth.vertices.slice(2)){
      expect(p.breakwaters.some(arm=>blocksAccess(tip,tip.add(seaward.scale(100)),new Polygon(arm.ring)))).toBe(true);
    }
    expect(JSON.stringify(input.water)).toBe(before);
    const wet=(q:Point)=>input.water.some(r=>pointInPolygon(q,r));
    for(const quay of p.quays)for(const q of quay.ring){expect(wet(q)).toBe(false);expect(pointInPolygon(q,input.patch.vertices)).toBe(true);}
    for(const box of p.warehouses){
      for(const q of box.vertices){expect(wet(q)).toBe(false);expect(pointInPolygon(q,input.patch.vertices)).toBe(true);}
      for(const other of p.warehouses)if(box!==other)expect(polygonsOverlap(box,other)).toBe(false);
      for(const path of p.access)for(let i=1;i<path.length;i++){
        // Warehouse door links start on their own frontage; all public cart
        // routes are clear of warehouse interiors.
        if(!box.vertices.some(q=>Point.distance(q,path[0])<1e-6)){
          const centre=new Point((path[i-1].x+path[i].x)/2,(path[i-1].y+path[i].y)/2);
          expect(pointInPolygon(centre,box.vertices)).toBe(false);
        }
      }
    }
    for(let i=1;i<p.approach.length;i++){
      const channel=roadCorridor(p.approach[i-1],p.approach[i],p.navigationWidth);
      for(const q of channel.vertices)expect(wet(q)).toBe(true);
      channel.forEdge((a,b)=>expect(drySegments(a,b,input.water)).toHaveLength(0));
      for(const solid of [...p.breakwaters.map(b=>new Polygon(b.ring)),...p.berths])expect(polygonsOverlap(channel,solid)).toBe(false);
    }
    expect(p.access.some(path=>path[0]===input.gate)).toBe(true);
    expect(planHarbour(input)).toEqual(p);
  });

  it('uses an existing sheltered inlet without adding an unnecessary offshore wall',()=>{
    const input=site();
    input.water=[points([[-30,0],[30,0],[30,35],[200,35],[200,200],[-200,200],[-200,35],[-30,35]])];
    input.shorelines=[points([[-200,35],[-30,35],[-30,0],[30,0],[30,35],[200,35]])];
    const p=planHarbour(input)!;
    expect(p.kind).toBe('natural');expect(p.breakwaters).toHaveLength(0);expect(p.basin.length).toBeGreaterThan(0);
  });

  it('leaves a lake shoreline intact and omits ocean breakwaters',()=>{
    const input=site('lake'),before=JSON.stringify(input.water),p=planHarbour(input)!;
    expect(p.kind).toBe('lake');expect(p.breakwaters).toHaveLength(0);expect(p.basin.length).toBeGreaterThan(0);
    expect(JSON.stringify(input.water)).toBe(before);
  });

  it('approaches a river landing along the channel without blocking the opposite bank',()=>{
    const input=site('river');input.water=[points([[-200,0],[200,0],[200,14],[-200,14]])];
    input.shorelines.push(points([[200,14],[-200,14]]));
    const p=planHarbour(input)!;
    expect(p.kind).toBe('river');expect(p.breakwaters).toHaveLength(0);expect(p.approach.length).toBeGreaterThan(1);
    expect(p.approach[0].y).toBeCloseTo(p.approach.at(-1)!.y);
    for(const q of p.approach){expect(q.y).toBeGreaterThan(0);expect(q.y).toBeLessThan(14);}
  });

  it('does not invent a basin for a confined narrow strip of water',()=>{
    const input=site('river');input.water=[points([[-200,0],[200,0],[200,4],[-200,4]])];
    input.shorelines.push(points([[200,4],[-200,4]]));
    const p=planHarbour(input)!;
    expect(p.kind).toBe('landing');expect(p.basin).toHaveLength(0);expect(p.breakwaters).toHaveLength(0);expect(p.approach).toHaveLength(0);
  });

  it('reports required coverage from the original survey origin after town placement', () => {
    const input = site(); input.surveyRadius = 28; input.surveyOriginOffsetM = 3990;
    try { planHarbour(input); throw new Error('expected survey request'); }
    catch (error) { expect((error as any).waterContextResult?.issues[0].requiredSurveyRadiusM).toBe(5000); }
  });

  it('rejects infrastructure and navigation that would need unsurveyed water',()=>{
    const input=site();input.surveyRadius=28;
    expect(()=>planHarbour(input)).toThrow('water-coverage-exceeded');
  });
});
