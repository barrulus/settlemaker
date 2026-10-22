import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { assembleSvg } from '../src/output/assemble-svg.js';
import type { Scene, SymbolInstance } from '../src/scene/scene.js';
import { ART_GLYPHS, ART_META } from '../src/assets/artwork-data.js';
import { wallTowerCanvas } from '../src/assets/fortification-dimensions.js';
import { prepareRoofLighting } from '../src/output/roof-lighting.js';

function fixture(id: string, rotationDeg: number): Scene {
  return {
    version: 2, seed: 1, population: 0, biome: id.split('--')[1]??'temperate',
    bounds: { min_x: -64, min_y: -64, max_x: 64, max_y: 64 },
    layers: {
      water: { rings: [], synthetic: false }, fields: [], furrows: [], greens: [],
      vegetation: [], roads: [], buildings: [], piers: [], walls: [],
      symbols: [{ id, rotationDeg, at: { x: 0, y: 0 }, scale: 64, scaleY: 96,
        zBand: 'structure', artworkVariant: 0, materialVariant: 4 }],
    },
  };
}

describe('roof lighting in world space', () => {
  it.each([
    { id:'sm-house', cross:true, samples:[[32,22],[32,39]] },
    { id:'sm-house-tiled', cross:true, samples:[[32,22],[32,39]] },
    { id:'sm-house--coastal', cross:true, samples:[[32,22],[32,39]] },
    { id:'sm-house--tropical', cross:true, samples:[[32,22],[32,39]] },
    { id:'sm-house--tundra', cross:true, samples:[[37,27.6],[37,33.4]] },
    { id:'sm-hut-straw', cross:false, samples:[[22,31],[42,31]] },
    { id:'sm-chapel', cross:false, samples:[[27,30],[37,30]], sampleRadius:1 },
    { id:'sm-city-row-house-a', cross:false, samples:[[24,35],[40,35]] },
    { id:'sm-city-row-house-b', cross:true, samples:[[32,20],[32,44]] },
    { id:'sm-city-inn', cross:true, samples:[[32,6],[32,16]] },
    { id:'sm-city-inn', cross:false, samples:[[6,32],[15,32]] },
    { id:'sm-city-warehouse', cross:false, samples:[[12,30],[27,30]] },
    { id:'sm-city-guildhall', cross:true, samples:[[45,18],[45,45]] },
    { id:'sm-city-terrace', cross:false, samples:[[7,32],[18,32]] },
    { id:'sm-city-corner', cross:true, samples:[[35,11],[35,21]] },
    { id:'sm-city-corner', cross:false, samples:[[11,36],[21,36]] },
    { id:'sm-city-courtyard-u', cross:true, samples:[[32,7],[32,17]] },
    { id:'sm-city-courtyard', cross:false, samples:[[7,32],[15,32]] },
    { id:'sm-city-workshop', cross:true, samples:[[29,12],[29,23]] },
    { id:'sm-city-bathhouse', cross:true, samples:[[32,18],[32,44]] },
    { id:'sm-city-market-hall', cross:true, samples:[[18,19],[18,42]] },
    { id:'sm-city-church', cross:true, samples:[[12,22],[12,29]] },
    { id:'sm-city-temple-hall', cross:false, samples:[[23,32],[40,32]] },
    { id:'sm-city-palace-pavilion', cross:false, samples:[[14,32],[50,32]] },
    { id:'sm-city-palace-pavilion', cross:true, samples:[[32,14],[32,50]] },
    { id:'sm-city-row-house-a--coastal', cross:false, samples:[[24,35],[40,35]] },
    { id:'sm-city-corner--coastal', cross:true, samples:[[35,11],[35,21]] },
    { id:'sm-city-row-house-a--tropical', cross:false, samples:[[24,32],[41,32]] },
    { id:'sm-city-row-house-a--tropical', cross:true, samples:[[29.5,15],[33.5,49.5]] },
    { id:'sm-city-corner--tropical', cross:true, samples:[[35,11],[35,21]] },
    { id:'sm-city-row-house-a--tundra', cross:false, samples:[[22,23],[43,23]] },
    { id:'sm-city-row-house-a--tundra', cross:false, samples:[[27,35],[34,35]] },
    { id:'sm-city-row-house-a--desert', cross:false, samples:[[18.73,32],[45.25,32]], resolution:2048, sampleRadius:2 },
  ])('lights the sunward face of rotated and stretched $id (cross ridge: $cross)', async ({id,cross,samples,resolution=512,sampleRadius=3}) => {
    for (const rotation of [0, 90, 180, 270, 37, 127]) for (const direction of [1, -1]) {
      const scene = fixture(id, rotation);
      const shadowOffset = { dx: .4 * direction, dy: .6 * direction };
      const svg = assembleSvg(scene, { theme: { shadowOffset } });
      expect(svg).toContain(`<g id="shadows" transform="translate(${shadowOffset.dx.toFixed(2)},${shadowOffset.dy.toFixed(2)})">`);
      const { data, info } = await sharp(Buffer.from(svg.replace(/var\(--[^,]+,\s*([^\)]+)\)/g, '$1')))
        .resize(resolution, resolution).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const angle = rotation * Math.PI / 180;
      // Sample well inside each actual roof plane, away from stacks and ridges.
      const brightness = (x: number, y: number) => {
        const lx = x - 32, ly = (y - 32) * 1.5;
        const px = Math.round((64 + lx * Math.cos(angle) - ly * Math.sin(angle)) * resolution/128);
        const py = Math.round((64 + lx * Math.sin(angle) + ly * Math.cos(angle)) * resolution/128);
        let sum = 0;
        for (let dy = -sampleRadius; dy <= sampleRadius; dy++) for (let dx = -sampleRadius; dx <= sampleRadius; dx++) {
          const i = ((py + dy) * info.width + px + dx) * info.channels;
          sum += (data[i] + data[i + 1] + data[i + 2]) / 3;
        }
        return sum / (2*sampleRadius+1)**2;
      };
      const negative = brightness(samples[0][0],samples[0][1]);
      const positive = brightness(samples[1][0],samples[1][1]);
      const normal = angle + (cross ? Math.PI / 2 : 0);
      const sunward = shadowOffset.dx * Math.cos(normal) + shadowOffset.dy * Math.sin(normal);
      expect((negative - positive) * Math.sign(sunward), `${id} at ${rotation}°, direction ${direction}`).toBeGreaterThan(2);
    }
  });

  it('keeps a flat desert terrace matte when the sun changes direction', async () => {
    const colours=[];
    for(const rotation of [0,37,90])for(const direction of [-1,1]) {
      const svg=assembleSvg(fixture('sm-city-row-house-a--desert',rotation),{theme:{shadowOffset:{dx:.4*direction,dy:.6*direction}}});
      const {data,info}=await sharp(Buffer.from(svg.replace(/var\(--[^,]+,\s*([^\)]+)\)/g,'$1'))).resize(256,256).removeAlpha().raw().toBuffer({resolveWithObject:true});
      const centre=(128*info.width+128)*info.channels;
      colours.push([...data.subarray(centre,centre+3)]);
    }
    for(const colour of colours)expect(colour).toEqual(colours[0]);
  });

  it('keeps all five city kits inside surveyed wings, leaving courts and passages clear', async () => {
    const city=Object.keys(ART_META).filter(id=>id.startsWith('sm-city-'));
    expect(city).toHaveLength(170);
    for(const id of city) {
      const art=ART_GLYPHS[id], panels=ART_META[id].footprintPolygons!;
      for(const markup of [art.body,art.sil]) {
        // Include an outer margin so viewport clipping cannot hide stray ink.
        const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="272" height="272" viewBox="-2 -2 68 68">${markup}</svg>`;
        const {data}=await sharp(Buffer.from(svg.replace(/var\(--[^,]+,\s*([^\)]+)\)/g,'$1'))).ensureAlpha().raw().toBuffer({resolveWithObject:true});
        let painted=0;
        for(let y=0;y<272;y++)for(let x=0;x<272;x++)if(data[(y*272+x)*4+3]) {
          painted++;
          const inside=panels.some(p=>x/4-2>=p[0][0] && (x+1)/4-2<=p[2][0] && y/4-2>=p[0][1] && (y+1)/4-2<=p[2][1]);
          if(!inside)throw new Error(`${id} paints outside its wings at ${x/4-2},${y/4-2}`);
        }
        expect(painted).toBeGreaterThan(1000);
      }
    }
  });

  it('preserves every authored shape when preparing regional roofs, snow and raised details for lighting', () => {
    const city=Object.entries(ART_GLYPHS).filter(([id])=>id.startsWith('sm-city-'));
    for(const [id,{body}] of city) {
      if(!body.startsWith('<g data-roof-sections="true">'))continue;
      const lighting=prepareRoofLighting(body,paint=>paint.replace(/var\(--[^,]+,\s*([^\)]+)\)/g,'$1'),id)!;
      expect(lighting,id).toBeDefined();
      const shapes=(markup:string)=>markup.match(/<(?:path|circle|rect|ellipse|polygon|polyline)\b/g)??[];
      expect(shapes(lighting.body),id).toEqual(shapes(body));
      const sections=body.match(/data-roof-section="\d+"/g)??[];
      expect(lighting.uses!(37,{dx:.4,dy:.6},1.5).match(/<use /g),id).toHaveLength(sections.length);
    }
  });

  it('accounts for stretching when lighting diagonal faces of a conical tower roof', async () => {
    for(const stretch of [.5,2])for(const rotation of [0,180]) {
      const scene=fixture('sm-city-castle-tower-round',rotation);
      scene.layers.symbols[0].scaleY=64*stretch;
      const svg=assembleSvg(scene,{theme:{shadowOffset:{dx:-.8,dy:1}}});
      const {data,info}=await sharp(Buffer.from(svg.replace(/var\(--[^,]+,\s*([^\)]+)\)/g,'$1'))).resize(512,512).removeAlpha().raw().toBuffer({resolveWithObject:true});
      const brightness=(side:number)=>{
        const direction=rotation===0?side:-side;
        const px=256+direction*32,py=256+direction*32*stretch;
        let sum=0;
        for(let y=-3;y<=3;y++)for(let x=-3;x<=3;x++) {
          const i=((py+y)*info.width+px+x)*info.channels;
          sum+=(data[i]+data[i+1]+data[i+2])/3;
        }
        return sum/49;
      };
      // Compression makes this facet face more north/south; stretching makes
      // it face more east/west. This sun direction lies between those normals.
      const expected=(stretch===.5?1:-1)*(rotation===0?1:-1);
      expect((brightness(-1)-brightness(1))*expected).toBeGreaterThan(2);
    }
  });

  it('uses the same lighting for a defensive wall tower and a placed tower', async () => {
    const scene=fixture('sm-city-castle-tower-round',0);
    scene.bounds={min_x:-3,min_y:-3,max_x:3,max_y:3};
    scene.layers.symbols=[{id:'sm-city-castle-tower-round',at:{x:0,y:0},scale:wallTowerCanvas(false),rotationDeg:0,zBand:'structure'}];
    const raster=async (svg:string)=>sharp(Buffer.from(svg.replace(/var\(--[^,]+,\s*([^\)]+)\)/g,'$1'))).resize(256,256).removeAlpha().raw().toBuffer();
    const placed=await raster(assembleSvg(scene,{theme:{shadowOpacity:0}}));
    scene.layers.symbols=[];
    scene.layers.walls=[{polylines:[],towers:[{x:0,y:0}],gates:[],large:false}];
    const wall=await raster(assembleSvg(scene,{theme:{shadowOpacity:0}}));
    expect(wall).toEqual(placed);
  });

  it('paints adjoining curtain-wall pieces below tower roofs regardless of their centre positions', () => {
    const scene=fixture('sm-city-castle-tower-round',0);
    scene.layers.symbols[0].buildingId='tower';
    scene.layers.symbols.push({id:'sm-city-castle-wall',at:{x:0,y:24},scale:64,rotationDeg:90,zBand:'structure',buildingId:'wall'});
    const svg=assembleSvg(scene).split('<g id="symbols">')[1];
    expect(svg.indexOf('data-building-id="wall"')).toBeGreaterThanOrEqual(0);
    expect(svg.indexOf('data-building-id="wall"')).toBeLessThan(svg.indexOf('data-building-id="tower"'));
  });

  it('shares detailed glyphs across rotations and leaves ground shadows independent of roof paints', () => {
    const scene = fixture('sm-city-row-house-a', 0);
    const home = scene.layers.symbols[0];
    scene.layers.symbols = [0, 90, 180, 270].map(rotationDeg => ({ ...home, rotationDeg }));
    const svg = assembleSvg(scene);
    expect(svg.match(/<g id="glyph-sm-city-row-house-a-shape-0-tone-4">/g)).toHaveLength(1);
    const shadows = svg.match(/<g id="shadows"[^>]*>([\s\S]*?)<\/g>/)![1];
    expect(shadows.match(/<use /g)).toHaveLength(4);
    expect(shadows).not.toMatch(/\b(?:fill|color)="/);
    const unlit = assembleSvg(scene, { theme: { shadowOffset: { dx: 0, dy: 0 } } });
    const paints = [...unlit.matchAll(/<use [^>]*fill="([^"]+)" color="([^"]+)"/g)];
    expect(paints).toHaveLength(4);
    for (const [, negative, positive] of paints) expect(negative).toBe(positive);
  });

  it('lights older scenes without stored variation selections', () => {
    const scene = fixture('sm-city-row-house-b', 180);
    const home: SymbolInstance = scene.layers.symbols[0];
    delete home.artworkVariant;
    delete home.materialVariant;
    expect(assembleSvg(scene)).toMatch(/<use href="#glyph-sm-city-row-house-b" fill="#[\da-f]+" color="#[\da-f]+"/);
  });
});
