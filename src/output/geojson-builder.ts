import type { Feature, FeatureCollection, Polygon as GeoPolygon } from 'geojson';
import type { Polygon } from '../geom/polygon.js';
import type { Model } from '../generator/model.js';
import type { CurtainWall, GateMeta } from '../generator/curtain-wall.js';
import type { GenerationParams } from '../generator/generation-params.js';
import { computeLocalBounds, computeDiameterLocal } from '../generator/bounds.js';
import type { LocalBounds } from '../generator/bounds.js';
import { computeSettlementScale } from './settlement-tiler.js';
import { Castle } from '../wards/castle.js';
import { Harbour } from '../wards/harbour.js';
import { Point } from '../types/point.js';
import { IdAllocator } from './id-allocator.js';
import { selectPois, regimeFor } from '../poi/poi-selector.js';
import { FLOATING_POI_KINDS } from '../poi/poi-kinds.js';

/**
 * Version of the output document shape. Bump whenever a breaking change lands
 * (renamed properties, dropped fields) so consumers can gate their ingestion.
 */
export const GEOJSON_SCHEMA_VERSION = 3;

/**
 * Source-of-truth library version. Kept in sync with package.json manually —
 * cheaper than a JSON import assertion and lets tests pin a deterministic value.
 */
export const SETTLEMAKER_VERSION = '0.4.0';

export interface GenerateGeoJsonOptions {
  /** ISO-8601 timestamp to stamp on the output. Defaults to `new Date().toISOString()`. */
  generatedAt?: string;
  /** Override the library version string (mostly for tests). */
  settlemakerVersion?: string;
  /**
   * Padding (local units) for `metadata.local_bounds`. MUST match
   * `SvgOptions.padding` if both generators are invoked on the same model,
   * otherwise the SVG viewBox and GeoJSON bounds will drift. Defaults to 20
   * to match the SVG default.
   */
  padding?: number;
}

/**
 * Convert a generated Model to a GeoJSON FeatureCollection.
 *
 * Coordinates are in settlement-local units: origin near the burg centroid,
 * Y axis pointing DOWN (SVG convention). Consumers wanting compass-up rendering
 * should mirror Y.
 *
 * The top-level `metadata` block carries schema + generation-version info so
 * downstream systems (e.g. questables) can detect stale output and upsert on
 * a stable `gate_id` within each gate feature.
 */
export function generateGeoJson(model: Model, options: GenerateGeoJsonOptions = {}): FeatureCollection {
  const features: Feature[] = [];
  const allocator = new IdAllocator();
  const buildingIdMap = new Map<Polygon, string>();

  // 1. Wards + buildings (buildings get building_id; populate map for POI linking).
  for (const patch of model.patches) {
    if (!patch.ward) continue;

    features.push({
      type: 'Feature',
      properties: {
        layer: 'ward',
        wardType: patch.ward.type,
        label: patch.ward.getLabel(),
        withinCity: patch.withinCity,
        withinWalls: patch.withinWalls,
      },
      geometry: polygonToGeoJson(patch.shape),
    });

    for (const building of patch.ward.geometry) {
      const buildingId = allocator.alloc('b');
      buildingIdMap.set(building, buildingId);
      features.push({
        type: 'Feature',
        properties: {
          layer: 'building',
          wardType: patch.ward.type,
          building_id: buildingId,
        },
        geometry: polygonToGeoJson(building),
      });
    }

    if (patch.ward instanceof Harbour) {
      for (const pier of patch.ward.piers) {
        features.push({
          type: 'Feature',
          properties: {
            layer: 'pier',
            wardType: patch.ward.type,
          },
          geometry: polygonToGeoJson(pier),
        });
      }
    }
  }

  // 2. Streets: arteries then roads, each with a stable street_id.
  for (const artery of model.arteries) {
    features.push({
      type: 'Feature',
      properties: { layer: 'street', streetType: 'artery', street_id: allocator.alloc('s') },
      geometry: { type: 'LineString', coordinates: artery.vertices.map(v => [v.x, v.y]) },
    });
  }
  for (const road of model.roads) {
    features.push({
      type: 'Feature',
      properties: { layer: 'street', streetType: 'road', street_id: allocator.alloc('s') },
      geometry: { type: 'LineString', coordinates: road.vertices.map(v => [v.x, v.y]) },
    });
  }

  // 3. Walls + entrances (unchanged).
  if (model.wall !== null) {
    addWallFeatures(features, model.wall, 'city_wall');
  }
  if (model.citadel !== null && model.citadel.ward instanceof Castle) {
    addWallFeatures(features, (model.citadel.ward as Castle).wall, 'citadel_wall');
  }
  addEntranceFeatures(features, model);

  // 4. POIs: selected after the rest of the map is built.
  const pois = selectPois(model, model.params.population, allocator, buildingIdMap);
  for (const poi of pois) {
    const props: Record<string, unknown> = {
      layer: 'poi',
      poi_id: allocator.alloc('p'),
      kind: poi.kind,
      ward_type: poi.wardType,
      building_id: poi.buildingId,
    };
    // Per spec: floating POIs are only `pier` and `well`; all other kinds must
    // have a non-null building_id or be omitted entirely (the selector enforces this).
    if (poi.buildingId === null && !FLOATING_POI_KINDS.has(poi.kind)) {
      throw new Error(`POI kind ${poi.kind} emitted without a building_id — selector bug`);
    }
    features.push({
      type: 'Feature',
      properties: props,
      geometry: { type: 'Point', coordinates: [poi.point.x, poi.point.y] },
    });
  }

  return {
    type: 'FeatureCollection',
    features,
    // Extra top-level keys are permitted by RFC 7946 §6.1 ("foreign members").
    metadata: buildMetadata(model, model.params, options),
  } as FeatureCollection & { metadata: OutputMetadata };
}

interface OutputMetadata {
  schema_version: number;
  settlemaker_version: string;
  settlement_generation_version: string;
  coordinate_system: string;
  coordinate_units: string;
  generated_at: string;
  local_bounds: LocalBounds;
  scale: {
    meters_per_unit: number;
    diameter_meters: number;
    diameter_local: number;
    source: string;
  };
  stable_ids: { prefixes: { entrance: 'g'; poi: 'p'; street: 's'; building: 'b' } };
  poi_density: 'hamlet' | 'town';
}

function buildMetadata(
  model: Model,
  params: GenerationParams,
  options: GenerateGeoJsonOptions,
): OutputMetadata {
  const diameterMeters = computeSettlementScale(params.population).diameterMeters;
  const diameterLocal = computeDiameterLocal(model);
  return {
    schema_version: GEOJSON_SCHEMA_VERSION,
    settlemaker_version: options.settlemakerVersion ?? SETTLEMAKER_VERSION,
    settlement_generation_version: computeGenerationVersion(params),
    coordinate_system: 'local_origin_y_down',
    coordinate_units: 'settlement_units',
    generated_at: options.generatedAt ?? new Date().toISOString(),
    local_bounds: computeLocalBounds(model, options.padding ?? 20),
    scale: {
      meters_per_unit: diameterMeters / diameterLocal,
      diameter_meters: diameterMeters,
      diameter_local: diameterLocal,
      source: 'population_heuristic_v1',
    },
    stable_ids: { prefixes: { entrance: 'g', poi: 'p', street: 's', building: 'b' } },
    poi_density: regimeFor(params.population),
  };
}

/**
 * Content hash of every input that influences gate placement. Stable across
 * identical runs; changes the moment any gate-affecting input changes.
 */
function computeGenerationVersion(params: GenerationParams): string {
  const relevant = {
    schema: GEOJSON_SCHEMA_VERSION,
    seed: params.seed,
    nPatches: params.nPatches,
    walls: params.wallsNeeded,
    citadel: params.citadelNeeded,
    plaza: params.plazaNeeded,
    temple: params.templeNeeded,
    shanty: params.shantyNeeded,
    capital: params.capitalNeeded,
    maxGates: params.maxGates ?? null,
    oceanBearing: params.oceanBearing ?? null,
    harbourSize: params.harbourSize ?? null,
    roadBearings: params.roadEntryPoints?.map(r => ({
      b: Math.round(r.bearingDeg * 10) / 10,
      r: r.routeId ?? null,
      k: r.kind ?? null,
    })) ?? null,
  };
  return djb2(JSON.stringify(relevant)).toString(36);
}

function djb2(s: string): number {
  let hash = 5381;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) + hash + s.charCodeAt(i)) & 0x7fffffff;
  }
  return hash || 1;
}

function addEntranceFeatures(features: Feature[], model: Model): void {
  // model.border always exists post-buildWalls(); it holds gateMeta for
  // walled AND unwalled burgs. Citadel-wall gates live on a different
  // CurtainWall and are excluded naturally by the gateMeta.get() filter.
  if (model.border === null) return;
  const border = model.border;
  const diameterLocal = computeDiameterLocal(model);

  for (const gate of model.gates) {
    const meta = border.gateMeta.get(gate);
    if (!meta) continue;
    features.push(entranceFeatureFor(gate, meta, border, model, diameterLocal));
  }
}

function entranceFeatureFor(
  gate: Point,
  meta: GateMeta,
  border: CurtainWall,
  model: Model,
  diameterLocal: number,
): Feature {
  const isHarbour = meta.kind === 'sea' || isOnHarbourWater(gate, model);
  const kind: 'land' | 'harbour' = isHarbour ? 'harbour' : 'land';
  const subKind = isHarbour ? 'harbour' : (meta.kind === 'foot' ? 'foot' : 'road');
  const entranceId = `g${meta.wallVertexIndex}`;

  const neighbours = findNeighbourEntrances(gate, border);

  // Offset arrival a short distance inward so tokens render inside the
  // boundary, not on it. Cap the offset so tiny settlements don't overshoot
  // the origin.
  const r = Math.hypot(gate.x, gate.y);
  const offset = Math.min(3, 0.05 * diameterLocal);
  const arrivalScale = r > 0 ? (r - offset) / r : 0;
  const arrivalLocal: [number, number] = [
    Math.round(gate.x * arrivalScale * 100) / 100,
    Math.round(gate.y * arrivalScale * 100) / 100,
  ];

  const properties: Record<string, unknown> = {
    layer: 'entrance',
    entrance_id: entranceId,
    kind,
    sub_kind: subKind,
    wall_vertex_index: meta.wallVertexIndex,
    bearing_deg: meta.bearingDeg,
    arrival_local: arrivalLocal,
  };
  if (meta.routeId != null) properties.matched_route_id = meta.routeId;
  if (meta.matchDeltaDeg != null) properties.bearing_match_delta_deg = meta.matchDeltaDeg;
  if (neighbours.prev != null) properties.prev_entrance_id = neighbours.prev;
  if (neighbours.next != null) properties.next_entrance_id = neighbours.next;

  return {
    type: 'Feature',
    properties,
    geometry: { type: 'Point', coordinates: [gate.x, gate.y] },
  };
}

function isOnHarbourWater(gate: Point, model: Model): boolean {
  if (model.harbour === null) return false;
  return model.harbour.shape.contains(gate);
}

/**
 * Walk the wall polygon from the gate vertex outward in both directions until
 * the next border gate is found. Returns the neighbour gate ids for the
 * "patrol from gate A to gate B" narrative use case.
 *
 * Scoped to border gates only — citadel-wall gates can coincide with border
 * vertices by identity, so walking over `model.gates` would spuriously stop
 * at them even though they belong to a separate wall.
 */
function findNeighbourEntrances(
  gate: Point,
  border: CurtainWall,
): { prev?: string; next?: string } {
  const verts = border.shape.vertices;
  const n = verts.length;
  const startIdx = verts.indexOf(gate);
  if (startIdx === -1) return {};

  const borderGates = new Set(border.gateMeta.keys());

  const findInDirection = (step: 1 | -1): string | undefined => {
    for (let k = 1; k < n; k++) {
      const v = verts[((startIdx + step * k) % n + n) % n];
      if (v !== gate && borderGates.has(v)) {
        return `g${border.gateMeta.get(v)!.wallVertexIndex}`;
      }
    }
    return undefined;
  };

  return { next: findInDirection(1), prev: findInDirection(-1) };
}

function addWallFeatures(features: Feature[], wall: CurtainWall, wallType: string): void {
  features.push({
    type: 'Feature',
    properties: { layer: 'wall', wallType },
    geometry: polygonToGeoJson(wall.shape),
  });

  for (const tower of wall.towers) {
    features.push({
      type: 'Feature',
      properties: { layer: 'tower', wallType },
      geometry: { type: 'Point', coordinates: [tower.x, tower.y] },
    });
  }
}

function polygonToGeoJson(poly: Polygon): GeoPolygon {
  const coords = poly.vertices.map(v => [v.x, v.y] as [number, number]);
  if (coords.length > 0) {
    coords.push([coords[0][0], coords[0][1]]);
  }
  return { type: 'Polygon', coordinates: [coords] };
}
