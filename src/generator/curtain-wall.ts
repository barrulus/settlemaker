import { Point } from '../types/point.js';
import { Polygon } from '../geom/polygon.js';
import { SeededRandom } from '../utils/random.js';
import { Patch } from './patch.js';
import { maxBy } from '../utils/array-utils.js';
import type { Model } from './model.js';
import type { RoadEntry, RouteKind } from './generation-params.js';

/**
 * Per-gate metadata recorded during wall construction so the output layer can
 * echo back the matched route and tag each gate with its wall-vertex index.
 */
export interface GateMeta {
  /** Index of the gate vertex in `wall.shape.vertices`. Stable within a generation. */
  wallVertexIndex: number;
  /** Compass bearing from origin to gate (degrees, 0=N clockwise). */
  bearingDeg: number;
  /** Route id echoed from the matched input bearing, if any. */
  routeId?: string;
  /** Route kind echoed from the matched input bearing. Defaults to 'road'. */
  kind?: RouteKind;
  /** Absolute difference between the requested input bearing and placed gate bearing. */
  matchDeltaDeg?: number;
}

export class CurtainWall {
  shape: Polygon;
  segments: boolean[];
  gates: Point[];
  towers: Point[];
  /** Metadata per gate keyed by the gate Point (identity). */
  gateMeta: Map<Point, GateMeta> = new Map();

  private real: boolean;
  private patches: Patch[];

  constructor(real: boolean, model: Model, patches: Patch[], reserved: Point[], rng: SeededRandom, roadEntryPoints?: RoadEntry[], maxGates?: number) {
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
    this.buildGates(real, model, reserved, rng, roadEntryPoints, maxGates);
  }

  private buildGates(real: boolean, model: Model, reserved: Point[], rng: SeededRandom, roadEntryPoints?: RoadEntry[], maxGates?: number): void {
    this.gates = [];
    this.gateMeta = new Map();
    const cap = maxGates ?? Infinity;

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

    // Filled in the route-bearing loop so we can re-read after wall smoothing moves vertices.
    const pendingMatches = new Map<Point, { entry: RoadEntry; deltaRad: number }>();

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

      // Remove neighbouring entrances
      if (index === 0) {
        entrances.splice(0, 2);
        entrances.pop();
      } else if (index === entrances.length - 1) {
        entrances.splice(index - 1, 2);
        entrances.shift();
      } else {
        entrances.splice(index - 1, 3);
      }
    };

    // Place gates at bearings matching roadEntryPoints
    const hasBearings = roadEntryPoints && roadEntryPoints.length > 0;
    if (hasBearings) {
      const entries = roadEntryPoints
        .map((entry, i) => ({
          entry,
          angle: Math.atan2(entry.point.y, entry.point.x),
          index: i,
        }))
        .sort((a, b) => a.angle - b.angle);

      for (const { entry, angle: targetAngle } of entries) {
        if (entrances.length < 1 || this.gates.length >= cap) break;

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
        // Stash the input bearing/route so post-selection metadata can echo it back.
        pendingMatches.set(gate, { entry, deltaRad: bestDist });
      }
    }

    // Ensure at least one gate (preserves original do...while semantics)
    if (this.gates.length === 0 && entrances.length > 0) {
      const index = rng.int(0, entrances.length);
      selectGate(entrances[index], index);
    }

    // Fill remaining gates randomly (skip when bearings already placed gates)
    if (!hasBearings) {
      while (entrances.length >= 3 && this.gates.length < cap) {
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

    this.recordGateMeta(pendingMatches);
  }

  /** Build the `gateMeta` map after smoothing finalises gate positions. */
  private recordGateMeta(pendingMatches: Map<Point, { entry: RoadEntry; deltaRad: number }>): void {
    for (const gate of this.gates) {
      const vertexIndex = this.shape.vertices.indexOf(gate);
      const bearingDeg = normaliseBearing(Math.atan2(gate.x, -gate.y) * 180 / Math.PI);
      const match = pendingMatches.get(gate);
      const meta: GateMeta = { wallVertexIndex: vertexIndex, bearingDeg };
      if (match) {
        if (match.entry.routeId != null) meta.routeId = match.entry.routeId;
        if (match.entry.kind != null) meta.kind = match.entry.kind;
        meta.matchDeltaDeg = Math.round(match.deltaRad * 180 / Math.PI * 10) / 10;
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
    this.gateMeta.set(gate, { ...existing, wallVertexIndex: vertexIndex, bearingDeg, ...override });
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
