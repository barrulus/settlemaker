import { artworkBiome } from './artwork.js';

const ROOFS:Record<string,string[]>={
  temperate:['#7f8c9b','#938c80','#a97968','#a4a7a1','#78857a'],
  desert:['#d5c3a3','#c5b090','#ddc8ac','#bbaa91','#cbbda7'],
  tundra:['#8196a2','#98a4a7','#909994','#74888f','#a5a8a6'],
  tropical:['#b87c64','#9d735f','#bc946f','#8f8070','#c78b76'],
  coastal:['#829f96','#98a399','#a18e7b','#7f929a','#afb3a6'],
};
export function roofColour(biome:string|undefined,variant:number):string{return ROOFS[artworkBiome(biome)][Math.abs(variant)%5];}
export function recolourRoof(body:string,biome:string|undefined,variant:number):string {
  if(!variant)return body;
  const colour=roofColour(biome,variant),rgb=[1,3,5].map(i=>parseInt(colour.slice(i,i+2),16));
  const light='#'+rgb.map(c=>Math.round(c+(255-c)*.28).toString(16).padStart(2,'0')).join('');
  return body.replace(/var\((--sm-(?:city|village)-[\w-]+-(roof|light)),\s*[^)]+\)/g,
    (_,token,role)=>`var(${token}-tone-${variant}, ${role==='roof'?colour:light})`);
}
