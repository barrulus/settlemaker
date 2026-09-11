import { artworkBiome, floraId, selectFlora } from './artwork.js';

export function landscapeHash(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ seed;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const STANDS: Record<string, string[][]> = {
  temperate: [['oak','hawthorn','wood-fern'],['beech','coppice','wood-fern'],['spruce','birch','bramble'],['birch','hawthorn','meadow-flowers']],
  desert: [['thorn-scrub','dry-bunchgrass'],['sage-scrub','saltbush'],['succulent-rosette','deadwood']],
  tundra: [['dwarf-willow','moss-cushion'],['dwarf-birch','crowberry'],['heather','bearberry'],['reindeer-lichen','rock-lichen']],
  tropical: [['rainforest-canopy','understory-shrub','broadleaf-fern'],['fig','jungle-vines','flowering-ginger'],['bamboo','tree-fern'],['fan-palm','understory-shrub']],
  coastal: [['windswept-pine','maritime-heath'],['windthorn','sea-buckthorn'],['tamarisk','sea-kale'],['marram-grass','dune-sedge','sea-thrift']],
};

/** Neighbouring plants share a stand; variants and understory remain individual.
 * Coordinates are metres, so patch size is consistent across both engines. */
export function selectFloraAt(biome: string, x: number, y: number, seed: number, roll: number, wet = false): string {
  const b = artworkBiome(biome), pitch = 48, cx = Math.floor(x/pitch), cy = Math.floor(y/pitch);
  let nearest = Infinity, stand = 0;
  for (let i=cx-1;i<=cx+1;i++) for (let j=cy-1;j<=cy+1;j++) {
    const px=(i+.2+.6*landscapeHash(i,j,seed))*pitch;
    const py=(j+.2+.6*landscapeHash(i,j,seed^12345))*pitch;
    const d=(px-x)**2+(py-y)**2;
    if(d<nearest){nearest=d;stand=Math.floor(landscapeHash(i,j,seed^0x51a7)*STANDS[b].length);}
  }
  if(wet && roll>.65)return selectFlora(b,roll,true);
  const kinds=STANDS[b][stand];
  const choice=landscapeHash(Math.round(x*4),Math.round(y*4),seed^0x7193);
  const kind=choice<.8?kinds[0]:kinds[1+Math.floor((choice-.8)/.2*(kinds.length-1))];
  const variant=Math.min(2,Math.floor(roll*3));
  return floraId(kind,b,variant,b==='tundra'&&variant===2);
}
