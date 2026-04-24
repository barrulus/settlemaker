import { Point } from '../types/point.js';
import { Polygon } from '../geom/polygon.js';
import { SeededRandom } from '../utils/random.js';
import { Patch } from './patch.js';
import { maxBy } from '../utils/array-utils.js';
import type { Model } from './model.js';
import type { RoadEntry, RouteKind } from './generation-params.js';

/**
 * A single route assigned to a gate. Multiple routes can share a gate when
 * their bearings cluster together or when the wall has too few entrance
 * candidates to give each route its own vertex.
 */
export interface GateRouteAssignment {
  /** Route id echoed from the caller's input bearing, if provided. */
  routeId?: string;
  /** Route kind (road / foot / sea). Defaults to 'road' at the output layer. */
  kind?: RouteKind;
  /** The caller's requested compass bearing (degrees, 0=N clockwise). */
  requestedBearingDeg: number;
  /** Absolute angular delta between requested bearing and placed gate bearing. */
  matchDeltaDeg: number;
}

/**
 * Per-gate metadata recorded during wall construction so the output layer can
 * echo back the matched route and tag each gate with its wall-vertex index.
 */
export interface GateMeta {
  /** Index of the gate vertex in `wall.shape.vertices`. Stable within a generation. */
  wallVertexIndex: number;
  /** Compass bearing from origin to gate (degrees, 0=N clockwise). */
  bearingDeg: number;
  /**
   * Routes attached to this gate, ordered by match quality (best first). Empty
   * for gates placed without a caller-provided bearing (random fill).
   */
  routes: GateRouteAssignment[];
  /**
   * Primary (best-matched) route id — mirrors `routes[0]?.routeId` for
   * consumers that care about a single match.
   */
  routeId?: string;
  /** Primary route kind — mirrors `routes[0]?.kind`. */
  kind?: RouteKind;
  /** Primary route delta — mirrors `routes[0]?.matchDeltaDeg`. */
  matchDeltaDeg?: number;
}

/**
 * Angular window (degrees) within which a second route is considered close
 * enough to the first that they should share the same gate instead of getting
 * their own entrances on the wall. Picked empirically: two roads entering
 * within ~20° of each other read as "the same approach direction" visually.
 */
const GATE_CLUSTER_DEG = 20;

export class CurtainWall {
  shape: Polygon;
  segments: boolean[];
  gates: Point[];
  towers: Point[];
  /** Metadata per gate keyed by the gate Point (identity). */
  gateMeta: Map<Point, GateMeta> = new Map();

  private real: boolean;
  private patches: Patch[];

  constructor(real: boolean, model: Model, patches: Patch[], reserved: Point[], rng: SeededRandom, roadEntryPoints?: RoadEntry[]) {
    this.real = real;
    this.patches = patches;
    this.gates = [];
    this.towers = [];

    if (patches.length === 1) {
      this.shape = patches[0].shape;
    } else {
      this.shape = model.findCircumference(patches);

      if (real) {
        const smoothFactor = Math.min(1, 40 / patches.length);
        const smoothed = this.shape.vertices.map(v =>
          reserved.includes(v) ? v : this.shape.smoothVertex(v, smoothFactor),
        );
        this.shape.setPositions(new Polygon(smoothed));
      }
    }

    this.segments = this.shape.vertices.map(() => true);
    this.buildGates(real, model, reserved, rng, roadEntryPoints);
  }

  private buildGates(real: boolean, model: Model, reserved: Point[], rng: SeededRandom, roadEntryPoints?: RoadEntry[]): void {
    this.gates = [];
    this.gateMeta = new Map();

    // Entrances are wall vertices shared by more than one inner patch
    let entrances: Point[];
    if (this.patches.length > 1) {
      entrances = this.shape.filter(v =>
        !reserved.includes(v) &&
        this.patches.filter(p => p.shape.contains(v)).length > 1,
      );
    } else {
      entrances = this.shape.filter(v => !reserved.includes(v));
    }

    if (entrances.length === 0) {
      throw new Error('Bad walled area shape!');
    }

    // Small walls can't afford the "consume 3 adjacent entrances per gate"
    // spacing rule — the pool drains before all routes get placed. On walls
    // with few entrance candidates, shrink the exclusion window to 1 (just
    // the chosen vertex) so more gates can coexist.
    const spacingWindow = entrances.length <= 6 ? 1 : 3;

    // Accumulate routes per gate so a cluster of close-bearing routes all
    // attach to the same entrance feature instead of one stealing the gate.
    const pendingRoutes = new Map<Point, Array<{ entry: RoadEntry; deltaRad: number }>>();

    const attachRoute = (gate: Point, entry: RoadEntry, deltaRad: number) => {
      const existing = pendingRoutes.get(gate) ?? [];
      existing.push({ entry, deltaRad });
      pendingRoutes.set(gate, existing);
    };

    const selectGate = (gate: Point, index: number) => {
      this.gates.push(gate);

      if (real) {
        const outerWards = model.patchByVertex(gate).filter(w => !this.patches.includes(w));
        if (outerWards.length === 1) {
          const outer = outerWards[0];
          if (outer.shape.length > 3) {
            const wallDir = this.shape.next(gate).subtract(this.shape.prev(gate));
            const out = new Point(wallDir.y, -wallDir.x);

            const farthest = maxBy(outer.shape.vertices, (v: Point) => {
              if (this.shape.contains(v) || reserved.includes(v)) {
                return -Infinity;
              }
              const dir = v.subtract(gate);
              return dir.dot(out) / dir.length;
            });

            const halves = outer.shape.split(gate, farthest);
            const newPatches = halves.map(half => new Patch(half.vertices));
            // Replace outer in model.patches
            const idx = model.patches.indexOf(outer);
            if (idx !== -1) {
              model.patches[idx] = newPatches[0];
              for (let i = 1; i < newPatches.length; i++) {
                model.patches.splice(idx + i, 0, newPatches[i]);
              }
            }
          }
        }
      }

      if (spacingWindow === 1) {
        // Small wall: reserve only the chosen vertex so the remaining routes
        // still have somewhere to land.
        entrances.splice(index, 1);
      } else if (index === 0) {
        entrances.splice(0, 2);
        entrances.pop();
      } else if (index === entrances.length - 1) {
        entrances.splice(index - 1, 2);
        entrances.shift();
      } else {
        entrances.splice(index - 1, 3);
      }
    };

    const hasBearings = roadEntryPoints && roadEntryPoints.length > 0;
    if (hasBearings) {
      const entries = roadEntryPoints
        .map(entry => ({
          entry,
          angle: Math.atan2(entry.point.y, entry.point.x),
        }))
        .sort((a, b) => a.angle - b.angle);

      const clusterRad = GATE_CLUSTER_DEG * Math.PI / 180;

      for (const { entry, angle: targetAngle } of entries) {
        // 1. If a gate is already placed within the angular cluster window,
        //    attach this route to that gate instead of consuming a new vertex.
        let reuseGate: Point | null = null;
        let reuseDelta = Infinity;
        for (const placed of this.gates) {
          const pAngle = Math.atan2(placed.y, placed.x);
          let diff = Math.abs(pAngle - targetAngle);
          if (diff > Math.PI) diff = 2 * Math.PI - diff;
          if (diff < reuseDelta && diff <= clusterRad) {
            reuseDelta = diff;
            reuseGate = placed;
          }
        }
        if (reuseGate !== null) {
          attachRoute(reuseGate, entry, reuseDelta);
          continue;
        }

        // 2. No suitable existing gate — pick the closest remaining entrance.
        //    If the pool is exhausted, fall back to sharing the angularly
        //    nearest existing gate so every caller-supplied route is echoed.
        if (entrances.length === 0) {
          let fallbackGate: Point | null = null;
          let fallbackDelta = Infinity;
          for (const placed of this.gates) {
            const pAngle = Math.atan2(placed.y, placed.x);
            let diff = Math.abs(pAngle - targetAngle);
            if (diff > Math.PI) diff = 2 * Math.PI - diff;
            if (diff < fallbackDelta) {
              fallbackDelta = diff;
              fallbackGate = placed;
            }
          }
          if (fallbackGate !== null) attachRoute(fallbackGate, entry, fallbackDelta);
          continue;
        }

        let bestIdx = 0;
        let bestDist = Infinity;
        for (let i = 0; i < entrances.length; i++) {
          const v = entrances[i];
          const vAngle = Math.atan2(v.y, v.x);
          let diff = Math.abs(vAngle - targetAngle);
          if (diff > Math.PI) diff = 2 * Math.PI - diff;
          if (diff < bestDist) {
            bestDist = diff;
            bestIdx = i;
          }
        }

        const gate = entrances[bestIdx];
        selectGate(gate, bestIdx);
        attachRoute(gate, entry, bestDist);
      }
    }

    // Ensure at least one gate (preserves original do...while semantics)
    if (this.gates.length === 0 && entrances.length > 0) {
      const index = rng.int(0, entrances.length);
      selectGate(entrances[index], index);
    }

    // Fill remaining gates randomly (skip when bearings already placed gates)
    if (!hasBearings) {
      while (entrances.length >= 3) {
        const index = rng.int(0, entrances.length);
        selectGate(entrances[index], index);
      }
    }

    if (this.gates.length === 0) {
      throw new Error('Bad walled area shape!');
    }

    // Smooth wall sections around gates
    if (real) {
      for (const gate of this.gates) {
        gate.set(this.shape.smoothVertex(gate));
      }
    }

    this.recordGateMeta(pendingRoutes);
  }

  /** Build the `gateMeta` map after smoothing finalises gate positions. */
  private recordGateMeta(pendingRoutes: Map<Point, Array<{ entry: RoadEntry; deltaRad: number }>>): void {
    for (const gate of this.gates) {
      const vertexIndex = this.shape.vertices.indexOf(gate);
      const bearingDeg = normaliseBearing(Math.atan2(gate.x, -gate.y) * 180 / Math.PI);
      const matches = pendingRoutes.get(gate) ?? [];
      const routes: GateRouteAssignment[] = matches
        .slice()
        .sort((a, b) => a.deltaRad - b.deltaRad)
        .map(m => {
          const assignment: GateRouteAssignment = {
            requestedBearingDeg: m.entry.bearingDeg,
            matchDeltaDeg: Math.round(m.deltaRad * 180 / Math.PI * 10) / 10,
          };
          if (m.entry.routeId != null) assignment.routeId = m.entry.routeId;
          if (m.entry.kind != null) assignment.kind = m.entry.kind;
          return assignment;
        });

      const meta: GateMeta = { wallVertexIndex: vertexIndex, bearingDeg, routes };
      const primary = routes[0];
      if (primary !== undefined) {
        if (primary.routeId != null) meta.routeId = primary.routeId;
        if (primary.kind != null) meta.kind = primary.kind;
        meta.matchDeltaDeg = primary.matchDeltaDeg;
      }
      this.gateMeta.set(gate, meta);
    }
  }

  /** Mark wall segments adjacent to water patches as inactive (no wall on waterfront). */
  markWaterfrontSegments(waterPatches: Patch[]): void {
    const len = this.shape.length;
    for (let i = 0; i < len; i++) {
      const v0 = this.shape.vertices[i];
      const v1 = this.shape.vertices[(i + 1) % len];
      // The outer patch shares the reverse edge (v1→v0) with this wall segment
      for (const wp of waterPatches) {
        if (wp.shape.findEdge(v1, v0) !== -1) {
          this.segments[i] = false;
          break;
        }
      }
    }
  }

  buildTowers(): void {
    this.towers = [];
    if (this.real) {
      const len = this.shape.length;
      for (let i = 0; i < len; i++) {
        const t = this.shape.vertices[i];
        if (!this.gates.includes(t) &&
            (this.segments[(i + len - 1) % len] || this.segments[i])) {
          this.towers.push(t);
        }
      }
    }
  }

  getRadius(): number {
    let radius = 0;
    for (const v of this.shape.vertices) {
      radius = Math.max(radius, v.length);
    }
    return radius;
  }

  bordersBy(p: Patch, v0: Point, v1: Point): boolean {
    const index = this.patches.includes(p)
      ? this.shape.findEdge(v0, v1)
      : this.shape.findEdge(v1, v0);
    return index !== -1 && this.segments[index];
  }

  /** Recompute metadata for an existing gate (e.g. after water filtering) using stored route matches. */
  refreshGateMeta(gate: Point, override?: Partial<GateMeta>): void {
    const existing = this.gateMeta.get(gate);
    if (existing === undefined) return;
    const vertexIndex = this.shape.vertices.indexOf(gate);
    const bearingDeg = normaliseBearing(Math.atan2(gate.x, -gate.y) * 180 / Math.PI);
    this.gateMeta.set(gate, {
      ...existing,
      wallVertexIndex: vertexIndex,
      bearingDeg,
      routes: existing.routes,
      ...override,
    });
  }

  borders(p: Patch): boolean {
    const withinWalls = this.patches.includes(p);
    const length = this.shape.length;
    for (let i = 0; i < length; i++) {
      if (this.segments[i]) {
        const v0 = this.shape.vertices[i];
        const v1 = this.shape.vertices[(i + 1) % length];
        const index = withinWalls
          ? p.shape.findEdge(v0, v1)
          : p.shape.findEdge(v1, v0);
        if (index !== -1) return true;
      }
    }
    return false;
  }
}

/** Normalise a compass bearing to the half-open range [0, 360). */
function normaliseBearing(deg: number): number {
  const mod = ((deg % 360) + 360) % 360;
  return Math.round(mod * 10) / 10;
}
