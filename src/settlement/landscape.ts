import { Point } from '../types/point.js';
import { SeededRandom } from '../utils/random.js';
import { ARTWORK_MANIFEST } from '../assets/artwork.js';
import { buildFields } from '../village/dressing/fields.js';
import { buildVegetation } from '../village/dressing/vegetation.js';
import { radialExtent } from '../village/dressing/extent.js';
import { clipPolylineToRect } from '../village/geometry.js';
import { drySegments } from '../generator/city-frontage.js';
import type { Lane, Lot } from '../village/types.js';
import type { Layout } from './layouts.js';
import polygonClipping from 'polygon-clipping';
import { waterFillPolygons } from '../village/water-boundary.js';
import { growApronPath } from '../village/skeleton/apron.js';

/** Both layout techniques hand their occupied ground to the same field and
 * woodland planner. No pixel scale or population-to-diameter conversion. */
export function dressSettlement(layout: Layout, seed: number): void {
  const { scene, site, green } = layout;
  const L = scene.layers;
  if (site.water.length) {
    const supplied = waterFillPolygons(site.water);
    const rings = site.water.map(r => [r.map(p => [p.x, p.y] as [number, number])]);
    const polygons = supplied ?? polygonClipping.union(rings[0], ...rings.slice(1))
      .map(poly => poly.map(r => r.map(([x, y]) => new Point(x, y))));
    L.water.polygons = polygons;
    L.water.rings = polygons.flat();
  }
  const lots: Lot[] = L.buildings.map((b, i) => {
    const xs = b.ring.map(p => p.x), ys = b.ring.map(p => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    return { id: b.id ?? `claim:${i}`, laneId: '', side: 1, front: new Point((minX + maxX) / 2, minY), bearingDeg: 0,
      frontageM: maxX - minX, depthM: maxY - minY, score: 0 };
  });
  const builtPoints = L.buildings.flatMap(b => b.ring.map(p => new Point(p.x, p.y)));
  const extent = radialExtent(green.centre, builtPoints, Math.max(1, green.diameter / 2));
  // Extend external approaches before fields reserve ground; their final cut
  // happens after the landscape establishes the drawing boundary.
  for (const road of L.roads) if (road.kind === 'road' && road.path.length >= 2) {
    if (Math.hypot(road.path[0].x, road.path[0].y) > Math.hypot(road.path.at(-1)!.x, road.path.at(-1)!.y)) road.path.reverse();
  }
  const key = (p: {x:number;y:number}) => `${p.x.toFixed(5)},${p.y.toFixed(5)}`;
  const owners = new Map<string,number>();
  for (const road of L.roads) for (const k of new Set(road.path.map(key))) owners.set(k,(owners.get(k)??0)+1);
  for (const [i,road] of L.roads.entries()) if (road.kind === 'road' && road.path.length >= 2) {
    // A village approach and its apron are separate connected paths. Extending
    // both used to draw a straight road through the existing curved apron.
    if ((owners.get(key(road.path.at(-1)!))??0)>1) continue;
    const continuation = growApronPath({id:`landscape:${seed}:${i}`,type:'local',widthM:road.width??3,
      points:road.path.map(p=>new Point(p.x,p.y))},extent.maxM*2+1000);
    for (let j=1;j<continuation.length;j++) {
      const a=continuation[j-1],b=continuation[j],dry=drySegments(a,b,site.water)[0];
      if (!dry || Point.distance(dry[0],a)>1e-6) break;
      road.path.push(dry[1]);
      if (Point.distance(dry[1],b)>1e-6) break;
    }
  }
  const lanes: Lane[] = L.roads.map((r, i) => ({ id: `street:${i}`, type: 'local', points: r.path.map(p => new Point(p.x, p.y)), widthM: r.width ?? 3 }));
  const reservations = [...L.greens.map(g => g.ring), ...L.piers.map(p => p.ring)].map(r => r.map(p => new Point(p.x, p.y)));
  const rng = new SeededRandom(seed ^ 0x51f15e);
  const fields = buildFields(site, green, lanes, lots, [], rng, new Set(lots.map(l => l.id)), reservations, {
    maxRegionDepthM: Math.max(200, Math.sqrt(site.population * 150)),
    parcelAreaM2: 1200 * Math.max(1, site.population / 20000),
    maxCutDepth: 20,
    approachLaneIds: new Set(lanes.filter((_,i)=>L.roads[i].kind==='road').map(l=>l.id)),
  });
  L.fields = fields.blocks.map(f => ({ ring: f.polygon, glyph: f.glyph, angleDeg: f.furrowBearingDeg }));
  const landscapePoints = [...builtPoints, ...fields.blocks.flatMap(f => f.polygon), ...fields.regionPolygon];
  const edge = radialExtent(green.centre, landscapePoints, Math.max(1, green.diameter / 2));
  // City-scale landscapes use a coarser sampling grid, with actual tree sizes
  // retained. This bounds decorative output without changing housing or units.
  const samplingScale = Math.max(1, edge.maxM / 650);
  const vegetation = buildVegetation(site, green, lanes, lots, [], fields.blocks, extent, edge, extent.maxM, rng, reservations, samplingScale);
  if (samplingScale > 1) layout.diagnostics.push(`landscape vegetation sampled at ${samplingScale.toFixed(2)} times the base spacing`);
  L.vegetation.push(...vegetation.map(v => ({ at: v.position, kind: v.glyph, scale: (ARTWORK_MANIFEST[v.glyph]?.footprint?.[0] ?? 7) * (v.scale ?? 1), rotationDeg: 0 })));
  // Bounds include the full painted footprint of trees and symbols. Approach
  // lengths and off-map water polygons never decide the frame.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const include = (x: number, y: number, pad = 0) => { minX = Math.min(minX, x - pad); minY = Math.min(minY, y - pad); maxX = Math.max(maxX, x + pad); maxY = Math.max(maxY, y + pad); };
  for (const p of landscapePoints) include(p.x, p.y);
  for (const v of L.vegetation) include(v.at.x, v.at.y, v.scale / 2);
  for (const s of L.symbols) include(s.at.x, s.at.y, Math.hypot(s.scale, s.scaleY ?? s.scale) / 2);
  for (const w of L.walls) for (const r of w.polylines) for (const p of r) include(p.x, p.y, 5);
  scene.bounds = { min_x: minX - 20, min_y: minY - 20, max_x: maxX + 20, max_y: maxY + 20 };
  const frame = { minX: scene.bounds.min_x, minY: scene.bounds.min_y, maxX: scene.bounds.max_x, maxY: scene.bounds.max_y };
  for (const r of L.roads) r.path = clipPolylineToRect(r.path.map(p => new Point(p.x, p.y)), frame);
  L.roads = L.roads.filter(r => r.path.length > 1);
  if (site.surveyRadiusM !== undefined) {
    const radius = Math.max(...[frame.minX, frame.maxX].flatMap(x => [frame.minY, frame.maxY].map(y => Math.hypot(x, y))));
    if (radius + 1000 > site.surveyRadiusM) throw new RangeError(`water survey must cover at least ${Math.ceil(radius + 1000)} metres`);
  }
}
