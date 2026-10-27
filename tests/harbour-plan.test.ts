import { describe, expect, it } from 'vitest';
import { planHarbour, type HarbourSite } from '../src/wards/harbour-plan.js';
import { Point } from '../src/types/point.js';
import { Polygon } from '../src/geom/polygon.js';
import { pointInPolygon } from '../src/geom/point-in-polygon.js';
import { roadCorridor } from '../src/geom/road-corridor.js';
import { blocksAccess, drySegments, nearestOnSegment, polygonsOverlap } from '../src/generator/city-frontage.js';

const points=(pairs:number[][])=>pairs.map(([x,y])=>new Point(x,y));
function site(kind:HarbourSite['waterKind']='ocean'):HarbourSite{
  return {patch:new Polygon(points([[-30,-20],[30,-20],[30,10],[-30,10]])),
    water:[points([[-200,0],[200,0],[200,200],[-200,200]])],
    shorelines:[points([[-200,0],[200,0]])],gate:new Point(0,-20),large:true,waterKind:kind,metresPerUnit:3};
}

describe('planned harbour ground and navigation',()=>{
  it.each([16, 75, 149, 150, 999, 1000])('scales piers with population %i even for a large harbour', population => {
    const input = { ...site(), population }, p = planHarbour(input)!;
    expect(p).not.toBeNull();
    if (population < 150) expect(p.quays).toHaveLength(0);
    else expect(p.quays.length).toBeGreaterThan(0);
    expect(p.access.some(path => path[0] === input.gate)).toBe(true);
    if (population < 150) {
      expect(p.berths).toHaveLength(0);
      const beach = p.beach!;
      expect(beach).toBeDefined();
      const centre = beach[0].add(beach.at(-1)!).scale(.5);
      const radius = Point.distance(beach[0], centre);
      expect(radius * input.metresPerUnit).toBeCloseTo(6);
      for (const point of beach) {
        expect(Point.distance(point, centre)).toBeCloseTo(radius);
        expect(point.y).toBeLessThanOrEqual(centre.y + 1e-8);
        expect(pointInPolygon(point, input.water[0])).toBe(false);
        expect(pointInPolygon(point, input.patch.vertices)).toBe(true);
      }
      expect(Math.abs(new Polygon(beach).square) / (Math.PI * radius * radius / 2)).toBeCloseTo(1, 2);
      expect(pointInPolygon(p.access[0].at(-1)!, beach)).toBe(true);
    }
    else if (population < 1000) {
      expect(p.berths).toHaveLength(1);
      const [a, b, c] = p.berths[0].vertices;
      expect(Point.distance(a, b) * input.metresPerUnit).toBeCloseTo(1.2);
      expect(Point.distance(b, c) * input.metresPerUnit).toBeCloseTo(7); // 6 m wet + 1 m dry
      expect(pointInPolygon(a, input.water[0])).toBe(false);
      expect(pointInPolygon(c, input.water[0])).toBe(true);
    } else expect(p.berths.length).toBeGreaterThan(1);
    if (population < 1000) {
      expect(p.warehouses).toHaveLength(0);
      expect(p.kind).toBe('landing');
      expect(p.breakwaters).toHaveLength(0);
      expect(p.basin).toHaveLength(0);
      expect(p.fixtures).toHaveLength(0);
      if (population < 150) expect(p.access).toHaveLength(1);
      else {
        const edge = p.quays[0].edge;
        expect(Point.distance(edge[0], edge.at(-1)!) * input.metresPerUnit).toBeLessThanOrEqual(24);
      }
    }
  });

  it.each([false, true])('leaves a generous ocean entrance clear of the beacon heads (large: %s)', large => {
    const input = { ...site(), population: 4000, large }, p = planHarbour(input)!;
    expect(p.kind).toBe('protected');
    const openingM = Point.distance(...p.entrance) * input.metresPerUnit;
    expect(openingM).toBeCloseTo(large ? 32 : 24);
    // A beacon's rendered radius is 1.45 m plus half its .22 m outline.
    // Check its full footprint against every segment of the navigable lane.
    const beacons = p.fixtures.filter(f => f.kind === 'beacon');
    expect(beacons).toHaveLength(2);
    expect(openingM - 2 * 1.56).toBeGreaterThan(p.navigationWidth * input.metresPerUnit + 8);
    for (const beacon of beacons) for (let i = 1; i < p.approach.length; i++) {
      const distanceM = Point.distance(beacon.at, nearestOnSegment(beacon.at, p.approach[i - 1], p.approach[i])) * input.metresPerUnit;
      expect(distanceM - 1.56).toBeGreaterThan(p.navigationWidth * input.metresPerUnit / 2);
    }
  });

  it('fits a wider entrance and multiple sheltered berths on a narrow waterfront', () => {
    const input = { ...site(), population: 4000,
      patch: new Polygon(points([[-9,-20],[9,-20],[9,10],[-9,10]])) };
    const p = planHarbour(input)!;
    expect(p.kind).toBe('protected');
    const openingM = Point.distance(...p.entrance) * input.metresPerUnit;
    expect(openingM).toBeGreaterThanOrEqual(p.navigationWidth * input.metresPerUnit + 6 - 1e-6);
    expect(openingM).toBeLessThan(32);
    expect(p.berths.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < p.approach.length; i++) {
      const channel = roadCorridor(p.approach[i - 1], p.approach[i], p.navigationWidth);
      for (const berth of p.berths) expect(polygonsOverlap(channel, berth)).toBe(false);
    }
  });

  it('reserves a connected dry quay, warehouse service, sheltered basin and an open entrance',()=>{
    const input=site(),before=JSON.stringify(input.water),p=planHarbour(input)!;
    expect(p.kind).toBe('protected');expect(p.breakwaters).toHaveLength(2);
    expect(p.warehouses.length).toBeGreaterThanOrEqual(2);
    expect(p.basin.length).toBeGreaterThanOrEqual(4);
    expect(Point.distance(...p.entrance)).toBeGreaterThan(p.navigationWidth);
    expect(Point.distance(...p.entrance) * input.metresPerUnit).toBeCloseTo(32);
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
