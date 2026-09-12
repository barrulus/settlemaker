/** City landmark artwork and reusable, roof-only compound assemblies. */
import { mkdirSync, writeFileSync } from 'node:fs';

const family = (key,label,category,bounds,panels,extra={}) => ({key,label,category,bounds,panels,
  tags:[category,'landmark'],floors:[1,3],...extra});
export const landmarkFamilies = [
  family('chapel','Neighbourhood chapel','faith',[18,6,46,60],[[21,6,43,46],[18,42,46,60]],{feature:'chapel'}),
  family('church','Parish church','faith',[8,4,56,60],[[23,4,41,20],[8,18,56,33,'x'],[20,28,44,57],[24,44,40,60]],{feature:'church'}),
  family('cathedral','Cathedral','faith',[4,2,60,62],[[23,2,41,18],[14,19,26,52],[38,19,50,52],[4,16,60,30,'x'],[24,10,40,60],[13,47,26,62],[38,47,51,62]],{feature:'cathedral'}),
  family('temple-hall','Columned temple','faith',[8,4,56,60],[[8,4,56,60]],{feature:'temple'}),
  family('temple-court','Courtyard sanctuary','faith',[4,4,60,60],[[4,4,60,18,'x'],[4,18,18,60],[46,18,60,60],[18,48,27,60],[37,48,46,60],[20,5,44,22,'x']],{holes:[[18,22,46,48],[27,48,37,60]],feature:'sanctuary'}),
  family('cloister','Church and cloister','faith',[4,4,60,60],[[4,4,23,60],[23,4,60,18,'x'],[46,18,60,48],[23,48,34,60,'x'],[44,48,60,60,'x']],{holes:[[23,18,46,48],[34,48,44,60]],feature:'cloister',tags:['faith','aggregate','courtyard']}),
  family('palace-hall','Palace / state hall','palace',[2,10,62,54],[[2,14,16,50],[48,14,62,50],[12,10,52,54,'x']],{feature:'state-hall'}),
  family('palace-wing','Palace / residential wing','palace',[8,0,56,64],[[8,0,56,64]],{feature:'wing',joins:['north','south']}),
  family('palace-pavilion','Palace / corner pavilion','palace',[6,6,58,58],[[6,6,58,58]],{feature:'pavilion'}),
  family('palace-gallery','Palace / covered gallery','palace',[0,22,64,42],[[0,22,64,42,'x']],{feature:'gallery',joins:['west','east']}),
  family('palace-gatehouse','Palace / gatehouse','palace',[0,16,64,48],[[0,16,25,48],[39,16,64,48]],{holes:[[25,16,39,48]],feature:'palace-gate',joins:['west','east']}),
  family('palace-chapel','Palace / private chapel','palace',[16,4,48,60],[[20,4,44,17],[16,14,48,51],[23,48,41,60]],{feature:'private-chapel',tags:['palace','faith']}),
  family('castle-keep','Castle / keep','castle',[4,4,60,60],[[4,4,60,60]],{feature:'keep',floors:[3,6]}),
  family('castle-hall','Castle / great hall','castle',[4,12,60,52],[[4,12,60,52,'x']],{feature:'great-hall'}),
  family('castle-barracks','Castle / barracks','castle',[8,0,56,64],[[8,0,56,64]],{feature:'barracks',joins:['north','south']}),
  family('castle-tower-round','Castle / round tower','castle',[8,8,56,56],[[8,8,56,56]],{feature:'round-tower',floors:[3,5]}),
  family('castle-tower-square','Castle / square tower','castle',[8,8,56,56],[[8,8,56,56]],{feature:'square-tower',floors:[3,5]}),
  family('castle-gatehouse','Castle / twin gate towers','castle',[0,10,64,54],[[0,10,25,54],[39,10,64,54]],{feature:'castle-gate',holes:[[25,10,39,54]],joins:['west','east'],floors:[3,4]}),
  family('castle-wall','Castle / curtain wall','castle',[0,24,64,40],[[0,24,64,40,'x']],{feature:'wall',joins:['west','east'],floors:[1,1],tags:['castle','fortification']}),
  family('castle-chapel','Castle / chapel','castle',[18,4,46,60],[[21,4,43,18],[18,14,46,51],[24,48,40,60]],{feature:'castle-chapel',tags:['castle','faith']}),
];

export function drawLandmark(f,b,a) {
  const {path,rect,token,roof,ink}=a, wall=token(b,'wall'), accent=token(b,'accent');
  const snow='var(--sm-snow, #f2f6f8)', dark='var(--sm-void, #6b5460)';
  const circle=(x,y,r,fill,sw=1)=>`<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" stroke="${ink}" stroke-width="${sw}"/>`;
  const r=(p,cover='plane')=>roof(p,b,0,cover);
  const crest=(x,y,size)=>{
    let s=rect(x-size,y-size,size*2,size*2,wall,1);
    s+=path(`M${x-size},${y-size}L${x},${y}L${x+size},${y-size}L${x},${y-size*1.45}Z`,b==='tundra'?snow:accent,1);
    s+=path(`M${x-size},${y+size}L${x},${y}L${x+size},${y+size}M${x},${y}V${y-size*1.45}`,'none',.75);
    return s;
  };
  const steps=(x,y,w)=>rect(x,y,w,4,wall,.7)+path(`M${x},${y+1.4}h${w}M${x},${y+2.8}h${w}`,'none',.5);
  const bastion=(x,y,size)=>{
    let s=rect(x+1.1,y+1.1,size-2.2,size-2.2,wall,2.2);
    s+=r([x+4,y+4,x+size-4,y+size-4],'full');
    for(let t=3;t<size-3;t+=7) s+=rect(x+t,y+1.2,3,3,wall,.65)+rect(x+t,y+size-4.2,3,3,wall,.65)
      +rect(x+1.2,y+t,3,3,wall,.65)+rect(x+size-4.2,y+t,3,3,wall,.65);
    if(b==='tundra')s+=path(`M${x+2},${y+5}h${size-4}v2h-${size-4}Z`,snow,0);
    return s;
  };
  let body=f.panels.map((p,i)=>roof(p,b,i,['cathedral','pavilion'].includes(f.feature)?'full':'plane')).join('');
  let sil=f.panels.map(([x,y,X,Y])=>`<path d="M${x+1.1},${y+1.1}H${X-1.1}V${Y-1.1}H${x+1.1}Z" fill="currentColor" stroke="currentColor" stroke-width="2.2"/>`).join('');
  if(['chapel','private-chapel','castle-chapel'].includes(f.feature)) {
    body+=crest(32,46,f.feature==='chapel'?6:5)+steps(27,55,10);
  }
  if(f.feature==='church') body+=crest(32,24,6)+crest(32,51,6)+steps(28,55.5,8);
  if(f.feature==='cathedral') {
    body+=crest(32,23,6)+crest(19.5,54,4.3)+crest(44.5,54,4.3)+steps(27,55.5,10);
    for(const y of [34,41])body+=rect(14.5,y,4,2,wall,.65)+rect(45.5,y,4,2,wall,.65);
  }
  if(f.feature==='temple') {
    body=rect(9.1,5.1,45.8,53.8,wall,2.2);
    for(const x of [13,51]) for(let y=11;y<=48;y+=7.4)body+=circle(x,y,1.8,token(b,'light'),.7);
    body+=r([17,8,47,51],'full')+steps(17,53,30);
    body+=path('M19,12L32,17L45,12','none',1);
  }
  if(f.feature==='sanctuary') {
    body+=crest(32,13,5);
    for(const x of [15,49]) for(let y=23;y<45;y+=6)body+=circle(x,y,1.3,wall,.6);
  }
  if(f.feature==='cloister') {
    body+=crest(13.5,46,5);
    for(let x=26;x<45;x+=6)body+=rect(x,14,2,3,wall,.5);
    for(let y=22;y<44;y+=6)body+=rect(47,y,3,2,wall,.5);
  }
  if(f.feature==='state-hall') {
    body+=crest(9,31,4.5)+crest(55,31,4.5)+crest(32,31,7);
    body+=steps(24,48,16);
  }
  if(['wing','barracks','great-hall'].includes(f.feature)) {
    const vertical=f.feature!=='great-hall';
    for(const v of [14,32,50]) {
      const x=vertical?21:v,y=vertical?v:37;
      body+=rect(x-2,y-2,4,4,wall,.8)+path(`M${x-2},${y}h4`,'none',.55);
    }
  }
  if(f.feature==='pavilion')body+=crest(32,32,11);
  if(f.feature==='gallery')for(let x=5;x<61;x+=9)body+=rect(x,37,3,3,wall,.65);
  if(f.feature==='palace-gate')body+=crest(12,30,7)+crest(52,30,7);
  if(f.feature==='keep') {
    body=rect(5.1,5.1,53.8,53.8,wall,2.2)+r([13,13,51,51],'full');
    for(const[x,y]of [[4,4],[44,4],[4,44],[44,44]]) {
      body+=bastion(x,y,16);
      sil+=`<path d="M${x+1.1},${y+1.1}h13.8v13.8h-13.8Z" fill="currentColor" stroke="currentColor" stroke-width="2.2"/>`;
    }
    body+=steps(25,52,14);
  }
  if(f.feature==='square-tower')body=bastion(8,8,48);
  if(f.feature==='round-tower') {
    body=circle(32,32,22.9,wall,2.2)+circle(32,32,16.5,b==='tundra'?snow:token(b,'roof'),1.1);
    body+=path('M20.3,20.3L32,32L43.7,20.3M20.3,43.7L32,32L43.7,43.7','none',b==='tundra'?.4:.7);
    for(let i=0;i<10;i++){
      const angle=i*Math.PI/5,x=32+19.5*Math.cos(angle),y=32+19.5*Math.sin(angle);
      body+=`<g transform="rotate(${i*36},${x},${y})">${rect(x-1.4,y-1.7,2.8,3.4,wall,.65)}</g>`;
    }
    sil='<circle cx="32" cy="32" r="22.9" fill="currentColor" stroke="currentColor" stroke-width="2.2"/>';
  }
  if(f.feature==='castle-gate') {
    body=rect(1.1,11.1,22.8,41.8,wall,2.2)+rect(40.1,11.1,22.8,41.8,wall,2.2)
      +r([3,17,22,47],'full')+r([42,17,61,47],'full');
    for(const x of [2,20,40,58])for(const y of [12,48])body+=rect(x,y,3.5,3.5,wall,.6);
    // Open passage remains truly empty: no portcullis drawn across its void.
    body+=path('M22,20V44M42,20V44','none',1.2);
  }
  if(f.feature==='wall') {
    // Horizontal outline has no end caps; repeat on exactly 64 units.
    body=rect(0,24,64,16,wall,0)+path('M0,24.8H64M0,39.2H64','none',1.6);
    body+=rect(0,29,64,6,token(b,'light'),0);
    for(let x=2;x<64;x+=8)body+=rect(x,25.5,4,3,wall,.65)+rect(x,35.5,4,3,wall,.65);
    body+=path('M0,32H64M8,29V32M24,29V32M40,29V32M56,29V32M16,32V35M32,32V35M48,32V35','none',.5);
    if(b==='tundra')body+=path('M0,29H64V31L52,30.2L38,31.4L22,30.3L8,31.2L0,30.6Z',snow,0);
    body=`<g stroke-linecap="butt">${body}</g>`;
    sil='<path d="M0,24H64V40H0Z" fill="currentColor" stroke="none"/>';
  }
  return {body:`<g stroke-linejoin="round" stroke-linecap="round">${body}</g>`,sil:`<g stroke-linejoin="round">${sil}</g>`};
}

// Coordinates are in art units, with a shared scale. Components touch at
// selected roof envelopes; tower/wall overlaps are deliberate defensive joints.
export const compoundLayouts = [
  {key:'palace-court',label:'Palace / enclosed state court',bounds:[0,0,256,256],
    access:[[128,256],[128,211],[128,145]],voids:[[88,126,168,192]],
    pieces:[['palace-hall',128,65,2.4,0],['palace-wing',58,142,1,0],['palace-wing',198,142,1,0],
      ['palace-pavilion',58,90,.8,0],['palace-pavilion',198,90,.8,0],
      ['palace-gallery',58,194.8,.65,90],['palace-gallery',198,194.8,.65,90],
      ['palace-gallery',66,211,1,0],['palace-gallery',190,211,1,0],['palace-gatehouse',128,211,1,0],
      ['palace-chapel',233.2,147,.7,0]]},
  {key:'palace-open',label:'Palace / open forecourt',bounds:[0,0,256,256],
    access:[[128,256],[128,185],[128,124]],voids:[[88,124,168,220]],
    pieces:[['palace-hall',128,67,2.5,0],['palace-wing',57,142,1.2,0],['palace-wing',199,142,1.2,0],
      ['palace-pavilion',57,195,.85,0],['palace-pavilion',199,195,.85,0],['palace-chapel',238.2,140,.65,0]]},
  {key:'castle-bailey',label:'Castle / keep and bailey',bounds:[0,0,256,256],
    access:[[128,256],[128,224],[128,152]],voids:[[102,145,154,200]],
    pieces:[
      ...[64,128,192].map(x=>['castle-wall',x,32,1,0]),
      ...[64,128,192].flatMap(y=>[['castle-wall',32,y,1,90],['castle-wall',224,y,1,90]]),
      ['castle-wall',64,224,1,0],['castle-wall',192,224,1,0],['castle-gatehouse',128,224,1,0],
      ...[[32,32],[224,32],[32,224],[224,224]].map(([x,y])=>['castle-tower-round',x,y,1,0]),
      ['castle-keep',128,85,1.7,0],['castle-hall',72,170,1.15,90],['castle-barracks',195,150,.8,0],
      ['castle-chapel',192,191,.7,0]]},
];

export function writeCompounds(out,biomes,assets,symbols,wrap,text) {
  mkdirSync(`${out}/compounds`,{recursive:true});
  const records={};
  let sheet=`<rect width="1180" height="2100" fill="#f5f2ea"/>${text(32,42,'PALACES AND CASTLES / ASSEMBLED FROM THE KIT',25)}${text(32,72,'Open courts, clear gates and separate building pieces. Ground is shown only on this review sheet.')}`;
  let sheetDefs='';
  Object.entries(biomes).forEach(([b,p],i)=>{
    const y=105+i*391;
    sheet+=text(32,y+14,b.toUpperCase(),14);
    compoundLayouts.forEach((layout,j)=>{
      const id=`sm-city-${layout.key}${b==='temperate'?'':`--${b}`}`;
      const keys=[...new Set(layout.pieces.map(([k])=>`sm-city-${k}${b==='temperate'?'':`--${b}`}`))];
      const defs=keys.map(k=>`<g id="${k}">${assets[k].body}</g><g id="${k}-sil">${assets[k].sil}</g>`).join('');
      const layer=shadow=>layout.pieces.map(([k,x,y,s,angle])=>{
        const ref=`sm-city-${k}${b==='temperate'?'':`--${b}`}${shadow?'-sil':''}`;
        return `<use href="#${ref}" transform="translate(${x},${y}) rotate(${angle}) scale(${s}) translate(-32,-32)"/>`;
      }).join('');
      const sil=layer(true),body=layer(false);
      const painted=`<g color="#46303c" opacity=".2" transform="translate(2.6,3.6)">${sil}</g>${body}`;
      writeFileSync(`${out}/compounds/${id}.svg`,wrap(`<title>${layout.label} / ${b}</title><defs>${defs}</defs>${painted}`,'viewBox="0 0 256 256" width="512" height="512"'));
      writeFileSync(`${out}/compounds/${id}-sil.svg`,wrap(`<defs>${defs}</defs>${sil}`,'viewBox="0 0 256 256" width="512" height="512"'));
      records[id]={viewBox:[0,0,256,256],anchor:[128,128],biome:b,category:layout.key.startsWith('palace')?'palace':'castle',
        pieces:layout.pieces.map(([k,x,y,scale,rotation],n)=>({instanceId:`${id}-${n+1}`,glyph:`sm-city-${k}${b==='temperate'?'':`--${b}`}`,at:[x,y],scale,rotation})),
        accessPolyline:layout.access,clearCourtyardRects:layout.voids,capacity:null,
        notes:'Art-unit assembly recipe; reserve the site and transform access/footprints together. Standalone preview includes a world-direction shadow.'};
      // Inline markup avoids duplicate ids when multiple compounds share parts.
      const direct=shadow=>layout.pieces.map(([k,x,y,s,angle])=>`<g transform="translate(${x},${y}) rotate(${angle}) scale(${s}) translate(-32,-32)">${assets[`sm-city-${k}${b==='temperate'?'':`--${b}`}`][shadow?'sil':'body']}</g>`).join('');
      sheetDefs+=`<g id="${id}"><g color="#46303c" opacity=".2" transform="translate(2.6,3.6)">${direct(true)}</g>${direct(false)}</g>`;
      const x=32+j*378;
      sheet+=`<rect x="${x}" y="${y+28}" width="354" height="314" rx="6" fill="${p.ground}"/><use href="#${id}" transform="translate(${x+37},${y+39}) scale(1.1)"/>${text(x,y+366,layout.label,13)}`;
    });
  });
  writeFileSync(`${out}/compounds.json`,JSON.stringify({format:'settlemaker-city-compounds-v1',units:'art units',compounds:records},null,2)+'\n');
  writeFileSync(`${out}/compounds.svg`,wrap(`<defs>${sheetDefs}</defs>${sheet}`,'viewBox="0 0 1180 2100" width="1180" height="2100"'));
}
