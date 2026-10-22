/** Repeatable rural artwork and city entrance review; run after npm run build. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { generateSettlement } from '../dist/index.js';
import { assembleSvg } from '../dist/output/assemble-svg.js';

const stage=process.argv[2]??'after';
if(!['before','after'].includes(stage))throw new Error('Expected before or after');
const out=new URL('../output/medieval-rural/',import.meta.url);
mkdirSync(out,{recursive:true});
const {symbols}=JSON.parse(readFileSync(new URL('../symbols/village/symbols.json',import.meta.url),'utf8'));
const cards=[];
async function render(key,scene,width=1200) {
  const svg=assembleSvg(scene,{cullOffscreenArtwork:true});
  writeFileSync(new URL(`${key}-${stage}.svg`,out),svg);
  await sharp(Buffer.from(svg.replace(/var\(--[^,]+,\s*([^\)]+)\)/g,'$1'))).resize(width).png().toFile(new URL(`${key}-${stage}.png`,out).pathname);
  cards.push(key);
}
for(const biome of ['temperate','desert','tundra','tropical','coastal']) {
  const ids=Object.keys(symbols).filter(id=>symbols[id].biome===biome);
  await render(`${biome}-kit`,{version:2,seed:2,population:0,biome,
    bounds:{min_x:0,min_y:0,max_x:400,max_y:Math.ceil(ids.length/4)*95},
    layers:{water:{rings:[],synthetic:false},fields:[],furrows:[],greens:[],vegetation:[],roads:[],buildings:[],piers:[],walls:[],
      symbols:ids.map((id,i)=>({id,at:{x:50+i%4*100,y:44+Math.floor(i/4)*95},scale:64,rotationDeg:i%2?23:0,zBand:'structure'}))}},1200);
}
const input={name:'Rural review',population:2500,biome:'temperate',engine:'city',walls:true,plaza:true,temple:true,
  port:false,citadel:false,capital:false,shanty:false,roadBearings:[18,142,267]};
const city=generateSettlement(input,{seed:2}).model.scene;
await render('city',{...city,bounds:{min_x:-180,min_y:-180,max_x:180,max_y:180}},1400);
for(const [i,gate] of city.layers.walls[0].gates.entries()) {
  const x=(gate.p1.x+gate.p2.x)/2,y=(gate.p1.y+gate.p2.y)/2,r=23;
  await render(`gate-${i+1}`,{...city,bounds:{min_x:x-r,min_y:y-r,max_x:x+r,max_y:y+r}},800);
}
const village=generateSettlement({...input,engine:'village',population:300,walls:false},{seed:2}).model.scene;
await render('village',village,1400);
writeFileSync(new URL('index.html',out),`<!doctype html><meta charset="utf-8"><title>Rural buildings and city gates</title>
<style>body{margin:24px;background:#eee8dd;color:#453c32;font:16px system-ui}section{max-width:1700px}.pair{display:flex;gap:12px}.pair a{width:50%}img{width:100%}h1,h2{font-family:Georgia}</style>
<h1>Rural buildings and city gates</h1><p>Before (left) and after (right). Select an image for vector detail.</p>
${cards.map(key=>`<section><h2>${key}</h2><div class="pair">${['before','after'].map(s=>`<a href="${key}-${s}.svg"><img src="${key}-${s}.png" alt="${key} ${s}"></a>`).join('')}</div></section>`).join('')}`);
console.log(`Review: ${out.pathname}index.html`);
