import { wall, bridge } from '../assets/infrastructure-art.js';
import { artworkBiome, ARTWORK_MANIFEST } from '../assets/artwork.js';
import type { ScenePoint, WallFeature } from '../scene/scene.js';

const n=(v:number)=>Number(v.toFixed(4));
const path=(pts:ScenePoint[],close=false)=>pts.map((p,i)=>`${i?'L':'M'}${n(p.x)},${n(p.y)}`).join(' ')+(close?'Z':'');
const light=(s:string)=>`<g transform="translate(0.3,0.4)" color="#46303c" opacity=".2">${s}</g>`;

/** Draw along real centreline geometry, in a constant art-to-world scale. */
export function wallArtwork(w: WallFeature, biome?: string): string {
  const k=.15, body:string[]=[],shadows:string[]=[];
  for(const line of w.polylines){
    if(line.length<2)continue;
    const points=line.map(p=>[p.x/k,p.y/k]);
    const gates:Array<{at:number;width:number}>=[];
    for(const g of w.gates){
      const c={x:(g.p1.x+g.p2.x)/2,y:(g.p1.y+g.p2.y)/2};let offset=0,best=Infinity,at=0;
      for(let i=1;i<line.length;i++){
        const a=line[i-1],b=line[i],dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy),t=Math.max(0,Math.min(1,((c.x-a.x)*dx+(c.y-a.y)*dy)/(len*len||1)));
        const d=Math.hypot(a.x+t*dx-c.x,a.y+t*dy-c.y);if(d<best){best=d;at=offset+t*len;}offset+=len;
      }
      if(best<2)gates.push({at:at/k,width:Math.max(4,Math.hypot(g.p2.x-g.p1.x,g.p2.y-g.p1.y))/k});
    }
    const length=line.slice(1).reduce((s,p,i)=>s+Math.hypot(p.x-line[i].x,p.y-line[i].y),0)/k;
    if(Math.hypot(line[0].x-line.at(-1)!.x,line[0].y-line.at(-1)!.y)<1e-6){
      for(const g of [...gates]){if(g.at<g.width/2)gates.push({...g,at:g.at+length});if(g.at+g.width/2>length)gates.push({...g,at:g.at-length});}
    }
    const a=wall(points,{biome:artworkBiome(biome),kind:w.material??'curtain',width:w.large?14:12,gates: gates as never[]});
    body.push(`<g transform="scale(${k})">${a.body}</g>`);shadows.push(`<g transform="scale(${k})">${a.sil}</g>`);
  }
  return light(shadows.join(''))+body.join('');
}

/** A bent crossing is divided into its surveyed straight runs. Width is never stretched with span. */
export function bridgeArtwork(points:ScenePoint[], width:number, biome?:string, stone=false):string {
  let out='';
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i],len=Math.hypot(b.x-a.x,b.y-a.y);if(len<.01)continue;
    // Resample long spans into bounded art sections while retaining constant deck width.
    const k=width/18,segments=Math.max(1,Math.ceil(len/k/240)),step=len/segments;
    for(let j=0;j<segments;j++){
      const span=step/k, kind=stone?(span>80?'stone-multispan':'stone-roadbridge'):(span>80?'timber-trestle':'timber-footbridge');
      const drawing=bridge(kind,{biome:artworkBiome(biome),length:Math.max(28,span),width:18} as never);
      // Very short bank spans have cropped decks rather than length-scaled planks.
      const x=a.x+(b.x-a.x)*j/segments,y=a.y+(b.y-a.y)*j/segments,angle=Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI;
      const id=`bridge-${n(x)}-${n(y)}-${i}-${j}`.replaceAll('.','p');
      const clip=span<28?`<defs><clipPath id="${id}"><rect x="16" y="0" width="${span}" height="64"/></clipPath></defs>`:'';
      out+=`<g transform="translate(${n(x)},${n(y)}) rotate(${n(angle)}) scale(${n(k)}) translate(-16,-32)">${clip}<g${span<28?` clip-path="url(#${id})"`:''}>${drawing.body}</g></g>`;
    }
  }
  return out;
}

/** Decorate the planner's actual parcel. Never replace it with a stretched preset polygon. */
export function farmDetails(ring:ScenePoint[], glyph:string, unit:number, id:string):string {
  const meta=ARTWORK_MANIFEST[glyph];if(!meta||meta.natural||ring.length<3)return '';
  const b=artworkBiome(meta.biome),xs=ring.map(p=>p.x),ys=ring.map(p=>p.y),x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys),w=x1-x0,h=y1-y0;
  const k=Math.min(unit,Math.min(w,h)/15),margin=1.4*k,soil=`var(--sm-landscape-${b}-dry, #d5be84)`,d=path(ring,true);
  const clip=`farm-detail-${id.replace(/[^\w-]/g,'-')}`;
  // Access meets an actual boundary midpoint; the path reaches the field centre.
  const edge=ring.map((a,i)=>({a,b:ring[(i+1)%ring.length]})).sort((a,b)=>(b.a.y+b.b.y)-(a.a.y+a.b.y))[0];
  const entry={x:(edge.a.x+edge.b.x)/2,y:(edge.a.y+edge.b.y)/2},c={x:ring.reduce((s,p)=>s+p.x,0)/ring.length,y:ring.reduce((s,p)=>s+p.y,0)/ring.length};
  let art=`<path d="${d}" fill="none" stroke="${soil}" stroke-width="${n(margin*2)}"/><path d="${path([entry,c])}" fill="none" stroke="${soil}" stroke-width="${n(margin)}"/>`;
  if(meta.irrigation && b === 'desert'){
    const near={x:c.x+(ring[0].x-c.x)*.65,y:c.y+(ring[0].y-c.y)*.65};
    const colour=meta.dryChannels?`var(--sm-landscape-${b}-dark, #626e55)`:`var(--sm-landscape-${b}-water, #94b9b4)`;
    const channels=ring.map(p=>({x:c.x+(p.x-c.x)*.8,y:c.y+(p.y-c.y)*.8}));
    art+=`<path d="${path(channels,true)} ${path([channels[0],near,c])}" fill="none" stroke="${colour}" stroke-width="${n(.7*k)}"/>`;
    // Each managed plot has an explicit well/cistern head at its supply channel.
    art+=`<circle data-irrigation-source="well" cx="${n(near.x)}" cy="${n(near.y)}" r="${n(1.2*k)}" fill="${soil}" stroke="var(--sm-ink, #33262e)" stroke-width="${n(.2*k)}"/><circle cx="${n(near.x)}" cy="${n(near.y)}" r="${n(.65*k)}" fill="${colour}"/>`;
  }
  if(b === 'tropical' && meta.family?.includes('paddy')) {
    // Shallow flooded planting beds are divided by walkable earth bunds;
    // they do not borrow the desert's well and perimeter pipe layout.
    for(const y of [y0+h/3,y0+2*h/3])art+=`<path d="M${n(x0)},${n(y)}H${n(x1)}" fill="none" stroke="${soil}" stroke-width="${n(margin)}"/>`;
  }
  return `<defs><clipPath id="${clip}"><path d="${d}"/></clipPath></defs><g data-farm="${glyph}" clip-path="url(#${clip})">${art}</g>`;
}
