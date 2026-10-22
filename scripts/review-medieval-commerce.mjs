/** Actual renderer output, including independent lighting of compound wings. */
import { mkdirSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { assembleSvg } from '../dist/output/assemble-svg.js';

const out=new URL('../output/medieval-commerce/',import.meta.url);
mkdirSync(out,{recursive:true});
const names={inn:'Coaching inn',warehouse:'Warehouse',guildhall:'Guildhall'};
const cards=[];
for(const [family,label] of Object.entries(names)) {
  for(const rotationDeg of [0,40]) {
    const scene={version:2,seed:1,population:0,biome:'temperate',
      bounds:{min_x:-47,min_y:-47,max_x:47,max_y:47},
      layers:{water:{rings:[],synthetic:false},fields:[],furrows:[],greens:[],vegetation:[],roads:[],buildings:[],piers:[],walls:[],
        symbols:[{id:`sm-city-${family}`,at:{x:0,y:0},scale:64,rotationDeg,zBand:'structure',materialVariant:family==='inn'?2:family==='warehouse'?1:4}]}};
    const svg=assembleSvg(scene,{theme:{paper:'#d0c09d',shadowOffset:{dx:.8,dy:1.2}}});
    const stem=`${family}-${rotationDeg}`;
    writeFileSync(new URL(`${stem}.svg`,out),svg);
    await sharp(Buffer.from(svg.replace(/var\(--[^,]+,\s*([^\)]+)\)/g,'$1'))).resize(560).png().toFile(new URL(`${stem}.png`,out).pathname);
    cards.push(`<article><h2>${label} · ${rotationDeg}°</h2><a href="${stem}.svg"><img src="${stem}.png" alt="${label} at ${rotationDeg} degrees"></a></article>`);
  }
}
writeFileSync(new URL('index.html',out),`<!doctype html><meta charset="utf-8"><title>Medieval commerce</title>
<style>body{margin:32px;background:#eee8dd;color:#453c32;font:16px system-ui}h1{font:32px Georgia}h2{font-size:18px}main{display:grid;grid-template-columns:repeat(2,minmax(250px,560px));gap:24px}img{width:100%}a{color:#68513a}</style>
<h1>Inns, warehouses and guildhalls</h1><p>Rounded eaves, individual roof courses, and one sunlight direction across all wings. Click for vector detail.</p>
<main>${cards.join('')}</main><p><a href="../medieval-housing/index.html">View the city</a></p>`);
console.log(`Review: ${out.pathname}index.html`);
