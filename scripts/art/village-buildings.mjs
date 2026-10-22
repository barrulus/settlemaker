import { medievalHousing } from './medieval-housing.mjs';
import { desertRoof } from './medieval-desert.mjs';
import { tundraRoof } from './medieval-tundra.mjs';
import { coastalRoof } from './medieval-coastal.mjs';
import { tropicalRoof } from './medieval-tropical.mjs';
import { flattenRoofSections } from './roof-sections.mjs';

/** Rural building drawings: detached roofs, porches, local materials. */
export const villageBiomes = {
  temperate:{roof:'#b49b72',light:'#dac59d',wall:'#ded4be',accent:'#a5786e',wood:'#95816b',ground:'#a3c98d',description:'Thatch, warm plaster, timber porches and occasional tile or slate'},
  desert:{roof:'#c4ac89',light:'#e5d1ad',wall:'#ecddc1',accent:'#739b99',wood:'#ac916f',ground:'#d9c48f',description:'Earthen roof terraces, rounded adobe huts, shade porches and pale plaster'},
  tundra:{roof:'#85878c',light:'#adb3b8',wall:'#c6c6bd',accent:'#8c7775',wood:'#968879',ground:'#e6ecef',description:'Compact timber buildings, covered entries, steep roofs and settled roof snow'},
  tropical:{roof:'#ad9971',light:'#d1c193',wall:'#c9b58e',accent:'#769788',wood:'#8e7a5f',ground:'#6d9e5c',description:'Palm-thatch hips, raised timber floors, broad eaves and open verandas'},
  coastal:{roof:'#899b98',light:'#b2bdb5',wall:'#dedbca',accent:'#8b90a4',wood:'#9a9181',ground:'#cfd6b0',description:'Weathered shingles, pale walls, thatched huts and sheltered seaward roofs'},
};

export const ruralHousingForms = new Set(['sm-house','sm-house-tiled','sm-house-large-tiled','sm-longhouse','sm-boathouse']);
export const ruralVariantCount = 8;

export function drawVillage(id, variant = 0) {
  const [base,suffix]=id.split('--'),biome=suffix??'temperate',p=villageBiomes[biome];
  const ink='var(--sm-village-ink, #68574b)',snow='var(--sm-snow, #f2f6f8)',voidFill='var(--sm-void, #6b5460)';
  const t=role=>`var(--sm-village-${biome}-${role}, ${p[role]})`;
  const material=(name,value)=>`var(--sm-village-${name}, ${value})`;
  const tile=material('tile','#b78977'),tileLight=material('tile-light','#d3aa91');
  const slate=material('slate','#87939e'),slateLight=material('slate-light','#adb7bd');
  let body='',sil='';
  const n=v=>Number(v.toFixed(2));
  const poly=pts=>pts.map(([x,y],i)=>`${i?'L':'M'}${n(x)},${n(y)}`).join(' ')+'Z';
  const path=(d,fill='none',sw=.6,extra='')=>`<path d="${d}" fill="${fill}" stroke="${ink}" stroke-width="${n(sw*.42)}" ${extra}/>`;
  const shape=(d,fill,sw=1.9)=>{
    body+=path(d,fill,sw);
    sil+=`<path d="${d}" fill="currentColor" stroke="currentColor" stroke-width="${n(sw*.42)}"/>`;
  };
  const rectPath=(x,y,w,h)=>`M${n(x)},${n(y)}h${n(w)}v${n(h)}h${n(-w)}Z`;
  const softRect=(x,y,w,h)=>{
    const r=Math.min(.8,w*.15,h*.15);
    return `M${n(x+r)},${n(y)}H${n(x+w-r)}Q${n(x+w)},${n(y)} ${n(x+w)},${n(y+r)}V${n(y+h-r)}Q${n(x+w)},${n(y+h)} ${n(x+w-r)},${n(y+h)}H${n(x+r)}Q${n(x)},${n(y+h)} ${n(x)},${n(y+h-r)}V${n(y+r)}Q${n(x)},${n(y)} ${n(x+r)},${n(y)}Z`;
  };
  const rect=(x,y,w,h,fill,sw=.8,casts=false)=>casts?shape(softRect(x,y,w,h),fill,sw):body+=path(softRect(x,y,w,h),fill,sw);
  const line=(d,sw=.6,opacity=1)=>body+=path(d,'none',sw,`opacity="${opacity}"`);
  const circle=(x,y,r,fill,sw=.8,casts=false)=>{
    body+=`<circle cx="${n(x)}" cy="${n(y)}" r="${n(r)}" fill="${fill}" stroke="${ink}" stroke-width="${n(sw*.42)}"/>`;
    if(casts)sil+=`<circle cx="${n(x)}" cy="${n(y)}" r="${n(r)}" fill="currentColor" stroke="currentColor" stroke-width="${n(sw*.42)}"/>`;
  };
  function roof(x,y,w,h,{kind='local',porch=false,form=variant,handmade=false}={}) {
    const thatched=kind==='thatch'||biome==='tropical'||(biome==='temperate'&&kind==='local');
    const main=kind==='tile'?tile:kind==='slate'?slate:kind==='thatch'&&biome==='coastal'?material('coastal-thatch','#b8ab8b'):t('roof');
    const light=kind==='tile'?tileLight:kind==='slate'?slateLight:kind==='thatch'&&biome==='coastal'?material('coastal-thatch-light','#d4c7a6'):t('light');
    const draw=biome==='desert'?desertRoof:biome==='tundra'?tundraRoof:thatched?(handmade&&biome!=='tropical'?medievalHousing:tropicalRoof):biome==='coastal'?coastalRoof:medievalHousing;
    // The ridge follows the long dimension. Native panel coordinates avoid a
    // transpose that would also transpose the lighting normal at render time.
    const panels=[[x,y,x+w,y+h,...(w>=h?['x']:[])]];
    const art=draw({key:'rural-roof',panels},(form+Math.round(x+y+w))%8,
      {material:thatched?'thatch':kind==='slate'?'slate':'tile',detailScale:porch?.4:.85,features:biome==='desert'&&!porch});
    body+=art.body.replace(/var\(--sm-city-roof-ink,[^)]+\)/g,ink)
      .replace(/var\(--sm-city-[a-z]+-(roof|light|wall|accent),[^)]+\)/g,(_,role)=>role==='roof'?main:role==='light'?light:t(role))
      .replace(/--sm-city-tundra-snow-shade/g,'--sm-village-tundra-snow-shade');
    sil+=art.sil;
  }
  function house(x,y,w,h,{kind='local',entry=true}={}) {
    // Visible wall band and a small entry belong to a detached rural house.
    rect(x+2,y+2,w-4,h+2,t('wall'),1.4,true);
    if(biome==='tropical')for(const X of [x+3,x+w-5])for(const Y of [y+3,y+h])rect(X,Y,2,5,t('wood'),.75,true);
    roof(x,y,w,h,{kind});
    for(const X of [x+5,x+w-9])rect(X,y+h+.8,4,1.4,t('wood'),.45);
    if(entry) {
      const px=x+w*.5-4;
      rect(px+.8,y+h-1,6.4,7,t('wood'),.9,true);
      roof(px,y+h-2,8,6,{kind,porch:true});
      rect(px+2.7,y+h+4,2.6,1.5,voidFill,.5);
    }
    if(w>30&&h>21&&biome!=='tropical'&&biome!=='desert') {
      const X=x+w-10,Y=y+5;
      if(biome==='tundra')body+=path(poly([[X-1,Y-.8],[X+5,Y-1],[X+5.8,Y+5],[X-1.5,Y+6]]),snow,0);
      rect(X,Y,4.5,5.5,t('wall'),.8);rect(X+.7,Y+.8,3.1,1.4,voidFill,.45);
    }
  }
  function hut(kind='thatch',round=false) {
    const cx=32,cy=31;
    rect(28,46,8,7,t('wood'),1,true);
    const d='M50.4,30.5C51.1,41.5 43.8,49.3 32.2,49.7C20.5,49.4 12.3,42 13.2,31.3C12.8,20.8 21.2,12.4 32.3,12.4C43,12.1 50.1,20.8 50.4,30.5Z';
    const hutRoof=kind==='mud'?material('mud','#c3a080'):round?material('reed','#a99c83'):biome==='coastal'?material('coastal-thatch','#b8ab8b'):t('roof');
    const hutLight=kind==='mud'?material('mud-light','#ddbc98'):round?material('reed-light','#c9bea4'):biome==='coastal'?material('coastal-thatch-light','#d4c7a6'):t('light');
    shape(d,biome==='desert'?t('wall'):hutRoof,2);
    // Paired cone facets share the same sun as pitched roofs, even when a
    // hut turns. Small broken fibres replace long, ruler-straight spokes.
    const mud=biome==='desert'||kind==='mud';
    const dark=biome==='tundra'?material('tundra-snow-shade','#d6e1e6'):hutRoof;
    const bright=biome==='tundra'?snow:hutLight;
    const sector=angle=>{
      const a=(angle-22.5)*Math.PI/180,b=(angle+22.5)*Math.PI/180,R=17.3;
      return `M${cx},${cy}L${n(cx+R*Math.cos(a))},${n(cy+R*Math.sin(a))}A${R},${R} 0 0 1 ${n(cx+R*Math.cos(b))},${n(cy+R*Math.sin(b))}Z`;
    };
    for(let angle=0;angle<180;angle+=45)body+=`<g data-roof-axis="${angle}">${path(sector(angle+180),bright,0,'data-roof-face="negative"')}${path(sector(angle),dark,0,'data-roof-face="positive"')}</g>`;
    if(mud) {
      line('M18,37Q23,40 27,40M35,41Q42,40 46,36',.45,.35);
      circle(33,27,2.4,t('accent'),.65);
    } else {
      for(let i=0;i<48;i++)for(let ring=0;ring<3;ring++) {
        if((i+ring)%5===0)continue;
        const a=i*Math.PI/24+ring*.07,inner=5+ring*4+Math.sin(i*1.7)*.6,outer=inner+2.7;
        line(`M${n(cx+Math.cos(a)*inner)},${n(cy+Math.sin(a)*inner)}Q${n(cx+Math.cos(a+.015)*(inner+1.4))},${n(cy+Math.sin(a+.015)*(inner+1.4))} ${n(cx+Math.cos(a)*outer)},${n(cy+Math.sin(a)*outer)}`,.45,.38);
      }
      if(round)circle(32,31,10.5,'none',.4);
      circle(32,30,3.3,t('wood'),.7);circle(32,30,1.3,voidFill,.4);
    }
    roof(27.5,45,9,6,{kind,porch:true});
    rect(30.5,51,3,1.7,voidFill,.45);
  }
  function belfry(x,y,s=10) {
    rect(x,y,s,s,t('wall'),1.2,true);
    roof(x,y,s,s,{kind:'slate',porch:true});
  }
  function wallPart(x=0,y=26,w=64,h=12) {
    const start=body.length;
    // Exactly periodic masonry and posts; the full-bleed ends have no end cap.
    if(biome==='tundra'||biome==='tropical') {
      shape(rectPath(x,y,w,h),t('wood'),0);
      sil+=`<path d="${rectPath(x,y-.35,w,h+.7)}" fill="currentColor" stroke="none"/>`;
      for(let X=x+2;X<x+w;X+=4) {
        body+=path(poly([[X-1.5,y+h],[X-1.5,y+1.5],[X,y],[X+1.5,y+1.5],[X+1.5,y+h]]),t('light'),.65);
      }
      if(biome==='tundra')body+=path(`M${x},${y+2}h${w}v1.5h-${w}Z`,snow,0);
      line(`M${x},${y+h-2}h${w}`,.8);
    } else {
      shape(rectPath(x,y,w,h),t('wall'),0);
      body+=`<g stroke-linecap="butt">${path(`M${x},${y+.7}h${w}M${x},${y+h-.7}h${w}`,'none',1.4)}</g>`;
      for(let yy=y+3;yy<y+h-1;yy+=3) {
        line(`M${x},${yy}h${w}`,.45,.65);
        for(let xx=x+(((yy-y)/3)%2?4:8);xx<x+w;xx+=8)line(`M${xx},${yy}v2.8`,.4,.65);
      }
      rect(x,y+1.6,w,2,t('light'),0);
    }
    body=body.slice(0,start)+`<g stroke-linecap="butt">${body.slice(start)}</g>`;
  }
  function cottage(x,y,w,h,kind='local',boat=false) {
    const q=variant%8;
    // Each plan fits the same surveyed slot. Wings have their own roof axes;
    // shortening a main range makes room for an addition instead of stacking
    // identical rectangular porches on every house.
    const plans=[
      [[0,.02,1,.86],[.04,.59,.34,.42]],
      [[.07,.02,.83,.96]],
      [[0,.03,.77,.94],[.65,.4,.35,.55]],
      [[0,.01,1,.7],[.57,.48,.4,.53]],
      [[.16,0,.68,1],[.01,.14,.32,.65]],
      [[.02,.04,.96,.8],[.1,.62,.44,.38]],
      [[.04,0,.73,1],[.65,.06,.35,.55]],
      [[.02,.04,.96,.71],[.36,.48,.48,.52]],
    ];
    const panels=plans[q].map(([u,v,a,b])=>[x+u*w,y+v*h,w*a,h*b]);
    // Low, uneven plaster glimpses, not a white rectangular foundation slab.
    for(const [X,Y,W,H] of panels)shape(poly([[X+1.5,Y+1],[X+W-2,Y+1.7],
      [X+W-1.8,Y+H+1.1],[X+W*.58,Y+H+1.7],[X+2,Y+H+.7]]),t('wall'),.65);
    if(biome==='tropical')for(const[X,Y,W,H]of panels)for(const u of [.14,.81])rect(X+u*W,Y+H-.5,1.3,3,t('wood'),.45,true);
    const px=x+w*.5-4+(q%3-1)*1.5;
    if(!boat) {
      // The doorway remains near the nominal south entrance for access paths.
      shape(poly([[px+.4,y+h-5],[px+7,y+h-5.5],[px+7.2,y+h+4.5],[px+1,y+h+4.8]]),t('wall'),.65);
      roof(px-1,y+h-6,10+(q%2),9,{kind,porch:true,handmade:true,form:q+2});
    }
    for(const [i,[X,Y,W,H]]of panels.entries())roof(X,Y,W,H,{kind,handmade:true,form:q+i*3});
    // Some houses have an off-centre cross-gable, others a low lean-to.
    if(q===1||q===4)roof(px-1,y+h-9,10,12,{kind,porch:true,handmade:true,form:q+1});
    if(!boat)rect(px+3,y+h+3,2.4,1.5,voidFill,.35);
    if(q%3!==1) {
      const [X,Y,W,H]=panels[0];
      rect(X+W*.19,Y+H+.2,2.4,1,t('wood'),.3);
    }
    if(biome!=='tropical'&&biome!=='desert') {
      const [X,Y,W,H]=panels[0],cx=X+W*[.22,.72,.38,.68,.52,.78,.27,.63][q],cy=Y+H*(.25+(q%3)*.12);
      shapeChimney(cx,cy,2.4+(q%2)*.5);
    }
    if(boat){rect(18,43,28,3,voidFill,.8);line('M16,45V47M25,45V47M39,45V47M48,45V47',.6);}
  }
  function shapeChimney(x,y,w) {
    // Slightly skewed masonry, sized to the dwelling rather than the old slab.
    body+=path(poly([[x,y],[x+w,y+.25],[x+w-.2,y+3.6],[x-.3,y+3.3]]),t('wall'),.7);
    body+=path(poly([[x+.4,y+.6],[x+w-.5,y+.75],[x+w-.6,y+1.6],[x+.3,y+1.4]]),voidFill,0);
  }
  if(base==='sm-house')cottage(12,15,40,31);
  else if(base==='sm-house-tiled')cottage(11,15,42,31,'tile');
  else if(base==='sm-house-large-tiled')cottage(8,13,48,33,'slate');
  else if(base==='sm-longhouse')cottage(6,20,52,23);
  else if(base==='sm-boathouse')cottage(7,20,50,22,'local',true);
  else if(base.startsWith('sm-hut'))hut(base==='sm-hut-mud'?'mud':'thatch',base==='sm-hut-round');
  else if(base==='sm-inn') {
    // A rural lodging house with an open stable yard, not an urban perimeter block.
    house(7,11,50,24,{kind:biome==='temperate'?'tile':'local',entry:false});
    house(7,34,14,17,{entry:false});
    house(43,34,14,17,{entry:false});
    roof(26,31,12,7,{kind:'local',porch:true});
    rect(29,37,6,2,voidFill,.55);
    rect(47,45,6,3,t('accent'),.65);
  }
  else if(base==='sm-chapel'&&biome==='desert') {
    rect(12,12,40,38,t('wall'),1.8,true);
    for(const[x,y]of [[16,16],[48,16],[16,46],[48,46]])circle(x,y,3,t('roof'),.9,true);
    circle(32,30,12,t('light'),1.3);body+=path('M22,30Q32,15 42,30Q32,24 22,30Z',t('roof'),0);
    line('M32,19V41M22,30Q32,36 42,30',.55,.65);circle(32,30,1.1,t('accent'),.6);
    rect(27,49,10,5,t('wall'),.7,true);line('M27,51H37M27,52.5H37',.5);
  }
  else if(base==='sm-chapel'&&biome==='tropical') {
    rect(12,15,40,35,t('wood'),1.1,true);
    roof(8,21,48,27);roof(15,14,34,24);roof(23,10,18,15,{porch:true});
    rect(27,48,10,6,t('wood'),.8,true);line('M27.5,50H36.5M27.5,52H36.5',.65);
  }
  else if(base==='sm-chapel') {
    shape('M22,15V12Q22,3 32,3Q42,3 42,12V15Z',biome==='tundra'?snow:biome==='temperate'?slate:t('roof'),1.8);
    house(22,8,20,40,{kind:biome==='temperate'?'slate':'local'});belfry(26,40,12);
  }
  else if(base==='sm-cathedral') {
    shape('M22,14V11Q22,3 32,3Q42,3 42,11V14Z',slate,1.8);
    house(7,20,50,15,{kind:'slate',entry:false});house(22,7,20,43,{kind:'slate'});
    belfry(27,24,10);belfry(18,42,10);belfry(36,42,10);
  }
  else if(base==='sm-temple') {
    rect(9,12,46,40,t('wall'),1.8,true);
    for(const x of [13,51])for(let y=18;y<47;y+=7)circle(x,y,1.6,t('light'),.7);
    roof(18,14,28,33,{kind:'tile'});rect(22,50,20,4,t('wall'),.7,true);line('M22,51.4H42M22,52.8H42',.5);
  }
  else if(base==='sm-kit-wall')wallPart();
  else if(base==='sm-kit-corner') {
    wallPart(0,26,38,12);
    // Use a rotated copy of the same 64-period construction for the south arm.
    const beforeBody=body,beforeSil=sil;body='';sil='';wallPart(32,26,32,12);
    body=beforeBody+`<g transform="rotate(90,32,32)">${body}</g>`;
    sil=beforeSil+`<g transform="rotate(90,32,32)">${sil}</g>`;
  }
  else if(base==='sm-kit-gate') {
    wallPart();rect(23,23,18,18,t('wood'),1.1,true);
    if(biome==='tundra'||biome==='tropical'){
      roof(17,23,30,18,{porch:true});line('M22,29V38M42,29V38',1.6);
    } else {
      house(10,18,14,26,{entry:false});house(40,18,14,26,{entry:false});
      rect(25,26,14,12,voidFill,.65);for(let x=27;x<39;x+=3)line(`M${x},27V37`,.7);
      line('M25,30H39M25,34H39',.65);
    }
  }
  else if(base==='sm-kit-keep') {
    house(11,16,42,30,{kind:'slate'});
    for(const[x,y]of [[9,14],[43,14]])belfry(x,y,12);
  }
  else if(base==='sm-kit-tower-drum'||(base==='sm-kit-tower'&&biome==='coastal')) {
    circle(32,32,17,t('wall'),1.9,true);circle(32,32,12.3,t('roof'),1);
    for(let i=0;i<8;i++){
      const a=i*Math.PI/4,x=32+14.5*Math.cos(a),y=32+14.5*Math.sin(a);circle(x,y,1.3,t('light'),.6);
    }
    if(biome==='coastal'){circle(32,32,6.5,t('light'),.9);line('M28,28L36,36M36,28L28,36',.65);}
  }
  else if(base==='sm-kit-tower-square'||base==='sm-kit-tower') {
    if(biome==='tropical'||biome==='tundra') {
      for(const[x,y]of [[18,18],[43,18],[18,43],[43,43]])rect(x,y,3,5,t('wood'),.85,true);
      rect(20,45,24,3,t('wood'),.8,true);roof(16,17,32,29,{});line('M21,47H43',.7);
    } else {
      rect(16,16,32,32,t('wall'),1.9,true);roof(21,21,22,22,{kind:'slate'});
      for(const[x,y]of [[18,18],[42,18],[18,42],[42,42]])rect(x,y,4,4,t('light'),.7);
    }
  }
  else throw new Error(`No village drawing for ${id}`);
  // Match the original apse vectors: cathedral east; these chapels south.
  const angle=base==='sm-cathedral'?90:base==='sm-chapel'&&!['desert','tropical'].includes(biome)?180:0;
  if(angle){body=`<g transform="rotate(${angle},32,32)">${body}</g>`;sil=`<g transform="rotate(${angle},32,32)">${sil}</g>`;}
  return {body:flattenRoofSections(`<g stroke-linejoin="round" stroke-linecap="round">${body}</g>`),sil:`<g stroke-linejoin="round" stroke-linecap="round">${sil}</g>`,biome,
    family:base,category:base.includes('kit-')?'fortification':/chapel|cathedral|temple/.test(base)?'faith':'dwelling'};
}
