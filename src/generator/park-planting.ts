import { ARTWORK_MANIFEST, cityGlyph } from '../assets/artwork.js';
import { floraCanopyRadius, landscapeHash, selectParkTreeAt } from '../assets/landscape-placement.js';
import { boundsOfPoints } from '../geom/bounds.js';
import { pointInPolygon } from '../geom/point-in-polygon.js';
import { roadCorridor } from '../geom/road-corridor.js';
import type { Polygon } from '../geom/polygon.js';
import { createBoundsIndex } from '../scene/spatial-index.js';
import { Point } from '../types/point.js';
import { WardType } from '../types/interfaces.js';
import { Park } from '../wards/park.js';
import { Castle } from '../wards/castle.js';
import { artworkPaintRadius } from '../assets/artwork-bounds.js';
import { wallPaintWidth, wallTowerCanvas, WALL_GATE_CLEARANCE } from '../assets/fortification-dimensions.js';
import { nearestOnSegment } from './city-frontage.js';
import { cityRoadReservations } from './city-streets.js';
import type { Model } from './model.js';
import { PlacementIndex } from './placement-index.js';
import { resolveGlyphFor } from '../village/deck.js';

/** Plant after the final geometry/census. No generator RNG, lots, paths or
 * population change; only the managed park's canopy layer is populated. */
export function plantCityParks(model: Model, metresPerUnit: number): void {
  if(!model.usesCityLayout)return;
  const parks=model.patches.map(p=>p.ward).filter((w):w is Park=>w instanceof Park);
  if(!parks.length)return;
  const obstacles: Polygon[]=[...cityRoadReservations(model).map(r=>r.polygon)];
  for(const patch of model.patches){
    const ward=patch.ward;
    if(!ward)continue;
    if(ward.type!==WardType.Park)obstacles.push(...ward.geometry);
    for(const lane of ward.lanes)obstacles.push(roadCorridor(lane.a,lane.b,lane.width));
  }
  // Wall and tower artwork has fixed output-space dimensions. Physical
  // scenes later multiply model coordinates by metresPerUnit; legacy scenes
  // retain mesh coordinates, irrespective of their estimated metre scale.
  const outputUnit=model.params.development?.metresPerUnit??1;
  const circles=model.symbols.filter(s=>s.zBand==='structure'&&!s.building)
    .map(s=>({at:s.at,radius:artworkPaintRadius(resolveGlyphFor(model.params.biome??'temperate',s.id),s.scale,s.scaleY??s.scale)}));
  const fortifications=[...(model.wall?[{wall:model.wall,large:false}]:[]),
    ...(model.citadel?.ward instanceof Castle?[{wall:model.citadel.ward.wall,large:true}]:[])];
  for(const {wall,large} of fortifications){
    const width=wallPaintWidth(large)/outputUnit;
    wall.shape.vertices.forEach((a,i)=>{
      if(!wall.segments[i])return;
      const b=wall.shape.vertices[(i+1)%wall.shape.length];
      obstacles.push(roadCorridor(a,b,width));
      circles.push({at:a,radius:width/2},{at:b,radius:width/2});
    });
    for(const at of wall.towers){
      if(wall.gates.some(g=>Point.distance(at,g)<WALL_GATE_CLEARANCE/outputUnit))continue;
      circles.push({at,radius:artworkPaintRadius(cityGlyph('castle-tower-round',model.params.biome),wallTowerCanvas(large)/outputUnit)});
    }
  }
  const circleIndex=createBoundsIndex(circles.map(c=>({bounds:boundsOfPoints([c.at],c.radius),value:c})));
  const index=createBoundsIndex(obstacles.filter(p=>p.length>2).map(p=>({bounds:boundsOfPoints(p.vertices),value:p})));
  const water=model.getWaterRings();
  const waterEdges=water.flatMap(r=>r.map((a,i)=>({a,b:r[(i+1)%r.length]})));
  const waterIndex=createBoundsIndex(waterEdges.map(e=>({bounds:boundsOfPoints([e.a,e.b]),value:e})));
  const distance=(p:Point,a:Point,b:Point)=>Point.distance(p,nearestOnSegment(p,a,b));
  const intersects=(p:Point,r:number,poly:Polygon)=>pointInPolygon(p,poly.vertices)
    ||poly.vertices.some((a,i)=>distance(p,a,poly.vertices[(i+1)%poly.length])<=r);
  const seed=model.params.seed, biome=model.params.biome??'temperate', k=metresPerUnit;
  for(const park of parks){
    park.trees=[];
    const crowns=new PlacementIndex<{at:Point;radius:number}>(16/k);
    for(const grove of park.geometry){
      const bounds=boundsOfPoints(grove.vertices), centre=grove.centroid;
      // Sample finely enough for the smaller species in a mixed grove.
      // Actual measured crowns, below, set the accepted tree spacing.
      const pitch=3.5/k;
      const inset=.5/k, clearing=Math.min(5/k,Math.sqrt(Math.abs(grove.square))*.12);
      for(let row=Math.floor(bounds.min_y/pitch);row<=Math.ceil(bounds.max_y/pitch);row++){
        for(let column=Math.floor(bounds.min_x/pitch);column<=Math.ceil(bounds.max_x/pitch);column++){
          // Bounded jitter makes loose, connected little woods, rather than
          // identical orchard rows. The central lawn and walks remain open.
          const p=new Point((column+.5+(landscapeHash(column,row,seed)-.5)*.55)*pitch,
            (row+.5+(landscapeHash(column,row,seed^0x67726f76)-.5)*.55)*pitch);
          if(!pointInPolygon(p,grove.vertices))continue;
          const roll=landscapeHash(column,row,seed^0x74726565);
          const kind=selectParkTreeAt(biome,p.x*k,p.y*k,seed,roll);
          const canvas=ARTWORK_MANIFEST[kind].footprint![0]*(.9+.2*roll)/k;
          const radius=Math.max(canvas/2,floraCanopyRadius(kind,canvas));
          if(Point.distance(p,centre)<clearing+radius)continue;
          if(grove.vertices.some((a,i)=>distance(p,a,grove.vertices[(i+1)%grove.length])<radius+inset))continue;
          if(park.paths.some(path=>path.slice(1).some((b,i)=>distance(p,path[i],b)<radius+park.pathWidth/2+inset)))continue;
          const query=boundsOfPoints([p],radius+inset);
          if(index.query(query).some(poly=>intersects(p,radius+inset,poly)))continue;
          if(circleIndex.query(query).some(c=>Point.distance(p,c.at)<radius+c.radius+inset))continue;
          if(water.filter(r=>pointInPolygon(p,r)).length%2
            ||waterIndex.query(query).some(e=>distance(p,e.a,e.b)<radius+inset))continue;
          // Crowns may lightly overlap within a stand; separate trunks and
          // slight canopy gaps keep individual trees legible at street scale.
          if(crowns.query(query).some(t=>Point.distance(p,t.at)<.6*(radius+t.radius)))continue;
          crowns.insert(boundsOfPoints([p],radius),{at:p,radius});
          park.trees.push({at:p,kind,scale:canvas,rotationDeg:landscapeHash(column,row,seed^0x726f7461)*360});
        }
      }
    }
  }
}
