/** End-to-end review using the compiled public generator, never a separate art renderer. */
import {mkdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {generateSettlement,buildScene} from '../dist/index.js';
import {cityUrbanity} from '../dist/generator/city-character.js';
import {CommonWard} from '../dist/wards/common-ward.js';
const out=fileURLToPath(new URL('../output/art-integration/',import.meta.url));
mkdirSync(out,{recursive:true});
const base={name:'Artwork integration',walls:true,plaza:true,temple:true,port:false,citadel:true,shanty:false,capital:true,roadBearings:[{bearing_deg:18,kind:'main',route_id:'a'},{bearing_deg:142,kind:'town',route_id:'b'},{bearing_deg:267,kind:'local',route_id:'c'}]};
const examples=[];
for(const biome of ['temperate','desert','tundra','tropical','coastal'])for(const population of [300,10000])examples.push({name:`${biome}-${population}`,label:`${biome} / ${population===300?'village':'city'}`,input:{...base,biome,population},seed:2});
examples.push({name:'brook',label:'River village / native bridge decks',input:{...base,name:'Brook',population:300,biome:'temperate',walls:false,roadBearings:[{bearing_deg:135,kind:'main',through:true,route_id:'cross'},{bearing_deg:305,kind:'main',through:true,route_id:'cross'}],rivers:[{centreline:[{x:-900,y:-896},{x:900,y:904}],widthM:2.83}]},seed:3});
for(const population of [50000,100000])examples.push({name:`temperate-${population}`,label:`Temperate / ${population.toLocaleString()} residents`,input:{...base,biome:'temperate',population},seed:2});
examples.push({name:'tropical-rice',label:'Tropical river village / rice paddies',input:{...base,population:300,biome:'tropical',rivers:[{centreline:[{x:-500,y:90},{x:500,y:90}],widthM:6}]},seed:2});
const summary=[];
for(const e of examples){
  const r=generateSettlement(e.input,{seed:e.seed});
  let character;
  if(r.kind==='settlement'){
    const bands=[{name:'centre',min:.7,max:1.01},{name:'middle',min:.3,max:.7},{name:'edge',min:0,max:.3}].map(b=>{
      const patches=r.model.patches.filter(p=>p.withinCity&&p.ward instanceof CommonWard&&cityUrbanity(r.model,p)>=b.min&&cityUrbanity(r.model,p)<b.max);
      const roofs=patches.reduce((n,p)=>n+p.ward.geometry.reduce((s,b)=>s+Math.abs(b.square),0),0),land=patches.reduce((n,p)=>n+Math.abs(p.shape.square),0);
      return {name:b.name,wards:patches.length,roofCoverage:land?Number((roofs/land).toFixed(3)):0};
    });
    const scene=buildScene(r.model);
    character={bands,parks:r.model.patches.filter(p=>p.ward?.type==='park').length,greens:scene.layers.greens.length,ruralHomes:r.model.symbols.filter(s=>s.id.startsWith('sm-house')).length,roofColours:[...new Set(r.model.symbols.map(s=>s.materialVariant??0))].length};
  }
  writeFileSync(`${out}/${e.name}.svg`,r.svg);
  writeFileSync(`${out}/${e.name}.geojson`,JSON.stringify(r.geojson));
  await sharp(Buffer.from(r.svg.replace(/var\(--[^,]+,\s*([^\)]+)\)/g,'$1'))).resize({width:1400}).png().toFile(`${out}/${e.name}.png`);
  summary.push({name:e.name,engine:r.kind,...(character?{character}:{}),...(r.kind==='village'?{buildings:r.model.buildings.length,housed:r.model.buildings.reduce((n,b)=>n+b.occupancy,0),fields:r.model.fields.length,plants:r.model.vegetation.length,bridges:r.model.bridges.length,gates:r.model.wall?.gates.length??0}:{buildings:r.model.countOrdinaryBuildingsPublic(),glyphs:r.model.symbols.filter(s=>s.building).length})});
  console.log(`Rendered ${e.name}`);
}
writeFileSync(`${out}/summary.json`,JSON.stringify(summary,null,2));
writeFileSync(`${out}/index.html`,`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Settlemaker integrated artwork</title><style>body{margin:30px;background:#f5f2ea;color:#33262e;font:16px system-ui}h1{font:36px Georgia,serif}p{max-width:850px;line-height:1.6}a{color:#426677}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(420px,1fr));gap:24px}article{background:white;border:1px solid #d0cabf;padding:16px;border-radius:8px}img{width:100%;max-height:680px;object-fit:contain}h2{font:24px Georgia,serif}nav{display:flex;gap:16px;flex-wrap:wrap;margin:20px 0}</style><h1>The artwork, inside the generator.</h1><p>These maps come from the public <code>generateSettlement</code> API. Each biome has a village and a city, with native buildings, flora, field textures and fortifications. The river fixtures show bridges and tropical paddies. Larger cities demonstrate denser centres and greener outskirts.</p><nav><a href="../../symbols/greens/index.html">Biome greens</a><a href="../art-refinement-before/index.html">Previous version</a><a href="../../symbols/landscape/index.html">Flora & farms</a><a href="../../symbols/village/index.html">Village art</a><a href="../../symbols/city/index.html">City art</a><a href="../../symbols/infrastructure/index.html">Infrastructure</a><a href="summary.json">Generation counts</a></nav><main>${examples.map(e=>`<article><h2>${e.label}</h2><a href="${e.name}.svg"><img src="${e.name}.png" alt="Generated ${e.label}" loading="lazy"></a><nav><a href="${e.name}.svg">SVG / zoom in</a><a href="${e.name}.geojson">GeoJSON</a></nav></article>`).join('')}</main></html>`);
console.log(`Review: ${out}index.html`);
