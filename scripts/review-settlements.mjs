import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import sharp from 'sharp';
import { BIOMES, PALETTES, planSettlement, createSettlementModel, renderSettlement } from '../dist/index.js';
const out = new URL('../output/appearance-review/', import.meta.url);
await mkdir(new URL('data/',out), { recursive:true });
const base={name:'Appearance review',roadBearings:[20,145,270],port:false,citadel:false,walls:true,plaza:true,temple:true,shanty:false,capital:false};
const fixtures=[];
for(const population of [300,800,2000])for(const seed of [2,7])for(const preset of ['village','city'])fixtures.push({population,seed,preset});
const biomes=process.argv.includes('--quick')?['temperate']:BIOMES;
const summary=[], manifest={};
for(const biome of biomes)for(const f of fixtures){
 const start=performance.now(),key=`${biome}-${f.preset}-${f.population}-${f.seed}`;
 const file=new URL(`data/${key}.js`,out);
 let model;
 if(process.argv.includes('--reuse')){
   const source=await readFile(file,'utf8');model=JSON.parse(source.slice(source.indexOf(',')+1,source.lastIndexOf(')')));
 }else{
   model=createSettlementModel({...base,population:f.population,biome},{seed:f.seed,development:{preset:f.preset}});
   await writeFile(file,`globalThis.settlementReviewRegister(${JSON.stringify(key)},${JSON.stringify(model).replaceAll('<','\\u003c')});`);
 }
 const bounds=model.scene.bounds;
 manifest[key]={bounds,radius:Math.max(...Object.values(bounds).map(Math.abs)),
   centreRadius:model.scene.layers.buildings.reduce((r,b)=>Math.max(r,...b.ring.map(p=>Math.max(Math.abs(p.x),Math.abs(p.y)))),30)+25,
   residentialBuildings:model.buildings.filter(b=>b.capacity>0).length,
   buildingsInsideWalls:model.buildings.filter(b=>b.capacity>0 && b.insideWalls).length,
   buildingsOutsideWalls:model.buildings.filter(b=>b.capacity>0 && !b.insideWalls).length,
   residents:model.residents};
 summary.push({biome,...f,operation:process.argv.includes('--reuse')?'load-cached-model':'generate-model',ms:Math.round(performance.now()-start),buildings:model.buildings.length,residents:model.residents});
 console.log(`${key}: ${model.residents.assigned}/${f.population} residents`);
}
const start=performance.now();
const large=planSettlement({...base,population:200000,biome:'temperate'},{seed:2,development:{preset:'city',corePopulation:10000}});
const largeMs=Math.round(performance.now()-start);
await writeFile(new URL('data/city-200000.js',out),`globalThis.settlementReviewRegister("city-200000",${JSON.stringify({scene:large.model.scene}).replaceAll('<','\\u003c')});`);
manifest['city-200000']={centreRadius:large.model.scene.layers.buildings.reduce((r,b)=>Math.max(r,...b.ring.map(p=>Math.max(Math.abs(p.x),Math.abs(p.y)))),30)+25,
 residentialBuildings:large.model.buildings.filter(b=>b.capacity>0).length,
 buildingsInsideWalls:large.model.buildings.filter(b=>b.capacity>0 && b.insideWalls).length,
 buildingsOutsideWalls:large.model.buildings.filter(b=>b.capacity>0 && !b.insideWalls).length,
 residents:large.model.residents};
await writeFile(new URL('city-200000.svg',out),large.svg);
await writeFile(new URL('city-200000.geojson',out),JSON.stringify(large.geojson));
const cityRadius = manifest['city-200000'].centreRadius + 125;
const cityView = renderSettlement(large.model,{width:1400,bounds:{min_x:-cityRadius,min_y:-cityRadius,max_x:cityRadius,max_y:cityRadius}});
await writeFile(new URL('city-200000-city.svg',out),cityView);
await sharp(Buffer.from(cityView)).resize(1400).png().toFile(fileURLToPath(new URL('city-200000.png',out)));
summary.push({biome:'temperate',preset:'city',population:200000,seed:2,operation:'generate-render-export',ms:largeMs,svgBytes:Buffer.byteLength(large.svg),buildings:large.model.buildings.length,residents:large.model.residents});
await writeFile(new URL('metrics.json',out),JSON.stringify(summary,null,2));
const worker=await build({entryPoints:[fileURLToPath(new URL('settlement-review-worker.mjs',import.meta.url))],bundle:true,format:'iife',target:'es2022',write:false});
await writeFile(new URL('worker-source.js',out),`globalThis.settlementReviewWorker=${JSON.stringify(worker.outputFiles[0].text)};`);
await build({entryPoints:[fileURLToPath(new URL('settlement-review-client.mjs',import.meta.url))],bundle:true,format:'iife',target:'es2022',outfile:fileURLToPath(new URL('review.js',out))});
const selects=(id,label,values)=>`<label>${label}<select id="${id}">${values.map(([value,text])=>`<option value="${value}">${text}</option>`).join('')}</select></label>`;
await writeFile(new URL('index.html',out),`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Settlement density review</title>
<style>body{font:16px system-ui;margin:24px;background:#f5f4ef;color:#282b28}h1{font-size:28px}p{max-width:1000px}.controls{display:flex;flex-wrap:wrap;gap:16px;margin:24px 0;position:sticky;top:0;background:#f5f4ef;padding:12px 0;z-index:1}label{display:grid;gap:5px}select{font:inherit;padding:7px}.maps{display:grid;grid-template-columns:1fr 1fr;gap:28px 20px}figure{margin:0;min-width:0}figcaption{font-weight:600;margin-bottom:8px}img{width:100%;aspect-ratio:1;object-fit:contain;background:#e3e3df;border:1px solid #c9cbc6}.stats,.scale{font-size:13px;margin:5px 0}.shortage{color:#a52222;font-weight:bold}.scale{color:#535953}.large img{aspect-ratio:auto;max-height:800px}a{color:#285c67}code{background:#e6e5de;padding:2px 4px}@media(max-width:700px){body{margin:12px}.maps{grid-template-columns:1fr}.controls{position:static}}.map-button{padding:0;border:0;background:transparent;width:100%;cursor:zoom-in}.map-button:disabled{cursor:wait}.map-button img{display:block}dialog{width:min(1100px,92vw);max-height:95vh;border:1px solid #aaa;background:#f5f4ef}dialog::backdrop{background:#0009}.viewer-controls{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.viewer-controls button{font:inherit;padding:8px}#viewer-map{width:100%;height:70vh;aspect-ratio:auto;object-fit:contain}</style>
<h1>Settlement density review</h1><p>One physical model, shared artwork and landscape, with compact city blocks or dispersed village plots. Compare 300, 800 and 2,000 residents using two seeds. City buildings accommodate more residents; total population stays the same.</p>
<div class="controls">${selects('biome','Biome',biomes.map(b=>[b,b]))}${selects('theme','Theme',['natural',...Object.keys(PALETTES)].map(t=>[t,t]))}${selects('view','View',[['centre','Settlement centres · equal scale'],['equal','Full landscapes · equal scale'],['fit','Fit each landscape separately']])}${selects('population','Population',[['all','All populations'],...[300,800,2000].map(p=>[p,p.toLocaleString('en-GB')])])}${selects('seed','Seed',[['all','Both seeds'],[2,'2'],[7,'7']])}</div>
<p id="status" role="status">Loading settlement plans…</p><div id="maps" class="maps"></div>
<h2>200,000 residents with a 10,000-person walled core</h2><p>Temperate · natural appearance · seed 2. ${large.model.residents.insideWalls.assigned.toLocaleString('en-GB')} assigned inside the walls, ${large.model.residents.outsideWalls.assigned.toLocaleString('en-GB')} outside; ${large.model.residents.unassigned} unassigned. ${large.model.buildings.length.toLocaleString('en-GB')} residential buildings. Generation and export: ${(largeMs/1000).toFixed(2)} seconds on this machine.</p>
<figure class="large"><button id="open-large" class="map-button"><img src="city-200000.png" alt="Explore the large city with a small walled core and mixed-density outskirts" loading="lazy"></button><figcaption>Click to zoom and pan · <a href="city-200000.svg">SVG overview (${(Buffer.byteLength(large.svg)/1e6).toFixed(1)} MB)</a> · <a href="city-200000.geojson">GeoJSON in metres</a> · <a href="metrics.json">All measured results</a></figcaption></figure>
<p>The large-city preview shows the city and adjoining farms at its own scale. Click to explore; Fit in the viewer includes the full agricultural landscape. The SVG overview also includes all farmland.</p>
<dialog id="viewer"><h2 id="viewer-title">Settlement</h2><p id="viewer-summary" class="stats"></p><div class="viewer-controls"><button id="zoom-in">Zoom in</button><button id="zoom-out">Zoom out</button><button id="pan-left">←</button><button id="pan-up">↑</button><button id="pan-down">↓</button><button id="pan-right">→</button><button id="fit-view">Fit</button><a id="download-view">Download view</a><button id="close-viewer">Close</button></div><p id="viewer-status" role="status"></p><img id="viewer-map" alt="Settlement detail"></dialog>
<script>globalThis.settlementReviewManifest=${JSON.stringify(manifest)};globalThis.settlementReviewFixtures=${JSON.stringify(fixtures)};</script><script src="worker-source.js"></script><script src="review.js"></script></html>`);
console.log(`Review: ${fileURLToPath(new URL('index.html',out))}`);
