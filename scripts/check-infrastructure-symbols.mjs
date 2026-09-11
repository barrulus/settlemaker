/** Raster contract checks for artwork that must preserve gates, deck width and access. */
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {wall,bridge,henge,bridgeKinds,hengeKinds} from './art/infrastructure.mjs';
const root=fileURLToPath(new URL('../symbols/infrastructure/',import.meta.url));
const manifest=JSON.parse(readFileSync(`${root}/symbols.json`,'utf8')).symbols;
const sprite=readFileSync(`${root}/symbols.svg`,'utf8');
const parts=Object.fromEntries([...sprite.matchAll(/<symbol id="([^"]+)"[^>]*>([\s\S]*?)<\/symbol>/g)].map(m=>[m[1],m[2]]));
const scale=4,pad=8;
async function raster(markup,vb){
  const width=(vb[2]+pad*2)*scale,height=(vb[3]+pad*2)*scale;
  const s=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="-${pad} -${pad} ${vb[2]+pad*2} ${vb[3]+pad*2}" width="${width}" height="${height}">${markup}</svg>`.replace(/var\(--[^,]+,\s*([^\)]+)\)/g,'$1');
  return {data:await sharp(Buffer.from(s)).ensureAlpha().raw().toBuffer(),width,height};
}
const alpha=(r,x,y)=>r.data[(Math.floor((y+pad)*scale)*r.width+Math.floor((x+pad)*scale))*4+3];
async function check(id,a){
  const body=await raster(a.body,a.viewBox),sil=await raster(a.sil,a.viewBox);
  for(let y=0;y<body.height;y++)for(let x=0;x<body.width;x++){
    const k=(y*body.width+x)*4+3,b=body.data[k],s=sil.data[k],xx=x/scale-pad,yy=y/scale-pad;
    assert.ok(b<=s+3,`${id}: body outside silhouette at ${xx},${yy}: ${b}/${s}`);
    if(xx<0||yy<0||xx>=a.viewBox[2]||yy>=a.viewBox[3])assert.equal(b+s,0,`${id}: clipped art at ${xx},${yy}`);
    if(a.category==='henge'){
      if(Math.hypot(xx-48,yy-46)<8.5||(Math.abs(xx-48)<2.75&&yy>=46&&yy<90))assert.equal(b+s,0,`${id}: blocked henge centre/entry at ${xx},${yy}`);
    }
  }
}
assert.equal(Object.keys(manifest).length,165);
assert.equal(Object.keys(parts).length,330);
for(const[id,m]of Object.entries(manifest))await check(id,{...m,body:parts[id],sil:parts[id+'-sil']});
for(const kind of hengeKinds){
  const a=henge(kind,{seed:11}),b=henge(kind,{seed:11}),c=henge(kind,{seed:42});
  assert.deepEqual(a,b,`${kind}: seed must reproduce exactly`);assert.notEqual(a.body,c.body,`${kind}: seeds need visible geometry variation`);
  for(const seed of [0,1,2,3,17,31,73,101,102,999,0xffffffff])await check(`${kind} seed ${seed}`,henge(kind,{seed}));
}
for(const kind of bridgeKinds){
  let previous=-1;
  for(const length of [32,64,96,160]){
    const a=bridge(kind,{length});await check(`${kind} span ${length}`,a);
    assert.equal(a.bankAnchors[1][0]-a.bankAnchors[0][0],length);
    assert.equal(a.clearTravelWidth,bridge(kind,{length:64}).clearTravelWidth,`${kind}: span cannot stretch deck width`);
    assert.ok(a.pierPositions.length>=previous);previous=a.pierPositions.length;
  }
}
for(const kind of ['curtain','rubble','palisade']){
  const a=wall([[16,25],[68,36],[92,88],[150,64]],{kind,gates:[{at:26,width:18}]});
  a.viewBox=[0,0,170,110];await check(`${kind} angled gate`,a);
  const r=await raster(a.sil,a.viewBox),g=a.gateAnchors[0],[tx,ty]=g.tangent;
  for(let along=-7;along<=7;along+=.5)for(let across=-5;across<=5;across+=.5)assert.equal(alpha(r,g.at[0]+tx*along-ty*across,g.at[1]+ty*along+tx*across),0,`${kind}: gate gap filled`);
}
console.log('165 saved glyph/silhouette pairs, 66 additional henge seeds, 24 bridge spans and 3 angled wall gates passed.');
