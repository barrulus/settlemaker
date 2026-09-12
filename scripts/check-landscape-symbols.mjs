import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {runInNewContext} from 'node:vm';
import sharp from 'sharp';
import {biomes,floraCatalog,flora,svg,snow} from './art/landscape.mjs';
import {farmCatalog,fieldTile,farmParcel} from './art/farms.mjs';
const root=fileURLToPath(new URL('../symbols/landscape/',import.meta.url));
const {symbols}=JSON.parse(readFileSync(`${root}/symbols.json`,'utf8'));
const fallback=s=>s.replace(/var\(--[^,]+,\s*([^\)]+)\)/g,'$1');
const doc=(body,w,h,box=`0 0 ${w} ${h}`)=>`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${box}">${body}</svg>`;
const render=s=>sharp(Buffer.from(fallback(s))).ensureAlpha().raw().toBuffer({resolveWithObject:true});
async function noClipping(a,name){
  const[,,w,h]=a.viewBox,{data,info}=await render(doc(`<g transform="translate(4,4)">${a.body}</g>`,(w+8)*2,(h+8)*2,`0 0 ${w+8} ${h+8}`));let painted=0;
  for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){const alpha=data[(y*info.width+x)*4+3];if(alpha){painted++;assert(x>=8&&y>=8&&x<info.width-8&&y<info.height-8,`${name}: ink outside viewport at ${x/2-4},${y/2-4}`);}}
  assert(painted>20,`${name}: empty artwork`);
}
for(const[id,a]of Object.entries(symbols)){
  const saved=readFileSync(`${root}/individual/${id}.svg`,'utf8');
  assert.equal(a.castsShadow,false,id);assert(!saved.includes('<filter'),id);
  if(a.cls!=='pattern')await noClipping({...a,body:saved.replace(/^.*?<svg[^>]*>/s,'').replace(/<\/svg>\s*$/,'')},id);
  if(a.category==='farm'&&!a.natural){
    const {data,info}=await render(saved),expected=biomes[a.biome].dry.match(/\w\w/g).map(h=>parseInt(h,16));
    for(let y=110;y<116;y++)for(let x=79;x<81;x++){const at=(y*info.width+x)*4;assert.equal(data[at+3],255,`${id}: entrance not painted`);expected.forEach((v,k)=>assert(Math.abs(data[at+k]-v)<=2,`${id}: crop or obstruction in entrance`));}
  }
}
let extras=0;
for(const[b,defs]of Object.entries(floraCatalog))for(const spec of defs){
  for(const seed of [0,1,4294967295]){const a=flora(b,spec.kind,{seed});assert.equal(a.body,flora(b,spec.kind,{seed}).body);await noClipping(a,`${b}/${spec.kind}/${seed}`);extras++;}
  if(b==='tundra')for(const seed of [11,42,74]){
    const plain=flora(b,spec.kind,{seed}).body,winter=flora(b,spec.kind,{seed,winter:true}).body;
    const underlying=winter.replace(/<path\b[^>]*\/>/g,p=>p.includes(`fill="${snow}"`)?'':p);
    assert.equal(underlying,plain,`${spec.kind}: snow changed underlying plant geometry`);
  }
}

// Compare a native tiled fill across x/y seams with the unclipped periodic motifs.
// This catches nested viewport clipping, incomplete wrapping and edge gutters.
for(const[b,defs]of Object.entries(farmCatalog))for(const spec of defs){
  const a=fieldTile(b,spec.kind),inner=a.body.match(/<svg[^>]*>([\s\S]*)<\/svg>$/)[1],fill=a.body.match(/^<rect[^>]*fill="([^"]+)"/)[1];
  const patterned=doc(`<defs><pattern id="p" width="32" height="32" patternUnits="userSpaceOnUse">${a.body}</pattern></defs><rect x="-16" y="-16" width="64" height="64" fill="url(#p)"/>`,256,256,'-16 -16 64 64');
  const uncut=doc(`<rect x="-16" y="-16" width="64" height="64" fill="${fill}"/>${inner}`,256,256,'-16 -16 64 64');
  const [left,right]=await Promise.all([render(patterned),render(uncut)]);
  let changed=0,max=0;for(let i=0;i<left.data.length;i++){const d=Math.abs(left.data[i]-right.data[i]);if(d>3)changed++;max=Math.max(max,d);}
  assert(changed/left.data.length<.002,`${b}/${spec.kind}: tile seams differ from uncut motifs (${changed}, max ${max})`);
  // Exercise the unsigned seed boundary, including orchard sub-plant seeds.
  assert(fieldTile(b,spec.kind,{seed:4294967295}).body.length>0);
}

// Real XML parser: unique IDs, resolved local references and vector-only documents.
const parsed=spawnSync('python3',['-c',String.raw`
import pathlib,re,sys,xml.etree.ElementTree as E
root=pathlib.Path(sys.argv[1]);files=list(root.rglob('*.svg'))
for f in files:
    tree=E.parse(f);ids=[e.attrib['id'] for e in tree.iter() if 'id' in e.attrib]
    assert len(ids)==len(set(ids)),f'duplicate IDs in {f}'
    for e in tree.iter():
        assert e.tag.rsplit('}',1)[-1] not in ['image','script','foreignObject'],f
        for k,v in e.attrib.items():
            refs=re.findall(r'url\(#([^)]*)\)',v)
            if k.rsplit('}',1)[-1]=='href' and v.startswith('#'):refs.append(v[1:])
            for ref in refs:assert ref in ids,f'{f}: missing {ref}'
print(f'{len(files)} SVG documents parsed; IDs and references valid')
`,root],{encoding:'utf8'});assert.equal(parsed.status,0,parsed.stderr);console.log(parsed.stdout.trim());

// Exercise the bundled file:// gallery controls in a minimal DOM; no network needed.
class Element{
  constructor(id){this.id=id;this.value='';this.checked=false;this.events={};this.style={};this.dataset={};}
  set innerHTML(v){this.html=v;if(v.startsWith('<option'))this.value=v.match(/value="([^"]*)"/)?.[1]??v.match(/<option>([^<]*)/)[1];}
  get innerHTML(){return this.html;}
  addEventListener(k,fn){this.events[k]=fn;}
  querySelectorAll(){return [];}
  click(){this.clicked=true;}
}
const els={},element=id=>els[id]??(els[id]=new Element(id));
element('category').value='flora';element('seed').value='11';element('angle').value='0';element('form').value='crooked';
let download;
const html=readFileSync(`${root}/index.html`,'utf8'),js=html.match(/<script>([\s\S]*)<\/script>/)[1];
runInNewContext(js,{document:{getElementById:element,createElement:()=>download=new Element('download-link')},URL:{createObjectURL:()=> 'blob:test',revokeObjectURL:()=>{}},Blob,setTimeout:fn=>fn()});
for(const b of Object.keys(biomes))for(const c of ['flora','field','farm']){
  element('biome').value=b;element('category').value=c;element('category').events.change();assert(element('live').html.includes('<svg'));
  element('next').events.click();assert(element('seed').value>11);
  element('download').events.click();assert(download.clicked&&download.download.endsWith('.svg'));
  if(c==='farm'){element('form').value='riverside';element('angle').value='37';element('form').events.input();assert(element('live').html.includes('rotate(37)'));}
  if(c==='flora'&&b==='tundra'){element('snow').checked=true;element('snow').events.input();assert(element('live').html.includes('--sm-snow'));}
}
console.log(`${Object.keys(symbols).length} saved assets; ${extras} extra flora seeds; 42 snow states preserve their plants; 30 seamless tiles; open farm entrances; gallery controls and downloads passed.`);
