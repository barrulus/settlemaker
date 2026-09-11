import { flora } from './landscape-art.js';
import { fieldTile } from './farms-art.js';
import { henge } from './infrastructure-art.js';
import type { RefinedGlyphMarkup } from './refined-glyphs.js';
export { ART_TOKENS } from './artwork-data.js';
import { REFINED_MANIFEST, type RefinedSymbolMeta } from './refined-manifest.js';
import { REFINED_GLYPHS } from './refined-glyphs.js';
import { REFINED_INK } from './refined-ink.js';
import { ART_META, ART_GLYPHS, ART_INK } from './artwork-data.js';

export interface ArtworkMeta extends RefinedSymbolMeta {
  biome?: string; category?: string; family?: string; site?: string;
  layer?: string; season?: string; seed?: number; irrigation?: boolean; dryChannels?: boolean;
  natural?: boolean; conditional?: boolean;
  footprintPolygons?: number[][][]; courtyardVoids?: number[][];
  representedBuildings?: number | string | null; repeatPitch?: unknown;
}
/** Reviewed village art overrides the same legacy IDs; untouched greens/wells remain. */
export const ARTWORK_MANIFEST: Record<string, ArtworkMeta> = {...REFINED_MANIFEST,...ART_META};
export const ARTWORK_GLYPHS: Record<string, RefinedGlyphMarkup> = {...REFINED_GLYPHS,...ART_GLYPHS};
const generated: Record<string, RefinedGlyphMarkup> = {};
for(const [id,m] of Object.entries(ART_META)) {
  if(!['flora','field','henge'].includes(m.category??''))continue;
  Object.defineProperty(ARTWORK_GLYPHS,id,{enumerable:true,get(){
    if(generated[id])return generated[id];
    if(m.category==='flora')return generated[id]={body:flora(m.biome,m.family,{seed:m.seed,winter:m.season==='snow'}).body};
    if(m.category==='field')return generated[id]={body:fieldTile(m.biome,m.family,{seed:m.seed}).body};
    const drawing=henge(m.family,{biome:m.biome,seed:m.seed}),wrap=(s:string)=>`<g transform="scale(${64/96})">${s}</g>`;
    return generated[id]={body:wrap(drawing.body),sil:wrap(drawing.sil)};
  }});
}
export const ARTWORK_INK = {...REFINED_INK,...ART_INK};
export const BIOMES = ['temperate','desert','tundra','tropical','coastal'] as const;
export function artworkBiome(b?: string): string { return BIOMES.includes(b as typeof BIOMES[number]) ? b! : 'temperate'; }
export function cityGlyph(family: string, biome?: string): string { const b=artworkBiome(biome);return `sm-city-${family}${b==='temperate'?'':`--${b}`}`; }
export function floraId(kind: string, biome: string, variant=0, snow=false): string {
  const b=artworkBiome(biome);return `sm-flora-${kind}-${'abc'[Math.abs(variant)%3]}${snow&&b==='tundra'?'-snow':''}--${b}`;
}

/** Default regional mix. Water-dependent plants are selected only at eligible sites. */
const DRY: Record<string,string[]> = {
  temperate:['oak','beech','birch','poplar','spruce','hawthorn','coppice','bramble','wood-fern','meadow-flowers','fallen-bough'],
  desert:['thorn-scrub','sage-scrub','succulent-rosette','dry-bunchgrass','saltbush','deadwood'],
  tundra:['dwarf-willow','dwarf-birch','crowberry','bearberry','heather','moss-cushion','reindeer-lichen','rock-lichen','alpine-flowers','prostrate-juniper'],
  tropical:['rainforest-canopy','fig','fan-palm','bamboo','tree-fern','understory-shrub','broadleaf-fern','flowering-ginger','jungle-vines'],
  coastal:['windswept-pine','windthorn','tamarisk','sea-buckthorn','maritime-heath','marram-grass','dune-sedge','sea-thrift','sea-kale','driftwood'],
};
const WET: Record<string,string[]>={temperate:['willow','reedbed'],desert:['date-palm','acacia','oasis-reeds'],tundra:['sedge-tussock','cottongrass'],tropical:['elephant-ear','wetland-reeds'],coastal:['saltmarsh-rush','glasswort','sea-lavender']};
export function floraKinds(biome?: string, wet=false): string[]{const b=artworkBiome(biome);return [...DRY[b],...(wet?WET[b]:[])].flatMap(k=>[0,1,2].map(v=>floraId(k,b,v,b==='tundra'&&v===2)));}
export function selectFlora(biome: string, roll: number, wet=false): string {const a=floraKinds(biome,wet);return a[Math.min(a.length-1,Math.floor(roll*a.length))];}
export function fieldKinds(biome?: string, irrigated=false): string[]{
  const b=artworkBiome(biome);
  const kinds:Record<string,string[]>={temperate:['grain-strips','harvested-stubble','ploughed-fallow','kitchen-garden','apple-orchard','hay-meadow'],desert:irrigated?['irrigated-grain','basin-garden','date-grove','olive-grove','alfalfa-beds','resting-basin']:[],tundra:['summer-grazing','lichen-range','wet-sedge-meadow','rested-grazing'],tropical:irrigated?['wet-rice-paddy','drained-paddy','mixed-root-garden','banana-garden','coconut-grove','resting-field']:['mixed-root-garden','banana-garden','resting-field'],coastal:['sheltered-grain','coastal-pasture','sheltered-garden','sheltered-orchard','cut-meadow','resting-field']};
  return kinds[b].map(k=>`sm-field-${k}--${b}`);
}
