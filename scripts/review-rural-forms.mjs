/** Neighbourhood and regional plan review. Run after build:art and build. */
import {mkdirSync,writeFileSync} from 'node:fs';
import sharp from 'sharp';
import {generateSettlement} from '../dist/index.js';
import {assembleSvg} from '../dist/output/assemble-svg.js';
import {HOUSING_VARIANTS} from '../dist/assets/housing-data.js';
const out=new URL('../output/rural-forms/',import.meta.url);mkdirSync(out,{recursive:true});
const cards=[];
async function render(key,scene,width=1400) {
  const svg=assembleSvg(scene,{cullOffscreenArtwork:true});
  writeFileSync(new URL(`${key}.svg`,out),svg);
  await sharp(Buffer.from(svg.replace(/var\(--[^,]+,\s*([^\)]+)\)/g,'$1'))).resize(width).png().toFile(new URL(`${key}.png`,out).pathname);
  cards.push(key);
}
for(const biome of ['temperate','desert','tundra','tropical','coastal']) {
  const ids=Object.keys(HOUSING_VARIANTS).filter(id=>!id.startsWith('sm-city-')&&(biome==='temperate'?!id.includes('--'):id.endsWith(`--${biome}`)));
  await render(`${biome}-plans`,{version:2,seed:2,population:0,biome,
    bounds:{min_x:0,min_y:0,max_x:640,max_y:ids.length*80},
    layers:{water:{rings:[],synthetic:false},fields:[],furrows:[],greens:[],vegetation:[],roads:[],buildings:[],piers:[],walls:[],
      symbols:ids.flatMap((id,r)=>HOUSING_VARIANTS[id].map((_,i)=>({id,artworkVariant:i,at:{x:40+i*80,y:40+r*80},scale:76,rotationDeg:0,zBand:'structure'})))}});
}
const input={name:'Rural forms',population:2500,biome:'temperate',engine:'city',walls:true,plaza:true,temple:true,port:false,citadel:false,capital:false,shanty:false,roadBearings:[18,142,267]};
const city=generateSettlement(input,{seed:2}).model.scene;
const homes=city.layers.symbols.filter(s=>s.artworkVariant!==undefined&&!s.id.startsWith('sm-city-'));
console.log(`${homes.length} suburban/rural homes; ${new Set(homes.map(s=>s.artworkVariant)).size} plans`);
await render('city',{...city,bounds:{min_x:-180,min_y:-180,max_x:180,max_y:180}});
// The north gate sits at the transition from dense city blocks to cottages.
const gate=city.layers.walls[0].gates[0],x=(gate.p1.x+gate.p2.x)/2,y=(gate.p1.y+gate.p2.y)/2;
await render('city-edge',{...city,bounds:{min_x:x-38,min_y:y-42,max_x:x+38,max_y:y+34}},1200);
const village=generateSettlement({...input,engine:'village',population:180,walls:false},{seed:2}).model.scene;
await render('village',{...village,bounds:{min_x:-75,min_y:-75,max_x:75,max_y:75}},1200);
writeFileSync(new URL('index.html',out),`<!doctype html><meta charset="utf-8"><title>Rural house plans</title><style>body{background:#e9e3d5;margin:24px;color:#43392c;font:16px system-ui}img{max-width:100%;width:1400px}h1,h2{font-family:Georgia}</style><h1>Rural house plans</h1><p>Eight native plans per dwelling family. Regional materials, shared lighting, bounded roof and shadow geometry.</p>${cards.map(k=>`<h2>${k}</h2><a href="${k}.svg"><img src="${k}.png" alt="${k}"></a>`).join('')}`);
console.log(`Review: ${out.pathname}index.html`);
