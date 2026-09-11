/** End-to-end review using the compiled public generator, never a separate art renderer. */
import {mkdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {generateSettlement} from '../dist/index.js';
const out=fileURLToPath(new URL('../output/art-integration/',import.meta.url));
mkdirSync(out,{recursive:true});
const base={name:'Artwork integration',walls:true,plaza:true,temple:true,port:false,citadel:true,shanty:false,capital:true,roadBearings:[{bearing_deg:18,kind:'main',route_id:'a'},{bearing_deg:142,kind:'town',route_id:'b'},{bearing_deg:267,kind:'local',route_id:'c'}]};
const examples=[];
for(const biome of ['temperate','desert','tundra','tropical','coastal'])for(const population of [300,10000])examples.push({name:`${biome}-${population}`,label:`${biome} / ${population===300?'village':'city'}`,input:{...base,biome,population},seed:2});
examples.push({name:'brook',label:'River village / native bridge decks',input:{...base,name:'Brook',population:300,biome:'temperate',walls:false,roadBearings:[{bearing_deg:135,kind:'main',through:true,route_id:'cross'},{bearing_deg:305,kind:'main',through:true,route_id:'cross'}],coastlineGeometry:[[{x:-900,y:-898},{x:900,y:902},{x:900,y:906},{x:-900,y:-894}]]},seed:3});
const summary=[];
for(const e of examples){
  const r=generateSettlement(e.input,{seed:e.seed});
  writeFileSync(`${out}/${e.name}.svg`,r.svg);
  writeFileSync(`${out}/${e.name}.geojson`,JSON.stringify(r.geojson));
  await sharp(Buffer.from(r.svg.replace(/var\(--[^,]+,\s*([^\)]+)\)/g,'$1'))).resize({width:1400}).png().toFile(`${out}/${e.name}.png`);
  summary.push({name:e.name,engine:r.kind,...(r.kind==='village'?{buildings:r.model.buildings.length,housed:r.model.buildings.reduce((n,b)=>n+b.occupancy,0),fields:r.model.fields.length,plants:r.model.vegetation.length,bridges:r.model.bridges.length,gates:r.model.wall?.gates.length??0}:{buildings:r.model.countOrdinaryBuildingsPublic(),glyphs:r.model.symbols.filter(s=>s.building).length})});
  console.log(`Rendered ${e.name}`);
}
writeFileSync(`${out}/summary.json`,JSON.stringify(summary,null,2));
writeFileSync(`${out}/index.html`,`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Settlemaker integrated artwork</title><style>body{margin:30px;background:#f5f2ea;color:#33262e;font:16px system-ui}h1{font:36px Georgia,serif}p{max-width:850px;line-height:1.6}a{color:#426677}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(420px,1fr));gap:24px}article{background:white;border:1px solid #d0cabf;padding:16px;border-radius:8px}img{width:100%;max-height:680px;object-fit:contain}h2{font:24px Georgia,serif}nav{display:flex;gap:16px;flex-wrap:wrap;margin:20px 0}</style><h1>The artwork, inside the generator.</h1><p>These maps come from the public <code>generateSettlement</code> API. Each biome has a village and a city, with native buildings, flora, field textures and fortifications. The river fixture exercises bridge placement.</p><nav><a href="../../symbols/landscape/index.html">Flora & farms</a><a href="../../symbols/village/index.html">Village art</a><a href="../../symbols/city/index.html">City art</a><a href="../../symbols/infrastructure/index.html">Infrastructure</a><a href="summary.json">Generation counts</a></nav><main>${examples.map(e=>`<article><h2>${e.label}</h2><a href="${e.name}.svg"><img src="${e.name}.png" alt="Generated ${e.label}" loading="lazy"></a><nav><a href="${e.name}.svg">SVG / zoom in</a><a href="${e.name}.geojson">GeoJSON</a></nav></article>`).join('')}</main></html>`);
console.log(`Review: ${out}index.html`);
