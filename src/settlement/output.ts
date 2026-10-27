import type { Feature, FeatureCollection, Position } from 'geojson';
import { assembleSvg, type AssembleOptions } from '../output/assemble-svg.js';
import type { Scene, ScenePoint } from '../scene/scene.js';
import type { SettlementModel } from './model.js';
import type { LocalBounds } from '../generator/bounds.js';
import { sceneInView } from './render-view.js';

const pt = (p: ScenePoint): Position => [p.x, p.y];
const closed = (points: ScenePoint[]): Position[] => {
  const ring = points.map(pt);
  if (ring.length && (ring[0][0] !== ring.at(-1)![0] || ring[0][1] !== ring.at(-1)![1])) ring.push([...ring[0]]);
  return ring;
};

export interface SettlementRenderOptions extends Omit<AssembleOptions, 'pixelsPerUnit'> {
  /** Target display width in pixels; default 1200. Geometry remains in metres. */
  width?: number;
  /** Physical viewport. Zoom by changing bounds and rendering again. */
  bounds?: LocalBounds;
  /** Both modes retain native artwork at every display size. */
  detail?: 'auto' | 'full';
}

export function renderSettlement(model: SettlementModel, options: SettlementRenderOptions = {}): string {
  const width=options.width??1200;
  if (!Number.isFinite(width)||width<=0) throw new RangeError('render width must be positive and finite');
  const bounds=options.bounds??model.scene.bounds;
  if (!Object.values(bounds).every(Number.isFinite)||bounds.max_x<=bounds.min_x||bounds.max_y<=bounds.min_y) throw new RangeError('render bounds must have positive finite dimensions');
  if (options.detail!==undefined&&!['auto','full'].includes(options.detail)) throw new RangeError('render detail must be auto or full');
  const appearance = {...options, cullOffscreenArtwork:options.cullOffscreenArtwork??!!options.bounds, pixelsPerUnit: options.detail==='full'?undefined:width/(bounds.max_x-bounds.min_x)};
  const scene=sceneInView(model.scene,bounds,appearance);
  return renderPhysicalScene(scene, appearance);
}

/** Shared physical output annotation; rendering adapters must not infer units. */
export function renderPhysicalScene(scene: Scene, appearance: AssembleOptions): string {
  return assembleSvg(scene, appearance)
    .replace('<svg ', '<svg data-px-per-metre="1" data-coordinate-system="local_metres_y_down" data-origin-x="0" data-origin-y="0" ');
}

export type SettlementGeoJson = FeatureCollection & { metadata: {
  schema: 'settlemaker/physical-plan';
  schema_version: 1;
  coordinate_system: 'local_metres_y_down';
  coordinate_units: 'metres';
  local_bounds: SettlementModel['scene']['bounds'];
  scale: { meters_per_unit: 1; source: 'physical_layout_v1' };
  residents: SettlementModel['residents'];
  development: SettlementModel['development'];
  seed: number;
  placement?: SettlementModel['placement'];
} };

/** Export the very same geometry the renderer consumes. This is a distinct,
 * versioned local-plan schema, not a silent reinterpretation of legacy coordinates. */
export function exportSettlement(model: SettlementModel): SettlementGeoJson {
  const features: Feature[] = [];
  const polygon = (id: string, points: ScenePoint[], properties: Record<string, unknown>) => {
    if (points.length >= 3) features.push({ type: 'Feature', id, properties, geometry: { type: 'Polygon', coordinates: [closed(points)] } });
  };
  const line = (id: string, path: ScenePoint[], properties: Record<string, unknown>) => {
    if (path.length >= 2) features.push({ type: 'Feature', id, properties, geometry: { type: 'LineString', coordinates: path.map(pt) } });
  };
  const point = (id: string, at: ScenePoint, properties: Record<string, unknown>) => features.push({ type: 'Feature', id, properties, geometry: { type: 'Point', coordinates: pt(at) } });
  const L = model.scene.layers;
  const residents = new Map(model.buildings.map(b => [b.id, b]));
  for (const [i, b] of L.buildings.entries()) {
    const id = b.id ?? `building:${i}`, account = residents.get(id);
    polygon(id, b.ring, { layer: 'building', building_id: id, kind: b.kind, capacity: account?.capacity ?? 0, residents: account?.residents ?? 0,
      district_id: account?.districtId ?? null, ...(account?.settlementRole ? {settlement_role:account.settlementRole} : {}), inside_walls: account?.insideWalls ?? false, urbanity: account?.urbanity ?? null });
  }
  for (const [i, r] of L.roads.entries()) line(r.id ?? `street:${i}`, r.path, { layer: 'street', street_id: r.id ?? `street:${i}`, streetType: r.kind, ...(r.role ? {role:r.role} : {}), width: r.width ?? 3, ...(r.taper ? { taper_widths_m: r.taper } : {}), ...(r.access ? { access: true } : {}), route_ids: r.routeIds ?? [] });
  for (const [i, g] of (L.ground??[]).entries()) polygon(`ground:${i}`,g.ring,{layer:'ground',surface:g.surface});
  for (const [i, f] of L.fields.entries()) polygon(`field:${i}`, f.ring, { layer: 'field', glyph: f.glyph, bearing_deg: f.angleDeg });
  for (const [i, g] of L.greens.entries()) { polygon(`green:${i}`, g.ring, { layer: 'green', ...(g.purpose ? {purpose:g.purpose} : {}), ...(g.surface ? {surface:g.surface} : {}) }); for (const [j, p] of (g.paths ?? []).entries()) line(`green:${i}:path:${j}`, p, { layer: 'path', width: g.pathWidth }); }
  for (const [i, v] of L.vegetation.entries()) point(`vegetation:${i}`, v.at, { layer: 'vegetation', glyph: v.kind, width_m: v.scale, bearing_deg: v.rotationDeg });
  if (L.water.rings.length) features.push({ type: 'Feature', id: 'water', properties: { layer: 'water' }, geometry: { type: 'MultiPolygon', coordinates: (L.water.polygons ?? L.water.rings.map(r => [r])).map(poly => poly.map(closed)) } });
  for (const [i, p] of L.piers.entries()) polygon(`pier:${i}`, p.ring, { layer: 'pier', ...(p.harbourId ? { harbour_id: p.harbourId } : {}) });
  for (const harbour of L.harbours ?? []) {
    const props = { harbour_id: harbour.id, harbour_kind: harbour.kind };
    if (harbour.beach) polygon(`${harbour.id}:beach`, harbour.beach, { ...props, layer: 'beach', surface: 'sand' });
    polygon(`${harbour.id}:basin`, harbour.basin, { ...props, layer: 'harbour-basin', navigation_width_m: harbour.navigationWidth });
    line(`${harbour.id}:entrance`, harbour.entrance, { ...props, layer: 'harbour-entrance' });
    line(`${harbour.id}:approach`, harbour.approach, { ...props, layer: 'harbour-approach', width: harbour.navigationWidth });
    for (const [i,q] of harbour.quays.entries()) polygon(`${harbour.id}:quay:${i}`, q.ring, { ...props, layer: 'quay' });
    for (const [i,b] of harbour.breakwaters.entries()) polygon(`${harbour.id}:breakwater:${i}`, b.ring, { ...props, layer: 'breakwater', width: b.width });
    for (const [i,p] of harbour.access.entries()) line(`${harbour.id}:access:${i}`, p, { ...props, layer: 'harbour-access' });
    for (const [i,f] of harbour.fixtures.entries()) point(`${harbour.id}:fixture:${i}`, f.at, { ...props, layer: 'harbour-fixture', kind: f.kind, bearing_deg: f.angle });
  }
  for (const [i, w] of L.walls.entries()) {
    for (const [j, p] of w.polylines.entries()) line(`wall:${i}:${j}`, p, { layer: 'wall', material: w.material });
    for (const [j, g] of w.gates.entries()) line(`gate:${i}:${j}`, [g.p1, g.p2], { layer: 'entrance', route_ids: g.routeIds });
  }
  for (const d of model.districts) polygon(d.id, d.boundary, { layer: 'district', district_id: d.id, urbanity: d.urbanity, inside_walls: d.insideWalls,
    ...(d.settlementRole ? {settlement_role:d.settlementRole} : {}), ...(d.character ? {character:d.character} : {}),
    ...(d.occupiedAreaM2 !== undefined ? {occupied_area_m2:d.occupiedAreaM2} : {}), ...(d.areaM2 !== undefined ? {area_m2:d.areaM2} : {}) });
  for (const [i, s] of L.symbols.entries()) point(`symbol:${i}`, s.at, { layer: 'symbol', glyph: s.id, building_id: s.buildingId,
    ...(s.buildingIds ? { building_ids: s.buildingIds } : {}), width_m: s.scale, height_m: s.scaleY ?? s.scale, bearing_deg: s.rotationDeg });
  for (const b of L.bridges ?? []) line(b.id, b.path, { layer: 'bridge', width: b.width });
  return { type: 'FeatureCollection', features, metadata: { schema: 'settlemaker/physical-plan', schema_version: 1, coordinate_system: 'local_metres_y_down', coordinate_units: 'metres',
    local_bounds: { ...model.scene.bounds }, scale: { meters_per_unit: 1, source: 'physical_layout_v1' }, residents: structuredClone(model.residents),
    development: { ...model.development }, seed: model.seed,
    ...(model.placement ? { placement: structuredClone(model.placement) } : {}) } };
}
