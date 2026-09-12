/** Native, top-down landscape artwork. Pure functions also power the local gallery. */
export const biomes={
  temperate:{ground:'#a3c98d',leaf:'#769365',light:'#afbf82',dark:'#607d60',soil:'#b69c77',dry:'#d5be84',water:'#95b8ba',flower:'#e3cf9c'},
  desert:{ground:'#d9c48f',leaf:'#909566',light:'#c0bd82',dark:'#626e55',soil:'#bda079',dry:'#d7c28e',water:'#94b9b4',flower:'#dfb1a0'},
  tundra:{ground:'#e6ecef',leaf:'#8c9d81',light:'#bdc4a2',dark:'#627870',soil:'#b1a793',dry:'#c9bf9c',water:'#a6bec6',flower:'#d4b8c9'},
  tropical:{ground:'#6d9e5c',leaf:'#679568',light:'#a3b876',dark:'#507b5d',soil:'#aa8870',dry:'#c7b681',water:'#83aaa2',flower:'#d1a28c'},
  coastal:{ground:'#cfd6b0',leaf:'#8eaa91',light:'#c3c9a0',dark:'#5f8076',soil:'#c0b394',dry:'#d6cda5',water:'#a0bec1',flower:'#cdb3cc'},
};
export const n=v=>Number(v.toFixed(2));
export const xml=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
export const ink='var(--sm-ink, #33262e)';
export const snow='var(--sm-snow, #f2f6f8)';
export const token=(b,k)=>`var(--sm-landscape-${b}-${k}, ${biomes[b][k]})`;
export const path=(d,fill='none',sw=.65,stroke=ink,extra='')=>`<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" ${extra}/>`;
export const circle=(x,y,r,fill,sw=0,stroke=ink)=>`<circle cx="${n(x)}" cy="${n(y)}" r="${n(r)}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
export const rect=(x,y,w,h,fill,extra='')=>`<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="${fill}" ${extra}/>`;
export const polygon=pts=>pts.map(([x,y],i)=>`${i?'L':'M'}${n(x)},${n(y)}`).join(' ')+'Z';
export function random(seed){if(!Number.isInteger(seed)||seed<0||seed>4294967295)throw Error('Seed must be an unsigned 32-bit integer');let s=seed;return()=>{s=(s+0x6D2B79F5)>>>0;let t=Math.imul(s^(s>>>15),1|s);t^=t+Math.imul(t^(t>>>7),61|t);return((t^(t>>>14))>>>0)/4294967296;};}
// Rounded scallops with unequal lobes; no polygon corners in leafy crowns.
function organic(x,y,rx,ry,rng,lobes=9){
  const step=Math.PI*2/lobes,rs=Array.from({length:lobes},()=>.79+rng()*.12),pt=(a,r)=>`${n(x+Math.cos(a)*rx*r)},${n(y+Math.sin(a)*ry*r)}`;
  let d=`M${pt(-step/2,rs[0])}`;
  for(let i=0;i<lobes;i++){const a=i*step,rr=1.05+rng()*.1;d+=`C${pt(a-step*.32,rr)} ${pt(a+step*.32,rr)} ${pt(a+step*.5,rs[(i+1)%lobes])}`;}return d+'Z';
}
const entry=(kind,form,layer,metres,site,options={})=>({kind,form,layer,nominalFootprint:[metres,metres],site,...options});
export const floraCatalog={
  temperate:[
    entry('oak','crown','tree',10,'woodland / pasture',{lobes:9}),
    entry('beech','crown','tree',9,'well-drained woodland',{lobes:14}),
    entry('birch','crown','tree',6,'open woodland',{open:true,pale:true}),
    entry('willow','crown','tree',9,'freshwater banks',{weeping:true}),
    entry('poplar','crown','tree',5,'moist ground / planted rows',{narrow:true}),
    entry('spruce','needles','tree',7,'cool woodland'),
    entry('apple','crown','tree',5,'cultivated orchard',{fruit:'#b57468',open:true}),
    entry('hawthorn','crown','shrub',3.5,'hedgerows / scrub',{fruit:'#c6ab9f',open:true}),
    entry('coppice','crown','shrub',4,'managed woodland',{multi:true}),
    entry('bramble','mat','low',2.4,'hedge margins',{fruit:'#797082'}),
    entry('wood-fern','fern','low',1.6,'damp woodland shade'),
    entry('meadow-flowers','grass','low',1.5,'open meadow',{flowers:true}),
    entry('reedbed','grass','low',2,'freshwater wet margin',{reed:true}),
    entry('fallen-bough','snag','low',3,'woodland floor',{fallen:true}),
  ],
  desert:[
    entry('date-palm','palm','tree',7,'oasis / reliable water',{fruit:'#ad8460'}),
    entry('acacia','crown','tree',8,'seasonal water / dry savanna fringe',{open:true,flat:true}),
    entry('olive','crown','tree',5,'Mediterranean dry fringe / cultivated oasis',{pale:true,fruit:'#646c59',open:true}),
    entry('tamarisk','crown','shrub',4,'wadi / groundwater access',{fine:true}),
    entry('thorn-scrub','thorn','shrub',2.5,'dry scrub'),
    entry('sage-scrub','mat','shrub',2,'arid regional scrub',{pale:true}),
    entry('succulent-rosette','rosette','low',1.4,'regional rocky dryland'),
    entry('barrel-cactus','cactus','low',1.2,'regional New World desert'),
    entry('prickly-pear','cactus','shrub',2,'regional New World desert',{pads:true}),
    entry('dry-bunchgrass','grass','low',1.2,'sandy dryland',{dry:true}),
    entry('desert-bloom','mat','low',1,'brief post-rain flowering',{flowers:true}),
    entry('saltbush','crown','shrub',2.3,'saline arid soil',{pale:true,open:true}),
    entry('oasis-reeds','grass','low',1.8,'freshwater oasis margin',{reed:true}),
    entry('deadwood','snag','low',3,'dry wash',{fallen:true}),
  ],
  tundra:[
    entry('dwarf-willow','crown','shrub',1.5,'moist tundra',{open:true,multi:true}),
    entry('dwarf-birch','crown','shrub',1.5,'shrub tundra',{pale:true,open:true}),
    entry('crowberry','mat','low',1.2,'heath tundra',{fruit:'#656170'}),
    entry('bearberry','mat','low',1.2,'dry tundra',{fruit:'#b57f75'}),
    entry('heather','mat','low',1.2,'regional heath',{flowers:true}),
    entry('moss-cushion','mat','low',1,'damp tundra',{moss:true}),
    entry('reindeer-lichen','lichen','low',1.4,'lichen tundra'),
    entry('rock-lichen','lichen','low',.9,'exposed rock',{rock:true}),
    entry('sedge-tussock','grass','low',1.1,'wet tundra'),
    entry('cottongrass','grass','low',1.1,'wet tundra',{cotton:true}),
    entry('alpine-flowers','mat','low',.8,'short growing season',{flowers:true,pale:true}),
    entry('prostrate-juniper','needles','shrub',1.6,'regional subarctic / alpine heath',{prostrate:true}),
    entry('treeline-spruce','needles','tree',4,'subarctic forest fringe ONLY',{fringe:true}),
    entry('treeline-snag','snag','tree',3.5,'subarctic forest fringe ONLY',{fringe:true}),
  ],
  tropical:[
    entry('rainforest-canopy','crown','tree',12,'humid tropical forest',{lobes:12}),
    entry('fig','crown','tree',10,'humid woodland',{multi:true}),
    entry('fan-palm','palm','tree',7,'regional tropical woodland',{fan:true}),
    entry('coconut-palm','palm','tree',8,'warm sandy coast / cultivated grove',{fruit:'#ab916f'}),
    entry('banana','broadleaf','shrub',4,'moist fertile soil / cultivation'),
    entry('bamboo','bamboo','tree',5,'regional moist woodland / cultivation'),
    entry('tree-fern','fern','tree',4,'humid shaded forest',{large:true}),
    entry('mangrove','crown','tree',7,'warm intertidal ONLY',{roots:true,open:true}),
    entry('understory-shrub','crown','shrub',3,'forest understory',{open:true}),
    entry('broadleaf-fern','fern','low',1.6,'damp forest floor'),
    entry('elephant-ear','broadleaf','low',1.8,'wet tropical margin',{heart:true}),
    entry('flowering-ginger','broadleaf','low',1.8,'humid understory',{flowers:true}),
    entry('jungle-vines','mat','low',2.5,'forest edges',{vines:true}),
    entry('wetland-reeds','grass','low',1.8,'freshwater wetlands',{reed:true}),
  ],
  coastal:[
    entry('windswept-pine','needles','tree',7,'temperate exposed coast',{wind:true}),
    entry('windthorn','crown','tree',5,'temperate maritime scrub',{wind:true,open:true}),
    entry('tamarisk','crown','shrub',4,'regional sandy coast',{fine:true}),
    entry('sea-buckthorn','crown','shrub',3,'regional dunes / coastal scrub',{fruit:'#c29b62',pale:true,open:true}),
    entry('maritime-heath','mat','low',1.5,'acid maritime heath',{flowers:true}),
    entry('marram-grass','grass','low',1.4,'sandy dunes',{dry:true}),
    entry('dune-sedge','grass','low',1.2,'dune slacks'),
    entry('saltmarsh-rush','grass','low',1.4,'saltmarsh',{reed:true}),
    entry('glasswort','succulent','low',.9,'saltmarsh / tidal flats'),
    entry('sea-lavender','mat','low',1,'regional saltmarsh',{flowers:true}),
    entry('sea-thrift','grass','low',.8,'rocky maritime grassland',{flowers:true}),
    entry('sea-kale','broadleaf','low',1.1,'regional shingle coast',{heart:true,pale:true}),
    entry('sheltered-apple','crown','tree',5,'mild coast / cultivated orchard behind shelter',{fruit:'#b57468',open:true}),
    entry('driftwood','snag','low',3,'strandline',{fallen:true,pale:true}),
  ],
};

export function flora(biome,kind,{seed=11,winter=false}={}){
  const spec=floraCatalog[biome]?.find(a=>a.kind===kind);if(!spec)throw Error(`Unknown flora: ${biome}/${kind}`);
  if(winter&&biome!=='tundra')throw Error('Snow state is provided for tundra flora only');
  random(seed); // Validate before mixing a species salt into the geometry seed.
  const salt=[...kind].reduce((s,c)=>(Math.imul(s,31)+c.charCodeAt(0))>>>0,0);
  const r=random((seed^salt)>>>0),snowR=random((seed^salt^0x71acbf2d)>>>0),t=k=>token(biome,k),leaf=spec.pale?t('light'):t('leaf'),wood='var(--sm-landscape-wood, #a08d78)';
  let body='';const cx=32+(r()-.5)*3,cy=32+(r()-.5)*3;
  const line=(d,w=.6,col=ink)=>body+=path(d,'none',w,col);
  const blob=(x,y,rx,ry,fill=leaf,sw=1.15,lobes=7)=>{const d=organic(x,y,rx,ry,fill===snow?snowR:r,lobes);body+=path(d,fill,sw);return d;};
  function foliage(x,y,rx,ry,detail=7){
    blob(x,y,rx,ry,t('dark'),.85,spec.lobes??9);
    blob(x-1.1,y-1.2,rx*.92,ry*.9,leaf,0,spec.lobes??9);
    for(let j=0;j<detail;j++){const a=j*Math.PI*2/detail+r()*.4,rr=.4+r()*.08,X=x+Math.cos(a)*rx*rr,Y=y+Math.sin(a)*ry*rr;
      blob(X,Y,rx*(.29+r()*.09),ry*(.3+r()*.08),j%3===0?t('light'):leaf,0,5);
      if(j%3===1)line(`M${n(X-2)},${n(Y)}q2,-2 4,-.4`,.25,t('dark'));
      if(winter&&j%3===0)blob(X-.5,Y-.5,rx*.25,ry*.24,snow,0,6);
      if(spec.fruit)for(let k=0;k<3;k++)body+=circle(X+(r()-.5)*rx*.3,Y+(r()-.5)*ry*.3,.85,spec.fruit,.3);
    }
    if(spec.weeping)for(let j=0;j<11;j++){const a=j*2*Math.PI/11;line(`M${n(x+Math.cos(a)*rx*.5)},${n(y+Math.sin(a)*ry*.5)}q${n(Math.cos(a)*4)},${n(Math.sin(a)*4)} ${n(Math.cos(a)*rx*.32)},${n(Math.sin(a)*ry*.32)}`,.65,t('dark'));}
  }
  function frond(x,y,a,len,w,mode='feather'){
    let s='';const d=`M0,0Q${n(-w)},${n(-len*.48)} 0,${n(-len)}Q${n(w)},${n(-len*.5)} 0,0Z`;
    if(mode==='feather'){
      const pts=[[0,0]];for(let j=1;j<=8;j++){const f=j/9,W=Math.sin(f*Math.PI)*w;pts.push([-W,-len*f],[ -W*.22,-len*(f+.035)]);}pts.push([0,-len]);for(let j=8;j>=1;j--){const f=j/9,W=Math.sin(f*Math.PI)*w;pts.push([W*.2,-len*(f+.035)],[W,-len*f]);}
      s+=path(polygon(pts),leaf,.75);s+=path(`M0,0Q1,${n(-len*.5)} 0,${n(-len)}`,'none',.55,t('dark'));
    }else {s+=path(d,leaf,.95)+path(`M0,0L0,${n(-len)}`,'none',.65,t('dark'));for(let j=1;j<6;j++){const f=j/7,W=Math.sin(f*Math.PI)*w*.45;s+=path(`M0,${n(-len*f)}l${n(-W)},${n(-len*.11)}M0,${n(-len*f)}l${n(W)},${n(-len*.11)}`,'none',.4,t('dark'));}}
    body+=`<g transform="translate(${n(x)},${n(y)}) rotate(${n(a)})">${s}</g>`;
  }
  const form=spec.form;
  if(form==='crown'){
    if(spec.roots||spec.multi||spec.open){for(let i=0;i<7;i++){const a=i*6.283/7+r()*.4,rr=spec.roots?25:18,xx=cx+Math.cos(a)*rr,yy=cy+Math.sin(a)*rr;line(`M${n(cx)},${n(cy)}Q${n(cx+Math.cos(a+.25)*14)},${n(cy+Math.sin(a+.25)*14)} ${n(xx)},${n(yy)}`,spec.roots?2:1.3,wood);}}
    if(spec.open||spec.multi){const count=spec.multi?5:3;for(let i=0;i<count;i++){const a=i*6.283/count+r()*.4,X=cx+Math.cos(a)*10,Y=cy+Math.sin(a)*9;foliage(X,Y,11+r()*3,(spec.flat?8:11)+r()*2,4);}}
    else foliage(cx,cy,spec.narrow?15:24,spec.wind?17:24,spec.fine?11:7);
  }else if(form==='needles'){
    const count=spec.prostrate?3:1;
    for(let k=0;k<count;k++){const x=cx+(count===1?0:Math.cos(k*2.1)*10),y=cy+(count===1?0:Math.sin(k*2.1)*9),scale=count===1?1:.58;
      for(let tier=0;tier<3;tier++){const rad=(25-tier*7)*scale,branches=11-tier,pts=[];for(let j=0;j<branches;j++){const a=j*6.283/branches+r()*.2,rr=rad*(.78+r()*.2),sway=spec.wind?5*(tier+1)/3:0;pts.push([x+Math.cos(a-.18)*rr*.45+sway,y+Math.sin(a-.18)*rr*.45],[x+Math.cos(a)*rr+sway,y+Math.sin(a)*rr*(spec.wind?.67:1)],[x+Math.cos(a+.18)*rr*.45+sway,y+Math.sin(a+.18)*rr*.45]);}
        body+=path(polygon(pts),tier===0?t('dark'):tier===1?leaf:t('light'),tier===0?.7:0);
        for(let j=0;j<branches;j+=3){const a=j*6.283/branches;line(`M${n(x)},${n(y)}l${n(Math.cos(a)*rad*.72)},${n(Math.sin(a)*rad*.72*(spec.wind?.67:1))}`,.25,t('dark'));}
        if(winter&&tier>0){const snowPts=pts.map(([X,Y])=>[x+(X-x)*.62,y+(Y-y)*.62]);body+=path(polygon(snowPts),snow,.3,t('light'));}
      }
    }
  }else if(form==='palm'||form==='fern'){
    const count=spec.fan?9:form==='fern'?9:11,offset=r()*360;
    if(spec.fan){for(let j=0;j<count;j++){const a=offset+j*360/count+(r()-.5)*15;let s=path('M0,0L-9,-17L-10,-24L-5,-22L-4,-27L0,-24L3,-27L5,-23L10,-24L8,-16Z',j%3===0?t('light'):leaf,.85);for(let k=-8;k<=8;k+=4)s+=path(`M0,0L${k},-23`,'none',.45,t('dark'));body+=`<g transform="translate(${n(cx)},${n(cy)}) rotate(${n(a)})">${s}</g>`;}}
    else for(let j=0;j<count;j++)frond(cx,cy,offset+j*360/count+(r()-.5)*17,19+r()*9,form==='fern'?5:4,'feather');
    body+=circle(cx,cy,2.4,wood,.9);if(spec.fruit)for(let j=0;j<3;j++)body+=circle(cx-2+j*2,cy+3,1.3,spec.fruit,.55);
  }else if(form==='broadleaf'||form==='rosette'){
    const count=form==='rosette'?13:7,offset=r()*360;
    for(let j=0;j<count;j++)frond(cx,cy,offset+j*360/count+(r()-.5)*14,16+r()*12,form==='rosette'?4:spec.heart?14:9,'leaf');
    body+=circle(cx,cy,2,t('light'),.65);if(spec.flowers)body+=path(`M${n(cx)},${n(cy+5)}q-5,-5 0,-13q5,7 0,13Z`,t('flower'),.75);
  }else if(form==='grass'||form==='succulent'){
    const clumps=4+Math.floor(r()*3);
    for(let k=0;k<clumps;k++){const a=k*6.283/clumps,x=cx+Math.cos(a)*(5+r()*8),y=cy+Math.sin(a)*(5+r()*7),leaves=spec.reed?6:9;
      for(let j=0;j<leaves;j++){const angle=j*6.283/leaves+r()*.5,len=7+r()*10,dx=Math.cos(angle)*len,dy=Math.sin(angle)*len;
        const d=`M${n(x)},${n(y)}Q${n(x+dx*.18-1)},${n(y+dy*.6)} ${n(x+dx)},${n(y+dy)}Q${n(x+dx*.5+1.3)},${n(y+dy*.28)} ${n(x)},${n(y)}Z`;
        body+=path(d,spec.dry?t('dry'):j%3===0?t('light'):leaf,form==='succulent'?1.2:.4,form==='succulent'?leaf:t('dark'));
        if((spec.flowers||spec.cotton)&&j%4===0){body+=circle(x+dx,y+dy,spec.cotton?1.7:1.2,spec.cotton?snow:t('flower'),.35);if(spec.flowers)body+=circle(x+dx+.6,y+dy,.45,t('dry'));}
        if(spec.reed&&j%3===0)line(`M${n(x+dx*.77)},${n(y+dy*.77)}L${n(x+dx)},${n(y+dy)}`,1.3,wood);
      }
      if(winter)blob(x,y,4,3,snow,0,5);
    }
  }else if(form==='mat'||form==='lichen'){
    if(spec.rock)blob(cx,cy,22,18,'#aaa9a0',1.1,6);
    const count=spec.moss?9:7;
    for(let j=0;j<count;j++){const a=j*6.283/count+r()*.3,rr=8+r()*7,x=cx+Math.cos(a)*rr,y=cy+Math.sin(a)*rr,rx=6+r()*6,ry=5+r()*5;
      blob(x,y,rx,ry,form==='lichen'?t('light'):j%3===0?t('light'):leaf,form==='lichen'?.45:.75,6);
      for(let k=0;k<7;k++){const X=x+(r()-.5)*rx,Y=y+(r()-.5)*ry;
        if(form==='lichen')line(`M${n(X)},${n(Y+2)}v-3m0,1l-1.4,-1.1m1.4,1.1l1.5,-1.2`,.55,t('dark'));
        else if((spec.flowers||spec.fruit)&&k%2===0)body+=circle(X,Y,.9,spec.fruit??t('flower'),.25);
        else line(`M${n(X)},${n(Y)}l1,-1m-1,1l-.6,-1`,.45,t('dark'));
      }
      if(winter&&j%3===0)blob(x-.5,y-.5,rx*.82,ry*.8,snow,0,6);
    }
    if(spec.vines)for(let j=0;j<3;j++)line(`M${18+j*6},20q-10,15 7,20t12,-12`,.8,t('dark'));
  }else if(form==='snag'){
    const angle=r()*360;body+=`<g transform="translate(${n(cx)},${n(cy)}) rotate(${n(angle)}) scale(.72)">`;
    const trunk=spec.fallen?'M-25,7Q-4,4 23,-8':'M-9,19Q-1,5 6,-23';
    body+=path(trunk,'none',4,ink)+path(trunk,'none',2.5,wood);
    for(let j=0;j<6;j++){const x=spec.fallen?-18+j*7:-5+j*1.7,y=spec.fallen?5-j*2:13-j*6,dir=j%2?1:-1,dx=(6+r()*9)*dir,dy=(5+r()*7)*(spec.fallen?dir:-1);
      const d=`M${n(x)},${n(y)}l${n(dx)},${n(dy)}l${n(dx*.45)},${n(-3-r()*3)}M${n(x+dx*.68)},${n(y+dy*.68)}l${n(-dx*.12)},${n(dy*.55)}`;
      body+=path(d,'none',1.8,ink)+path(d,'none',1,wood);
    }body+='</g>';if(winter)blob(cx,cy,5,3,snow,0,5);
  }else if(form==='thorn'){
    const spread=1,offset=r()*360;
    for(let j=0;j<7;j++){const a=offset+j*6.283/7,len=17+r()*10,x=cx+Math.cos(a)*len,y=cy+Math.sin(a)*len*spread;
      line(`M${n(cx)},${n(cy)}L${n(x)},${n(y)}`,form==='thorn'?1.3:3,ink);line(`M${n(cx)},${n(cy)}L${n(x)},${n(y)}`,form==='thorn'?.65:1.9,spec.pale?t('dry'):wood);
      for(let k=0;k<3;k++){const f=.45+k*.17,X=cx+(x-cx)*f,Y=cy+(y-cy)*f,dx=Math.cos(a+1)*6,dy=Math.sin(a+1)*6*spread;line(`M${n(X-dx)},${n(Y-dy)}L${n(X)},${n(Y)}L${n(X+dx)},${n(Y+dy)}`,form==='thorn'?.7:1.1,wood);if(form==='thorn'&&k===1)blob(X,Y,3.8,3.2,leaf,.6,5);}
    }
    if(winter)blob(cx,cy,5,4,snow,0,5);
  }else if(form==='cactus'){
    const count=spec.pads?7:3;for(let j=0;j<count;j++){const a=j*6.283/count,x=cx+Math.cos(a)*(spec.pads?12:9),y=cy+Math.sin(a)*(spec.pads?12:9),rx=spec.pads?5:9,ry=spec.pads?9:9;
      body+=`<g transform="rotate(${n(a*180/Math.PI)},${n(x)},${n(y)})">${path(organic(x,y,rx,ry,r,8),leaf,1)}`;
      for(let k=-2;k<=2;k++)line(`M${n(x+k*rx*.27)},${n(y-ry*.7)}Q${n(x+k*rx*.46)},${n(y)} ${n(x+k*rx*.27)},${n(y+ry*.7)}`,.45,t('light'));
      for(let k=0;k<6;k++){const X=x+(r()-.5)*rx,Y=y+(r()-.5)*ry;line(`M${n(X-.6)},${n(Y)}h1.2m-.6,-.6v1.2`,.35,ink);}body+='</g>';
    }
  }else if(form==='bamboo'){
    for(let j=0;j<9;j++){const x=20+r()*23,y=20+r()*23;body+=circle(x,y,1.8,t('dry'),.6);for(let k=0;k<4;k++)frond(x,y,r()*360,10+r()*8,2.3,'leaf');}
  }
  return{...spec,biome,category:'flora',seed,season:winter?'snow':'growing',viewBox:[0,0,64,64],anchor:[32,32],cls:'fixed',zBand:spec.layer==='low'?'parcel':'canopy',castsShadow:false,receivesShadow:spec.layer!=='low',body};
}

export function svg(asset,{title=''}={}){const [x,y,w,h]=asset.viewBox;return`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" width="${w}" height="${h}">${title?`<title>${xml(title)}</title>`:''}${asset.body}</svg>`;}
