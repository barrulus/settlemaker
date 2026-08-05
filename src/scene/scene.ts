import type { LocalBounds } from '../generator/bounds.js';

/**
 * Versioned semantic scene: WHAT is where, never how it looks. This is the
 * spec's long-term integration contract — a future AFMG-side assembler
 * consumes this same shape. Additive evolution only; bump SCENE_VERSION on
 * breaking change.
 */
export const SCENE_VERSION = 1 as const;

export interface ScenePoint { x: number; y: number }

export interface WaterLayer {
  /** Even-odd rings in output coords; holes = islands. Empty = landlocked. */
  rings: ScenePoint[][];
  /** True when synthesized from oceanBearing rather than caller geometry. */
  synthetic: boolean;
}

export interface FieldPlot {
  ring: ScenePoint[];
  /** Furrow-hatch direction in degrees, from the plot's OBB. */
  angleDeg: number;
}
/** @deprecated Always empty since settlemaker 0.8.0 — fields carry angleDeg instead of furrow segments. */
export interface Furrow { start: ScenePoint; end: ScenePoint }
export interface GreenFeature { ring: ScenePoint[] }

export interface VegetationInstance {
  at: ScenePoint;
  kind: 'tree';
  /** Uniform scale in local units (symbol is authored in a unit box). */
  scale: number;
  rotationDeg: number;
}

export interface RoadFeature {
  path: ScenePoint[];
  /** artery = through-town trunk; road = external approach stub. */
  kind: 'artery' | 'road';
}

export interface BuildingFeature {
  ring: ScenePoint[];
  /** Ward type string (WardType value) — semantic, drives styling/symbols. */
  kind: string;
  landmark: boolean;
}

export interface PierFeature { ring: ScenePoint[] }

export interface WallGate {
  /** Endpoints of the gate bar, precomputed from wall direction. */
  p1: ScenePoint;
  p2: ScenePoint;
  routeIds: string[];
}

export interface WallFeature {
  polylines: ScenePoint[][];
  towers: ScenePoint[];
  gates: WallGate[];
  /** Citadel walls render heavier towers. */
  large: boolean;
}

export interface Scene {
  version: typeof SCENE_VERSION;
  name?: string;
  seed: number;
  population: number;
  biome?: string;
  bounds: LocalBounds;
  layers: {
    water: WaterLayer;
    fields: FieldPlot[];
    /** @deprecated Always empty since settlemaker 0.8.0 — fields carry angleDeg instead. */
    furrows: Furrow[];
    greens: GreenFeature[];
    vegetation: VegetationInstance[];
    roads: RoadFeature[];
    buildings: BuildingFeature[];
    piers: PierFeature[];
    walls: WallFeature[];
  };
}
