import type { LocalBounds } from '../generator/bounds.js';
import type { Scene, ScenePoint } from './scene.js';
import type { AssembleOptions } from '../output/assemble-svg.js';
import { resolveAppearance } from '../appearance/resolve.js';
import { resolveSkin } from '../assets/skins.js';
import { assetSetFor, SETTLEMENT_SET } from '../assets/asset-sets.js';
import { ARTWORK_INK } from '../assets/artwork.js';
import { boundsOfPoints as pointsBounds } from '../geom/bounds.js';
import { linkedBuildingIds } from './symbol-buildings.js';

const overlaps = (a: LocalBounds, b: LocalBounds) => a.min_x <= b.max_x && a.max_x >= b.min_x && a.min_y <= b.max_y && a.max_y >= b.min_y;
const expand = (b: LocalBounds, n: number): LocalBounds => ({ min_x: b.min_x-n, min_y: b.min_y-n, max_x: b.max_x+n, max_y: b.max_y+n });
function union(boxes: LocalBounds[]): LocalBounds {
  const b = { min_x: Infinity, min_y: Infinity, max_x: -Infinity, max_y: -Infinity };
  for (const x of boxes) { b.min_x=Math.min(b.min_x,x.min_x); b.min_y=Math.min(b.min_y,x.min_y); b.max_x=Math.max(b.max_x,x.max_x); b.max_y=Math.max(b.max_y,x.max_y); }
  return b;
}

/** Immutable broadphase. Results retain input order, including equal coordinates. */
export function createBoundsIndex<T>(entries: Array<{bounds: LocalBounds; value: T}>): { query(bounds: LocalBounds): T[] } {
  type Item = {bounds:LocalBounds;value:T;order:number};
  type Node = {bounds:LocalBounds;items?:Item[];left?:Node;right?:Node};
  const build = (items: Item[]): Node => {
    const bounds=union(items.map(i=>i.bounds));
    if(items.length<=12)return {bounds,items};
    const axis=bounds.max_x-bounds.min_x>=bounds.max_y-bounds.min_y?'x':'y';
    items.sort((a,b)=>(a.bounds[`min_${axis}`]+a.bounds[`max_${axis}`])-(b.bounds[`min_${axis}`]+b.bounds[`max_${axis}`])||a.order-b.order);
    const mid=Math.floor(items.length/2);
    return {bounds,left:build(items.slice(0,mid)),right:build(items.slice(mid))};
  };
  const root=build(entries.map((e,order)=>({...e,order})));
  return {query(bounds) {
    if(bounds.min_x<=root.bounds.min_x && bounds.min_y<=root.bounds.min_y && bounds.max_x>=root.bounds.max_x && bounds.max_y>=root.bounds.max_y)
      return entries.map(entry=>entry.value);
    const hits:Item[]=[];
    const visit=(node:Node):void=>{
      if(!overlaps(node.bounds,bounds))return;
      if(node.items){for(const item of node.items)if(overlaps(item.bounds,bounds))hits.push(item);}
      else {visit(node.left!);visit(node.right!);}
    };
    visit(root);return hits.sort((a,b)=>a.order-b.order).map(i=>i.value);
  }};
}

export interface SceneIndex {
  /** Appearance is evaluated per query: changed shadows/strokes never reuse stale paint bounds. */
  query(bounds: LocalBounds, appearance?: AssembleOptions): Scene;
}

/** Native artwork uses measured ink bounds. Unbounded custom art takes a conservative
 * uncullable fallback; inventing a padding estimate for arbitrary SVG could lose ink. */
export function createSceneIndex(scene: Scene): SceneIndex { return prepareSceneQuery(scene, true); }

/** One-shot/full-frame rendering avoids constructing a spatial tree which will
 * not prune useful work. Uses the same paint bounds and appearance as indexed views. */
export function scanSceneInView(scene: Scene, bounds: LocalBounds, appearance: AssembleOptions = {}): Scene {
  return prepareSceneQuery(scene, false).query(bounds, appearance);
}

function prepareSceneQuery(scene: Scene, indexed: boolean): SceneIndex {
  const L=scene.layers, assets=assetSetFor(scene.biome);
  const glyphBounds=(id:string, at:ScenePoint, scale:number, rotation:number, scaleY=scale):LocalBounds|null=>{
    const g=assets.glyphs?.[id], ink=ARTWORK_INK[id];
    if(!g||!ink)return null;
    const [x,y,w,h]=g.viewBox;
    const [ix0,iy0,ix1,iy1]=ink.bounds;
    const box=[Math.min(x,ix0),Math.min(y,iy0),Math.max(x+w,ix1),Math.max(y+h,iy1)];
    const a=rotation*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
    const corners=[[box[0],box[1]],[box[2],box[1]],[box[2],box[3]],[box[0],box[3]]].map(([px,py])=>{
      const dx=(px-g.anchor[0])*scale/w,dy=(py-g.anchor[1])*scaleY/h;
      return {x:at.x+dx*c-dy*s,y:at.y+dx*s+dy*c};
    });
    return expand(pointsBounds(corners),.3);
  };
  const symbolBoxes=L.symbols.map(s=>glyphBounds(s.id,s.at,s.scale,s.rotationDeg,s.scaleY));
  const linked=new Map<string,LocalBounds[]>();
  L.symbols.forEach((s,i)=>{if(symbolBoxes[i])for(const id of linkedBuildingIds(s))linked.set(id,[...(linked.get(id)??[]),symbolBoxes[i]!]);});
  const index=<T>(values:T[],bounds:(v:T,i:number)=>LocalBounds|null)=>{
    if(!indexed)return (view:LocalBounds)=>values.filter((value,i)=>{const b=bounds(value,i);return !b||overlaps(b,view);});
    const always:T[]=[], entries:Array<{bounds:LocalBounds;value:T}>=[];
    values.forEach((value,i)=>{const b=bounds(value,i);if(b)entries.push({value,bounds:b});else always.push(value);});
    const tree=createBoundsIndex(entries);
    if(!always.length)return (b:LocalBounds)=>tree.query(b);
    // Unmeasured items are generally rare; order is restored without scanning the source layer.
    const order=new Map(values.map((v,i)=>[v,i]));
    return (b:LocalBounds)=>[...tree.query(b),...always].sort((a,c)=>order.get(a)!-order.get(c)!);
  };
  const buildings=index(L.buildings,b=>union([pointsBounds(b.ring),...(b.id?linked.get(b.id)??[]:[])]));
  const symbols=index(L.symbols,(_,i)=>symbolBoxes[i]);
  const vegetation=index(L.vegetation,v=>{
    const glyph=glyphBounds(v.kind,v.at,v.scale,v.rotationDeg);
    return glyph?union([glyph,expand(pointsBounds([v.at]),v.scale*.32)]):null;
  });
  const fields=index(L.fields,f=>pointsBounds(f.ring));
  const greens=index(L.greens,g=>expand(pointsBounds([...g.ring,...(g.paths??[]).flat()]),(g.pathWidth??.7)/2));
  const roads=index(L.roads,r=>expand(pointsBounds(r.path),(r.width??0)/2));
  const piers=index(L.piers,p=>pointsBounds(p.ring));
  const bridges=index(L.bridges??[],b=>expand(pointsBounds(b.path),b.width*2));
  const harbours=index(L.harbours??[],h=>expand(pointsBounds([
    ...h.basin, ...h.quays.flatMap(q=>q.ring), ...h.breakwaters.flatMap(b=>b.ring),
    ...h.berths.flatMap(b=>b.ring), ...h.fixtures.map(f=>f.at),
  ]),12));
  return {query(bounds,options={}) {
    const skin=options.skin?resolveSkin(options.skin,options.skinBiome??scene.biome):undefined;
    const theme=resolveAppearance(scene.biome,options.palette,options.theme,skin).city;
    // Custom art is not constrained to its viewBox. Preserve it until its author supplies measured bounds.
    if(options.skin || (options.assetSet && options.assetSet!==SETTLEMENT_SET))return {...scene,bounds};
    const screenRoad=options.pixelsPerUnit&&options.overviewRoadMinPixels?options.overviewRoadMinPixels/options.pixelsPerUnit:0;
    const padding=Math.max(4,options.pixelsPerUnit ? .3/options.pixelsPerUnit : 0,Math.abs(theme.shadowOffset.dx)+Math.abs(theme.shadowOffset.dy)+2,
      theme.arteryWidth+theme.casingDelta*2,theme.roadWidth+theme.casingDelta*2,theme.shoreWidth,screenRoad);
    const view=expand(bounds,padding);
    return {...scene,bounds,layers:{...L,buildings:buildings(view),symbols:symbols(view),vegetation:vegetation(view),
      fields:fields(view),greens:greens(view),roads:roads(view),piers:piers(view),bridges:bridges(view),
      ...(L.harbours ? { harbours: harbours(view) } : {})}};
  }};
}
