import type { LocalBounds } from '../generator/bounds.js';
import type { BuildingCapacity } from '../generator/model.js';

/**
 * Versioned semantic scene: WHAT is where, never how it looks. This is the
 * spec's long-term integration contract — a future AFMG-side assembler
 * consumes this same shape. Additive evolution only; bump SCENE_VERSION on
 * breaking change.
 */
export const SCENE_VERSION = 2 as const;

export interface ScenePoint { x: number; y: number }

export interface WaterLayer {
  /** Real banks only: excludes internal seams and survey-square closure. */
  shorelines?: ScenePoint[][];
  /** A generated open sea can continue beyond the settlement's initial frame.
   * Measured water and finite lakes never receive this approximation. */
  oceanContinuation?: {
    shoreline: ScenePoint[];
    /** Unit vector pointing from land into the sea. */
    waterDirection: ScenePoint;
    otherWater: ScenePoint[][];
  };
  /** Polygon grouping, including holes, when supplied by the physical planner. */
  polygons?: ScenePoint[][][];
  /** Even-odd rings in output coords; holes = islands. Empty = landlocked. */
  rings: ScenePoint[][];
  /** True when synthesized from oceanBearing rather than caller geometry. */
  synthetic: boolean;
}

export interface FieldPlot {
  /** Native biome field tile; pattern pitch stays independent of parcel size. */
  glyph?: string;
  ring: ScenePoint[];
  /** Furrow-hatch direction in degrees, from the plot's OBB. */
  angleDeg: number;
  /** false → plot ground draws but furrow hatch is suppressed (windmill plot). */
  hatch?: boolean;
}
/** @deprecated Always empty since settlemaker 0.8.0 — fields carry angleDeg instead of furrow segments. */
export interface Furrow { start: ScenePoint; end: ScenePoint }
export interface GreenFeature {
  purpose?: 'public' | 'private' | 'natural' | 'civic';
  /** A civic square occupies open ground but is paved rather than grassed. */
  surface?: 'paved';
  ring: ScenePoint[];
  paths?: ScenePoint[][];
  pathWidth?: number;
}

export interface VegetationInstance {
  at: ScenePoint;
  /** Glyph id (refined canopy) or legacy unit-box kind ('tree'). */
  kind: string;
  scale: number;       // world-unit size of the whole glyph box
  rotationDeg: number;
}
export interface SymbolInstance {
  materialVariant?: number;
  /** Seeded default housing appearance; custom skins retain their own artwork. */
  artworkVariant?: number;
  id: string;          // glyph id, e.g. 'sm-well'
  at: ScenePoint;
  scale: number;       // world-unit art-box width; height defaults to the same
  scaleY?: number;
  buildingId?: string;
  /** Actual compound wing identities, including the primary buildingId. */
  buildingIds?: string[];
  rotationDeg: number;
  zBand: 'structure' | 'overlay';
}

export interface RoadFeature {
  /** Surface widths at joined endpoints; interior retains width. */
  taper?: [number, number];
  /** Short paved frontage connection, rendered without a road casing. */
  access?: boolean;
  /** Optional generated street identity, distinct from supplied external route IDs. */
  id?: string;
  /** Semantic hierarchy; width remains the reserved physical corridor. */
  role?: 'trunk' | 'approach' | 'street' | 'service';
  routeIds?: string[];
  path: ScenePoint[];
  /** artery = trunk; road = external approach; alley = local street or block service lane. */
  kind: 'artery' | 'road' | 'alley';
  /** Full reserved street surface, in local mesh units. */
  width?: number;
}

export interface BuildingFeature {
  /** Same deterministic identity as GeoJSON building_id. */
  id?: string;
  ring: ScenePoint[];
  /** Ward type string (WardType value) — semantic, drives styling/symbols. */
  kind: string;
  landmark: boolean;
  glyphBacked?: true;
}

export interface PierFeature { ring: ScenePoint[]; harbourId?: string }

/** Built infrastructure over an unchanged natural coast. Basin and approach
 * reserve navigable water; quays/breakwaters/berths are solid footprints. */
export interface HarbourFeature {
  id: string;
  kind: 'protected' | 'natural' | 'river' | 'lake' | 'landing';
  basin: ScenePoint[];
  entrance: [ScenePoint, ScenePoint];
  approach: ScenePoint[];
  quays: Array<{ ring: ScenePoint[]; edge: ScenePoint[] }>;
  breakwaters: Array<{ ring: ScenePoint[]; path: ScenePoint[]; width: number }>;
  berths: Array<{ ring: ScenePoint[] }>;
  access: ScenePoint[][];
  fixtures: Array<{ kind: 'bollard' | 'crane' | 'boat' | 'beacon'; at: ScenePoint; angle: number }>;
  navigationWidth: number;
}

export interface WallGate {
  /** Endpoints of the gate bar, precomputed from wall direction. */
  p1: ScenePoint;
  p2: ScenePoint;
  routeIds: string[];
}

export interface WallFeature {
  material?: 'curtain' | 'rubble' | 'palisade';
  polylines: ScenePoint[][];
  towers: ScenePoint[];
  gates: WallGate[];
  /** Citadel walls render heavier towers. */
  large: boolean;
}

export interface Scene {
  buildingCapacity?: BuildingCapacity;
  version: typeof SCENE_VERSION;
  name?: string;
  seed: number;
  population: number;
  biome?: string;
  /** City scale estimate for glyph minimum sizes, not a surveyed measurement. */
  metersPerUnit?: number;
  bounds: LocalBounds;
  layers: {
    water: WaterLayer;
    fields: FieldPlot[];
    /** @deprecated Always empty since settlemaker 0.8.0 — fields carry angleDeg instead. */
    furrows: Furrow[];
    greens: GreenFeature[];
    /** Underlying dense urban surface. Gardens, roads and buildings overlay it. */
    ground?: Array<{ring:ScenePoint[];surface:'paved'}>;
    vegetation: VegetationInstance[];
    symbols: SymbolInstance[];
    roads: RoadFeature[];
    buildings: BuildingFeature[];
    piers: PierFeature[];
    harbours?: HarbourFeature[];
    walls: WallFeature[];
    /** Bank-to-bank crossings; absent on older version-2 scenes. */
    bridges?: Array<{id:string;path:ScenePoint[];width:number}>;
  };
}
