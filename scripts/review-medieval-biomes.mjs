/** Regional city kits, housing variations and generated neighbourhoods. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { generateSettlement } from '../dist/index.js';
import { assembleSvg } from '../dist/output/assemble-svg.js';
import { compoundLayouts } from './art/city-landmarks.mjs';

const out=new URL('../output/medieval-biomes/',import.meta.url);
mkdirSync(out,{recursive:true});
const {biomes,symbols:manifest}=JSON.parse(readFileSync(new URL('../symbols/city/symbols.json',import.meta.url),'utf8'));
const requested=process.argv.slice(2);
const regions=requested.length?requested:['desert','tundra','tropical','coastal'];
for(const biome of regions)if(!['desert','tundra','tropical','coastal'].includes(biome))throw new Error(`Unknown region: ${biome}`);
const scene=(biome,symbols,width,height)=>({version:2,seed:2,population:0,biome,
  bounds:{min_x:0,min_y:0,max_x:width,max_y:height},
  layers:{water:{rings:[],synthetic:false},fields:[],furrows:[],greens:[],vegetation:[],roads:[],buildings:[],piers:[],walls:[],symbols}});
const symbol=(biome,family,x,y,rotationDeg=0,artworkVariant)=>({id:`sm-city-${family}--${biome}`,at:{x,y},scale:64,
  rotationDeg,zBand:'structure',...(artworkVariant===undefined?{}:{artworkVariant,materialVariant:[4,2,1][artworkVariant%3]})});
const label=(x,y,text)=>`<text x="${x}" y="${y}" text-anchor="middle" font-family="sans-serif" font-size="4" fill="#68574b">${text}</text>`;
async function render(stem,model,width,labels='') {
  const svg=assembleSvg(model,{theme:{shadowOffset:{dx:.8,dy:1.2}}}).replace('</svg>',`${labels}</svg>`);
  writeFileSync(new URL(`${stem}.svg`,out),svg);
  await sharp(Buffer.from(svg.replace(/var\(--[^,]+,\s*([^\)]+)\)/g,'$1'))).resize(width).png().toFile(new URL(`${stem}.png`,out).pathname);
}
for(const biome of regions) {
  const entries=Object.values(manifest).filter(m=>m.biome===biome);
  const items=entries.map((m,i)=>symbol(biome,m.family,48+(i%6)*100,44+Math.floor(i/6)*100,i%2?32:0));
  const labels=entries.map((m,i)=>label(48+(i%6)*100,89+Math.floor(i/6)*100,m.family)).join('');
  await render(`${biome}-kit`,scene(biome,items,600,600),1500,labels);
  const homes=['row-house-a','row-house-b','shop-house','tenement'];
  const variants=homes.flatMap((f,row)=>Array.from({length:8},(_,i)=>symbol(biome,f,44+i*88,44+row*94,0,i)));
  await render(`${biome}-variants`,scene(biome,variants,704,376),1500,
    homes.flatMap((f,row)=>Array.from({length:8},(_,i)=>label(44+i*88,86+row*94,`${f} · ${i+1}`))).join(''));
  for(const key of ['palace-court','castle-bailey']) {
    const layout=compoundLayouts.find(l=>l.key===key);
    const pieces=layout.pieces.map(([family,x,y,scale,rotation])=>({...symbol(biome,family,x,y,rotation),scale:scale*64}));
    await render(`${biome}-${key}`,scene(biome,pieces,256,256),900);
  }
  const result=generateSettlement({name:`${biome} city`,population:2500,biome,engine:'city',walls:true,
    plaza:true,temple:true,port:false,citadel:false,capital:false,shanty:false,roadBearings:[18,142,267]},{seed:2});
  for(const [view,extent,size] of [['town',180,1200],['block',60,1000]])
    await render(`${biome}-${view}`,{...result.model.scene,bounds:{min_x:-extent,min_y:-extent,max_x:extent,max_y:extent}},size);
  const cards=[['kit','All 34 city forms'],['variants','Eight variations of each housing family'],['palace-court','Palace court'],['castle-bailey','Castle bailey'],['town','Generated city'],['block','Street detail']];
  writeFileSync(new URL(`${biome}.html`,out),`<!doctype html><meta charset="utf-8"><title>${biome} medieval city</title>
<style>body{margin:32px;background:#eee8dd;color:#453c32;font:16px system-ui}h1{font:32px Georgia}main{max-width:1500px}img{max-width:100%}a{color:#68513a}</style>
<p><a href="index.html">All biomes</a></p><h1>${biome[0].toUpperCase()+biome.slice(1)} city architecture</h1><p>${biomes[biome].description}. Click any image for vector detail.</p>
<main>${cards.map(([key,title])=>`<section><h2>${title}</h2><a href="${biome}-${key}.svg"><img src="${biome}-${key}.png" alt="${biome}: ${title}"></a></section>`).join('')}</main>`);
  console.log(`Reviewed ${biome}: ${out.pathname}${biome}.html`);
}
writeFileSync(new URL('index.html',out),`<!doctype html><meta charset="utf-8"><title>Medieval city biomes</title>
<style>body{margin:32px;background:#eee8dd;color:#453c32;font:16px system-ui}h1{font:32px Georgia}main{display:grid;grid-template-columns:repeat(2,minmax(280px,750px));gap:24px}img{width:100%}a{color:#68513a}</style>
<h1>Medieval city biomes</h1><p>136 regional city forms, with distinct materials, softly irregular edges and shared sunlight.</p><main>${['desert','tundra','tropical','coastal'].map(b=>`<article><h2><a href="${b}.html">${b[0].toUpperCase()+b.slice(1)}</a></h2><a href="${b}.html"><img src="${b}-kit.png" alt="${b} city kit"></a><p>${biomes[b].description}</p></article>`).join('')}</main>`);
console.log(`Review: ${out.pathname}index.html`);
