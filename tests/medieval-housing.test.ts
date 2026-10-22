import {Point} from '../src/types/point.js';
import {pointInPolygon} from '../src/geom/point-in-polygon.js';
import {describe, expect, it} from 'vitest';
import sharp from 'sharp';
import {generateSettlement, createSkin} from '../src/index.js';
import {HOUSING_VARIANTS} from '../src/assets/housing-data.js';
import {SETTLEMENT_SET} from '../src/assets/asset-sets.js';
import {ARTWORK_INK} from '../src/assets/artwork.js';
import {assembleSvg} from '../src/output/assemble-svg.js';
import {createSceneIndex} from '../src/scene/spatial-index.js';
import {reviewSettlementGround} from '../src/settlement/quality.js';

const input={name:'Housing',population:2000,biome:'temperate',engine:'city' as const,walls:true,
  plaza:true,temple:false,port:false,citadel:false,capital:false,shanty:false,roadBearings:[20,145,270]};

describe('medieval housing and urban ground',()=>{
  it('contains every roof and its shadow inside the shared measured fitting envelope',async()=>{
    expect(Object.keys(HOUSING_VARIANTS).filter(id=>id.startsWith('sm-city-'))).toHaveLength(20);
    expect(Object.keys(HOUSING_VARIANTS).filter(id=>!id.startsWith('sm-city-'))).toHaveLength(12);
    for(const [id,variants] of Object.entries(HOUSING_VARIANTS)) {
      expect(variants).toHaveLength(8);
      expect(new Set(variants.map(v=>v.body)).size).toBe(8);
      expect(new Set(variants.map(v=>v.sil)).size).toBe(8);
      const [x0,y0,x1,y1]=ARTWORK_INK[id].bounds;
      for(const variant of variants) {
        const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 64 64">${variant.body}${variant.sil}</svg>`;
        const {data,info}=await sharp(Buffer.from(svg.replace(/var\(--[^,]+,\s*([^\)]+)\)/g,'$1'))).ensureAlpha().raw().toBuffer({resolveWithObject:true});
        let painted=0;
        for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++)if(data[(y*info.width+x)*4+3]) {
          painted++;
          if(x/4<x0 || (x+1)/4>x1 || y/4<y0 || (y+1)/4>y1)throw new Error(`${id} variation escapes measured bounds`);
        }
        expect(painted).toBeGreaterThan(1000);
      }
    }
  });

  it.each(['desert','tundra','tropical','coastal'])('saves repeatable housing variations in %s city scenes',biome=>{
    const first=generateSettlement({...input,biome},{seed:2});
    const homes=first.model.scene.layers.symbols.filter(s=>s.artworkVariant!==undefined);
    expect(homes.length).toBeGreaterThan(40);
    expect(new Set(homes.map(s=>s.artworkVariant)).size).toBe(8);
    expect(homes.every(s=>s.id.endsWith(`--${biome}`))).toBe(true);
    expect(first.model.residents.unassigned).toBe(0);
    expect(generateSettlement({...input,biome},{seed:2}).model.scene).toEqual(first.model.scene);
  });

  it.each(['temperate','desert','tundra','tropical','coastal'])('varies rural houses in %s villages and preserves custom skins',biome=>{
    const first=generateSettlement({...input,biome,engine:'village',population:180,walls:false},{seed:2});
    const scene=first.model.scene;
    const homes=scene.layers.symbols.filter(s=>HOUSING_VARIANTS[s.id]&&!s.id.startsWith('sm-city-'));
    expect(homes.length).toBeGreaterThan(10);
    expect(homes.every(s=>s.artworkVariant!==undefined)).toBe(true);
    expect(new Set(homes.map(s=>s.artworkVariant)).size).toBeGreaterThan(4);
    expect(generateSettlement({...input,biome,engine:'village',population:180,walls:false},{seed:2}).model.scene).toEqual(scene);
    const home=homes[0], isolated={...scene,layers:{...scene.layers,symbols:[home]}};
    expect(assembleSvg(isolated)).toContain(`glyph-${home.id}-shape-${home.artworkVariant}-sil`);
    const body='<path d="M12 12H52V52H12Z" fill="#abcdef"/>';
    const skin=createSkin({version:1,id:'rural-test',name:'Rural override',glyphs:{[home.id]:{body,sil:body}}});
    const custom=assembleSvg(isolated,{skin});
    expect(custom).toContain(body);
    expect(custom).not.toContain(`glyph-${home.id}-shape-`);
  });

  it('saves repeatable variations, uses mostly paved dense yards, and exports the same ground',()=>{
    const result=generateSettlement(input,{seed:2});
    const scene=result.model.scene;
    const homes=scene.layers.symbols.filter(s=>s.artworkVariant!==undefined);
    expect(new Set(homes.map(s=>s.artworkVariant)).size).toBe(8);
    expect(generateSettlement(input,{seed:2}).model.scene).toEqual(scene);
    expect(result.model.residents.unassigned).toBe(0);
    const privateGround=scene.layers.greens.filter(g=>g.purpose==='private' && scene.layers.ground?.some(base=>pointInPolygon(new Point(g.ring.reduce((n,p)=>n+p.x,0)/g.ring.length,g.ring.reduce((n,p)=>n+p.y,0)/g.ring.length),base.ring.map(p=>new Point(p.x,p.y)))));
    expect(privateGround.filter(g=>g.surface==='paved').length/privateGround.length).toBeGreaterThan(.65);
    expect(privateGround.some(g=>!g.surface)).toBe(true);
    expect(scene.layers.ground!.length).toBeGreaterThan(0);
    const ground=result.geojson.features.filter(f=>f.properties?.layer==='ground');
    expect(ground).toHaveLength(scene.layers.ground!.length);
    for(const [i,feature] of ground.entries()) {
      expect(feature.properties?.surface).toBe('paved');
      if(feature.geometry.type!=='Polygon')throw new Error('expected polygon');
      expect(feature.geometry.coordinates[0].slice(0,-1)).toEqual(scene.layers.ground![i].ring.map(p=>[p.x,p.y]));
    }
    const review=reviewSettlementGround(result.model,{maxSamplesPerDistrict:256});
    expect(review.districts.some(d=>d.estimatedAreasM2.pavedGround>0)).toBe(true);
    const view=createSceneIndex(scene).query({min_x:-40,min_y:-40,max_x:40,max_y:40});
    expect(view.layers.ground!.length).toBeGreaterThan(0);
    expect(createSceneIndex(scene).query({min_x:1e6,min_y:1e6,max_x:1e6+40,max_y:1e6+40}).layers.ground).toEqual([]);
  });

  it('uses matching variant shadows, honours overrides, and accepts older scenes',()=>{
    const scene=generateSettlement(input,{seed:2}).model.scene;
    const home=scene.layers.symbols.find(s=>s.artworkVariant===3)!;
    const isolated={...scene,layers:{...scene.layers,symbols:[home]}};
    const svg=assembleSvg(isolated);
    expect(svg).toContain(`href="#glyph-${home.id}-shape-3-tone-${home.materialVariant}-sil"`);
    const body='<path d="M16 8H48V56H16Z" fill="#abcdef"/>';
    const sil='<path d="M16 8H48V56H16Z" fill="currentColor"/>';
    const skin=createSkin({version:1,id:'test-housing',name:'Custom housing',glyphs:{[home.id]:{body,sil}}});
    const custom=assembleSvg(isolated,{skin});
    expect(custom).toContain(body);
    expect(custom).not.toContain(`glyph-${home.id}-shape-`);
    expect(custom).toContain(`href="#glyph-${home.id}-sil"`);
    const assetSet={...SETTLEMENT_SET,glyphs:{...SETTLEMENT_SET.glyphs,[home.id]:{...SETTLEMENT_SET.glyphs![home.id],body,sil}}};
    const customSet=assembleSvg(isolated,{assetSet});
    expect(customSet).toContain(body);
    expect(customSet).not.toContain(`glyph-${home.id}-shape-`);
    const old=structuredClone(isolated);
    delete old.layers.ground;
    delete old.layers.symbols[0].artworkVariant;
    expect(assembleSvg(old)).toContain(`href="#glyph-${home.id}-tone-`);
  });
});
