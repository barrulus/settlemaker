import { buildingLots, countrysidePlan } from './countryside.js';
import { Point } from '../types/point.js';
import { SeededRandom } from '../utils/random.js';
import { ARTWORK_MANIFEST } from '../assets/artwork.js';
import { buildFields } from '../village/dressing/fields.js';
import { buildVegetation } from '../village/dressing/vegetation.js';
import { radialExtent } from '../village/dressing/extent.js';
import { clipPolylineToRect } from '../village/geometry.js';
import { drySegments, overlapsWater, polygonsOverlap } from '../generator/city-frontage.js';
import type { Lane } from '../village/types.js';
import type { Layout } from './layouts.js';
import polygonClipping from 'polygon-clipping';
import { waterFillPolygons } from '../village/water-boundary.js';
import { growApronPath } from '../village/skeleton/apron.js';
import { Polygon } from '../geom/polygon.js';
import { roadCorridor } from '../geom/road-corridor.js';
import { PlacementIndex, placementBounds } from '../generator/placement-index.js';

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
  const lots=buildingLots(layout);
  const ruralIds=new Set(layout.buildings.filter(b=>b.settlementRole==='rural').map(b=>b.id));
  const countryside=countrysidePlan(layout,seed),urbanLots=countryside.urbanLots;
  const builtPoints = L.buildings.flatMap(b => b.ring.map(p => new Point(p.x, p.y)));
  // Rural homes reserve their actual footprints, not an empty radial envelope
  // around every hamlet. Fields remain interleaved with inhabited countryside.
  const urbanPoints = L.buildings.filter(b => !b.id || !ruralIds.has(b.id)).flatMap(b => b.ring.map(p => new Point(p.x,p.y)));
  const extent = radialExtent(green.centre, urbanPoints, Math.max(1, green.diameter / 2));
  // Extend external approaches before fields reserve ground; their final cut
  // happens after the landscape establishes the drawing boundary.
  for (const road of L.roads) if (road.kind === 'road' && road.path.length >= 2) {
    if (Math.hypot(road.path[0].x, road.path[0].y) > Math.hypot(road.path.at(-1)!.x, road.path.at(-1)!.y)) road.path.reverse();
  }
  // The final apron must honour the same occupied/protected ground as rural
  // placement, including a road which rural growth previously stopped.
  const approachClaims = new PlacementIndex<Polygon>();
  const claim = (p: Polygon) => { if (p.length>2) approachClaims.insert(placementBounds(p.vertices),p); };
  for (const ring of [...L.buildings.map(b=>b.ring),...L.greens.map(g=>g.ring),...L.piers.map(p=>p.ring)])
    claim(new Polygon(ring.map(p=>new Point(p.x,p.y))));
  for (const wall of L.walls) for (const path of wall.polylines) for (let i=1;i<path.length;i++)
    claim(roadCorridor(path[i-1],path[i],3));
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
      const corridor=roadCorridor(a,dry[1],road.width??3);
      if (overlapsWater(corridor,site.water) || approachClaims.query(placementBounds(corridor.vertices)).some(p=>polygonsOverlap(corridor,p))) break;
      road.path.push(dry[1]);
      if (Point.distance(dry[1],b)>1e-6) break;
    }
  }
  const lanes: Lane[] = L.roads.map((r, i) => ({ id: `street:${i}`, type: 'local', points: r.path.map(p => new Point(p.x, p.y)), widthM: r.width ?? 3 }));
  const reservations = [...L.greens.map(g => g.ring), ...L.piers.map(p => p.ring),
    ...L.buildings.filter(b => b.id && ruralIds.has(b.id)).map(b => b.ring)].map(r => r.map(p => new Point(p.x, p.y)));
  const farmClaims=L.buildings.filter(b=>b.id?.startsWith('building:rural:')).map(b=>b.ring.map(p=>new Point(p.x,p.y)));
  for(const road of L.roads.filter(r=>r.id?.startsWith('street:rural:')))for(let i=1;i<road.path.length;i++) {
    const corridor=roadCorridor(road.path[i-1],road.path[i],(road.width??3)+1).vertices;
    reservations.push(corridor);farmClaims.push(corridor);
  }
  const rng = new SeededRandom(seed ^ 0x51f15e);
  const fields = buildFields(site, green, lanes, urbanLots, [], rng, new Set(urbanLots.map(l => l.id)), reservations, {
    regionPlan: countryside.plan,
    ...(farmClaims.length?{refineAround:{claims:farmClaims,targetAreaM2:1200,maxDepth:5}}:{}),
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
