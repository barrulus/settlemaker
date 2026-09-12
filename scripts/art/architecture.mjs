/** Shared SVG pen, material and roof drawing primitives. No file writes on import. */
export function architecture(biomes, namespace = "city") {
const ink = 'var(--sm-ink, #33262e)';
const fmt = n => Number(n.toFixed(2));
const path = (d, fill='none', sw=0.6, extra='') => `<path d="${d}" fill="${fill}" stroke="${ink}" stroke-width="${sw}" ${extra}/>`;
const rect = (x,y,w,h,fill,sw=1) => path(`M${x},${y}h${w}v${h}h-${w}Z`,fill,sw);
const token = (biome, role) => `var(--sm-${namespace}-${biome}-${role}, ${biomes[biome][role]})`;
const points = p => p.map(([x,y],i)=>`${i?'L':'M'}${fmt(x)},${fmt(y)}`).join(' ')+'Z';

function roof(panel, biome, index, snowCover='eaves') {
  let [x0,y0,x1,y1,axis='y'] = panel;
  const bx=x0+1.1, by=y0+1.1, ex=x1-1.1, ey=y1-1.1;
  const local=(u,v)=>axis==='y'?[bx+u,by+v]:[bx+v,by+u];
  const w=axis==='y'?ex-bx:ey-by, h=axis==='y'?ey-by:ex-bx;
  const poly=(p,fill,sw=0)=>path(points(p.map(([u,v])=>local(u,v))),fill,sw);
  const line=(p,sw=.6,extra='')=>path(p.map(([u,v],i)=>`${i?'L':'M'}${local(u,v).map(fmt).join(',')}`).join(' '),'none',sw,extra);
  let body=rect(bx,by,ex-bx,ey-by,token(biome,'roof'),2.2);
  if (biome==='desert') {
    body+=rect(bx+2.1,by+2.1,ex-bx-4.2,ey-by-4.2,token(biome,'light'),.8);
    for(let v=6;v<h-4;v+=6) body+=line([[4,v],[w-4,v+.13]],.45,'opacity=".42"');
    // Roof access hatch plus a small glazed water jar; both fully inset.
    if(w>=8&&h>=8) body+=poly([[w-8,h-8],[w-3,h-8],[w-3,h-3],[w-8,h-3]],token(biome,'wall'),.8);
    const [cx,cy]=local(6,6);
    if(w>=8&&h>=8) body+=`<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="1.6" fill="${token(biome,'accent')}" stroke="${ink}" stroke-width=".7"/>`;
    return body;
  }
  const hip=biome==='tropical'?Math.min(7,h*.22):Math.min(3,h*.13);
  body+=poly([[1,1],[w/2,hip],[w/2,h-hip],[1,h-1]],token(biome,'light'));
  // Short cross-slope strokes retain the refined library's pen-hatched roof idiom.
  for(let v=4;v<h-3;v+=3.2) {
    const inset=v<hip||v>h-hip?3.5:2;
    const delta=Math.sin(v*2.7+index)*.22;
    body+=line([[inset,v],[w/2-1.2,v+delta]],.55,'opacity=".76"');
    body+=line([[w/2+1.2,v+.1],[w-inset,v-delta]],.55,'opacity=".76"');
    if(biome==='coastal'&&v+1.6<h-3) body+=line([[w*.72,v+.55],[w*.72,v+1.7]],.45,'opacity=".65"');
  }
  if(biome==='tundra') {
    const snow='var(--sm-snow, #f2f6f8)';
    // u runs DOWN the two roof slopes, from the ridge at w/2 to the
    // continuous eaves at 0 and w. v runs ALONG the ridge. Snow follows
    // those planes and eaves; it is never an isolated, outlined corner blob.
    if(snowCover==='full') {
      body+=poly([[.6,.6],[w-.6,.6],[w-.6,h-.6],[.6,h-.6]],snow);
    } else {
      if(snowCover==='plane') body+=poly([[.6,.6],[w/2,hip],[w/2,h-hip],[.6,h-.6]],snow);
      const depth=Math.min(4.5,w*.22);
      const eave=[[.6,.6],[depth,.6],[depth*.8,h*.2],[depth*1.1,h*.37],
        [depth*.7,h*.54],[depth,h*.75],[depth*.85,h-.6],[.6,h-.6]];
      if(snowCover!=='plane') body+=poly(eave,snow);
      body+=poly(eave.map(([u,v])=>[w-u,v]),snow);
    }
    // Snow caught on the upslope side of the chimney and wrapping its base.
    // The stack itself is drawn above this layer, leaving the flue open.
    if(w>17&&h>24) body+=poly([[w-9.5,6.5],[w-5,6],[w-2.3,7],
      [w-2.3,12.7],[w-7.4,13],[w-9,10]],snow);
  }
  const buried=biome==='tundra'&&snowCover==='full';
  body+=line([[w/2,hip],[w/2,h-hip]],buried?.65:biome==='tundra'?1.7:1.2,buried?'opacity=".3"':'');
  body+=line([[1,1],[w/2,hip],[w-1,1]],buried?.4:.75,buried?'opacity=".3"':'')
    +line([[1,h-1],[w/2,h-hip],[w-1,h-1]],buried?.4:.75,buried?'opacity=".3"':'');
  if(biome==='tropical') {
    body+=poly([[w/2-1.4,hip+2],[w/2+1.4,hip+2],[w/2+1.4,h-hip-2],[w/2-1.4,h-hip-2]],token(biome,'accent'),.75);
  }
  // Every roof flue remains inside its envelope, including in party-wall rows.
  if(w>17&&h>24) body+=poly([[w-7,7],[w-3,7],[w-3,12],[w-7,12]],token(biome,'wall'),.85)
    +poly([[w-6.4,7.5],[w-3.6,7.5],[w-3.6,9],[w-6.4,9]],'var(--sm-void, #6b5460)',.4);
  return body;
}

return { ink, fmt, path, rect, token, points, roof };
}
