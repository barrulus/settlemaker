import {mkdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {build} from 'esbuild';
import {palettes,wallKinds,bridgeKinds,hengeKinds,wall,bridge,henge,svg} from './art/infrastructure.mjs';

const out=fileURLToPath(new URL('../symbols/infrastructure/',import.meta.url));
mkdirSync(`${out}/individual`,{recursive:true});
mkdirSync(`${out}/examples`,{recursive:true});
const assets={},manifest={};
const suffix=b=>b==='temperate'?'':`--${b}`;
const title=s=>s.replaceAll('-',' ');
const fallback=s=>s.replace(/var\(--[^,]+,\s*([^\)]+)\)/g,'$1');
const doc=(body,w,h)=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${body}</svg>\n`;
const text=(x,y,s,size=14)=>`<text x="${x}" y="${y}" fill="#403c44" font-family="sans-serif" font-size="${size}">${s}</text>`;
const show=(a,x,y,s=1,ground=false)=>`<g transform="translate(${x},${y}) scale(${s})">${ground?`<rect width="${a.viewBox[2]}" height="${a.viewBox[3]}" fill="${palettes[a.biome].ground}"/>`:''}<g transform="translate(2.6,3.6)" color="#46303c" opacity=".2">${a.sil}</g>${a.body}</g>`;
const curved=Array.from({length:33},(_,i)=>{const a=i/32;return[12+78*Math.sin(a),48+78*(1-Math.cos(a))];});
const wave=Array.from({length:41},(_,i)=>{const t=i/40,u=1-t;return[12*u*u*u+3*48*u*u*t+3*80*u*t*t+116*t*t*t,60*u*u*u+3*8*u*u*t+3*88*u*t*t+36*t*t*t];});
const wallPaths={straight:[[12,48],[116,48]],bend:curved,'s-curve':wave};
const seeds=[11,42,74];

async function save(id,a){
  assets[id]=a;
  const [,,w,h]=a.viewBox;
  const padded=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="-8 -8 ${w+16} ${h+16}" width="${(w+16)*4}" height="${(h+16)*4}">${a.body}${a.sil}</svg>`;
  const {data,info}=await sharp(Buffer.from(fallback(padded))).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  let x0=info.width,y0=info.height,x1=0,y1=0;
  for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++)if(data[(y*info.width+x)*4+3]){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x+1);y1=Math.max(y1,y+1);}
  const {body,sil,...meta}=a;
  manifest[id]={...meta,cls:'fixed',zBand:'structure',units:'SVG art units',inkBounds:[x0/4-8,y0/4-8,x1/4-8,y1/4-8],silhouette:`${id}-sil`};
  writeFileSync(`${out}/individual/${id}.svg`,svg(a,{shadow:false,title:id})+'\n');
  writeFileSync(`${out}/individual/${id}-sil.svg`,svg({...a,body:a.sil},{shadow:false})+'\n');
}
for(const b of Object.keys(palettes)){
  for(const kind of wallKinds)for(const[form,points]of Object.entries(wallPaths)){
    const a=wall(points,{biome:b,kind});a.viewBox=[0,0,128,96];a.anchor=[64,48];a.form=form;
    a.connectors=[{at:points[0],tangent:[1,0]}, {at:points.at(-1),tangent:null}];
    for(const[j,k]of [[0,1],[points.length-1,points.length-2]]){const v=j===0?[points[k][0]-points[j][0],points[k][1]-points[j][1]]:[points[j][0]-points[k][0],points[j][1]-points[k][1]],l=Math.hypot(...v);a.connectors[j===0?0:1].tangent=v.map(x=>x/l);}
    await save(`sm-wall-${kind}-${form}${suffix(b)}`,a);
  }
  for(const kind of bridgeKinds)await save(`sm-bridge-${kind}${suffix(b)}`,bridge(kind,{biome:b,length:kind.includes('multispan')||kind.includes('trestle')?96:kind.includes('footbridge')?48:64}));
  for(const kind of hengeKinds)for(let i=0;i<seeds.length;i++)await save(`sm-henge-${kind}-${'abc'[i]}${suffix(b)}`,henge(kind,{biome:b,seed:seeds[i]}));
}
const definitions=Object.entries(assets).map(([id,a])=>`<symbol id="${id}" viewBox="${a.viewBox.join(' ')}">${a.body}</symbol><symbol id="${id}-sil" viewBox="${a.viewBox.join(' ')}">${a.sil}</symbol>`).join('');
writeFileSync(`${out}/symbols.svg`,doc(definitions,0,0));
const tokens=Object.fromEntries(Object.values(assets).flatMap(a=>[...a.body.matchAll(/var\((--[^,]+),\s*([^)]*)\)/g)].map(m=>[m[1],m[2]])));
writeFileSync(`${out}/symbols.json`,JSON.stringify({format:'settlemaker-infrastructure-v1',tokens,biomes:palettes,shadow:{offset:[2.6,3.6],opacity:.2,color:'#46303c'},symbols:manifest},null,2)+'\n');

// Demonstrate continuous arbitrary boundaries rather than a square tile frame.
const enclosure=[[48,33],[143,16],[238,61],[248,139],[185,210],[57,194],[20,119],[48,33]];
const lengths=enclosure.slice(1).map((p,i)=>Math.hypot(p[0]-enclosure[i][0],p[1]-enclosure[i][1]));
const gateAt=lengths.slice(0,4).reduce((s,n)=>s+n,0)+lengths[4]/2;
let walls=`<rect width="1180" height="1590" fill="#f5f2ea"/>${text(32,42,'WALLS / FOLLOW THE BOUNDARY',26)}${text(32,70,'Continuous strips, arbitrary bearings and real gate gaps. Towers are optional; corners do not set the site shape.')}`;
Object.entries(palettes).forEach(([b,p],i)=>{
  const y=112+i*285;walls+=text(32,y+14,b.toUpperCase(),14);
  wallKinds.forEach((kind,j)=>{
    const x=32+j*378,a=wall(enclosure,{biome:b,kind,gates:[{at:gateAt,width:23}]});a.viewBox=[0,0,280,236];a.anchor=[140,118];
    walls+=`<rect x="${x}" y="${y+28}" width="354" height="225" rx="6" fill="${p.ground}"/>${show(a,x+38,y+27,.93)}${text(x+10,y+273,title(kind),13)}`;
    writeFileSync(`${out}/examples/wall-${kind}${suffix(b)}.svg`,svg(a,{title:`Irregular ${kind} enclosure / ${b}`})+'\n');
    const {body,sil,...meta}=a;
    const xs=enclosure.map(p=>p[0]),ys=enclosure.map(p=>p[1]);
    writeFileSync(`${out}/examples/wall-${kind}${suffix(b)}.json`,JSON.stringify({...meta,units:'SVG art units',inkBounds:[Math.min(...xs)-a.width/2,Math.min(...ys)-a.width/2,Math.max(...xs)+a.width/2,Math.max(...ys)+a.width/2]},null,2)+'\n');
  });
});
writeFileSync(`${out}/walls.svg`,doc(walls,1180,1590));

let bridges=`<rect width="1180" height="1940" fill="#f5f2ea"/>${text(32,42,'BRIDGES / DECKS, BANK SEATS AND PIERS',26)}${text(32,70,'Stone and timber crossings in top view. The water and banks are separate review layers, not part of the glyph.')}`;
Object.entries(palettes).forEach(([b,p],i)=>{
  const y=105+i*358;bridges+=text(32,y+14,b.toUpperCase(),14);
  bridgeKinds.forEach((kind,j)=>{
    const x=32+j%3*378,Y=y+28+Math.floor(j/3)*156,a=assets[`sm-bridge-${kind}${suffix(b)}`],s=1.65,px=x+(354-a.viewBox[2]*s)/2,py=Y+9;
    const riverLeft=px+(a.bankAnchors[0][0]+6)*s,riverWidth=(a.crossingLength-12)*s;
    bridges+=`<rect x="${x}" y="${Y}" width="354" height="119" rx="5" fill="${p.ground}"/><rect x="${riverLeft}" y="${Y}" width="${riverWidth}" height="119" fill="${p.water}"/>${show(a,px,py,s)}${text(x+9,Y+140,title(kind),13)}`;
  });
});
writeFileSync(`${out}/bridges.svg`,doc(bridges,1180,1940));

let henges=`<rect width="1180" height="1270" fill="#f5f2ea"/>${text(32,42,'HENGES / STONE, LINTELS AND WEATHERING',26)}${text(32,70,'Six arrangements, each with three saved variants per biome and further reproducible seeds in the gallery.')}`;
Object.entries(palettes).forEach(([b,p],i)=>{
  const y=112+i*222;henges+=text(32,y+13,b.toUpperCase(),14);
  hengeKinds.forEach((kind,j)=>{
    const x=32+j*188,a=assets[`sm-henge-${kind}-a${suffix(b)}`];
    henges+=`<rect x="${x}" y="${y+28}" width="174" height="155" rx="5" fill="${p.ground}"/>${show(a,x+17,y+36,1.43)}${text(x+3,y+204,title(kind),12)}`;
  });
});
writeFileSync(`${out}/henges.svg`,doc(henges,1180,1270));
let variants=`<rect width="1180" height="1530" fill="#f5f2ea"/>${text(32,42,'HENGES / VARIATION WITHIN EACH ARRANGEMENT',25)}${text(32,70,'Seeded changes to stone size, spacing, lean, chips, lintels and collapse. Identical seeds reproduce identical SVGs.')}`;
hengeKinds.forEach((kind,i)=>{
  const y=113+i*226;variants+=text(32,y+16,title(kind),14);
  seeds.forEach((seed,j)=>{
    const x=295+j*283,a=assets[`sm-henge-${kind}-${'abc'[j]}`];
    variants+=`<rect x="${x}" y="${y-4}" width="258" height="183" rx="5" fill="${palettes.temperate.ground}"/>${show(a,x+37,y+1,1.84)}${text(x+75,y+202,`Variant ${'ABC'[j]} / seed ${seed}`,13)}`;
  });
});
writeFileSync(`${out}/henge-variations.svg`,doc(variants,1180,1530));

// The live gallery uses the SAME pure drawing module as the downloadable assets.
// Bundle inline so it works when opened directly as a local file.
const bundle=await build({stdin:{contents:`import {wall,bridge,henge,svg,palettes,wallKinds,bridgeKinds,hengeKinds} from './art/infrastructure.mjs';
const data=${JSON.stringify({assets,manifest})};
const $=id=>document.getElementById(id);let current;
function options(el,values){el.innerHTML=values.map(v=>'<option>'+v+'</option>').join('');}
options($('biome'),Object.keys(palettes));
function updateKinds(){const c=$('category').value;options($('kind'),c==='wall'?wallKinds:c==='bridge'?bridgeKinds:hengeKinds);$('length-control').hidden=c!=='bridge';$('bend-control').hidden=c!=='wall';$('seed-control').hidden=c!=='henge';render();}
function render(){const b=$('biome').value,c=$('category').value,k=$('kind').value;
if(c==='bridge'){current=bridge(k,{biome:b,length:Number($('length').value)});$('value').textContent=current.crossingLength+' art-unit span; rebuilds courses and piers';}
else if(c==='henge'){current=henge(k,{biome:b,seed:Math.max(0,Math.min(4294967295,Math.trunc(Number($('seed').value)||0)))});$('value').textContent='Seed '+current.seed+' · '+current.stones.length+' stones · '+current.lintels.length+' lintels';}
else {const bend=Number($('bend').value),pts=Array.from({length:61},(_,i)=>{const t=i/60;return[14+t*292,90+Math.sin(t*Math.PI*2)*bend];}),length=pts.slice(1).reduce((s,p,i)=>s+Math.hypot(p[0]-pts[i][0],p[1]-pts[i][1]),0);current=wall(pts,{biome:b,kind:k,gates:$('gate').checked?[{at:length/2,width:26}]:[]});current.viewBox=[0,0,320,180];current.anchor=[160,90];$('value').textContent='Constant wall width; detail follows the curve';}
$('live').innerHTML=svg(current,{shadow:$('shadow').checked});$('live').style.background=palettes[b].ground;
const shown=Object.entries(data.assets).filter(([id,a])=>a.biome===b&&a.category===c);
$('grid').innerHTML=shown.map(([id,a])=>'<article><div class="art" style="background:'+palettes[b].ground+'">'+svg(a,{shadow:$('shadow').checked})+'</div><div class="caption"><strong>'+a.kind+(a.form?' / '+a.form:'')+(a.seed!==undefined?' / seed '+a.seed:'')+'</strong><a href="individual/'+id+'.svg" download>SVG</a> · <a href="individual/'+id+'-sil.svg" download>Silhouette</a></div></article>').join('');}
$('category').addEventListener('change',updateKinds);for(const id of ['biome','kind','length','bend','seed','shadow','gate'])$(id).addEventListener('input',render);
$('next-seed').addEventListener('click',()=>{$('seed').value=Number($('seed').value)+1;render();});
$('download').addEventListener('click',()=>{const u=URL.createObjectURL(new Blob([svg(current,{shadow:false,title:current.kind})],{type:'image/svg+xml'}));const a=document.createElement('a');a.href=u;a.download='sm-'+current.category+'-'+current.kind+'-'+current.biome+(current.seed!==undefined?'-seed-'+current.seed:'')+'.svg';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);});updateKinds();`,resolveDir:fileURLToPath(new URL('.',import.meta.url)),sourcefile:'infrastructure-gallery.js'},bundle:true,write:false,platform:'browser',format:'iife',target:'es2022',minify:true});
const html=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Settlemaker walls, bridges and henges</title><style>
*{box-sizing:border-box}body{margin:0;background:#f5f2ea;color:#33262e;font:15px system-ui,sans-serif}main{max-width:1280px;margin:auto;padding:36px}h1{font:36px Georgia,serif;margin:8px 0 12px}p{line-height:1.6;max-width:880px}nav,.controls{display:flex;gap:16px;flex-wrap:wrap;align-items:center;margin:24px 0}a{color:#425f70}select,input,button{font:inherit}select,button,input[type=number]{padding:8px;border:1px solid #b7b0a9;border-radius:4px;background:#fffdf8}button{cursor:pointer}#live{border-radius:8px;min-height:230px;display:grid;place-items:center;padding:18px}#live svg{max-width:100%;max-height:320px;width:auto;height:280px}#grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px}article{border:1px solid #d2ccc4;border-radius:6px;overflow:hidden;background:#fffdf8}.art{height:190px;display:grid;place-items:center;padding:14px}.art svg{max-width:100%;max-height:160px}.caption{padding:15px}.caption strong{display:block;font-size:14px;margin-bottom:8px}.small,.caption a{font-size:13px}[hidden]{display:none!important}input[type=number]{width:110px}</style>
<main><div class="small">SETTLEMAKER / SHARED STRUCTURE KIT</div><h1>Beyond the building footprint.</h1><p>Walls that follow an irregular boundary. Bridges that adapt to the crossing. Henges with individual stone arrangements and wear. Shared by cities and villages, in the same pen-and-material style.</p>
<div class="controls"><label>Group <select id="category"><option value="wall">Walls</option><option value="bridge">Bridges</option><option value="henge">Henges</option></select></label><label>Biome <select id="biome"></select></label><label>Form <select id="kind"></select></label><label><input id="shadow" type="checkbox" checked> Shadows</label></div>
<div class="controls"><label id="length-control">Span <input id="length" type="range" min="32" max="160" value="80"></label><label id="bend-control">Wall bend <input id="bend" type="range" min="0" max="52" value="34"> <input id="gate" type="checkbox" checked> Gate gap</label><span id="seed-control"><label>Seed <input id="seed" type="number" min="0" max="4294967295" step="1" value="11"></label> <button id="next-seed">Next variation</button></span><button id="download">Download this SVG</button></div><div id="live"></div><p id="value" class="small"></p>
<h2>Saved pieces</h2><div id="grid"></div><nav><a href="walls.svg">Irregular enclosures</a><a href="bridges.svg">Bridge sheet</a><a href="henges.svg">Henge sheet</a><a href="henge-variations.svg">Henge variations</a><a href="../landscape/index.html">Flora and farms</a><a href="symbols.json">Manifest</a><a href="integration.md">Placement notes</a><a href="../city/index.html">City buildings</a><a href="../village/index.html">Village buildings</a></nav></main><script>${bundle.outputFiles[0].text}</script></html>`;
writeFileSync(`${out}/index.html`,html);
console.log(`Wrote ${Object.keys(assets).length} glyphs and silhouettes: 45 wall presets, 30 bridges, 90 henges; plus path examples and a live gallery.`);
