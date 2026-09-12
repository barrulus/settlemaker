/** Biome commons share the surveyed outlines used by the village generator. */
import {mkdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {greenGround,greenPalettes} from './art/greens.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const bundle=await build({entryPoints:[`${root}src/assets/refined-glyphs.ts`],bundle:true,write:false,format:'esm',platform:'node'});
const {REFINED_GLYPHS}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const out=`${root}symbols/greens`;
mkdirSync(`${out}/individual`,{recursive:true});
const svg=body=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${body}</svg>\n`;
const greens=Object.entries(REFINED_GLYPHS).filter(([id])=>id.startsWith('sm-green-'));
const manifest={};let sections='';
let sheet='<rect width="1120" height="1320" fill="#f5f2ea"/><text x="32" y="44" font-family="Georgia,serif" font-size="28" fill="#33262e">Commons, lawns and village greens</text>';
let row=0;
for(const biome of Object.keys(greenPalettes)){
  let tiles='';let column=0;
  sheet+=`<text x="32" y="${86+row*244}" font-family="sans-serif" font-size="16" fill="#426677">${biome.toUpperCase()}</text>`;
  for(const [base,g] of greens){
    const id=`${base}--${biome}`,d=g.body.match(/<path[^>]* d="([^"]+)"/)[1];
    const body=greenGround(d,biome,{id,seed:base.endsWith('-b')?1:0});
    writeFileSync(`${out}/individual/${id}.svg`,svg(body));
    const x=38+(column%6)*180,y=100+row*244+Math.floor(column/6)*110;
    sheet+=`<g transform="translate(${x+38},${y}) scale(1.25)">${body}</g><text x="${x+78}" y="${y+98}" text-anchor="middle" font-family="sans-serif" font-size="11" fill="#746d70">${base.replace('sm-green-','')}</text>`;column++;
    manifest[id]={biome,base,viewBox:[0,0,64,64],category:'green'};
    tiles+=`<a href="individual/${id}.svg"><img src="individual/${id}.svg" alt="${id}"><span>${base.replace('sm-green-','')}</span></a>`;
  }
  row++;
  sections+=`<section><h2>${biome}</h2><div class="grid">${tiles}</div></section>`;
}
writeFileSync(`${out}/catalogue.svg`,`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1120 1320">${sheet}</svg>\n`);
writeFileSync(`${out}/symbols.json`,JSON.stringify({format:'settlemaker-greens-v1',palettes:greenPalettes,symbols:manifest},null,2)+'\n');
writeFileSync(`${out}/index.html`,`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Biome commons and greens</title><style>body{margin:32px;background:#f5f2ea;color:#33262e;font:16px system-ui}h1,h2{font-family:Georgia,serif}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px}a{color:#426677}img{width:100%;height:130px}.grid a{display:block;background:#fffdf8;text-align:center;padding:12px;border-radius:8px}p{max-width:850px;line-height:1.6}</style><h1>Commons, lawns and village greens</h1><p>Single soft earth edges and sparse ground detail. Temperate grass, desert sand and sparse turf, tundra moss and pale ground, tropical grass, and coastal grass. Village outlines are preserved; city parks and gardens use their actual land boundaries.</p><a href="../../output/art-integration/index.html">View generated settlements</a>${sections}</html>`);
console.log(`Wrote ${Object.keys(manifest).length} biome greens.`);
