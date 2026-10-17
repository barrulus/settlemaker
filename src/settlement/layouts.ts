import type { AzgaarBurgInput } from '../input/azgaar-input.js';
import { mapToGenerationParams, MAX_PATCHES } from '../input/azgaar-input.js';
import { Model } from '../generator/model.js';
import { cityUrbanity } from '../generator/city-character.js';
import { neighbourhoodCharacter, isNaturalCommon } from '../generator/city-neighbourhoods.js';
import { timeGenerationStage, type GenerationTimingObserver } from '../generator/timing.js';
import type { DegradedFlag } from '../generator/generation-params.js';
import { meanBuildingArea, patchAreaForDemand } from '../generator/generation-params.js';
import { buildingIds } from '../output/id-allocator.js';
import { buildScene } from '../scene/build-scene.js';
import { SCENE_VERSION, type Scene, type ScenePoint } from '../scene/scene.js';
import { Point } from '../types/point.js';
import { WardType } from '../types/interfaces.js';
import { generateVillage } from '../village/village-model.js';
import { inkExtent } from '../village/glyphs.js';
import { roadCrossSection } from '../village/cross-section.js';
import { villageWall, villageWallBoundary } from '../village/walls.js';
import { buildSite } from '../village/site.js';
import { pointInPolygon } from '../geom/point-in-polygon.js';
import type { Green, Site } from '../village/types.js';
import { residentialCapacity, type DevelopmentProfile } from './development.js';
import type { SettlementBuilding, SettlementDistrict } from './model.js';
import { shapeVillageApproaches } from './approaches.js';

export interface Layout {
  scene: Scene;
  buildings: SettlementBuilding[];
  districts: SettlementDistrict[];
  site: Site;
  green: Green;
  diagnostics: string[];
  degradedFlags?: DegradedFlag[];
}

/** The block solver's mesh has a fixed engineering scale, independent of
 * population, frame padding, theme or the amount of surrounding farmland. */
const BLOCK_METRES_PER_UNIT = 3;

function scaleScene(scene: Scene, k: number): void {
  const point = (p: ScenePoint) => { p.x *= k; p.y *= k; };
  const ring = (r: ScenePoint[]) => r.forEach(point);
  const L = scene.layers;
  L.water.rings.forEach(ring);
  for (const f of L.fields) ring(f.ring);
  for (const g of L.greens) { ring(g.ring); g.paths?.forEach(ring); if (g.pathWidth !== undefined) g.pathWidth *= k; }
  for (const b of L.buildings) ring(b.ring);
  for (const p of L.piers) ring(p.ring);
  for (const r of L.roads) { ring(r.path); if (r.width !== undefined) r.width *= k; }
  for (const s of L.symbols) { point(s.at); s.scale *= k; if (s.scaleY !== undefined) s.scaleY *= k; }
  for (const v of L.vegetation) { point(v.at); v.scale *= k; }
  for (const w of L.walls) { w.polylines.forEach(ring); w.towers.forEach(point); for (const g of w.gates) { point(g.p1); point(g.p2); } }
  for (const b of L.bridges ?? []) { ring(b.path); b.width *= k; }
  for (const key of Object.keys(scene.bounds) as Array<keyof Scene['bounds']>) scene.bounds[key] *= k;
  scene.metersPerUnit = 1;
  delete scene.buildingCapacity;
}

export function blockLayout(input: AzgaarBurgInput, seed: number, profile: DevelopmentProfile, supply = { core: 1, outer: 1 }, landScale = 1, onStageTiming?: GenerationTimingObserver): Layout {
  const site = buildSite({ ...input, engine: 'village' }, seed);
  const corePeople = profile.corePopulation ?? Math.ceil(input.population * .8);
  const coreBuildings = Math.ceil(corePeople / profile.centreOccupancy * supply.core);
  const outerBuildings = Math.ceil((input.population - corePeople) / ((profile.centreOccupancy + profile.edgeOccupancy) / 2) * supply.outer);
  const target = Math.max(2, coreBuildings + outerBuildings);
  const k = BLOCK_METRES_PER_UNIT;
  const params = mapToGenerationParams({
    ...input, engine: 'city', waterContext: undefined, rivers: undefined,
    // The common site reader has already constructed water in metres.
    coastlineGeometry: site.water.map(r => r.map(p => ({ x: p.x / k, y: p.y / k }))),
    oceanBearing: undefined, urbanDensity: input.population / target,
  }, seed);
  params.cityLayout = true;
  // Physical street houses have a finer grain than the legacy city texture.
  // More households require more roofs, not larger merged roof symbols.
  params.textureScaleOverride = .3;
  // Keep neighbourhoods at a street-block scale when the outer city is much
  // larger than its historic core. The legacy 220-patch cap otherwise forces
  // outskirts into enormous precincts or stretches growth along distant roads.
  const patchLimit = Math.max(MAX_PATCHES, Math.min(1200, Math.ceil(target / 26) + 2));
  params.nCore = Math.min(patchLimit - (outerBuildings > 0 ? 1 : 0), Math.max(input.population < 100 ? 4 : 8, Math.ceil(coreBuildings / 26) + 2));
  params.nPatches = Math.min(patchLimit, params.nCore + (outerBuildings > 0 ? Math.max(2, Math.ceil(outerBuildings / 24)) : 0));
  // Size the enclosure for the actual bounded house grain and net coverage.
  // The old calibration assumed tiny fringe roofs and repeatedly rebuilt the
  // whole city after the first physical capacity estimate came up short.
  const houseArea = meanBuildingArea(10000) * params.textureScaleOverride / .6 * .85;
  const physicalScale = Math.max(.25, Math.sqrt(coreBuildings / Math.max(1, params.nCore - 2)
    * houseArea / (.6 * patchAreaForDemand(10000))));
  // Small towns retain their compact, reviewed enclosure; their local supply
  // correction is cheap. Blend into the physical estimate before large-city
  // retries become expensive, rather than introducing a population threshold.
  const compactScale = .8 * Math.sqrt(.5 * Math.max(.16, coreBuildings / Math.max(1, params.nCore - 2) / 30));
  const blend = Math.max(0,Math.min(1,(input.population-2000)/8000));
  const demandScale = compactScale + (physicalScale-compactScale)*blend;
  params.development = { coreBuildings, texturePopulation: 10000, metresPerUnit: k, landScale: landScale * demandScale,
    outerLandScale: Math.sqrt(1.7) };
  const model = new Model(params);
  model.onStageTiming = onStageTiming;
  model.generate();
  const scene = timeGenerationStage('scene', onStageTiming, () => buildScene(model));
  // Outer commons can retain a natural grove rather than a formal civic lawn.
  // Their ground was reserved by createWards, before residential subdivision.
  const natural = new Set(model.patches.filter(p => p.ward?.type === WardType.Park && isNaturalCommon(model,p))
    .flatMap(p => p.ward!.geometry.map(g => `${g.vertices[0]?.x},${g.vertices[0]?.y}`)));
  for (const g of scene.layers.greens) if (natural.has(`${g.ring[0]?.x},${g.ring[0]?.y}`)) g.purpose = 'natural';
  scaleScene(scene, k);
  const ids = buildingIds(model);
  const excluded = new Set([WardType.Castle, WardType.Cathedral, WardType.Market, WardType.Harbour, WardType.Park, WardType.Water, WardType.Empty]);
  const footprints = new Map(scene.layers.buildings.map(b => [b.id, b.ring]));
  const buildings: SettlementBuilding[] = [];
  const districts: SettlementDistrict[] = [];
  for (const [i, patch] of model.patches.entries()) {
    if (!patch.ward || (!patch.ward.geometry.length && !patch.withinCity)
      || [WardType.Water,WardType.Empty].includes(patch.ward.type)) continue;
    const urbanity = patch.zone === 'core' ? 1 : cityUrbanity(model, patch);
    const id = `district:${i}`;
    const insideWalls = model.wall !== null && patch.withinWalls;
    const settlementRole = patch.ward.type === WardType.Farm ? 'rural' as const : 'urban' as const;
    districts.push({ id, urbanity, insideWalls, settlementRole,
      character: patch.ward.type === WardType.Park ? 'green' : settlementRole === 'rural' ? 'rural'
        : excluded.has(patch.ward.type) ? 'civic' : neighbourhoodCharacter(model, patch),
      occupiedAreaM2: patch.ward.type === WardType.Park ? 0 : patch.ward.geometry.reduce((sum,b) => sum + Math.abs(b.square) * k * k, 0),
      areaM2: Math.abs(patch.shape.square) * k * k,
      boundary: patch.shape.vertices.map(p => ({ x: p.x * k, y: p.y * k })) });
    // Public neighbourhoods are still part of the city land area. Their
    // buildings contribute no residential capacity, but omitting the district
    // makes parks, squares and temple precincts look like holes in the city.
    if (excluded.has(patch.ward.type)) continue;
    for (const building of patch.ward.geometry) {
      const buildingId = ids.get(building)!;
      buildings.push({ id: buildingId, districtId: id, footprint: footprints.get(buildingId)!, urbanity, settlementRole,
        insideWalls, capacity: residentialCapacity(profile, urbanity), residents: 0 });
    }
  }
  const plaza = (model.plaza?.ward?.publicSpace ?? model.plaza?.shape)?.vertices.map(p => new Point(p.x * k, p.y * k));
  return { scene, buildings, districts, site,
    green: { centre: new Point(0, 0), diameter: 0, bearingDeg: 0, shape: 'sm-green-round', variant: 'a', ...(plaza ? { outline: plaza } : {}) },
    degradedFlags: [...model.degradedFlags], diagnostics: [...model.degradedFlags].map(f => `layout could not place ${f}`) };
}

export function frontageLayout(input: AzgaarBurgInput, seed: number, profile: DevelopmentProfile): Layout {
  const village = generateVillage({ ...input, engine: 'village' }, seed, undefined, { landscape: false, occupancy: profile.edgeOccupancy });
  const scene: Scene = { version: SCENE_VERSION, seed, name: input.name, population: input.population,
    biome: village.site.biome, metersPerUnit: 1,
    bounds: { min_x: village.frame.minX, min_y: village.frame.minY, max_x: village.frame.maxX, max_y: village.frame.maxY },
    layers: { water: { rings: village.site.water.map(r => r.map(p => ({ ...p }))), synthetic: input.oceanBearing !== undefined && !input.coastlineGeometry?.length },
      fields: [], furrows: [], greens: [], vegetation: [], symbols: [], roads: [], buildings: [], piers: [], walls: [] } };
  const L = scene.layers;
  for (const lane of village.lanes) L.roads.push({ path: lane.points.map(p => ({ ...p })), kind: lane.routeRole === 'approach' ? 'road' : 'alley', width: roadCrossSection(lane).surfaceM, routeIds: lane.sourceRouteIds });
  // Water-routed approaches already encode their bank/bridge constraints.
  if (!village.site.water.length) L.roads = shapeVillageApproaches(L.roads,seed);
  for (const b of village.buildings) L.symbols.push({ id: b.glyph, at: { ...b.position }, scale: b.footprint[0], scaleY: b.footprint[1], rotationDeg: b.bearingDeg, zBand: 'structure', buildingId: b.id });
  for (const b of village.buildings) {
    const ink = inkExtent(b.glyph, b.footprint);
    const hw = ink.width / 2, hd = ink.depth / 2;
    const angle = b.bearingDeg * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
    const ring = [[-hw,-hd],[hw,-hd],[hw,hd],[-hw,hd]].map(([x,y]) => ({
      x: b.position.x + x*c - y*s, y: b.position.y + x*s + y*c,
    }));
    L.buildings.push({ id: b.id, ring, kind: 'Craftsmen', landmark: b.occupancy === 0, glyphBacked: true });
  }
  const green = village.green;
  const outline = green.outline ?? Array.from({ length: 32 }, (_, i) => new Point(green.centre.x + Math.cos(i * Math.PI / 16) * green.diameter / 2, green.centre.y + Math.sin(i * Math.PI / 16) * green.diameter / 2));
  L.greens.push({ ring: outline.map(p => ({ ...p })) });
  let boundary: Point[] = [];
  if (input.walls) {
    const ordered = [...village.buildings].sort((a, b) => a.position.length - b.position.length || a.id.localeCompare(b.id));
    let capacity = 0;
    const enclosed = ordered.filter(b => {
      if (capacity >= (profile.corePopulation ?? input.population)) return false;
      capacity += b.occupancy;
      return true;
    });
    boundary = villageWallBoundary(enclosed, [], outline);
    L.walls.push(villageWall(boundary, village.lanes, village.site.water, village.site.biome));
  }
  L.bridges = village.bridges.filter(b => b.centreline && b.narrow).map(b => ({ id: b.id, path: b.centreline!, width: roadCrossSection(village.lanes.find(l => l.id === b.laneId)!).surfaceM }));
  const footprints = new Map(L.buildings.map(b => [b.id, b.ring]));
  const buildings = village.buildings.map(b => ({ id: b.id, districtId: 'district:frontage', footprint: footprints.get(b.id)!,
    capacity: b.occupancy, residents: 0, urbanity: 0, insideWalls: input.walls && pointInPolygon(b.position, boundary) }));
  for (const b of buildings) b.districtId = b.insideWalls ? 'district:frontage:inside' : 'district:frontage:outside';
  return { scene, buildings, districts: [true, false].flatMap(insideWalls => {
    const members = village.buildings.filter(b => buildings.find(account => account.id === b.id)!.insideWalls === insideWalls);
    return members.length ? [{ id: `district:frontage:${insideWalls ? 'inside' : 'outside'}`, boundary: villageWallBoundary(members, [], outline), urbanity: 0, insideWalls }] : [];
  }),
    site: village.site, green, diagnostics: village.diagnostics.filter(d => !d.startsWith('water strangled')) };
}
