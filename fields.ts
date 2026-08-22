import { generateVillage } from './src/village/village-model.js';
import { dist, bearingOf, wrapDeg } from './src/village/geometry.js';
import type { AzgaarBurgInput } from './src/input/azgaar-input.js';
const f = (population: number): AzgaarBurgInput => ({ name:'A', population, port:false, citadel:false, walls:false, plaza:false, temple:false, shanty:false, capital:false, roadBearings:[{bearing_deg:225,kind:'road'}] });
for (const [pop,seed] of [[300,1],[900,2]] as [number,number][]) {
  const m = generateVillage(f(pop), seed);
  const depths: number[] = []; const spans: number[] = []; const inners: number[] = [];
  for (const b of m.fields) {
    const rs = b.polygon.map(p=>dist(p,m.green.centre));
    depths.push(Math.max(...rs)-Math.min(...rs)); inners.push(Math.min(...rs));
    const bs = b.polygon.map(p=>bearingOf(m.green.centre,p));
    // angular extent via max pairwise gap complement
    const sorted=[...bs].sort((x,y)=>x-y); let maxGap=0;
    for(let i=1;i<sorted.length;i++) maxGap=Math.max(maxGap,sorted[i]-sorted[i-1]);
    maxGap=Math.max(maxGap, 360-(sorted[sorted.length-1]-sorted[0]));
    spans.push(360-maxGap);
  }
  const r=(a:number[])=>`${Math.min(...a).toFixed(0)}-${Math.max(...a).toFixed(0)}`;
  const crops = new Map<string,number>(); for(const b of m.fields) crops.set(b.glyph,(crops.get(b.glyph)??0)+1);
  console.log(`pop=${pop} s=${seed} blocks=${m.fields.length} depth=${r(depths)}m span=${r(spans)}deg innerR=${r(inners)}m crops=${[...crops].map(([k,v])=>k.replace('sm-field-','')+':'+v).join(' ')}`);
}
