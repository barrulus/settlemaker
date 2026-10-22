/** Author the city SVG library and its portable visual review. No runtime changes.
 * Run from this worktree: node scripts/build-city-symbols.mjs
 * Coordinates describe ROOF INK, not a nominal metre-sized parcel.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { medievalHousing, housingForms, housingVariantCount } from './art/medieval-housing.mjs';
import { medievalCommerce, commerceForms } from './art/medieval-commerce.mjs';
import { medievalUrban, urbanForms } from './art/medieval-urban.mjs';
import { medievalLandmark } from './art/medieval-landmarks.mjs';
import { desertRoof } from './art/medieval-desert.mjs';
import { tropicalRoof } from './art/medieval-tropical.mjs';
import { tundraRoof, finishTundra } from './art/medieval-tundra.mjs';
import { coastalRoof } from './art/medieval-coastal.mjs';
import { landmarkFamilies, compoundLayouts, writeCompounds } from './art/city-landmarks.mjs';

const out = fileURLToPath(new URL('../symbols/city/', import.meta.url));
mkdirSync(`${out}/individual`, { recursive: true });
const biomes = {
  temperate: { roof: '#858e9f', light: '#aab2bd', wall: '#d6d5d0', accent: '#a16c70', ground: '#c4b597', description: 'Clay tile, slate and shingle housing; softened eaves, varied ridges and chimney stacks' },
  desert: { roof: '#d8cbb6', light: '#f0e6d4', wall: '#b5aaa0', accent: '#6c9c9e', ground: '#d9c48f', description: 'Limewashed roof terraces, parapets, cisterns and shade screens' },
  tundra: { roof: '#7d8589', light: '#a4adb0', wall: '#c5c4b9', accent: '#91806d', ground: '#e6ecef', description: 'Timber shingles, irregular snow banks and snow-capped towers with shared sunlight' },
  tropical: { roof: '#a26d57', light: '#c89474', wall: '#d4d9cf', accent: '#648f88', ground: '#6d9e5c', description: 'Hipped fired-tile roofs, raised ridge vents and covered galleries' },
  coastal: { roof: '#84918d', light: '#b2b9ad', wall: '#d0c8b5', accent: '#99866d', ground: '#cfd6b0', description: 'Weathered shingles, timber ridge caps and modest loading dormers' },
};
// Bounds are exact outer paint envelopes; outlines are inset by half their width.
// Each rectangular roof panel is independently legible; no filled courtyard plate.
const families = [
  { key:'row-house-a', label:'Row house / ridge', bounds:[16,8,48,56], panels:[[16,8,48,56]], join:['west','east'], tags:['dwelling'], floors:[2,3], detail:'house' },
  { key:'row-house-b', label:'Row house / cross ridge', bounds:[16,8,48,56], panels:[[16,8,48,56,'x']], join:['west','east'], tags:['dwelling'], floors:[2,3], detail:'house' },
  { key:'shop-house', label:'Shop house', bounds:[16,8,48,56], panels:[[16,8,48,56]], join:['west','east'], tags:['dwelling','shop'], floors:[2,4], detail:'shop' },
  { key:'tenement', label:'Tenement', bounds:[8,8,56,56], panels:[[8,8,32,56],[32,8,56,56]], join:['west','east'], tags:['dwelling','multi-household'], floors:[3,5], detail:'tenement' },
  { key:'terrace', label:'Three-bay terrace', bounds:[2,8,62,56], panels:[[2,8,22,56],[22,8,42,56],[42,8,62,56]], join:['west','east'], tags:['dwelling','aggregate'], floors:[2,4], bays:3, detail:'terrace' },
  { key:'corner', label:'Corner / L wing', bounds:[8,8,56,56], panels:[[8,8,56,24,'x'],[8,24,24,56]], tags:['dwelling','corner'], floors:[2,4], detail:'corner' },
  { key:'courtyard-u', label:'Open court / U wings', bounds:[4,4,60,60], panels:[[4,4,60,20,'x'],[4,20,20,60],[44,20,60,60]], holes:[[20,20,44,60]], tags:['dwelling','courtyard'], floors:[2,4], detail:'court' },
  { key:'courtyard', label:'Perimeter court', bounds:[4,4,60,60], panels:[[4,4,60,18,'x'],[4,18,18,46],[46,18,60,46],[4,46,27,60,'x'],[37,46,60,60,'x']], holes:[[18,18,46,46],[27,46,37,60]], tags:['dwelling','courtyard','aggregate'], floors:[3,5], detail:'court' },
  { key:'inn', label:'Coaching inn / passage', bounds:[2,2,62,62], panels:[[2,2,62,20,'x'],[2,20,19,44],[45,20,62,44],[2,44,27,62,'x'],[37,44,62,62,'x']], holes:[[19,20,45,44],[27,44,37,62]], tags:['inn','courtyard','landmark'], floors:[2,4], detail:'inn' },
  { key:'workshop', label:'Workshop / rear shed', bounds:[8,8,56,56], panels:[[8,8,56,27,'x'],[8,27,56,56,'x']], join:['west','east'], tags:['workshop'], floors:[1,2], detail:'workshop' },
  { key:'warehouse', label:'Warehouse / loading dormers', bounds:[6,4,58,60], panels:[[6,4,32,60],[32,4,58,60]], join:['west','east'], tags:['warehouse','harbour'], floors:[2,4], detail:'warehouse' },
  { key:'guildhall', label:'Guildhall / lantern', bounds:[4,8,60,56], panels:[[4,8,60,56,'x']], tags:['civic','guildhall','landmark'], floors:[2,3], detail:'guildhall' },
  { key:'bathhouse', label:'Bathhouse / roof vents', bounds:[8,8,56,56], panels:[[8,8,56,56,'x']], tags:['civic','bathhouse'], floors:[1,2], detail:'bathhouse' },
  { key:'market-hall', label:'Covered market', bounds:[2,12,62,52], panels:[[2,12,62,52,'x']], tags:['market','commercial'], floors:[1,2], detail:'market' },
  ...landmarkFamilies,
];
const roofStyles={temperate:medievalHousing,desert:desertRoof,tundra:tundraRoof,tropical:tropicalRoof,coastal:coastalRoof};

function glyph(f,biome,variant=0) {
  const roof=roofStyles[biome];
  let art=housingForms.has(f.key)?roof(f,variant)
    :commerceForms.has(f.key)?medievalCommerce(f,{roof})
    :urbanForms.has(f.key)?medievalUrban(f,{roof})
    :medievalLandmark(f,{roof});
  if(biome==='tundra')art=finishTundra(f,art);
  if(biome==='temperate')return art;
  // Shared family details retain regional material tokens, including standalone
  // SVG fallback paints. Roof primitives already supply their own biome paints.
  const regional=markup=>markup.replace(/var\(--sm-city-temperate-(roof|light|wall|accent),[^)]*\)/g,
    (_,role)=>`var(--sm-city-${biome}-${role}, ${biomes[biome][role]})`);
  return {body:regional(art.body),sil:regional(art.sil)};
}

const assets={}, symbols={}, housingVariants={};
for(const biome of Object.keys(biomes)) for(const f of families) {
  const id=`sm-city-${f.key}${biome==='temperate'?'':`--${biome}`}`;
  assets[id]=glyph(f,biome);
  if(housingForms.has(f.key))housingVariants[id]=Array.from({length:housingVariantCount},(_,i)=>glyph(f,biome,i));
  const [x0,y0,x1,y1]=f.bounds;
  symbols[id]={cls:'fixed',viewBox:[0,0,64,64],anchor:[32,32],zBand:'structure',rotation:'free',
    biome,family:f.key,category:f.category??'urban',tags:f.tags,inkBounds:f.bounds,footprintPolygons:f.panels.map(([a,b,c,d])=>[[a,b],[c,b],[c,d],[a,d]]),
    courtyardVoids:f.holes??[],frontVector:[0,1],frontageEdge:[[x0,y1],[x1,y1]],
    joins:f.join??f.joins??[],repeatPitch:(f.join??f.joins)?.includes('west')?[x1-x0,0]:(f.join??f.joins)?.includes('north')?[0,y1-y0]:null,storeys:f.floors,
    representedBuildings:['inn','courtyard-u'].includes(f.key)?f.panels.length:f.bays??(f.tags.includes('aggregate')?null:1),
    requires:{adjacency:['road']},silhouette:`${id}-sil`,
  };
}
writeFileSync(`${out}/housing-variants.json`,JSON.stringify(housingVariants)+'\n');
const wrap=(body,attrs='')=>`<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>\n`;
const defs=Object.entries(assets).map(([id,a])=>`<symbol id="${id}" viewBox="0 0 64 64">${a.body}</symbol>\n<symbol id="${id}-sil" viewBox="0 0 64 64">${a.sil}</symbol>`).join('\n');
writeFileSync(`${out}/symbols.svg`,wrap(defs,'width="0" height="0" aria-hidden="true"'));
for(const [id,a] of Object.entries(assets)) {
  writeFileSync(`${out}/individual/${id}.svg`,wrap(`<title>${id}</title>${a.body}`,'viewBox="0 0 64 64" width="64" height="64"'));
  writeFileSync(`${out}/individual/${id}-sil.svg`,wrap(a.sil,'viewBox="0 0 64 64" width="64" height="64"'));
}
writeFileSync(`${out}/symbols.json`,JSON.stringify({format:'settlemaker-city-symbols-v1',units:'SVG art units; physical size is supplied by the placer',
  shadow:{offset:[2.6,3.6],opacity:.2,color:'#46303c'},biomes,
  tokens:{'--sm-city-roof-ink':'#68574b','--sm-city-tundra-snow-shade':'#d6e1e6',...Object.fromEntries(Object.entries(biomes).flatMap(([b,p])=>['roof','light','wall','accent'].map(k=>[`--sm-city-${b}-${k}`,p[k]])))},symbols},null,2)+'\n');

const use=(key,b,x,y,s=1,rotation=0,shadow=false)=>{
  const id=`sm-city-${key}${b==='temperate'?'':`--${b}`}${shadow?'-sil':''}`;
  return `<g transform="translate(${x},${y}) rotate(${rotation}) scale(${s}) translate(-32,-32)"><use href="#${id}" width="64" height="64"/></g>`;
};
const placed=(items,b)=>`<g transform="translate(2.6,3.6)" color="#46303c" opacity=".2">${items.map(p=>use(p[0],b,...p.slice(1),true)).join('')}</g>${items.map(p=>use(p[0],b,...p.slice(1),false)).join('')}`;
const text=(x,y,t,size=14,color='#403c44')=>`<text x="${x}" y="${y}" fill="${color}" font-family="sans-serif" font-size="${size}">${t}</text>`;

function catalogue(selected,name,title) {
  const height=215+selected.length*121;
  let sheet=`<defs>${defs}</defs><rect width="1180" height="${height}" fill="#f5f2ea"/>${text(32,42,title,26)}${text(32,70,`${selected.length} forms · 5 biome families · editable vectors · matching silhouettes`)}`;
  Object.entries(biomes).forEach(([b,p],i)=>{
    const x=258+i*182;
    sheet+=text(x,110,b.toUpperCase(),13);
    selected.forEach((f,j)=>{
      const y=145+j*121;
      if(i===0) sheet+=text(32,y+49,f.label,13);
      sheet+=`<rect x="${x-9}" y="${y}" width="151" height="108" rx="5" fill="${p.ground}" opacity=".5"/>`;
      sheet+=placed([[f.key,x+65,y+52,1.4,0]],b);
    });
  });
  sheet+=text(32,height-25,'Roof and courtyard geometry stays distinct. All shadows share one world-space direction.',13);
  writeFileSync(`${out}/${name}.svg`,wrap(sheet,`viewBox="0 0 1180 ${height}" width="1180" height="${height}"`));
}
catalogue(families,'catalogue','SETTLEMAKER / CITY ARCHITECTURE');
catalogue(families.filter(f=>f.category==='faith'),'religious','CITY / RELIGIOUS BUILDINGS');
catalogue(families.filter(f=>f.category==='palace'),'palace-kit','CITY / PALACE COMPONENTS');
catalogue(families.filter(f=>f.category==='castle'),'castle-kit','CITY / CASTLE COMPONENTS');
writeCompounds(out,biomes,assets,symbols,wrap,text);

let blocks=`<defs>${defs}</defs><rect width="1180" height="1510" fill="#f5f2ea"/>${text(32,42,'CITY KIT / ASSEMBLY STUDIES',26)}${text(32,70,'Same modules and pitch in every biome. Street at the bottom; shared walls align at the roof envelope.')}`;
Object.entries(biomes).forEach(([b,p],i)=>{
  const y=110+i*272;
  blocks+=text(32,y+16,b.toUpperCase(),14)+text(32,y+40,p.description,13);
  blocks+=`<rect x="32" y="${y+56}" width="1116" height="184" rx="6" fill="${p.ground}"/><path d="M32,${y+211}H1148" stroke="#d9d3c6" stroke-width="36"/>`;
  const row=[];
  for(let j=0;j<6;j++) {
    row.push([j%3===1?'shop-house':j%3===2?'row-house-b':'row-house-a',74+j*32,y+169,1,0]);
    row.push([j%2?'row-house-b':'row-house-a',74+j*32,y+121,1,180]);
  }
  blocks+=placed(row,b)+text(49,y+257,'Joined rows / back-to-back',12);
  // Four L wings on a 48-unit pitch: edges touch, central court stays open.
  const court=[['corner',344,y+121,1,0],['corner',392,y+121,1,90],['corner',392,y+169,1,180],['corner',344,y+169,1,270]];
  blocks+=placed(court,b)+text(320,y+257,'Four-wing court',12);
  blocks+=placed([['courtyard',504,y+142.6,1.8,0],['inn',658,y+139,1.8,0]],b)+text(451,y+257,'Perimeter housing',12)+text(605,y+257,'Inn with open passage',12);
  blocks+=placed([['warehouse',797,y+151,1.5,0],['workshop',889,y+157,1.5,0],['guildhall',1048,y+147.4,1.9,0]],b);
  blocks+=text(757,y+257,'Warehouse + workshop',12)+text(1000,y+257,'Guildhall',12);
});
writeFileSync(`${out}/assemblies.svg`,wrap(blocks,'viewBox="0 0 1180 1510" width="1180" height="1510"'));

const data=JSON.stringify({assets,symbols,biomes,families,compoundLayouts});
writeFileSync(`${out}/index.html`,`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Settlemaker city glyphs</title>
<style>*{box-sizing:border-box}body{margin:0;background:#f5f2ea;color:#33262e;font:15px system-ui,sans-serif}main{max-width:1280px;margin:auto;padding:36px}h1{font:36px Georgia,serif;margin:8px 0 12px}p{max-width:850px;line-height:1.6}nav{display:flex;gap:16px;flex-wrap:wrap;align-items:center;margin:24px 0}a{color:#425f70}select,input,button{font:inherit}select{padding:8px;border:1px solid #b7b0a9;border-radius:4px;background:white}#grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px}.card{border:1px solid #d2ccc4;border-radius:6px;overflow:hidden;background:#fffdf8}.art{display:grid;place-items:center;height:172px}.art svg{width:144px;height:144px}.caption{padding:16px}.caption strong{display:block;margin-bottom:8px}.caption a{font-size:12px}.small{color:#685e67;font-size:13px}#assembly{width:100%;height:auto}#count{margin-left:auto}</style>
<main><div class="small">SETTLEMAKER / VECTOR LIBRARY</div><h1>Architecture for a crowded city.</h1><p>Slate and tile roofs, recessed entrances, party-wall houses and open courts. ${families.length} building forms in five biome families, with softly irregular contours, regional materials and staggered roof courses.</p><nav><label>Biome <select id="biome">${Object.keys(biomes).map(b=>`<option>${b}</option>`).join('')}</select></label><label>Group <select id="category"><option value="all">All buildings</option><option value="urban">Homes and commerce</option><option value="faith">Religious buildings</option><option value="palace">Palace pieces</option><option value="castle">Castle pieces</option></select></label><label><input type="checkbox" id="shadow" checked> Shadows</label><label><input type="checkbox" id="ground" checked> Biome ground</label><span id="count">${families.length*5} glyphs + ${families.length*5} silhouettes</span></nav><p id="description" class="small"></p><div id="grid"></div><h2>Assembled frontages and courts</h2><p class="small">Each row house advances by its exact 32-unit painted width. Courtyard holes reveal the ground underneath. The inn has a ten-unit entrance passage.</p><img id="assembly" src="assemblies.svg" alt="City glyphs assembled into street rows and courtyard blocks across five biomes"><h2>Palaces and castles</h2><p>Complete compounds assembled from the same pieces, with open courts and entrance passages.</p><img style="width:100%" src="compounds.svg" alt="Palace and castle compounds across five biomes"><nav id="compound-downloads"></nav><nav><a href="compounds.json">Component placement recipes</a><a href="../village/index.html">Village building gallery</a><a href="catalogue.svg">Full SVG catalogue</a><a href="assemblies.svg">Street studies</a><a href="religious.svg">Religious buildings</a><a href="palace-kit.svg">Palace pieces</a><a href="castle-kit.svg">Castle pieces</a><a href="compounds.svg">Palace and castle assemblies</a><a href="symbols.svg">Symbol sprite</a><a href="../infrastructure/index.html">Walls, bridges and henges</a><a href="../landscape/index.html">Flora and farms</a><a href="symbols.json">Placement manifest</a><a href="integration.md">Integration notes</a></nav></main>
<script>const data=${data};function render(){const biome=document.querySelector('#biome').value,p=data.biomes[biome];document.querySelector('#compound-downloads').innerHTML=data.compoundLayouts.map(c=>'<a href="compounds/sm-city-'+c.key+(biome==='temperate'?'':'--'+biome)+'.svg" download>'+c.label+' / '+biome+' SVG</a>').join('');document.querySelector('#description').textContent=p.description;document.querySelector('#grid').innerHTML=data.families.filter(f=>document.querySelector('#category').value==='all'||(f.category??'urban')===document.querySelector('#category').value).map(f=>{const id='sm-city-'+f.key+(biome==='temperate'?'':'--'+biome),a=data.assets[id];return '<article class="card"><div class="art" style="background:'+(document.querySelector('#ground').checked?p.ground:'#eee9df')+'"><svg viewBox="0 0 72 72"><g transform="translate(4,4)">'+(document.querySelector('#shadow').checked?'<g transform="translate(2.6,3.6)" opacity=".2" color="#46303c">'+a.sil+'</g>':'')+a.body+'</g></svg></div><div class="caption"><strong>'+f.label+'</strong><a href="individual/'+id+'.svg" download>Download SVG</a> · <a href="individual/'+id+'-sil.svg" download>Silhouette</a></div></article>'}).join('')}document.querySelectorAll('select,input').forEach(el=>el.addEventListener('change',render));render();</script></html>\n`);
console.log(`Wrote ${Object.keys(assets).length} city glyphs, matching silhouettes, manifest and visual catalogue to ${out}`);
