/** Rural building drawings: detached roofs, porches, local materials. */
export const villageBiomes = {
  temperate:{roof:'#b49b72',light:'#dac59d',wall:'#ded4be',accent:'#a5786e',wood:'#95816b',ground:'#a3c98d',description:'Thatch, warm plaster, timber porches and occasional tile or slate'},
  desert:{roof:'#c4ac89',light:'#e5d1ad',wall:'#ecddc1',accent:'#739b99',wood:'#ac916f',ground:'#d9c48f',description:'Earthen roof terraces, rounded adobe huts, shade porches and pale plaster'},
  tundra:{roof:'#85878c',light:'#adb3b8',wall:'#c6c6bd',accent:'#8c7775',wood:'#968879',ground:'#e6ecef',description:'Compact timber buildings, covered entries, steep roofs and settled roof snow'},
  tropical:{roof:'#ad9971',light:'#d1c193',wall:'#c9b58e',accent:'#769788',wood:'#8e7a5f',ground:'#6d9e5c',description:'Palm-thatch hips, raised timber floors, broad eaves and open verandas'},
  coastal:{roof:'#899b98',light:'#b2bdb5',wall:'#dedbca',accent:'#8b90a4',wood:'#9a9181',ground:'#cfd6b0',description:'Weathered shingles, pale walls, thatched huts and sheltered seaward roofs'},
};

export function drawVillage(id) {
  const [base,suffix]=id.split('--'),biome=suffix??'temperate',p=villageBiomes[biome];
  const ink='var(--sm-ink, #33262e)',snow='var(--sm-snow, #f2f6f8)',voidFill='var(--sm-void, #6b5460)';
  const t=role=>`var(--sm-village-${biome}-${role}, ${p[role]})`;
  const material=(name,value)=>`var(--sm-village-${name}, ${value})`;
  const tile=material('tile','#b78977'),tileLight=material('tile-light','#d3aa91');
  const slate=material('slate','#87939e'),slateLight=material('slate-light','#adb7bd');
  let body='',sil='';
  const n=v=>Number(v.toFixed(2));
  const poly=pts=>pts.map(([x,y],i)=>`${i?'L':'M'}${n(x)},${n(y)}`).join(' ')+'Z';
  const path=(d,fill='none',sw=.6,extra='')=>`<path d="${d}" fill="${fill}" stroke="${ink}" stroke-width="${sw}" ${extra}/>`;
  const shape=(d,fill,sw=1.9)=>{
    body+=path(d,fill,sw);
    sil+=`<path d="${d}" fill="currentColor" stroke="currentColor" stroke-width="${sw}"/>`;
  };
  const rectPath=(x,y,w,h)=>`M${n(x)},${n(y)}h${n(w)}v${n(h)}h${n(-w)}Z`;
  const rect=(x,y,w,h,fill,sw=.8,casts=false)=>casts?shape(rectPath(x,y,w,h),fill,sw):body+=path(rectPath(x,y,w,h),fill,sw);
  const line=(d,sw=.6,opacity=1)=>body+=path(d,'none',sw,`opacity="${opacity}"`);
  const circle=(x,y,r,fill,sw=.8,casts=false)=>{
    body+=`<circle cx="${n(x)}" cy="${n(y)}" r="${n(r)}" fill="${fill}" stroke="${ink}" stroke-width="${sw}"/>`;
    if(casts)sil+=`<circle cx="${n(x)}" cy="${n(y)}" r="${n(r)}" fill="currentColor" stroke="currentColor" stroke-width="${sw}"/>`;
  };
  function roof(x,y,w,h,{cover='plane',kind='local',porch=false,axisLocked=false}={}) {
    // Long naves and taller annexes need a ridge along their long dimension.
    // Transpose only the roof; their south-facing porch stays with the house.
    if(!axisLocked&&h>w*1.1) {
      const previousBody=body,previousSil=sil;body='';sil='';
      roof(y,x,h,w,{cover,kind,porch,axisLocked:true});
      body=previousBody+`<g transform="matrix(0 1 1 0 0 0)">${body}</g>`;
      sil=previousSil+`<g transform="matrix(0 1 1 0 0 0)">${sil}</g>`;
      return;
    }
    const flat=biome==='desert',thatched=kind==='thatch'||biome==='tropical'||(biome==='temperate'&&kind==='local');
    const main=kind==='tile'?tile:kind==='slate'?slate:kind==='thatch'&&biome==='coastal'?material('coastal-thatch','#b8ab8b'):t('roof');
    const light=kind==='tile'?tileLight:kind==='slate'?slateLight:kind==='thatch'&&biome==='coastal'?material('coastal-thatch-light','#d4c7a6'):t('light');
    const hip=porch?2:biome==='tropical'?Math.min(8,w*.19):Math.min(5,w*.14),ry=y+h*.48;
    // Modest irregularity distinguishes hand-built eaves from party-wall modules.
    const outline=poly([[x+.4,y+.3],[x+w-.5,y],[x+w,y+h-.6],[x+w*.65,y+h],[x+.1,y+h-.3]]);
    shape(outline,main,porch?1.3:2);
    if(flat) {
      rect(x+2.4,y+2.4,w-4.8,h-4.8,light,.8);
      for(let yy=y+6;yy<y+h-3;yy+=4.5)line(`M${n(x+4)},${n(yy)}L${n(x+w-4)},${n(yy+.12)}`,.42,.4);
      if(w>24&&h>18){rect(x+w-10,y+h-8,5,4,t('wood'),.7);circle(x+6,y+6,1.5,t('accent'),.65);}
      return;
    }
    body+=path(poly([[x+1.4,y+1.3],[x+w-1.5,y+1],[x+w-hip,ry],[x+hip,ry]]),light,0);
    for(let xx=x+3.5;xx<x+w-2;xx+=thatched?2.6:3.3){
      const f=(xx-x)/w,edge=Math.min(f,1-f),stop=ry-Math.max(0,hip-edge*w)*.45;
      line(`M${n(xx)},${n(y+2.3)}L${n(xx+.18*Math.sin(xx))},${n(stop-1)}`,.5,.7);
      line(`M${n(xx+.1)},${n(ry+1.2)}L${n(xx-.2*Math.sin(xx))},${n(y+h-2.3)}`,.5,.7);
      if(!thatched&&!porch)line(`M${n(xx)},${n(y+h*.74)}h1.1`,.4,.6);
    }
    if(biome==='tundra') {
      if(cover==='full')body+=path(poly([[x+1.3,y+1.3],[x+w-1.5,y+1.2],[x+w-1.3,y+h-1.4],[x+1.3,y+h-1.5]]),snow,0);
      else {
        if(cover==='plane')body+=path(poly([[x+1.3,y+1.4],[x+w-1.4,y+1.2],[x+w-hip,ry-.15],[x+hip,ry-.15]]),snow,0);
        const depth=Math.min(4,h*.22);
        const edge=[[x+1.3,y+h-1.5],[x+1.4,y+h-depth],[x+w*.24,y+h-depth*.85],[x+w*.43,y+h-depth*1.15],[x+w*.62,y+h-depth*.75],[x+w*.81,y+h-depth],[x+w-1.4,y+h-depth*.9],[x+w-1.4,y+h-1.5]];
        body+=path(poly(edge),snow,0);
        if(cover==='eaves')body+=path(poly(edge.map(([X,Y])=>[X,y+h-(Y-y)])),snow,0);
      }
    }
    const buried=biome==='tundra'&&cover==='full';
    line(`M${n(x+hip)},${n(ry)}L${n(x+w-hip)},${n(ry+.1)}`,buried?.5:1.1,buried?.3:1);
    line(`M${n(x+1.4)},${n(y+1.3)}L${n(x+hip)},${n(ry)}L${n(x+1.4)},${n(y+h-1.5)}M${n(x+w-1.5)},${n(y+1.3)}L${n(x+w-hip)},${n(ry)}L${n(x+w-1.5)},${n(y+h-1.5)}`,.55,buried?.25:.8);
    if(thatched&&!porch)line(`M${n(x+hip+1)},${n(ry-1)}L${n(x+w-hip-1)},${n(ry-.8)}`,.45,.7);
  }
  function house(x,y,w,h,{kind='local',cover='plane',entry=true}={}) {
    // Visible wall band and a small entry belong to a detached rural house.
    rect(x+2,y+2,w-4,h+2,t('wall'),1.4,true);
    if(biome==='tropical')for(const X of [x+3,x+w-5])for(const Y of [y+3,y+h])rect(X,Y,2,5,t('wood'),.75,true);
    roof(x,y,w,h,{kind,cover});
    for(const X of [x+5,x+w-9])rect(X,y+h+.8,4,1.4,t('wood'),.45);
    if(entry) {
      const px=x+w*.5-4;
      rect(px+.8,y+h-1,6.4,7,t('wood'),.9,true);
      roof(px,y+h-2,8,6,{kind,cover:'full',porch:true});
      rect(px+2.7,y+h+4,2.6,1.5,voidFill,.5);
    }
    if(w>30&&h>21&&biome!=='tropical'&&biome!=='desert') {
      const X=x+w-10,Y=y+5;
      if(biome==='tundra')body+=path(poly([[X-1,Y-.8],[X+5,Y-1],[X+5.8,Y+5],[X-1.5,Y+6]]),snow,0);
      rect(X,Y,4.5,5.5,t('wall'),.8);rect(X+.7,Y+.8,3.1,1.4,voidFill,.45);
    }
  }
  function hut(kind='thatch',round=false) {
    const cx=32,cy=31,r=18.5;
    rect(28,46,8,7,t('wood'),1,true);
    const d='M50.4,30.5C51.1,41.5 43.8,49.3 32.2,49.7C20.5,49.4 12.3,42 13.2,31.3C12.8,20.8 21.2,12.4 32.3,12.4C43,12.1 50.1,20.8 50.4,30.5Z';
    const hutRoof=kind==='mud'?material('mud','#c3a080'):round?material('reed','#a99c83'):biome==='coastal'?material('coastal-thatch','#b8ab8b'):t('roof');
    const hutLight=kind==='mud'?material('mud-light','#ddbc98'):round?material('reed-light','#c9bea4'):biome==='coastal'?material('coastal-thatch-light','#d4c7a6'):t('light');
    shape(d,biome==='desert'?t('wall'):hutRoof,2);
    if(biome==='desert'||kind==='mud') {
      body+=path('M16,30C15.7,21.5 24,14.7 32,15C42,14.5 47.4,22 47.5,30C41,25.8 23,25.8 16,30Z',hutLight,0);
      line('M18,37Q32,44 46,36',.55,.55);circle(33,27,2.4,t('accent'),.8);
    } else {
      body+=path('M15.5,30.4C15.5,21 24,14.8 32.2,14.8C41.5,14.6 48.1,22.4 48,30L32,29Z',hutLight,0);
      for(let i=0;i<28;i++) {
        const a=i*Math.PI/14,inner=4.5,outer=r-2.1+Math.sin(i*1.7)*.5;
        line(`M${n(cx+Math.cos(a)*inner)},${n(cy+Math.sin(a)*inner)}L${n(cx+Math.cos(a)*outer)},${n(cy+Math.sin(a)*outer)}`,.5,.7);
      }
      if(round)circle(32,31,10.5,'none',.45);
      if(biome==='tundra')body+=path('M15.7,30.4C15.8,21.6 23,14.6 32.3,14.6C41.4,14.4 48,22 48,30.3L43,31.2L38,30.1L33,31.3L27,30.5L22,31.5Z',snow,0);
      circle(32,30,3.3,t('wood'),.9);circle(32,30,1.3,voidFill,.4);
    }
    roof(27.5,45,9,6,{kind,cover:'full',porch:true});
    rect(30.5,51,3,1.7,voidFill,.45);
  }
  function belfry(x,y,s=10) {
    rect(x,y,s,s,t('wall'),1.2,true);
    body+=path(poly([[x,y],[x+s/2,y+s/2],[x+s,y],[x+s/2,y+1]]),biome==='tundra'?snow:t('accent'),.7);
    line(`M${x},${y+s}L${x+s/2},${y+s/2}L${x+s},${y+s}M${x},${y}L${x+s/2},${y+s/2}L${x+s},${y}`, .7);
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
  if(base==='sm-house')house(12,15,40,31);
  else if(base==='sm-house-tiled')house(11,15,42,31,{kind:'tile'});
  else if(base==='sm-house-large-tiled') {
    house(8,13,48,33,{kind:'slate'});roof(9,34,13,14,{kind:'tile',porch:true});
  }
  else if(base==='sm-longhouse')house(6,20,52,23,{cover:'eaves'});
  else if(base==='sm-boathouse') {
    // Open mouth faces south/water. Roof above, weathered slip timbers below.
    rect(10,24,44,24,t('wood'),1.2,true);house(7,20,50,22,{entry:false});
    rect(18,43,28,3,voidFill,.8);line('M16,45V47M25,45V47M39,45V47M48,45V47',.6);
  }
  else if(base.startsWith('sm-hut'))hut(base==='sm-hut-mud'?'mud':'thatch',base==='sm-hut-round');
  else if(base==='sm-inn') {
    // A rural lodging house with an open stable yard, not an urban perimeter block.
    house(7,11,50,24,{kind:biome==='temperate'?'tile':'local',cover:'plane',entry:false});
    house(7,34,14,17,{cover:'eaves',entry:false});
    house(43,34,14,17,{cover:'full',entry:false});
    roof(26,31,12,7,{kind:'local',porch:true,cover:'full'});
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
    house(22,8,20,40,{kind:biome==='temperate'?'slate':'local',cover:'full'});belfry(26,40,12);
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
      roof(17,23,30,18,{cover:'full',porch:true});line('M22,29V38M42,29V38',1.6);
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
      rect(20,45,24,3,t('wood'),.8,true);roof(16,17,32,29,{cover:'full'});line('M21,47H43',.7);
    } else {
      rect(16,16,32,32,t('wall'),1.9,true);roof(21,21,22,22,{kind:'slate',cover:'full'});
      for(const[x,y]of [[18,18],[42,18],[18,42],[42,42]])rect(x,y,4,4,t('light'),.7);
    }
  }
  else throw new Error(`No village drawing for ${id}`);
  // Match the original apse vectors: cathedral east; these chapels south.
  const angle=base==='sm-cathedral'?90:base==='sm-chapel'&&!['desert','tropical'].includes(biome)?180:0;
  if(angle){body=`<g transform="rotate(${angle},32,32)">${body}</g>`;sil=`<g transform="rotate(${angle},32,32)">${sil}</g>`;}
  return {body:`<g stroke-linejoin="round" stroke-linecap="round">${body}</g>`,sil:`<g stroke-linejoin="round" stroke-linecap="round">${sil}</g>`,biome,
    family:base,category:base.includes('kit-')?'fortification':/chapel|cathedral|temple/.test(base)?'faith':'dwelling'};
}
