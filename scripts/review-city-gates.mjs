/** Close views of road-aligned, open city gates. Run after npm run build. */
import { mkdirSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { generateSettlement } from '../dist/index.js';
import { assembleSvg } from '../dist/output/assemble-svg.js';

const out=new URL('../output/gate-doors/',import.meta.url);
mkdirSync(out,{recursive:true});
const scene=generateSettlement({name:'Gate review',population:2500,biome:'temperate',engine:'city',walls:true,
  plaza:true,temple:true,port:false,citadel:false,capital:false,shanty:false,roadBearings:[18,142,267]},{seed:2}).model.scene;
for(const [i,g]of scene.layers.walls[0].gates.entries()) {
  const x=(g.p1.x+g.p2.x)/2,y=(g.p1.y+g.p2.y)/2,r=13;
  const svg=assembleSvg({...scene,bounds:{min_x:x-r,min_y:y-r,max_x:x+r,max_y:y+r}},{cullOffscreenArtwork:true});
  writeFileSync(new URL(`gate-${i+1}.svg`,out),svg);
  await sharp(Buffer.from(svg.replace(/var\(--[^,]+,\s*([^\)]+)\)/g,'$1'))).resize(900).png().toFile(new URL(`gate-${i+1}.png`,out).pathname);
}
writeFileSync(new URL('index.html',out),`<!doctype html><meta charset="utf-8"><title>Open city gates</title>
<style>body{background:#eee8dd;color:#453c32;margin:24px;font:16px system-ui}main{display:flex;flex-wrap:wrap;gap:20px}img{width:min(700px,100%)}</style>
<h1>Open city gates</h1><p>Full-length timber doors, hinged to the towers and opened alongside the road.</p>
<main>${[1,2,3].map(i=>`<a href="gate-${i}.svg"><img src="gate-${i}.png" alt="Gate ${i}"></a>`).join('')}</main>`);
console.log(`Review: ${out.pathname}index.html`);
