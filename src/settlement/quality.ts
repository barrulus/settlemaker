import { Point } from '../types/point.js';
import { pointInPolygon } from '../geom/point-in-polygon.js';
import { Polygon } from '../geom/polygon.js';
import { ARTWORK_MANIFEST } from '../assets/artwork.js';
import { boundsOfPoints } from '../geom/bounds.js';
import { roadCorridor } from '../geom/road-corridor.js';
import { createBoundsIndex } from '../scene/spatial-index.js';
import type { ScenePoint } from '../scene/scene.js';
import type { SettlementModel } from './model.js';

/** Precedence makes ground accounting disjoint. Building area is a reserved
 * footprint, not a claim to have measured painted roof ink. */
const categories = ['water','courtyard','buildingFootprint','road','wall','publicGreen','privateGarden','naturalGreen','civic','unclassifiedGreen','pavedGround'] as const;
type Category = typeof categories[number];
type Areas = Record<Category | 'residual', number>;
const emptyAreas = (): Areas => Object.fromEntries([...categories,'residual'].map(k=>[k,0])) as Areas;
type MultiPolygon = Point[][][];
const geometry = (ring: readonly ScenePoint[]): MultiPolygon => [[ring.map(p=>new Point(p.x,p.y))]];
const contains = (point: Point, polygons: MultiPolygon): boolean => polygons.some(poly=>pointInPolygon(point,poly[0])&&!poly.slice(1).some(hole=>pointInPolygon(point,hole)));

export interface DistrictGroundReview {
  id: string;
  insideWalls: boolean;
  groundAreaM2: number;
  estimatedAreasM2: Areas;
  estimatedGrossFootprintCoverage: number;
  estimatedNetFootprintCoverage: number;
  /** No rejected candidate polygons survive generation. Unknown is not zero. */
  failedPlacementAreaM2: null;
  sampleCount: number;
  sampleSpacingM: {x:number;y:number};
  estimatedResidualComponents: number;
  estimatedLargestResidualAreaM2: number;
}

/** Offline review only: bounded deterministic cell-centre sampling, weighted
 * to each district's exact boundary area. Classifications are estimates; sample
 * spacing is reported because narrow gaps/corridors may fall between samples.
 * Residual ground is neither an intentional court nor proof of failed placement.
 * Explicit road masks use square-ended segments, not rendered rounded caps. */
export function reviewSettlementGround(model: Pick<SettlementModel,'scene'|'districts'>,
  options: {maxSamplesPerDistrict?:number;targetSpacingM?:number} = {}) {
  const maxSamples=options.maxSamplesPerDistrict??4096, targetSpacing=options.targetSpacingM??1;
  if(!Number.isSafeInteger(maxSamples)||maxSamples<1||!Number.isFinite(targetSpacing)||targetSpacing<=0)
    throw new RangeError('ground review requires positive sample count and spacing');
  const L=model.scene.layers;
  const entries: Array<{bounds:ReturnType<typeof boundsOfPoints>;value:{kind:Category;polygon:MultiPolygon}}> = [];
  const add = (kind: Category, polygon: MultiPolygon) => {
    const points=polygon.flat(2);
    if(points.length>=3) entries.push({bounds:boundsOfPoints(points),value:{kind,polygon}});
  };
  if(L.water.polygons) for(const poly of L.water.polygons) add('water',[poly.map(r=>r.map(p=>new Point(p.x,p.y)))]);
  else if(L.water.rings.length) {
    // Retain legacy even-odd rings as a separate predicate below.
    add('water',L.water.rings.map(r=>geometry(r)[0]));
  }
  for(const b of L.buildings)add('buildingFootprint',geometry(b.ring));
  for(const s of L.symbols) {
    const meta=ARTWORK_MANIFEST[s.id];
    if(!s.buildingId||!meta?.courtyardVoids?.length)continue;
    const theta=s.rotationDeg*Math.PI/180,c=Math.cos(theta),sn=Math.sin(theta);
    const transform=(x:number,y:number):ScenePoint=> {
      const dx=(x-meta.anchor[0])*s.scale/meta.viewBox[2],dy=(y-meta.anchor[1])*(s.scaleY??s.scale)/meta.viewBox[3];
      return {x:s.at.x+dx*c-dy*sn,y:s.at.y+dx*sn+dy*c};
    };
    for(const [x0,y0,x1,y1] of meta.courtyardVoids)
      add('courtyard',geometry([[x0,y0],[x1,y0],[x1,y1],[x0,y1]].map(([x,y])=>transform(x,y))));
  }
  for(const r of L.roads)for(let i=1;i<r.path.length;i++)add('road',geometry(roadCorridor(r.path[i-1],r.path[i],r.width??3).vertices));
  for(const w of L.walls)for(const r of w.polylines)for(let i=1;i<r.length;i++)add('wall',geometry(roadCorridor(r[i-1],r[i],3).vertices));
  for(const g of L.ground??[])add('pavedGround',geometry(g.ring));
  for(const g of L.greens)add(g.surface==='paved'&&g.purpose==='private'?'courtyard':g.purpose==='public'?'publicGreen':g.purpose==='private'?'privateGarden':g.purpose==='natural'?'naturalGreen':g.purpose==='civic'?'civic':'unclassifiedGreen',geometry(g.ring));
  const index=createBoundsIndex(entries);
  const districts:DistrictGroundReview[]=model.districts.filter(d=>d.settlementRole!=='rural').map(d=> {
    const boundary=d.boundary.map(p=>new Point(p.x,p.y));
    const groundAreaM2=Math.abs(new Polygon(boundary).square),estimatedAreasM2=emptyAreas();
    const bounds=boundsOfPoints(boundary),width=bounds.max_x-bounds.min_x,height=bounds.max_y-bounds.min_y;
    const spacing=Math.max(targetSpacing,Math.sqrt(width*height/maxSamples));
    const nx=Math.max(1,Math.min(maxSamples,Math.floor(width/spacing))),ny=Math.max(1,Math.min(Math.floor(height/spacing),Math.floor(maxSamples/nx)));
    const dx=width/nx,dy=height/ny, residual=new Set<number>();
    const nearby=index.query(bounds).map(e=>({...e,bounds:boundsOfPoints(e.polygon.flat(2))}))
      .sort((a,b)=>categories.indexOf(a.kind)-categories.indexOf(b.kind));
    let sampleCount=0;
    for(let y=0;y<ny;y++) {
      const py=bounds.min_y+(y+.5)*dy;
      const row=nearby.filter(e=>e.bounds.min_y<=py&&e.bounds.max_y>=py);
      for(let x=0;x<nx;x++) {
        const point=new Point(bounds.min_x+(x+.5)*dx,py);
        if(!pointInPolygon(point,boundary))continue;
        sampleCount++;
        const hit=row.find(e=>e.bounds.min_x<=point.x&&e.bounds.max_x>=point.x
          && (e.kind==='water'&&!L.water.polygons
            ? e.polygon.reduce((n,p)=>n+Number(pointInPolygon(point,p[0])),0)%2===1
            : contains(point,e.polygon)));
        const category=hit?.kind??'residual';estimatedAreasM2[category]++;
        if(category==='residual')residual.add(y*nx+x);
      }
    }
    const weight=sampleCount?groundAreaM2/sampleCount:0;
    for(const k of [...categories,'residual'] as const)estimatedAreasM2[k]*=weight;
    if(!sampleCount)estimatedAreasM2.residual=groundAreaM2;
    let estimatedResidualComponents=0,largest=0;
    while(residual.size) {
      const queue=[residual.values().next().value!];residual.delete(queue[0]);estimatedResidualComponents++;
      for(let i=0;i<queue.length;i++) {
        const at=queue[i],x=at%nx,y=Math.floor(at/nx);
        for(const next of [x>0?at-1:-1,x+1<nx?at+1:-1,y>0?at-nx:-1,y+1<ny?at+nx:-1])
          if(residual.delete(next))queue.push(next);
      }
      largest=Math.max(largest,queue.length*weight);
    }
    return {id:d.id,insideWalls:d.insideWalls,groundAreaM2,estimatedAreasM2,
      estimatedGrossFootprintCoverage:groundAreaM2?estimatedAreasM2.buildingFootprint/groundAreaM2:0,
      estimatedNetFootprintCoverage:estimatedAreasM2.buildingFootprint/(estimatedAreasM2.buildingFootprint+estimatedAreasM2.residual+estimatedAreasM2.pavedGround)||0,
      failedPlacementAreaM2:null,sampleCount,sampleSpacingM:{x:dx,y:dy},estimatedResidualComponents,
      estimatedLargestResidualAreaM2:sampleCount?largest:groundAreaM2};
  });
  const total=(subset:DistrictGroundReview[])=>({districts:subset.length,groundAreaM2:subset.reduce((n,d)=>n+d.groundAreaM2,0),
    estimatedAreasM2:subset.reduce((a,d)=>{for(const k of [...categories,'residual'] as const)a[k]+=d.estimatedAreasM2[k];return a;},emptyAreas()),failedPlacementAreaM2:null});
  return {version:1,scope:'urban district boundaries; rural hulls excluded',
    method:'bounded cell-centre estimates weighted to exact district area; square-ended road segments; 3m wall corridors; artwork-declared courtyards',
    sampling:{maxSamplesPerDistrict:maxSamples,targetSpacingM:targetSpacing},
    unresolved:'Residual land is unclassified. Failed placement area is unknown because candidate rejection geometry is not retained.',
    core:total(districts.filter(d=>d.insideWalls)),outer:total(districts.filter(d=>!d.insideWalls)),districts};
}
