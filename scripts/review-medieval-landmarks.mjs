/** Render the landmark kit and its real assembly recipes with shared lighting. */
import { mkdirSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { assembleSvg } from '../dist/output/assemble-svg.js';
import { landmarkFamilies, compoundLayouts } from './art/city-landmarks.mjs';

const out=new URL('../output/medieval-landmarks/',import.meta.url);
mkdirSync(out,{recursive:true});
const scene=(symbols,width,height)=>({version:2,seed:1,population:0,biome:'temperate',
  bounds:{min_x:0,min_y:0,max_x:width,max_y:height},layers:{water:{rings:[],synthetic:false},
    fields:[],furrows:[],greens:[],vegetation:[],roads:[],buildings:[],piers:[],walls:[],symbols}});
const symbol=(key,x,y,scale=1,rotationDeg=0)=>({id:`sm-city-${key}`,at:{x,y},scale:scale*64,
  rotationDeg,zBand:'structure',materialVariant:key.startsWith('palace-')?2:4});
const cards=[];
async function render(key,title,model,labels='') {
  const svg=assembleSvg(model,{theme:{paper:'#d0c09d',shadowOffset:{dx:.8,dy:1.2}}}).replace('</svg>',`${labels}</svg>`);
  writeFileSync(new URL(`${key}.svg`,out),svg);
  await sharp(Buffer.from(svg.replace(/var\(--[^,]+,\s*([^\)]+)\)/g,'$1'))).resize(1400).png().toFile(new URL(`${key}.png`,out).pathname);
  cards.push(`<article><h2>${title}</h2><a href="${key}.svg"><img src="${key}.png" alt="${title}"></a></article>`);
}
for(const [category,title] of [['faith','Temples, churches and cloisters'],['palace','Palace buildings'],['castle','Castle buildings']]) {
  const families=landmarkFamilies.filter(f=>f.category===category);
  const columns=category==='castle'?4:3;
  const symbols=families.map((f,i)=>symbol(f.key,48+(i%columns)*96,45+Math.floor(i/columns)*100));
  const labels=families.map((f,i)=>`<text x="${48+(i%columns)*96}" y="${89+Math.floor(i/columns)*100}" text-anchor="middle" font-family="sans-serif" font-size="4" fill="#68574b">${f.label}</text>`).join('');
  await render(category,title,scene(symbols,columns*96,Math.ceil(families.length/columns)*100),labels);
}
for(const layout of compoundLayouts) {
  const symbols=layout.pieces.map(([key,x,y,scale,angle])=>symbol(key,x,y,scale,angle));
  await render(layout.key,layout.label,scene(symbols,256,256));
}
writeFileSync(new URL('index.html',out),`<!doctype html><meta charset="utf-8"><title>Medieval landmarks</title>
<style>body{margin:32px;background:#eee8dd;color:#453c32;font:16px system-ui}h1{font:32px Georgia}h2{font-size:20px}main{max-width:1400px;display:grid;gap:24px}img{width:100%}a{color:#68513a}</style>
<h1>Temples, castles and palaces</h1><p>Textured roofs, softened stonework and shared sunlight. All twenty existing landmark slots and three compound layouts. Click for vector detail.</p>
<main>${cards.join('')}</main><p><a href="../medieval-housing/index.html">View the city</a></p>`);
console.log(`Review: ${out.pathname}index.html`);
