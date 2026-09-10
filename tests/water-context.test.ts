import { describe, it, expect } from 'vitest';
import { generateSettlement } from '../src/index.js';
import { generateVillage } from '../src/village/village-model.js';
import { buildSite } from '../src/village/site.js';
import { inAnyWater, closestPointOnSegment, dist } from '../src/village/geometry.js';
import { waterBoundarySegments, prepareWaterBoundary } from '../src/village/water-boundary.js';
import { validateWaterContext, WaterContextError, type WaterContextV1 } from '../src/input/water-context.js';
import { encodeBurgParam, decodeBurgParam } from '../src/url/codec.js';
import { Point } from '../src/types/point.js';
import type { AzgaarBurgInput } from '../src/input/azgaar-input.js';

const measured = (bodies: Extract<WaterContextV1, {status:'measured'}>['bodies'] = []): WaterContextV1 => ({
  version: 1, status: 'measured', coordinateSpace: 'burg-local-metres', surveyRadiusM: 3000, geometryErrorM: .5, bodies,
});
const burg = (extra: Partial<AzgaarBurgInput> = {}): AzgaarBurgInput => ({ name: 'Survey', population: 10,
  port: false, citadel: false, walls: false, plaza: false, temple: false, shanty: false, capital: false,
  waterContext: measured(), ...extra });
const box = (x0: number, y0: number, x1: number, y1: number) => [new Point(x0,y0),new Point(x1,y0),new Point(x1,y1),new Point(x0,y1)];
const coast = (d = 40) => burg({ coastlineGeometry: [box(d,-3000,3000,3000)], waterContext: measured([
  {kind:'ocean',distanceM:d,bearingDeg:90,polygonIndices:[0]}]) });

describe('water-context v1', () => {
  it('keeps Tarrimas-Ha’s distant sea off the tile, with or without explicit empty polygons', () => {
    for (const polygons of [undefined, []]) {
      const b = burg({ oceanBearing: 92.49, waterContext: measured([{kind:'ocean',distanceM:11115,bearingDeg:92.49}]),
        ...(polygons ? { coastlineGeometry: polygons } : {}) });
      const result = generateSettlement(b, {seed:3});
      expect(result.kind).toBe('village');
      expect(result.waterContextResult).toEqual({version:1,status:'measured',issues:[]});
      expect(result.svg).not.toContain('data-band="water"');
    }
  });
  it('renders a measured 40m beach without inventing harbour infrastructure', () => {
    const result = generateSettlement(coast(), {seed:3});
    expect(result.waterContextResult?.issues).toEqual([]);
    expect(result.svg).toContain('data-shore="union"');
    if (result.kind !== 'village') throw Error('wrong engine');
    expect(inAnyWater(new Point(39,0), result.model.site.water)).toBe(false);
    expect(inAnyWater(new Point(41,0), result.model.site.water)).toBe(true);
    expect(result.model.pois.some(p=>p.kind==='boathouse')).toBe(false);
  });
  it('retains polygons and reports inconsistent summaries', () => {
    const b = coast(); (b.waterContext as any).bodies[0].distanceM = 1;
    const s = buildSite(b);
    expect(s.waterContextResult?.issues).toContainEqual({code:'water-context-conflict'});
    expect(s.water[0][0].x).toBe(40);
  });
  it('does not accept a correct distance with a wrong nearest-point bearing', () => {
    const b = coast(); (b.waterContext as any).bodies[0].bearingDeg = 270;
    expect(buildSite(b).waterContextResult?.issues).toContainEqual({code:'water-context-conflict'});
  });
  it('requires polygons for a lake or undeclared/complex single-ocean coast', () => {
    for (const kind of ['ocean','lake'] as const) expect(() => buildSite(burg({waterContext:measured([{kind,distanceM:40,bearingDeg:90}])}))).toThrow('water-geometry-required');
  });
  it('keeps the whole approximate curve at least the reported distance away', () => {
    const s = buildSite(burg({waterContext:measured([{kind:'ocean',distanceM:40,bearingDeg:90,coastApproximation:'simple-local-coast'}])}));
    const distances = waterBoundarySegments(s.water).map(([a,b])=>dist(new Point(0,0),closestPointOnSegment(new Point(0,0),a,b)));
    expect(Math.min(...distances)).toBeCloseTo(40,6);
    expect(s.waterContextResult?.status).toBe('approximate');
  });
  it('preserves islands and removes decomposition and crop edges from all bank queries', () => {
    const pieces=[box(-3000,-3000,3000,-50),box(-3000,50,3000,3000),box(-3000,-50,-50,50),box(50,-50,3000,50)];
    const s=buildSite(burg({coastlineGeometry:pieces,waterContext:measured([{kind:'ocean',distanceM:50,bearingDeg:0,polygonIndices:[0,1,2,3]}])}));
    expect(inAnyWater(new Point(0,0),s.water)).toBe(false);
    expect(inAnyWater(new Point(60,0),s.water)).toBe(true);
    const segments=waterBoundarySegments(s.water);
    expect(segments.reduce((sum,[a,b])=>sum+dist(a,b),0)).toBeCloseTo(400,6);
    expect(s.waterContextResult?.issues).toEqual([]);
  });
  it('dissolves an overlapping river mouth rather than exposing its ocean seam', () => {
    const water=[box(40,-3000,3000,3000),box(-100,80,100,90)];
    prepareWaterBoundary(water,3000);
    expect(waterBoundarySegments(water).some(([a,b])=>a.x===100&&b.x===100)).toBe(false);
  });
  it('never relocates a submerged burg or calls the survey crop a bank', () => {
    const water=[box(-3000,-3000,3000,3000)]; prepareWaterBoundary(water,3000);
    expect(waterBoundarySegments(water)).toEqual([]);
    expect(()=>generateVillage(burg({coastlineGeometry:water}),1)).toThrow('burg position is in water');
  });
  it('unknown units suppress the old bearing and identify unavailable geography', () => {
    const s=buildSite(burg({oceanBearing:90,waterContext:{version:1,status:'unknown-units',sourceUnit:'leagues'}}));
    expect(s.water).toEqual([]); expect(s.waterContextResult?.issues).toEqual([{code:'water-units-unknown'}]);
  });
  it('retains local rivers with an empty ocean/lake survey, without rescaling width', () => {
    const s=buildSite(burg({coastlineGeometry:[],rivers:[{centreline:[{x:-500,y:50},{x:500,y:50}],widthM:8,meander:false}]}));
    expect(inAnyWater(new Point(0,53),s.water)).toBe(true);
    expect(inAnyWater(new Point(0,55),s.water)).toBe(false);
    expect(s.waterContextResult?.issues).toEqual([]);
  });
  it('reports omitted local width', () => {
    const c=measured(); if(c.status==='measured')c.omittedRivers=[{reason:'local-width-unavailable'}];
    expect(buildSite(burg({waterContext:c})).waterContextResult?.issues).toEqual([{code:'water-river-local-width-unavailable'}]);
  });
  it('rejects out-of-survey planning including an empty survey', () => {
    const s=buildSite(burg());
    try { inAnyWater(new Point(3100,0),s.water); throw Error('not rejected'); }
    catch(e){ expect(e).toBeInstanceOf(WaterContextError); expect((e as WaterContextError).waterContextResult.issues[0].requiredSurveyRadiusM).toBe(4000); }
  });
  it('reports a port without nearby water and places no dock', () => {
    const r=generateSettlement(burg({port:true}),{seed:2});
    expect(r.waterContextResult?.issues).toContainEqual({code:'water-context-conflict'});
  });
  it.each([null,{}, {version:2}, {...measured(),surveyRadiusM:2999}, {...measured(),geometryErrorM:.6}])('rejects invalid contexts at both decoder and direct entry',async context=>{
    const b=burg({waterContext:context as any});
    expect(()=>validateWaterContext(b)).toThrow('water-context-invalid');
    await expect(decodeBurgParam(await encodeBurgParam(b))).rejects.toThrow('water-context-invalid');
  });
  it('rejects invalid polygon ownership',()=>{
    const b=coast(); (b.waterContext as any).bodies[0].polygonIndices=[0,0];
    expect(()=>buildSite(b)).toThrow('water-context-invalid');
  });
  it('supports 1000 but rejects 1001 before entering the city engine',()=>{
    expect(()=>validateWaterContext(burg({population:1000}))).not.toThrow();
    expect(()=>generateSettlement(burg({population:1001}))).toThrow('water-context-unsupported-engine');
  });
});
