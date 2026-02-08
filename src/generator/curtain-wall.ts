import { Point } from '../types/point.js';
import { Polygon } from '../geom/polygon.js';
import { SeededRandom } from '../utils/random.js';
import { Patch } from './patch.js';
import { maxBy } from '../utils/array-utils.js';
import type { Model } from './model.js';

export class CurtainWall {
  shape: Polygon;
  segments: boolean[];
  gates: Point[];
  towers: Point[];

  private real: boolean;
  private patches: Patch[];

  constructor(real: boolean, model: Model, patches: Patch[], reserved: Point[], rng: SeededRandom) {
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
    this.buildGates(real, model, reserved, rng);
  }

  private buildGates(real: boolean, model: Model, reserved: Point[], rng: SeededRandom): void {
    this.gates = [];

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

    do {
      const index = rng.int(0, entrances.length);
      const gate = entrances[index];
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
    } while (entrances.length >= 3);

    if (this.gates.length === 0) {
      throw new Error('Bad walled area shape!');
    }

    // Smooth wall sections around gates
    if (real) {
      for (const gate of this.gates) {
        gate.set(this.shape.smoothVertex(gate));
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
