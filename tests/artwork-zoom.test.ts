import { expect, it } from 'vitest';
import sharp from 'sharp';
import { assembleSvg } from '../src/output/assemble-svg.js';
import { BIOMES, fieldKinds, floraKinds } from '../src/assets/artwork.js';
import { createSceneIndex } from '../src/scene/spatial-index.js';
import type { Scene } from '../src/scene/scene.js';
import { SCHEMATIC_SET } from '../src/assets/asset-sets.js';
import { PALETTE_BLUEPRINT } from '../src/output/palette.js';

const rect = (x: number, y: number, w: number, h = w) =>
  [{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];
function fixture(biome: string): Scene {
  return {version:2, seed:2, population:300, biome, metersPerUnit:1,
    bounds:{min_x:0,min_y:0,max_x:120,max_y:120}, layers:{
      water:{rings:[],synthetic:false}, furrows:[], piers:[], walls:[], buildings:[], roads:[],
      greens:[{purpose:'private',ring:rect(4,4,18)}, {purpose:'public',ring:rect(30,4,60,20),
        paths:[[{x:30,y:12},{x:90,y:12}]],pathWidth:.7}],
      ground:[{ring:rect(4,28,30,16)}],
      fields:fieldKinds(biome,true).map((glyph,i)=>({glyph,ring:rect(4+i*18,75,16,35),angleDeg:i*15})),
      vegetation:floraKinds(biome,true).map((kind,i)=>({kind,at:{x:5+(i%15)*7,y:49+Math.floor(i/15)*8},scale:7,rotationDeg:i*17})),
      symbols:[{id:'sm-well',at:{x:40,y:35},scale:4,rotationDeg:0,zBand:'structure'}],
    }};
}
async function raster(svg: string) {
  return sharp(Buffer.from(svg.replace('<svg ', '<svg width="360" height="360" '))).ensureAlpha().raw().toBuffer();
}

it.each([...BIOMES, 'steppe'])('preserves %s materials, outlines, flora and small structures across zoom thresholds', biome => {
  const scene = fixture(biome), before = JSON.stringify(scene);
  for (const appearance of [{}, {palette:PALETTE_BLUEPRINT}, {assetSet:SCHEMATIC_SET}]) {
    const reference = assembleSvg(scene, appearance);
    for (const pixelsPerUnit of [.01,.3,.74,.76,1,1.99,2.01,2.66,2.68,4,16])
      expect(assembleSvg(scene, {...appearance,pixelsPerUnit})).toBe(reference);
  }
  expect(JSON.stringify(scene)).toBe(before);
});

it.each(BIOMES)('keeps %s cropped tiles visually identical to the full artwork at the same scale', async biome => {
  const scene = fixture(biome), index = createSceneIndex(scene);
  // Overlapping crops cross plot edges, differently rotated field patterns,
  // off-centre canopies and paved ground. Compare independent render paths.
  for (const bounds of [
    {min_x:10,min_y:10,max_x:70,max_y:70},
    {min_x:35.125,min_y:55.375,max_x:95.125,max_y:115.375},
  ]) {
    const expected = await raster(assembleSvg({...scene,bounds},{preciseBounds:true}));
    for (const pixelsPerUnit of [.3,2,8]) {
      const appearance = {preciseBounds:true,cullOffscreenArtwork:true,pixelsPerUnit};
      const observed = await raster(assembleSvg(index.query(bounds,appearance),appearance));
      let error = 0;
      for (let i=0;i<expected.length;i++) error += Math.abs(expected[i]-observed[i]);
      expect(error/expected.length).toBeLessThan(.01);
    }
  }
});
