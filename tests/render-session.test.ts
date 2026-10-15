import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
beforeEach(() => { vi.useFakeTimers({toFake:['Date']}); vi.setSystemTime(new Date('2026-10-15T00:00:00Z')); });
afterEach(() => vi.useRealTimers());
import { createSettlementSession, createLegacySettlementModel, generateSettlement, createSettlementModel, renderSettlement, BUILD_INFO, type AzgaarBurgInput } from '../src/index.js';
import { createBoundsIndex, createSceneIndex, scanSceneInView } from '../src/scene/spatial-index.js';
import type { Scene } from '../src/scene/scene.js';
import { assembleSvg } from '../src/output/assemble-svg.js';
import { ARTWORK_MANIFEST } from '../src/assets/artwork.js';

const input:AzgaarBurgInput={name:'Retained harbour',population:300,biome:'temperate',walls:false,plaza:true,temple:false,port:false,citadel:false,shanty:false,capital:false,roadBearings:[20,160,270]};
const rect=(x:number,y:number,w=3)=>[{x,y},{x:x+w,y},{x:x+w,y:y+w},{x,y:y+w}];
function fixture():Scene {
  return {version:2,seed:1,population:10,bounds:{min_x:-100,min_y:-100,max_x:100,max_y:100},metersPerUnit:1,layers:{
    water:{rings:[],synthetic:false},fields:[],furrows:[],greens:[],vegetation:[],symbols:[],piers:[],walls:[],
    buildings:[{id:'a',ring:rect(-30,0),kind:'Craftsmen',landmark:false},{id:'b',ring:rect(60,60),kind:'Craftsmen',landmark:false}],
    roads:[{kind:'road',role:'approach',width:2,path:[{x:-100,y:5},{x:100,y:5}]}]}};
}

describe('retained rendering sessions',()=>{
  it.each(['city','village'] as const)('preserves legacy %s full exports without convenience outputs',engine=>{
    const options={engine,seed:73};
    const expected=generateSettlement(input,options);
    const session=createSettlementSession(input,options);
    expect(session.renderFull()).toBe(expected.svg);
    expect(session.exportGeoJson()).toEqual(expected.geojson);
    expect(session.metadata.seed).toBe(73);
    expect(session.metadata.supportsViewport).toBe(engine==='city');
    expect(JSON.parse(JSON.stringify(session.metadata))).toMatchObject({engineVersion:BUILD_INFO.engineVersion});
    const retained=createLegacySettlementModel(input,options);
    expect(retained).not.toHaveProperty('svg');expect(retained).not.toHaveProperty('geojson');
    if(engine==='village'){
      expect(session.metadata.coordinateSystem).toBe('legacy_village_svg_y_down');
      expect(session.metadata.metersPerUnit).toBe(.25);
      expect(session.metadata.originalBounds.min_x).toBe(0);
    }
  });
  it('preserves the city coastal output frame and named-palette changes without generation',()=>{
    const burg={...input,population:3000,coastlineGeometry:[[{x:300,y:-1000},{x:2000,y:-1000},{x:2000,y:1000},{x:300,y:1000}]]};
    const options={engine:'city' as const,seed:2};
    const expected=generateSettlement(burg,options);
    const session=createSettlementSession(burg,options);
    expect(session.renderFull()).toBe(expected.svg);
    expect(session.metadata.originShift).toEqual(expected.originShift);
    const before=JSON.stringify(session.scene);
    expect(session.renderFull({theme:'blueprint'})).toBe(generateSettlement(burg,{...options,theme:'blueprint'}).svg);
    expect(JSON.stringify(session.scene)).toBe(before);
  });
  it('separates physical preview from full export and retains immutable geometry',()=>{
    const options={seed:2,development:{preset:'city' as const}};
    const session=createSettlementSession(input,options);
    const model=createSettlementModel(input,options);
    const before=JSON.stringify(session.scene);
    expect(session.renderFull()).toBe(renderSettlement(model,{detail:'full'}));
    const svg=session.renderView({bounds:{min_x:-20,min_y:-20,max_x:20,max_y:20},width:400});
    expect(svg).toContain('viewBox="-20.000000 -20.000000 40.000000 40.000000"');
    expect(JSON.stringify(session.scene)).toBe(before);
    expect(session.metadata.metersPerUnit).toBe(1);
    expect(session.metadata.residents?.requested).toBe(300);
    expect(()=>session.renderView({width:0})).toThrow(RangeError);
  });
});

describe('paint-aware spatial queries',()=>{
  it('keeps one-shot scans equivalent to indexed paint filtering, including off-frame geometry',()=>{
    const scene=fixture(), index=createSceneIndex(scene);
    for(const bounds of [scene.bounds,{min_x:0,min_y:0,max_x:10,max_y:10}]){
      for(const appearance of [{},{theme:{shadowOffset:{dx:30,dy:0}}},{pixelsPerUnit:.01,overviewRoadMinPixels:2}])
        expect(scanSceneInView(scene,bounds,appearance)).toEqual(index.query(bounds,appearance));
    }
  });
  it('preserves input painter order and finds crossing bounds',()=>{
    const index=createBoundsIndex([{value:'second',bounds:{min_x:9,min_y:9,max_x:11,max_y:11}},{value:'first',bounds:{min_x:-100,min_y:10,max_x:100,max_y:10}}]);
    expect(index.query({min_x:10,min_y:10,max_x:12,max_y:12})).toEqual(['second','first']);
  });
  it('updates query extents when shadows change without mutating or rebuilding the scene',()=>{
    const scene=fixture(), before=JSON.stringify(scene), index=createSceneIndex(scene);
    const bounds={min_x:0,min_y:0,max_x:10,max_y:10};
    expect(index.query(bounds).layers.buildings).toHaveLength(0);
    expect(index.query(bounds,{theme:{shadowOffset:{dx:30,dy:0}}}).layers.buildings.map(b=>b.id)).toEqual(['a']);
    expect(index.query(bounds).layers.roads).toHaveLength(1);
    expect(index.query(bounds).layers.buildings).toHaveLength(0);
    expect(JSON.stringify(scene)).toBe(before);
  });
  it('retains rotated non-square glyphs and linked footprints crossing the viewport',()=>{
    const scene=fixture();scene.layers.buildings[0].glyphBacked=true;
    const id=Object.keys(ARTWORK_MANIFEST).find(id=>id.includes('row-house-a'))!;
    scene.layers.symbols=[{id,buildingId:'a',at:{x:-15,y:0},scale:50,scaleY:8,rotationDeg:20,zBand:'structure'}];
    const view=createSceneIndex(scene).query({min_x:0,min_y:-3,max_x:4,max_y:3});
    expect(view.layers.symbols).toHaveLength(1);
    expect(view.layers.buildings.map(b=>b.id)).toContain('a');
  });
  it('does not guess custom artwork extents',()=>{
    const scene=fixture();
    const view=createSceneIndex(scene).query({min_x:0,min_y:0,max_x:1,max_y:1},{assetSet:{name:'unbounded',symbols:{}}});
    expect(view.layers.buildings).toHaveLength(2);
  });
  it('applies road emphasis only to display and leaves reserved widths unchanged',()=>{
    const scene=fixture(), before=JSON.stringify(scene);
    const full=assembleSvg(scene);
    const overview=assembleSvg(scene,{pixelsPerUnit:.1,overviewRoadMinPixels:2});
    expect(full).toContain('stroke-width="2.00"');
    expect(overview).toContain('stroke-width="20.00"');
    expect(JSON.stringify(scene)).toBe(before);
  });
});
