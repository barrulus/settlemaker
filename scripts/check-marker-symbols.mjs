/** Validate SVG integrity, source coverage, small-size rendering and the portable pack. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {runInNewContext} from 'node:vm';
import sharp from 'sharp';
import {markerCatalog} from './art/markers.mjs';
const out=fileURLToPath(new URL('../symbols/markers/',import.meta.url));
const meta=JSON.parse(readFileSync(`${out}/markers.json`,'utf8'));
const ids=markerCatalog.map(a=>a.id).sort();
assert.equal(ids.length,36);assert.deepEqual(Object.keys(meta.markers).sort(),ids);
if(process.argv[2]){
  const original=JSON.parse(readFileSync(`${process.argv[2]}/markers.json`,'utf8'));
  assert.deepEqual(ids,Object.keys(original.markers).sort(),'source marker coverage changed');
  for(const id of ids){assert.equal(meta.markers[id].type,original.markers[id].type);assert.deepEqual(meta.markers[id].viewBox,original.markers[id].viewBox);}
  assert.deepEqual(meta.pin,original.pin,'existing pin layout contract changed');
}
const fallback=s=>s.replace(/var\(--[^,]+,\s*([^\)]+)\)/g,'$1');
const sprite=readFileSync(`${out}/markers.svg`,'utf8').replace(/^.*?<svg[^>]*>/s,'').replace(/<\/svg>\s*$/,'');
for(const id of ids){
  const svg=readFileSync(`${out}/${id}.svg`,'utf8');
  assert(!/<(?:image|text|script|filter|foreignObject)\b/.test(svg),id);
  const {data,info}=await sharp(Buffer.from(fallback(svg))).resize(256,256).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  let minX=256,minY=256,maxX=0,maxY=0,count=0;
  for(let y=0;y<256;y++)for(let x=0;x<256;x++)if(data[(y*256+x)*4+3]>4){
    count++;minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x+1);maxY=Math.max(maxY,y+1);
    assert(x>=12&&y>=12&&x<244&&y<244,`${id}: artwork touches the viewport`);
  }
  assert(count>500,`${id}: empty drawing`);
  assert(Math.abs((minX+maxX)/2-128)<3&&Math.abs((minY+maxY)/2-128)<3,`${id}: drawing not centred`);
  const use=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="256" height="256">${sprite}<use href="#${id}" width="64" height="64"/></svg>`;
  const fromSprite=await sharp(Buffer.from(fallback(use))).ensureAlpha().raw().toBuffer();
  assert(data.equals(fromSprite),`${id}: sprite differs from the standalone SVG`);
  for(const size of [16,20,30,46]){
    const small=await sharp(Buffer.from(fallback(svg))).resize(size,size).ensureAlpha().raw().toBuffer();
    let coverage=0;for(let i=3;i<small.length;i+=4)coverage+=small[i]/255;
    assert(coverage>size*size*.07,`${id}: too little visible ink at ${size}px`);
  }
}
const xml=spawnSync('python3',['-c',String.raw`
import pathlib,re,xml.etree.ElementTree as E,zipfile,sys
from html.parser import HTMLParser
p=pathlib.Path(sys.argv[1]);files=list(p.glob('*.svg'))
for f in files:
 root=E.parse(f);ids=[e.attrib['id'] for e in root.iter() if 'id' in e.attrib]
 assert len(ids)==len(set(ids)),f'duplicate IDs in {f}'
 for e in root.iter():
  for k,v in e.attrib.items():
   refs=re.findall(r'url\(#([^)]*)\)',v)
   if k.rsplit('}',1)[-1]=='href' and v.startswith('#'):refs.append(v[1:])
   for ref in refs:assert ref in ids,(f,ref)
class Links(HTMLParser):
 def handle_starttag(self,tag,attrs):
  for k,v in attrs:
   if k in ['href','src']:assert (p/v).is_file(),v
Links().feed((p/'index.html').read_text())
with zipfile.ZipFile(p/'settlemaker-markers.zip') as z:
 assert z.testzip() is None
 assert len([f for f in z.namelist() if '/mk-' in f and f.endswith('.svg')])==36
 for f in z.namelist():
  assert not f.startswith('/') and '..' not in f.split('/'),f
  assert z.read(f)==(p/pathlib.Path(f).name).read_bytes(),f
print(f'{len(files)} SVG documents parsed; gallery links and ZIP contents valid')
`,out],{encoding:'utf8'});
assert.equal(xml.status,0,xml.stderr);console.log(xml.stdout.trim());
// Exercise the gallery's size, background, outline and collection controls.
const elements={},properties={},classes=new Set(),articles=markerCatalog.map(a=>({dataset:{category:a.category},hidden:false}));
const el=id=>elements[id]??(elements[id]={value:'',checked:false,events:{},addEventListener(e,fn){this.events[e]=fn;}});
const html=readFileSync(`${out}/index.html`,'utf8'),js=html.match(/<script>([\s\S]*)<\/script>/)[1];
runInNewContext(js,{document:{getElementById:el,querySelectorAll:()=>articles,documentElement:{style:{setProperty:(k,v)=>properties[k]=v}},body:{classList:{toggle:(k,v)=>v?classes.add(k):classes.delete(k)}}}});
el('size').value='30';el('size').events.input();assert.equal(properties['--size'],'30px');assert.equal(el('size-label').value,'30 px');
el('background').value='#ffffff';el('background').events.change();assert.equal(properties['--backdrop'],'#ffffff');
el('outline').checked=true;el('outline').events.change();assert(classes.has('outline'));
for(const category of [...new Set(markerCatalog.map(a=>a.category)),'all']){
 el('category').value=category;el('category').events.change();
 assert.equal(articles.filter(a=>!a.hidden).length,category==='all'?36:markerCatalog.filter(a=>a.category===category).length);
}
console.log('36 markers: centred unclipped artwork, exact sprite parity, 144 small-size renders, original type/pin compatibility and gallery controls passed.');
