import { Point } from '../types/point.js';
import { WardType } from '../types/interfaces.js';
import type { Model } from '../generator/model.js';
import type { CurtainWall } from '../generator/curtain-wall.js';
import { computeLocalBounds } from '../generator/bounds.js';
import { applyOutputShift, NO_SHIFT, type OriginShift } from '../generator/origin-shift.js';
import { Farm } from '../wards/farm.js';
import { Harbour } from '../wards/harbour.js';
import { Castle } from '../wards/castle.js';
import {
  SCENE_VERSION,
  type Scene, type ScenePoint, type RoadFeature, type BuildingFeature,
  type WallFeature, type WallGate,
} from './scene.js';

const LANDMARK_TYPES = new Set<WardType>([WardType.Castle, WardType.Cathedral, WardType.Market]);
const GATE_BAR_HALF = 2.7; // THICK_STROKE(1.8) * 1.5 — matches prior renderGate geometry

export interface BuildSceneOptions {
  shift?: OriginShift;
  padding?: number;
}

/** Pure extraction: Model → semantic Scene in OUTPUT coordinates. */
export function buildScene(model: Model, options: BuildSceneOptions = {}): Scene {
  const shift = options.shift ?? NO_SHIFT;
  const padding = options.padding ?? 20;
  const sc = (p: { x: number; y: number }): ScenePoint => {
    const [x, y] = applyOutputShift(p.x, p.y, shift);
    return { x, y };
  };
  const ring = (pts: ReadonlyArray<{ x: number; y: number }>): ScenePoint[] => pts.map(sc);

  const scene: Scene = {
    version: SCENE_VERSION,
    seed: model.params.seed,
    population: model.params.population,
    bounds: computeLocalBounds(model, padding, shift),
    layers: {
      water: {
        rings: model.getWaterRings().map(r => ring(r)),
        synthetic: model.syntheticCoast !== null,
      },
      fields: [], furrows: [], greens: [], vegetation: [],
      roads: [], buildings: [], piers: [], walls: [],
    },
  };

  for (const artery of model.arteries) {
    scene.layers.roads.push({ path: ring(artery.vertices), kind: 'artery' } as RoadFeature);
  }
  for (const road of model.roads) {
    scene.layers.roads.push({ path: ring(road.vertices), kind: 'road' } as RoadFeature);
  }

  for (const patch of model.patches) {
    const ward = patch.ward;
    if (!ward) continue;
    if (ward instanceof Farm) {
      for (const plot of ward.subPlots) {
        if (plot.length >= 3) scene.layers.fields.push({ ring: ring(plot) });
      }
      for (const f of ward.furrows) {
        scene.layers.furrows.push({ start: sc(f.start), end: sc(f.end) });
      }
      // Farm buildings still land in `buildings` via the geometry loop below.
    }
    if (ward.type === WardType.Park) {
      for (const grove of ward.geometry) {
        scene.layers.greens.push({ ring: ring(grove.vertices) });
      }
      continue; // groves are greens, not buildings
    }
    for (const poly of ward.geometry) {
      scene.layers.buildings.push({
        ring: ring(poly.vertices),
        kind: String(ward.type),
        landmark: LANDMARK_TYPES.has(ward.type),
      } as BuildingFeature);
    }
    if (ward instanceof Harbour) {
      for (const pier of ward.piers) {
        scene.layers.piers.push({ ring: ring(pier.vertices) });
      }
    }
  }

  if (model.wall !== null) {
    scene.layers.walls.push(wallFeature(model.wall, false, sc, model));
  }
  if (model.citadel !== null && model.citadel.ward instanceof Castle) {
    scene.layers.walls.push(wallFeature(model.citadel.ward.wall, true, sc, model));
  }

  return scene;
}

function wallFeature(
  wall: CurtainWall,
  large: boolean,
  sc: (p: { x: number; y: number }) => ScenePoint,
  model: Model,
): WallFeature {
  const gates: WallGate[] = wall.gates.map(gate => {
    const dir = wall.shape.next(gate).subtract(wall.shape.prev(gate));
    dir.normalize(GATE_BAR_HALF);
    const meta = model.border?.gateMeta.get(gate);
    return {
      p1: sc(gate.subtract(dir)),
      p2: sc(gate.add(dir)),
      routeIds: (meta?.routes ?? []).flatMap(r => (r.routeId != null ? [r.routeId] : [])),
    };
  });
  return {
    polylines: activeWallPolylines(wall).map(pl => pl.map(sc)),
    towers: wall.towers.map(sc),
    gates,
    large,
  };
}

/** Group consecutive active wall segments into polylines (moved from svg-builder). */
export function activeWallPolylines(wall: CurtainWall): Point[][] {
  const len = wall.shape.length;
  if (wall.segments.every(s => s)) {
    return [[...wall.shape.vertices, wall.shape.vertices[0]]];
  }
  const polylines: Point[][] = [];
  let current: Point[] | null = null;
  for (let i = 0; i < len; i++) {
    if (wall.segments[i]) {
      if (current === null) current = [wall.shape.vertices[i]];
      current.push(wall.shape.vertices[(i + 1) % len]);
    } else if (current !== null) {
      polylines.push(current);
      current = null;
    }
  }
  if (current !== null) {
    if (polylines.length > 0 && polylines[0][0] === current[current.length - 1]) {
      current.pop();
      polylines[0] = [...current, ...polylines[0]];
    } else {
      polylines.push(current);
    }
  }
  return polylines;
}
