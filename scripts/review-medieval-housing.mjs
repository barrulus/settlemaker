/** Fixed-seed, public-API comparison of residential artwork and urban ground. */
import {mkdirSync, writeFileSync, existsSync} from 'node:fs';
import sharp from 'sharp';
import {generateSettlement} from '../dist/index.js';
import {assembleSvg} from '../dist/output/assemble-svg.js';

const stage = process.argv[2] ?? 'after';
if (!['before', 'after'].includes(stage)) throw new Error('Use before or after');
const out = new URL('../output/medieval-housing/', import.meta.url);
mkdirSync(out, {recursive:true});
const input = {name:'Medieval housing study', population:10000, biome:'temperate', engine:'city',
  walls:true, plaza:true, temple:true, port:false, citadel:false, capital:false, shanty:false,
  roadBearings:[{bearing_deg:18,kind:'main',route_id:'a'}, {bearing_deg:142,kind:'town',route_id:'b'}, {bearing_deg:267,kind:'local',route_id:'c'}]};
const result = generateSettlement(input, {seed:2});
const scene = result.model.scene;
// Fixed world coordinates keep both comparisons honest even when parcels change.
const close = assembleSvg({...scene, bounds:{min_x:-60,min_y:-60,max_x:60,max_y:60}}, {pixelsPerUnit:8});
for (const [name,svg,width] of [['city',result.svg,1600], ['block',close,1200]]) {
  writeFileSync(new URL(`${stage}-${name}.svg`,out),svg);
  await sharp(Buffer.from(svg.replace(/var\(--[^,]+,\s*([^\)]+)\)/g,'$1'))).resize({width}).png().toFile(new URL(`${stage}-${name}.png`,out).pathname);
}
writeFileSync(new URL(`${stage}-summary.json`,out),JSON.stringify({input,seed:2,buildings:scene.layers.buildings.length,
  residents:result.model.residents,roofVariants:[...new Set(scene.layers.symbols.map(s=>s.artworkVariant).filter(v=>v!==undefined))],
  gardens:scene.layers.greens.filter(g=>g.purpose==='private'&&!g.surface).length,
  pavedYards:scene.layers.greens.filter(g=>g.purpose==='private'&&g.surface==='paved').length},null,2));
const stages=['before','after'].filter(s=>existsSync(new URL(`${s}-block.png`,out)));
writeFileSync(new URL('index.html',out),`<!doctype html><meta charset="utf-8"><title>Medieval housing study</title>
<style>body{margin:32px;background:#eee8dd;color:#453c32;font:16px system-ui}h1{font:32px Georgia}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(420px,1fr));gap:24px}img{width:100%}a{color:#68513a}</style>
<h1>Medieval housing study</h1><p>Population 10,000 · seed 2 · identical 120-metre view. Click for full vector detail.</p>
<main>${stages.map(s=>`<article><h2>${s}</h2><a href="${s}-block.svg"><img src="${s}-block.png" alt="${s} residential block"></a><p><a href="${s}-city.svg">Whole city SVG</a> · <a href="${s}-summary.json">Generation counts</a></p><img src="${s}-city.png" alt="${s} whole city"></article>`).join('')}</main>`);
console.log(`Review: ${out.pathname}index.html`);
