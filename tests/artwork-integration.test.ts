import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import sharp from 'sharp';
import {generateSettlement,buildScene,Point,SeededRandom} from '../src/index.js';
import {ARTWORK_GLYPHS,ARTWORK_MANIFEST,fieldKinds,floraKinds,BIOMES} from '../src/assets/artwork.js';
import {SETTLEMENT_SET,assetSetFor} from '../src/assets/asset-sets.js';
import {cityArchitecture} from '../src/generator/city-glyphs.js';
import {cityCrossings} from '../src/scene/crossings.js';
import {bridgeArtwork,wallArtwork} from '../src/output/artwork.js';
import {placeStoneCircle} from '../src/village/dressing/pois.js';
import {roadFixture,roadReviewFixtures} from './fixtures/village-roads.js';
import {generateVillage} from '../src/village/village-model.js';
import {renderVillage} from '../src/village/render.js';
import {selectPois} from '../src/poi/poi-selector.js';
import {buildingIds,IdAllocator} from '../src/output/id-allocator.js';
import {assembleSvg} from '../src/output/assemble-svg.js';

const fallback=(s:string)=>s.replace(/var\(--[^,]+,\s*([^\)]+)\)/g,'$1');
const body=(s:string)=>s.replace(/^.*?<svg[^>]*>/s,'').replace(/<\/svg>\s*$/,'').replace(/<title>[\s\S]*?<\/title>/g,'').trim();

describe('reviewed artwork is the generator default',()=>{
  it('uses the authored drawings, including independent low-plant sizes and no plant shadows',()=>{
    expect(assetSetFor()).toBe(SETTLEMENT_SET);
    for(const[group,id]of [['village','sm-house'],['city','sm-city-row-house-a'],['landscape','sm-flora-oak-b--temperate'],['landscape','sm-field-date-grove--desert']]){
      const original=body(readFileSync(`symbols/${group}/individual/${id}.svg`,'utf8'));
      expect(ARTWORK_GLYPHS[id].body===original,`${id} differs from reviewed art`).toBe(true);
    }
    expect(ARTWORK_MANIFEST['sm-flora-wood-fern-a--temperate'].footprint![0]).toBeLessThan(ARTWORK_MANIFEST['sm-flora-oak-a--temperate'].footprint![0]);
    for(const b of BIOMES)for(const id of floraKinds(b))expect(ARTWORK_GLYPHS[id].sil).toBeUndefined();
  });

  it.each(BIOMES)('resolves every city role and native field in %s',biome=>{
    for(const id of Object.values(cityArchitecture(23,biome))){expect(ARTWORK_MANIFEST[id]?.biome,id).toBe(biome);expect(ARTWORK_GLYPHS[id],id).toBeDefined();}
    for(const id of fieldKinds(biome,true)){
      expect(ARTWORK_MANIFEST[id]?.viewBox).toEqual([0,0,32,32]);
      expect(ARTWORK_MANIFEST[id]?.biome).toBe(biome);
      expect(ARTWORK_GLYPHS[id]?.sil).toBeUndefined();
    }
  });

  it('excludes open-tundra trees, arable crops and unsupported wet tropical plants',()=>{
    expect(floraKinds('tundra').some(id=>/treeline/.test(id))).toBe(false);
    expect(fieldKinds('tundra').every(id=>ARTWORK_MANIFEST[id].natural)).toBe(true);
    expect(floraKinds('tropical').some(id=>/mangrove|wetland-reeds/.test(id))).toBe(false);
    expect(floraKinds('desert').some(id=>/date-palm|oasis-reeds|cactus/.test(id))).toBe(false);
    expect(fieldKinds('desert',false)).toEqual([]);
    expect(fieldKinds('tropical',false).some(id=>/paddy/.test(id))).toBe(false);
  });

  it('keeps actual city POI building identities when selecting their architecture',()=>{
    const r=generateSettlement(roadFixture(10000,{temple:true,capital:true,citadel:true,walls:true}),{seed:2});
    if(r.kind!=='settlement')throw Error('expected city');
    const scene=buildScene(r.model),ids=buildingIds(r.model),pois=selectPois(r.model,10000,new IdAllocator(),ids);
    const families:Record<string,string>={inn:'inn',bathhouse:'bathhouse',shop:'shop-house',guildhall:'guildhall',warehouse:'warehouse',smithy:'workshop'};
    let checked=0;
    for(const p of pois){
      if(!p.buildingId||!families[p.kind])continue;
      const s=scene.layers.symbols.find(s=>s.buildingId===p.buildingId);
      if(!s)continue; // An unsuitable small lot retains its real polygon.
      expect(ARTWORK_MANIFEST[s.id].family).toBe(families[p.kind]);checked++;
    }
    expect(checked).toBeGreaterThan(4);
    expect(r.svg).toContain('--sm-city-temperate-roof');
    expect(r.svg).toContain('--sm-infra-temperate-stone');
    expect(r.svg).toContain('data-field-glyph="sm-field-');
    expect(assembleSvg(scene,{symbols:false})).not.toContain('<g id="symbols">');
  });
});

describe('infrastructure uses generated geometry',()=>{
  it('cuts the wall at its closing vertex as well as along ordinary segments',async()=>{
    const line=[{x:10,y:10},{x:40,y:15},{x:48,y:42},{x:14,y:50},{x:10,y:10}];
    const drawing=wallArtwork({polylines:[line],gates:[{p1:{x:7,y:9.5},p2:{x:13,y:10.5},routeIds:['road']}],towers:[],large:false});
    const {data,info}=await sharp(Buffer.from(fallback(`<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 60 60">${drawing}</svg>`))).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    expect(data[(40*info.width+40)*4+3]).toBe(0);
    expect(data[(50*info.width+100)*4+3]).toBeGreaterThan(100);
  });

  it('finds only bounded river crossings, including water holes',()=>{
    const water=[[{x:-2,y:-20},{x:2,y:-20},{x:2,y:20},{x:-2,y:20}]];
    const road={path:[{x:-10,y:0},{x:10,y:0}],kind:'artery' as const};
    const crossings=cityCrossings([road],water);expect(crossings).toHaveLength(1);
    expect(cityCrossings([{...road,path:[{x:-10,y:0},{x:0,y:0}]}],water)).toEqual([]);
    const drawing=bridgeArtwork(crossings[0].path,crossings[0].width,'tundra',true);
    expect(drawing).toContain('--sm-infra-tundra-stone');expect(drawing).not.toMatch(/NaN|Infinity/);
  });

  it('draws the new bridge art on the village planner’s real river crossings',()=>{
    const f=roadReviewFixtures.find(f=>f.id==='brook')!,model=generateVillage(f.input,3),svg=renderVillage(model);
    expect(model.bridges.length).toBeGreaterThan(0);
    for(const bridge of model.bridges)expect(svg).toContain(`data-bridge="${bridge.id}"`);
    expect(svg).toContain('--sm-infra-temperate-');
    expect(svg).not.toMatch(/NaN|Infinity/);
  });

  it('builds a non-square village perimeter with real road gate gaps',()=>{
    const r=generateSettlement(roadFixture(150,{walls:true,roadBearings:[18,142,267]}),{seed:2});
    if(r.kind!=='village')throw Error('expected village');
    expect(r.model.wall?.polylines.flat().length).toBeGreaterThan(4);
    expect(r.model.wall?.gates.length).toBeGreaterThanOrEqual(3);
    expect(r.svg).toContain('data-band="walls"');
    expect(r.geojson.features.some(f=>f.properties?.layer==='wall')).toBe(true);
  });

  it.each(BIOMES)('places a native varied henge as the stone-circle POI in %s',biome=>{
    const green={shape:'sm-green-round' as const,variant:'a' as const,centre:new Point(0,0),diameter:10,bearingDeg:0};
    const rng=new SeededRandom(2);rng.bool=()=>true;
    const poi=placeStoneCircle(green,100,[],[],[],[],[],[],rng,biome);
    expect(poi).not.toBeNull();expect(poi?.kind).toBe('stone-circle');
    expect(poi?.glyph).toMatch(/^sm-henge-/);expect(ARTWORK_MANIFEST[poi!.glyph].biome).toBe(biome);
    expect(ARTWORK_GLYPHS[poi!.glyph].sil).toBeTruthy();
  });
});
