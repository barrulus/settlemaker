import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import sharp from 'sharp';
import {biomes,floraCatalog,flora,svg,xml} from './art/landscape.mjs';
import {farmCatalog,fieldTile,farmParcel,parcelForms} from './art/farms.mjs';

const out=fileURLToPath(new URL('../symbols/landscape/',import.meta.url));
mkdirSync(`${out}/individual`,{recursive:true});
const seeds=[11,42,74],variants='abc',assets={},manifest={};
const label=s=>s.replaceAll('-',' ');
const title=(x,y,s,size=14)=>`<text x="${x}" y="${y}" fill="#403c44" font-family="sans-serif" font-size="${size}">${xml(s)}</text>`;
const doc=(s,w,h)=>`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${s}</svg>\n`;
const bg=(x,y,w,h,c)=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${c}"/>`;
const show=(a,x,y,s=1)=>`<g transform="translate(${x},${y}) scale(${s})">${a.body}</g>`;
const fallback=s=>s.replace(/var\(--[^,]+,\s*([^\)]+)\)/g,'$1');
async function save(id,a){
  assets[id]=a;const{body,...meta}=a;
  if(a.cls==='pattern')meta.inkBounds=[0,0,32,32];
  else{
    const [,,w,h]=a.viewBox;
    const rendered=doc(`<g transform="translate(4,4)">${body}</g>`,w+8,h+8);
    const{data,info}=await sharp(Buffer.from(fallback(rendered))).resize((w+8)*3,(h+8)*3).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    let x0=info.width,y0=info.height,x1=0,y1=0;
    for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++)if(data[(y*info.width+x)*4+3]){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x+1);y1=Math.max(y1,y+1);}
    meta.inkBounds=[x0/3-4,y0/3-4,x1/3-4,y1/3-4].map(v=>Number(v.toFixed(3)));
  }
  manifest[id]=meta;writeFileSync(`${out}/individual/${id}.svg`,svg(a,{title:label(id)})+'\n');
}
for(const b of Object.keys(biomes)){
  for(const spec of floraCatalog[b])for(let v=0;v<3;v++)for(const winter of b==='tundra'?[false,true]:[false]){
    const id=`sm-flora-${spec.kind}-${variants[v]}${winter?'-snow':''}--${b}`;
    await save(id,flora(b,spec.kind,{seed:seeds[v],winter}));
  }
  for(const spec of farmCatalog[b]){
    await save(`sm-field-${spec.kind}--${b}`,fieldTile(b,spec.kind));
    for(const form of Object.keys(parcelForms)){
      const id=`sm-farm-${spec.kind}-${form}--${b}`;
      await save(id,farmParcel(b,spec.kind,{form,angle:form==='riverside'?-16:form==='terrace'?12:0,id}));
    }
  }
}
writeFileSync(`${out}/symbols.svg`,doc(`<defs>${Object.entries(assets).map(([id,a])=>`<symbol id="${id}" viewBox="${a.viewBox.join(' ')}">${a.body}</symbol>`).join('')}</defs>`,0,0));
const tokens=Object.fromEntries(Object.values(assets).flatMap(a=>[...a.body.matchAll(/var\((--[^,]+),\s*([^)]*)\)/g)].map(m=>[m[1],m[2]])));
writeFileSync(`${out}/symbols.json`,JSON.stringify({format:'settlemaker-landscape-v1',description:'Native SVG flora, seamless field textures and irregular farm parcels. Integrated through the shared runtime artwork registry; farm presets remain standalone review assets.',units:'SVG art units unless nominalFootprint (suggested metres)',tokens,biomes,savedSeeds:seeds,counts:{flora:252,field:30,farm:90},symbols:manifest},null,2)+'\n');

for(const b of Object.keys(biomes)){
  let s=bg(0,0,1280,1510,'#f5f2ea')+title(32,42,`${b.toUpperCase()} / FLORA & CULTIVATED LAND`,27)+title(32,70,'Fourteen plant forms, three individual variations. Trees, shrubs and low plants shown at equal review size; world sizes differ.');
  for(let i=0;i<floraCatalog[b].length;i++){
    const spec=floraCatalog[b][i],x=32+i%2*620,y=98+Math.floor(i/2)*139;
    s+=bg(x,y,604,127,biomes[b].ground)+title(x+13,y+25,label(spec.kind),16)+title(x+13,y+49,`${spec.layer} / ${spec.nominalFootprint[0]} m guide`,12);
    const words=spec.site.split(' ');let row='',line=0;
    for(const word of words){if((row+' '+word).length>30){s+=title(x+13,y+72+line++*16,row,11);row=word;}else row+=(row?' ':'')+word;}s+=title(x+13,y+72+line*16,row,11);
    for(let v=0;v<3;v++)s+=show(assets[`sm-flora-${spec.kind}-${variants[v]}--${b}`],x+229+v*121,y+14,1.42);
  }
  s+=title(32,1108,b==='tundra'?'SUMMER LAND USE / NATURAL GRAZING + CONDITIONAL FRINGE GARDENS':'FARMING / CROP TEXTURE, HEADLANDS, TRACKS & WATER',19);
  for(let i=0;i<farmCatalog[b].length;i++){
    const spec=farmCatalog[b][i],x=32+i%3*415,y=1128+Math.floor(i/3)*182;
    s+=bg(x,y,398,168,biomes[b].ground)+show(assets[`sm-farm-${spec.kind}-crooked--${b}`],x+99,y+5,1.03)+title(x+12,y+151,label(spec.kind),13);
  }
  writeFileSync(`${out}/${b}.svg`,doc(s,1280,1510));
}
let fields=bg(0,0,1360,1520,'#f5f2ea')+title(32,42,'FIELDS / SEAMLESS SWATCHES',28)+title(32,70,'Each swatch repeats its 32 × 32 SVG tile. Crop direction is independent of the parcel boundary.');
for(const[b,p]of Object.entries(biomes)){
  const row=Object.keys(biomes).indexOf(b),y=110+row*276;fields+=title(32,y,b.toUpperCase(),17);
  farmCatalog[b].forEach((spec,i)=>{const x=32+i*218,a=assets[`sm-field-${spec.kind}--${b}`],id=`sheet-${b}-${i}`;
    fields+=`<defs><pattern id="${id}" width="32" height="32" patternUnits="userSpaceOnUse">${a.body}</pattern></defs><rect x="${x}" y="${y+20}" width="200" height="190" fill="url(#${id})"/>${title(x,y+233,label(spec.kind),12)}${title(x,y+252,spec.natural?'Natural ground':spec.conditional?'Conditional / fringe':spec.irrigation?'Managed water':'Cultivated / managed',11)}`;
  });
}
writeFileSync(`${out}/fields.svg`,doc(fields,1360,1520));
let snowSheet=bg(0,0,1280,1120,'#f5f2ea')+title(32,42,'TUNDRA / GROWING SEASON & SETTLED SNOW',26)+title(32,70,'The same seed in both states. Snow rests on foliage surfaces and cushions; treeline trees remain a conditional option.');
floraCatalog.tundra.forEach((spec,i)=>{const x=32+i%2*620,y=96+Math.floor(i/2)*142;snowSheet+=bg(x,y,604,130,biomes.tundra.ground)+title(x+14,y+28,label(spec.kind),16)+title(x+14,y+50,spec.fringe?'Forest fringe only':spec.layer,12);
  snowSheet+=show(assets[`sm-flora-${spec.kind}-a--tundra`],x+220,y+10,1.45)+show(assets[`sm-flora-${spec.kind}-a-snow--tundra`],x+390,y+10,1.45);
});
writeFileSync(`${out}/tundra-snow.svg`,doc(snowSheet,1280,1120));

// Composition with existing rural artwork to review line weight, palette and scale.
let scenes=bg(0,0,1380,1200,'#f5f2ea')+title(32,42,'RURAL LANDSCAPES / BUILDINGS, PLANTS & WORKED LAND',26)+title(32,70,'Illustrative compositions. Natural plant groups and modest fields leave room for paths and building entrances.');
const scenePlants={temperate:['oak','birch','apple','hawthorn','wood-fern','meadow-flowers'],desert:['date-palm','olive','acacia','thorn-scrub','dry-bunchgrass','succulent-rosette'],tundra:['dwarf-willow','dwarf-birch','crowberry','reindeer-lichen','sedge-tussock','cottongrass'],tropical:['rainforest-canopy','coconut-palm','banana','understory-shrub','tree-fern','broadleaf-fern'],coastal:['windswept-pine','windthorn','sheltered-apple','sea-buckthorn','marram-grass','sea-thrift']};
for(const[b,p]of Object.entries(biomes)){
  const i=Object.keys(biomes).indexOf(b),x=32+i%2*678,y=103+Math.floor(i/2)*356;
  scenes+=bg(x,y,658,334,p.ground)+title(x+18,y+28,b.toUpperCase(),16);
  const spec=farmCatalog[b][b==='tundra'?0:b==='tropical'?0:3],a=farmParcel(b,spec.kind,{id:`scene-${b}`,form:'riverside',seed:42});
  scenes+=show(a,x+277,y+64,2.08);
  scenes+=`<path d="M${x+70},${y+330}Q${x+177},${y+208} ${x+449},${y+310}" fill="none" stroke="${p.dry}" stroke-width="13" stroke-linecap="round"/>`;
  if(spec.irrigation)scenes+=`<path d="M${x+658},${y+128}H${x+277+a.waterInlet[0]*2.08}" fill="none" stroke="${p.water}" stroke-width="5"/>`;
  const houseId=`sm-house${b==='temperate'?'':`--${b}`}`,source=readFileSync(`${out}/../village/individual/${houseId}.svg`,'utf8').replace(/^.*?<svg[^>]*>/s,'').replace(/<\/svg>\s*$/,'');
  scenes+=`<g transform="translate(${x+137},${y+146}) scale(1.55)">${source}</g>`;
  const spots=[[30,59,1.6],[146,39,1.25],[219,112,1],[40,157,.82],[109,260,.42],[245,272,.36],[55,242,.45]];
  spots.forEach(([X,Y,S],j)=>{const k=scenePlants[b][j%6],plant=flora(b,k,{seed:seeds[j%3]});const scale=b==='tundra'?S*.55:S;scenes+=show(plant,x+X,y+Y,scale);});
  scenes+=title(x+16,y+318,b==='tundra'?'Low tundra plants / natural summer grazing':spec.irrigation?'Cultivation connected to a water supply':'Sheltered rural plots / open paths',12);
}
scenes+=title(748,894,'Designed as a landscape kit',26)+title(748,932,'252 flora SVGs / 70 plant forms / three seeds',17)+title(748,963,'30 seamless field tiles / 90 irregular farm plots',17)+title(748,1005,'No cast shadows on plants or fields.',15)+title(748,1034,'Use habitat notes to select suitable locations.',15)+title(748,1063,'Live variants and individual downloads in the gallery.',15);
writeFileSync(`${out}/scenes.svg`,doc(scenes,1380,1200));

const bundle=await build({entryPoints:[fileURLToPath(new URL('./art/landscape-gallery.mjs',import.meta.url))],bundle:true,write:false,platform:'browser',format:'iife',target:'es2022',minify:true});
writeFileSync(`${out}/index.html`,`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Settlemaker flora & farms</title><style>
*{box-sizing:border-box}body{margin:0;background:#f5f2ea;color:#33262e;font:15px system-ui,sans-serif}main{max-width:1400px;margin:auto;padding:32px}h1{font:42px Georgia,serif;margin:12px 0}h2{font:27px Georgia,serif}p{max-width:930px;line-height:1.6}a{color:#3b6672}nav,.controls{display:flex;gap:18px;flex-wrap:wrap;align-items:center;margin:22px 0}.small{font-size:13px;color:#625e57}select,input,button{font:inherit}select,button,input[type=number]{padding:9px;border:1px solid #b8b4a9;border-radius:5px;background:#fffdf8}button{cursor:pointer}input[type=number]{width:110px}.live-wrap{display:grid;grid-template-columns:minmax(260px,1fr) 1fr;gap:24px;background:#eae6dc;border-radius:8px;padding:20px}#live{min-height:270px;display:grid;place-items:center;border-radius:5px;padding:10px}#live svg{height:270px;max-width:100%;width:auto}#site{font-size:17px}#grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(390px,1fr));gap:18px}article{background:#fffdf8;border:1px solid #d4cfc4;border-radius:7px;overflow:hidden}.art{padding:12px;display:flex;justify-content:space-around;align-items:center;gap:8px}.sample{min-width:0;text-align:center;flex:1}.sample svg{width:100%;height:130px}.sample a{display:block;font-size:12px;margin:5px}.caption{padding:15px}.caption h3{font:20px Georgia,serif;margin:0 0 8px}.caption p{font-size:13px;margin:6px 0}[hidden]{display:none!important}@media(max-width:720px){main{padding:18px}.live-wrap{grid-template-columns:1fr}#grid{grid-template-columns:1fr}h1{font-size:34px}}:focus-visible{outline:3px solid #487987;outline-offset:3px}</style>
<main><div class="small">SETTLEMAKER / FLORA & FARMING</div><h1>A richer landscape around the village.</h1><p>Seventy plant forms across five biomes, with three saved variations each and a separate tundra snow set. Thirty seamless field textures and ninety farm parcels add orchards, gardens, grazing and cultivated land.</p><nav><a href="scenes.svg">Rural compositions</a><a href="fields.svg">Field swatches</a><a href="tundra-snow.svg">Tundra snow</a><a href="integration.md">Placement & habitat notes</a><a href="symbols.json">Manifest</a></nav>
<div class="controls"><label>Biome <select id="biome"></select></label><label>Library <select id="category"><option value="flora">Plants</option><option value="field">Seamless fields</option><option value="farm">Farm plots</option></select></label><label>Form <select id="kind"></select></label></div>
<div class="live-wrap"><div id="live"></div><div><h2 id="live-title"></h2><p id="site"></p><p id="details" class="small"></p><div class="controls"><label>Variation seed <input id="seed" type="number" min="0" max="4294967295" value="11"></label><button id="next">Next variation</button><label id="snow-control"><input type="checkbox" id="snow"> Settled snow</label></div><div class="controls"><label id="form-control">Parcel <select id="form"><option>crooked</option><option>riverside</option><option>terrace</option></select></label><label id="angle-control">Crop direction <input type="range" id="angle" min="-90" max="90" value="0"></label></div><button id="download">Download this SVG</button><p class="small" id="download-note"></p></div></div>
<h2>Saved library <span class="small" id="count"></span></h2><div id="grid"></div><nav>${Object.keys(biomes).map(b=>`<a href="${b}.svg">${b} sheet</a>`).join('')}<a href="../village/index.html">Village buildings</a><a href="../city/index.html">City buildings</a><a href="../infrastructure/index.html">Walls, bridges & henges</a></nav><p class="small">Editable native SVG. This is an artwork library; automatic map selection and placement remain a separate integration step. Habitat labels describe suitable sites, not a claim that every species occurs in every region of a biome.</p></main><script>${bundle.outputFiles[0].text}</script></html>`);
console.log(`Wrote ${Object.keys(assets).length} landscape assets: 252 flora, 30 seamless fields, 90 farm plots; eight review sheets and a live gallery.`);
