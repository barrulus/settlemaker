import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { assembleSvg } from '../src/output/assemble-svg.js';
import { SCENE_VERSION, type Scene, type WallFeature } from '../src/scene/scene.js';
import type { LocalBounds } from '../src/generator/bounds.js';

function fixture(material: WallFeature['material'], biome: string, bounds: LocalBounds): Scene {
  const line=[{x:0,y:0},{x:100,y:0},{x:100,y:75},{x:45,y:90},{x:0,y:75},{x:0,y:0}];
  return {version:SCENE_VERSION,seed:1,population:5000,biome,bounds,metersPerUnit:1,layers:{
    water:{rings:[],synthetic:false},fields:[],furrows:[],greens:[],vegetation:[],symbols:[],
    piers:[],buildings:[],roads:[],walls:[{material,polylines:[line],large:true,
      towers:[{x:0,y:0},{x:100,y:75},{x:45,y:90}],
      gates:[{p1:{x:47,y:0},p2:{x:53,y:0},routeIds:[]},
        {p1:{x:-3,y:0},p2:{x:3,y:0},routeIds:[]}]}]}};
}
async function pixels(svg: string) {
  return sharp(Buffer.from(svg.replace('<svg ','<svg width="240" height="240" '))).ensureAlpha().raw().toBuffer();
}

describe('viewport wall artwork',()=>{
  it.each(['curtain','rubble','palisade'] as const)('preserves every visible %s pixel at gates, corners, towers and adjacent tile edges',async material=>{
    const crops=[
      {min_x:-4,min_y:-4,max_x:4,max_y:4}, // wrapped closing gate
      {min_x:45,min_y:-4,max_x:55,max_y:6}, // ordinary gate
      {min_x:97,min_y:72,max_x:105,max_y:80}, // tower and corner
      {min_x:20,min_y:-2,max_x:26,max_y:4}, // adjacent tiles, fixed motif phase
      {min_x:26,min_y:-2,max_x:32,max_y:4},
      {min_x:30,min_y:1.1,max_x:36,max_y:7.1}, // only outer shadow enters frame
      {min_x:43,min_y:2.4,max_x:49,max_y:8.4}, // gate tower shadow, beyond the wall envelope
      {min_x:46,min_y:-3,max_x:48,max_y:1}, // open timber door along the passage edge
    ];
    for(const biome of ['temperate','tundra'])for(const bounds of crops){
      const scene=fixture(material,biome,bounds),before=JSON.stringify(scene);
      const full=assembleSvg(scene,{preciseBounds:true});
      const culled=assembleSvg(scene,{preciseBounds:true,cullOffscreenArtwork:true});
      expect(culled.length).toBeLessThan(full.length*.5);
      expect(await pixels(culled)).toEqual(await pixels(full));
      expect(JSON.stringify(scene)).toBe(before);
    }
  });

  it('omits an enclosing ring entirely from a central tile without changing export artwork',async()=>{
    const scene=fixture('curtain','desert',{min_x:30,min_y:30,max_x:40,max_y:40});
    const original=assembleSvg(scene),culled=assembleSvg(scene,{cullOffscreenArtwork:true});
    expect(culled).not.toContain('id="glyph-sm-city-castle-tower-round');
    expect(culled.length).toBeLessThan(original.length*.2);
    expect(await pixels(culled)).toEqual(await pixels(original));
    expect(assembleSvg(scene)).toBe(original);
  });
});
