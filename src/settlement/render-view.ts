import type { Scene, ScenePoint } from '../scene/scene.js';
import type { LocalBounds } from '../generator/bounds.js';

/** Conservative viewport rejection: crossing lines and overlapping glyphs stay.
 * The physical model and its export are never clipped or simplified. */
export function sceneInView(scene: Scene, bounds: LocalBounds): Scene {
  const intersects = (points: ScenePoint[], padding = 0) => {
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for(const p of points){minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y);}
    return minX-padding<=bounds.max_x && maxX+padding>=bounds.min_x && minY-padding<=bounds.max_y && maxY+padding>=bounds.min_y;
  };
  const L=scene.layers;
  return {...scene,bounds,layers:{...L,
    buildings:L.buildings.filter(b=>intersects(b.ring,2)),
    fields:L.fields.filter(f=>intersects(f.ring)),
    greens:L.greens.filter(g=>intersects(g.ring,2)),
    roads:L.roads.filter(r=>intersects(r.path,(r.width??3)/2)),
    vegetation:L.vegetation.filter(v=>intersects([v.at],v.scale)),
    symbols:L.symbols.filter(s=>intersects([s.at],Math.hypot(s.scale,s.scaleY??s.scale))),
    piers:L.piers.filter(p=>intersects(p.ring)),
    bridges:L.bridges?.filter(b=>intersects(b.path,b.width)),
  }};
}
