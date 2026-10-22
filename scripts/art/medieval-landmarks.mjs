import { medievalHousing } from './medieval-housing.mjs';

/** Temperate landmark kit. Every detail stays on an existing surveyed panel. */
export function medievalLandmark(family) {
  const ink='var(--sm-city-roof-ink, #68574b)';
  const stone='var(--sm-city-temperate-wall, #d6c7ad)';
  const roof='var(--sm-city-temperate-roof, #858e9f)';
  const light='var(--sm-city-temperate-light, #aab2bd)';
  const accent='var(--sm-city-temperate-accent, #9f8c6c)';
  const fmt=v=>Number(v.toFixed(2));
  const xy=p=>p.map(fmt).join(',');
  const path=(d,fill='none',width=.45,extra='')=>`<path d="${d}" fill="${fill}" stroke="${ink}" stroke-width="${width}" ${extra}/>`;
  const round=(x,y,w,h,r=.8)=>`M${fmt(x+r)},${fmt(y)}H${fmt(x+w-r)}Q${fmt(x+w)},${fmt(y)} ${fmt(x+w)},${fmt(y+r)}V${fmt(y+h-r)}Q${fmt(x+w)},${fmt(y+h)} ${fmt(x+w-r)},${fmt(y+h)}H${fmt(x+r)}Q${fmt(x)},${fmt(y+h)} ${fmt(x)},${fmt(y+h-r)}V${fmt(y+r)}Q${fmt(x)},${fmt(y)} ${fmt(x+r)},${fmt(y)}Z`;
  const rect=(x,y,w,h,fill=stone,width=.45,r=.6)=>path(round(x,y,w,h,r),fill,width);
  const circle=(x,y,r,fill,width=.45)=>`<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" stroke="${ink}" stroke-width="${width}"/>`;
  const sections=[];
  let sil='';
  const section=body=>sections.push(body.replace('<g ',`<g data-roof-section="${sections.length}" `));
  const detail=body=>section(`<g stroke-linejoin="round" stroke-linecap="round">${body}</g>`);
  const foundation=(x,y,X,Y)=>{
    const d=round(x+.4,y+.4,X-x-.8,Y-y-.8,1.1);
    let masonry='';
    for(let row=0,v=y+3;v<Y-2;v+=4,row++)for(let u=x+2+(row%2)*2;u<X-3;u+=6)
      masonry+=path(`M${fmt(u)},${fmt(v+.15)}l${fmt(Math.min(3.4,X-u-2))},-.15v1.3`,'none',.18,'opacity=".22"');
    detail(path(d,stone,.35,'stroke-opacity=".6"')+masonry);
    sil+=`<path d="${d}" fill="currentColor" stroke="currentColor" stroke-width=".35"/>`;
  };
  const panel=(bounds,variant=0,scale=.65)=>{
    const art=medievalHousing({key:family.key,panels:[bounds]},variant,{detailScale:scale,material:family.category==='palace'?'tile':'slate',features:false});
    section(art.body);
  };
  const steps=(x,y,w)=>detail(rect(x,y,w,3.8,stone,.35,.45)
    +path(`M${x+.3},${y+1.3}h${w-.6}M${x+.3},${y+2.6}h${w-.6}`,'none',.25,'opacity=".5"'));
  // Four hipped planes share rounded outer corners, with a sharp roof apex.
  const pyramid=(cx,cy,s)=>{
    const r=Math.min(1.1,s*.18);
    const rotate=([x,y],turn)=>{
      for(let i=0;i<turn;i++)[x,y]=[-y,x];
      return [cx+x,cy+y];
    };
    const face=(turn,fill,sign)=>{
      const p=v=>xy(rotate(v,turn));
      return path(`M${cx},${cy}L${p([-s+r*.293,-s+r*.293])}Q${p([-s+r*.586,-s])} ${p([-s+r,-s])}L${p([s-r,-s])}Q${p([s-r*.586,-s])} ${p([s-r*.293,-s+r*.293])}Z`,fill,0,`data-roof-face="${sign}"`);
    };
    section(`<g data-roof-axis="x">${face(3,light,'negative')}${face(1,roof,'positive')}</g>`);
    section(`<g data-roof-axis="y">${face(0,light,'negative')}${face(2,roof,'positive')}</g>`);
    let courses='';
    const pitch=s>12?2.4:1.6;
    for(let turn=0;turn<4;turn++)for(let v=pitch;v<s-.6;v+=pitch) {
      courses+=path(`M${xy(rotate([-v+.4,-v],turn))}L${xy(rotate([v-.4,-v],turn))}`,'none',.22,'opacity=".4"');
      for(let u=-v+1.3;u<v-.8;u+=2.9)courses+=path(`M${xy(rotate([u,-v],turn))}L${xy(rotate([u*.8,-v+Math.min(1.2,v*.3)],turn))}`,'none',.18,'opacity=".32"');
    }
    detail(courses+circle(cx,cy,.45,accent,.2));
  };
  const lantern=(cx,cy,s)=>{
    detail(rect(cx-s,cy-s,s*2,s*2,stone,.35,.7)
      +rect(cx-s+.8,cy+s-2,s*2-1.6,1.1,accent,.3,.25));
    pyramid(cx,cy-.8,s-.45);
  };
  const battlements=(x,y,size)=>{
    let blocks='';
    for(let t=2.8;t<size-3;t+=6.8) {
      blocks+=rect(x+t,y+.8,2.8,2.5,stone,.32,.35)+rect(x+t,y+size-3.3,2.8,2.5,stone,.32,.35);
      blocks+=rect(x+.8,y+t,2.5,2.8,stone,.32,.35)+rect(x+size-3.3,y+t,2.5,2.8,stone,.32,.35);
    }
    detail(blocks);
  };
  const bastion=(x,y,size)=>{
    foundation(x,y,x+size,y+size);
    pyramid(x+size/2,y+size/2,size/2-4);
    battlements(x,y,size);
  };
  const feature=family.feature;
  const special=['temple','keep','square-tower','round-tower','castle-gate','wall','pavilion'].includes(feature);
  if(!special) {
    for(const p of family.panels)foundation(...p.slice(0,4));
    for(const [i,p] of family.panels.entries())panel(p,[0,4,1,7][i%4],feature==='state-hall'?.4:['cathedral','cloister','sanctuary'].includes(feature)?.45:.65);
  }
  if(['chapel','private-chapel','castle-chapel'].includes(feature)) {
    lantern(32,46,feature==='chapel'?5.5:4.7);
    steps(27,55,10);
  }
  if(feature==='church') {
    lantern(32,24,5.5); lantern(32,51,5.5); steps(28,55.5,8);
  }
  if(feature==='cathedral') {
    lantern(32,23,5.5); lantern(19.5,54,4.3); lantern(44.5,54,4.3); steps(27,55.5,10);
    for(const y of [34,41])detail(rect(14.5,y,3.2,1.6,stone,.3,.3)+rect(46.3,y,3.2,1.6,stone,.3,.3));
  }
  if(feature==='temple') {
    foundation(8,4,56,60);
    for(const x of [13,51])for(let y=11;y<=48;y+=7.4)detail(circle(x,fmt(y),1.65,stone,.35)+circle(x,fmt(y),.7,stone,.2));
    panel([17,8,47,51],0,.6);
    steps(17,53,30);
  }
  if(feature==='sanctuary') {
    lantern(32,13,4.5);
    for(const x of [15,49])for(let y=23;y<45;y+=6)detail(circle(x,y,1.15,stone,.3));
  }
  if(feature==='cloister') {
    lantern(13.5,46,4.5);
    for(let x=26;x<45;x+=6)detail(rect(x,14,1.7,2.6,stone,.25,.3));
    for(let y=22;y<44;y+=6)detail(rect(47,y,2.6,1.7,stone,.25,.3));
  }
  if(feature==='state-hall') {
    lantern(9,31,4.3); lantern(55,31,4.3); lantern(32,31,6.5); steps(24,48,16);
  }
  if(['wing','barracks','great-hall'].includes(feature)) {
    for(const v of [14,32,50]) {
      const x=feature==='great-hall'?v:21,y=feature==='great-hall'?37:v;
      detail(rect(x-2,y-1,4,3.5,stone,.35,.4)+rect(x-1.3,y+.5,2.6,1.1,accent,.2,.2));
      panel([x-2.5,y-3,x+2.5,y+.7],0,.2);
    }
  }
  if(feature==='pavilion') { foundation(6,6,58,58); pyramid(32,32,24.8); lantern(32,32,6.5); }
  if(feature==='gallery')for(let x=5;x<61;x+=9)detail(rect(x,37,2.6,2.4,stone,.3,.4));
  if(feature==='palace-gate') { lantern(12,30,6.3); lantern(52,30,6.3); }
  if(feature==='keep') {
    foundation(4,4,60,60);
    panel([13,13,51,51],0,.6);
    for(const [x,y] of [[4,4],[44,4],[4,44],[44,44]])bastion(x,y,16);
    steps(25,52,14);
  }
  if(feature==='square-tower')bastion(8,8,48);
  if(feature==='round-tower') {
    detail(circle(32,32,23.5,stone,.4)+circle(32,32,17.2,stone,.3));
    sil='<circle cx="32" cy="32" r="23.5" fill="currentColor" stroke="currentColor" stroke-width=".4"/>';
    const polar=(r,a)=>[32+r*Math.cos(a),32+r*Math.sin(a)];
    const wedge=(a,fill,sign)=>path(`M32,32L${xy(polar(16.5,a-Math.PI/8))}A16.5,16.5 0 0 1 ${xy(polar(16.5,a+Math.PI/8))}Z`,fill,0,`data-roof-face="${sign}"`);
    for(let i=0;i<4;i++) {
      const angle=i*Math.PI/4;
      section(`<g data-roof-axis="${i*45}">${wedge(angle+Math.PI,light,'negative')}${wedge(angle,roof,'positive')}</g>`);
    }
    let courses='';
    for(let r=4.5;r<16;r+=3.5) {
      courses+=`<circle cx="32" cy="32" r="${r}" fill="none" stroke="${ink}" stroke-width=".22" opacity=".4"/>`;
      for(let i=0;i<Math.ceil(r*2);i++) {
        const a=i*Math.PI*2/Math.ceil(r*2)+r*.13;
        courses+=path(`M${xy(polar(r,a))}L${xy(polar(r-1.4,a))}`,'none',.2,'opacity=".35"');
      }
    }
    detail(courses+circle(32,32,.65,accent,.25));
    let blocks='';
    for(let i=0;i<12;i++) {
      const [x,y]=polar(20.1,i*Math.PI/6);
      blocks+=rect(x-1.35,y-1.5,2.7,3,stone,.32,.4).replace('/>',` transform="rotate(${i*30},${fmt(x)},${fmt(y)})"/>`);
    }
    detail(blocks);
  }
  if(feature==='castle-gate') {
    foundation(0,10,25,54); foundation(39,10,64,54);
    panel([3,17,22,47],0,.55); panel([42,17,61,47],4,.55);
    for(const x of [2,20,40,58])for(const y of [12,48])detail(rect(x,y,3.2,3.2,stone,.35,.5));
    detail(path('M23,20V44M41,20V44','none',.6,'opacity=".65"'));
  }
  if(feature==='wall') {
    // Keep repeating ends exactly flush and the full walk inside its footprint.
    detail(path('M0,24H64V40H0Z',stone,0)+path('M0,24.5H64M0,39.5H64','none',.65,'stroke-linecap="butt"')
      +path('M0,29H64V35H0Z',light,0));
    let blocks='';
    for(let x=2;x<64;x+=8)blocks+=rect(x,25.5,4,3,stone,.32,.4)+rect(x,35.5,4,3,stone,.32,.4);
    detail(blocks+path('M0,32H64M8,29V32M24,29V32M40,29V32M56,29V32M16,32V35M32,32V35M48,32V35','none',.23,'opacity=".4" stroke-linecap="butt"'));
    sil='<path d="M0,24H64V40H0Z" fill="currentColor"/>';
  }
  return {body:`<g data-roof-sections="true">${sections.join('')}</g>`,sil};
}
