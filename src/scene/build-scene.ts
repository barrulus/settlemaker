import { Point } from '../types/point.js';
import { WardType } from '../types/interfaces.js';
import type { Model } from '../generator/model.js';
import type { CurtainWall } from '../generator/curtain-wall.js';
import { computeLocalBounds } from '../generator/bounds.js';
import { applyOutputShift, NO_SHIFT, type OriginShift } from '../generator/origin-shift.js';
import { Farm } from '../wards/farm.js';
import { Harbour } from '../wards/harbour.js';
import { Castle } from '../wards/castle.js';
import { SeededRandom } from '../utils/random.js';
import { pointInPolygon } from '../geom/point-in-polygon.js';
import { Polygon } from '../geom/polygon.js';
import { CANOPY_KINDS } from '../assets/asset-sets.js';
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
    ...(model.params.biome != null ? { biome: model.params.biome } : {}),
    bounds: computeLocalBounds(model, padding, shift),
    layers: {
      water: {
        rings: model.getWaterRings().map(r => ring(r)),
        synthetic: model.syntheticCoast !== null,
      },
      fields: [], furrows: [], greens: [], vegetation: [],
      symbols: model.symbols.map(s => ({
        id: s.id, at: sc(s.at), scale: s.scale, rotationDeg: s.rotationDeg, zBand: s.zBand,
      })),
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
      for (let i = 0; i < ward.subPlots.length; i++) {
        const plot = ward.subPlots[i];
        if (plot.length >= 3) {
          scene.layers.fields.push({ ring: ring(plot), angleDeg: ward.plotAngles[i] ?? 0 });
        }
      }
      // furrows layer stays empty — see Furrow deprecation note in scene.ts.
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

  scatterVegetation(model, scene, sc);

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

/**
 * Deterministic tree scatter in park groves. Uses its own SeededRandom
 * derived arithmetically from the model seed so the generation stream is
 * untouched: scenes can be rebuilt any number of times with identical
 * results and zero effect on layout.
 */
function scatterVegetation(
  model: Model,
  scene: Scene,
  sc: (p: { x: number; y: number }) => ScenePoint,
): void {
  const rng = new SeededRandom((model.params.seed ^ 0x5eed) >>> 0 || 1);
  for (const patch of model.patches) {
    const ward = patch.ward;
    if (!ward || ward.type !== WardType.Park) continue;
    for (const grove of ward.geometry) {
      const poly = new Polygon(grove.vertices);
      const area = Math.abs(poly.square);
      const n = Math.min(24, Math.floor(area / 12));
      if (n === 0) continue;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const v of grove.vertices) {
        if (v.x < minX) minX = v.x;
        if (v.y < minY) minY = v.y;
        if (v.x > maxX) maxX = v.x;
        if (v.y > maxY) maxY = v.y;
      }
      let placed = 0;
      for (let attempt = 0; attempt < n * 10 && placed < n; attempt++) {
        const p = new Point(minX + rng.float() * (maxX - minX), minY + rng.float() * (maxY - minY));
        if (!pointInPolygon(p, grove.vertices)) continue;
        scene.layers.vegetation.push({
          at: sc(p),
          kind: CANOPY_KINDS[Math.floor(rng.float() * CANOPY_KINDS.length)],
          scale: 1.6 + rng.float() * 1.2,
          rotationDeg: Math.round(rng.float() * 360),
        });
        placed++;
      }
    }
  }
}
