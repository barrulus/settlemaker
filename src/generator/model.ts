import { Point } from '../types/point.js';
import { Polygon } from '../geom/polygon.js';
import { Segment } from '../geom/segment.js';
import { Voronoi } from '../geom/voronoi.js';
import { SeededRandom } from '../utils/random.js';
import { sign } from '../utils/math-utils.js';
import { minBy, randomElement, last } from '../utils/array-utils.js';

import { Patch } from './patch.js';
import { CurtainWall } from './curtain-wall.js';
import { Topology } from './topology.js';
import type { GenerationParams } from './generation-params.js';
import type { Street } from '../types/interfaces.js';

import { Ward } from '../wards/ward.js';
import { GateWard } from '../wards/gate-ward.js';
import { Market } from '../wards/market.js';
import { Castle } from '../wards/castle.js';
import { Farm } from '../wards/farm.js';
import { Slum } from '../wards/slum.js';
import { buildWardDistribution, type WardConstructor } from '../wards/ward-distribution.js';

const MAX_ATTEMPTS = 20;

export class Model {
  rng: SeededRandom;

  private nPatches: number;
  private plazaNeeded: boolean;
  private citadelNeeded: boolean;
  private wallsNeeded: boolean;
  private params: GenerationParams;

  topology: Topology | null = null;
  patches: Patch[] = [];
  waterbody: Patch[] = [];
  inner: Patch[] = [];
  citadel: Patch | null = null;
  plaza: Patch | null = null;
  center: Point = new Point();

  border: CurtainWall | null = null;
  wall: CurtainWall | null = null;

  cityRadius: number = 0;
  gates: Point[] = [];

  arteries: Street[] = [];
  streets: Street[] = [];
  roads: Street[] = [];

  constructor(params: GenerationParams) {
    this.params = params;
    this.rng = new SeededRandom(params.seed);
    this.nPatches = params.nPatches;
    this.plazaNeeded = params.plazaNeeded;
    this.citadelNeeded = params.citadelNeeded;
    this.wallsNeeded = params.wallsNeeded;
  }

  /** Run the full 6-phase generation pipeline. Retries on failure up to MAX_ATTEMPTS. */
  generate(): Model {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        this.build();
        return this;
      } catch (e) {
        // Reset state and retry
        this.patches = [];
        this.inner = [];
        this.citadel = null;
        this.plaza = null;
        this.border = null;
        this.wall = null;
        this.gates = [];
        this.streets = [];
        this.roads = [];
        this.arteries = [];
        this.topology = null;
      }
    }
    throw new Error(`Failed to generate after ${MAX_ATTEMPTS} attempts`);
  }

  private build(): void {
    this.streets = [];
    this.roads = [];

    this.buildPatches();
    this.optimizeJunctions();
    this.buildWalls();
    this.buildStreets();
    this.createWards();
    this.buildGeometry();
  }

  // Phase 1: Build Voronoi patches
  private buildPatches(): void {
    const rng = this.rng;
    const sa = rng.float() * 2 * Math.PI;
    const points: Point[] = [];
    for (let i = 0; i < this.nPatches * 8; i++) {
      const a = sa + Math.sqrt(i) * 5;
      const r = i === 0 ? 0 : 10 + i * (2 + rng.float());
      points.push(new Point(Math.cos(a) * r, Math.sin(a) * r));
    }

    let voronoi = Voronoi.build(points);

    // Relax central wards
    for (let i = 0; i < 3; i++) {
      const toRelax: Point[] = [];
      for (let j = 0; j < 3 && j < voronoi.points.length; j++) {
        toRelax.push(voronoi.points[j]);
      }
      if (this.nPatches < voronoi.points.length) {
        toRelax.push(voronoi.points[this.nPatches]);
      }
      voronoi = Voronoi.relax(voronoi, toRelax);
    }

    voronoi.points.sort((p1, p2) => sign(p1.length - p2.length));
    const regions = voronoi.partitioning();

    this.patches = [];
    this.inner = [];

    let count = 0;
    for (const r of regions) {
      const patch = Patch.fromRegion(r);
      this.patches.push(patch);

      if (count === 0) {
        // Find vertex closest to origin for center
        this.center = minBy(patch.shape.vertices, (p: Point) => p.length);
        if (this.plazaNeeded) {
          this.plaza = patch;
        }
      } else if (count === this.nPatches && this.citadelNeeded) {
        this.citadel = patch;
        this.citadel.withinCity = true;
      }

      if (count < this.nPatches) {
        patch.withinCity = true;
        patch.withinWalls = this.wallsNeeded;
        this.inner.push(patch);
      }

      count++;
    }
  }

  // Phase 2: Merge close junctions
  private optimizeJunctions(): void {
    const patchesToOptimize = this.citadel === null
      ? this.inner
      : this.inner.concat([this.citadel]);

    const wards2clean: Patch[] = [];
    for (const w of patchesToOptimize) {
      let index = 0;
      while (index < w.shape.length) {
        const v0 = w.shape.vertices[index];
        const v1 = w.shape.vertices[(index + 1) % w.shape.length];

        if (v0 !== v1 && Point.distance(v0, v1) < 8) {
          for (const w1 of this.patchByVertex(v1)) {
            if (w1 !== w) {
              const vIdx = w1.shape.indexOf(v1);
              if (vIdx !== -1) w1.shape.vertices[vIdx] = v0;
              wards2clean.push(w1);
            }
          }

          v0.addEq(v1);
          v0.scaleEq(0.5);

          const rmIdx = w.shape.indexOf(v1);
          if (rmIdx !== -1) w.shape.vertices.splice(rmIdx, 1);
        }
        index++;
      }
    }

    // Remove duplicate vertices
    for (const w of wards2clean) {
      for (let i = 0; i < w.shape.length; i++) {
        const v = w.shape.vertices[i];
        let dupIdx: number;
        while ((dupIdx = w.shape.indexOf(v, i + 1)) !== -1) {
          w.shape.vertices.splice(dupIdx, 1);
        }
      }
    }
  }

  // Phase 3: Build walls
  private buildWalls(): void {
    const reserved = this.citadel !== null ? this.citadel.shape.copy() : [];

    this.border = new CurtainWall(this.wallsNeeded, this, this.inner, reserved, this.rng);
    if (this.wallsNeeded) {
      this.wall = this.border;
      this.wall.buildTowers();
    }

    const radius = this.border.getRadius();
    this.patches = this.patches.filter(p =>
      p.shape.distance(this.center) < radius * 3,
    );

    this.gates = this.border.gates.slice();

    if (this.citadel !== null) {
      const castle = new Castle(this, this.citadel);
      castle.wall.buildTowers();
      this.citadel.ward = castle;

      if (this.citadel.shape.compactness < 0.75) {
        throw new Error('Bad citadel shape!');
      }

      this.gates = this.gates.concat(castle.wall.gates);
    }
  }

  // Phase 4: Build streets
  private buildStreets(): void {
    const smoothStreet = (street: Polygon) => {
      const smoothed = street.smoothVertexEq(3);
      for (let i = 1; i < street.length - 1; i++) {
        street.vertices[i].set(smoothed.vertices[i]);
      }
    };

    this.topology = new Topology(this);

    for (const gate of this.gates) {
      const end = this.plaza !== null
        ? minBy(this.plaza.shape.vertices, v => Point.distance(v, gate))
        : this.center;

      const street = this.topology.buildPath(gate, end, this.topology.outer);
      if (street !== null) {
        this.streets.push(new Polygon(street));

        if (this.border!.gates.includes(gate)) {
          const dir = gate.norm(1000);
          let start: Point | null = null;
          let dist = Infinity;
          for (const [, pt] of this.topology.node2pt) {
            const d = Point.distance(pt, dir);
            if (d < dist) {
              dist = d;
              start = pt;
            }
          }

          if (start) {
            const road = this.topology.buildPath(start, gate, this.topology.inner);
            if (road !== null) {
              this.roads.push(new Polygon(road));
            }
          }
        }
      } else {
        throw new Error('Unable to build a street!');
      }
    }

    this.tidyUpRoads();

    for (const a of this.arteries) {
      smoothStreet(a);
    }
  }

  private tidyUpRoads(): void {
    const segments: Segment[] = [];

    const cut2segments = (street: Polygon) => {
      let v0: Point | null = null;
      let v1 = street.vertices[0];
      for (let i = 1; i < street.length; i++) {
        v0 = v1;
        v1 = street.vertices[i];

        // Skip segments along the plaza
        if (this.plaza !== null &&
            this.plaza.shape.contains(v0) &&
            this.plaza.shape.contains(v1)) {
          continue;
        }

        let exists = false;
        for (const seg of segments) {
          if (seg.start === v0 && seg.end === v1) {
            exists = true;
            break;
          }
        }

        if (!exists) {
          segments.push(new Segment(v0, v1));
        }
      }
    };

    for (const street of this.streets) cut2segments(street);
    for (const road of this.roads) cut2segments(road);

    this.arteries = [];
    while (segments.length > 0) {
      const seg = segments.pop()!;

      let attached = false;
      for (const a of this.arteries) {
        if (a.vertices[0] === seg.end) {
          a.vertices.unshift(seg.start);
          attached = true;
          break;
        } else if (last(a.vertices) === seg.start) {
          a.vertices.push(seg.end);
          attached = true;
          break;
        }
      }

      if (!attached) {
        this.arteries.push(new Polygon([seg.start, seg.end]));
      }
    }
  }

  // Phase 5: Create wards
  private createWards(): void {
    const rng = this.rng;
    const unassigned = this.inner.slice();

    if (this.plaza !== null) {
      this.plaza.ward = new Market(this, this.plaza);
      const idx = unassigned.indexOf(this.plaza);
      if (idx !== -1) unassigned.splice(idx, 1);
    }

    // Assign inner city gate wards
    for (const gate of this.border!.gates) {
      for (const patch of this.patchByVertex(gate)) {
        if (patch.withinCity && patch.ward === null &&
            rng.bool(this.wall === null ? 0.2 : 0.5)) {
          patch.ward = new GateWard(this, patch);
          const idx = unassigned.indexOf(patch);
          if (idx !== -1) unassigned.splice(idx, 1);
        }
      }
    }

    // Build ward distribution
    const wards = buildWardDistribution(this.params);
    // Shuffle ~10% of elements
    for (let i = 0; i < Math.floor(wards.length / 10); i++) {
      const index = rng.int(0, wards.length - 1);
      const tmp = wards[index];
      wards[index] = wards[index + 1];
      wards[index + 1] = tmp;
    }

    // Assign inner city wards
    while (unassigned.length > 0) {
      const wardClass: WardConstructor = wards.length > 0 ? wards.shift()! : Slum;

      // Check if the ward class has a custom rateLocation
      const rateFunc = (wardClass as typeof Ward).rateLocation;

      let bestPatch: Patch;
      if (rateFunc === Ward.rateLocation) {
        // No custom rating — pick random unassigned
        do {
          bestPatch = randomElement(unassigned, rng);
        } while (bestPatch.ward !== null && unassigned.some(p => p.ward === null));
      } else {
        bestPatch = minBy(unassigned, (patch: Patch) =>
          patch.ward === null ? rateFunc(this, patch) : Infinity,
        );
      }

      bestPatch.ward = new wardClass(this, bestPatch);
      const idx = unassigned.indexOf(bestPatch);
      if (idx !== -1) unassigned.splice(idx, 1);
    }

    // Outskirts
    if (this.wall !== null) {
      for (const gate of this.wall.gates) {
        if (!rng.bool(1 / (this.nPatches - 5))) {
          for (const patch of this.patchByVertex(gate)) {
            if (patch.ward === null) {
              patch.withinCity = true;
              patch.ward = new GateWard(this, patch);
            }
          }
        }
      }
    }

    // Calculate city radius and process countryside
    this.cityRadius = 0;
    for (const patch of this.patches) {
      if (patch.withinCity) {
        for (const v of patch.shape.vertices) {
          this.cityRadius = Math.max(this.cityRadius, v.length);
        }
      } else if (patch.ward === null) {
        patch.ward = (rng.bool(0.2) && patch.shape.compactness >= 0.7)
          ? new Farm(this, patch)
          : new Ward(this, patch);
      }
    }
  }

  // Phase 6: Build geometry
  private buildGeometry(): void {
    for (const patch of this.patches) {
      if (patch.ward) {
        patch.ward.createGeometry();
      }
    }
  }

  // Public helpers
  findCircumference(patches: Patch[]): Polygon {
    if (patches.length === 0) return new Polygon();
    if (patches.length === 1) return new Polygon(patches[0].shape.vertices);

    const A: Point[] = [];
    const B: Point[] = [];

    for (const w1 of patches) {
      w1.shape.forEdge((a, b) => {
        let outerEdge = true;
        for (const w2 of patches) {
          if (w2.shape.findEdge(b, a) !== -1) {
            outerEdge = false;
            break;
          }
        }
        if (outerEdge) {
          A.push(a);
          B.push(b);
        }
      });
    }

    const result = new Polygon();
    let index = 0;
    do {
      result.push(A[index]);
      index = A.indexOf(B[index]);
    } while (index !== 0);

    return result;
  }

  patchByVertex(v: Point): Patch[] {
    return this.patches.filter(patch => patch.shape.contains(v));
  }

  getNeighbour(patch: Patch, v: Point): Patch | null {
    const next = patch.shape.next(v);
    for (const p of this.patches) {
      if (p.shape.findEdge(next, v) !== -1) return p;
    }
    return null;
  }

  getNeighbours(patch: Patch): Patch[] {
    return this.patches.filter(p => p !== patch && p.shape.borders(patch.shape));
  }

  isEnclosed(patch: Patch): boolean {
    return patch.withinCity && (
      patch.withinWalls ||
      this.getNeighbours(patch).every(p => p.withinCity)
    );
  }
}
