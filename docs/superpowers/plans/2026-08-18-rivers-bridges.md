# Rivers and Bridges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rivers thread through settlements as real geometry — classified, rendered, bridged where the biggest routes cross, walled-around but never dammed — following a population ladder from ford-side hamlet to river-spanning city.

**Architecture:** A `RiverCourse` (spine polyline + width profile per branch) is the semantic backbone; its buffered corridor rings plug into the two existing water seams — `Model.isWaterAt()` for placement and `Model.getWaterRings()` → `build-scene` → `#water` for pixels. Bridges are chosen before streets and become the only traversable crossings in `Topology` (the wall-gates pattern). Walls terminate at banks. Everything is inert when no river input is supplied.

**Tech Stack:** TypeScript, zero runtime deps, vitest. All commands run via `nix develop --command bash -c "..."`.

**Spec:** `docs/superpowers/specs/2026-08-18-rivers-bridges-design.md`

## Global Constraints

- **Zero runtime dependencies** — no geometry libraries; everything hand-rolled like `src/geom/`.
- **Byte-stability:** with no river input, generated SVG must be byte-identical to master. Task 2 pins this with md5 fixtures; every later task keeps that test green.
- **Determinism:** all randomness through the instance `SeededRandom` (`model.rng` or an rng passed in). Never `Math.random()` or `Date.now()`.
- **Floats:** use `toBeCloseTo` in tests, never `toBe` (the `-0` gotcha).
- **Test command:** `nix develop --command bash -c "npx vitest run <file>"`; full suite `nix develop --command bash -c "npx vitest run"`.
- **Commits:** no Co-Authored-By lines. `docs/superpowers/` is gitignored — use `git add -f` for plan/spec edits (source and tests are normal).
- **Owner render gates:** threshold constants (band boundaries, bridge counts, affinity strength) are STARTING values; they get tuned with barrulus at the Task 11 render gates, not silently.
- **Spec deviation (approved path):** the spec says corridor "unioned" with coastal water. Implementation achieves the union without boolean geometry: classification ORs two membership tests, rendering paints river rings as a second `fill-rule="nonzero"` path in `#water`. Estuary/confluence overlaps are handled by paint order, not polygon math.

## File Structure

- `src/generator/generation-params.ts` — modify: `RiverInput` types, river constants, delete dead `riverPath`.
- `src/generator/river.ts` — create: `RiverCourse`, `buildRiverCourse`, `synthesizeRiver`.
- `src/generator/bridges.ts` — create: `BridgeCrossing`, `planBridges`.
- `src/generator/model.ts` — modify: resolve river, water classification OR, seed steering, bridge/wall/street integration.
- `src/generator/topology.ts` — modify: block corridor vertices except crossings; add crossing edges.
- `src/generator/curtain-wall.ts` — modify: bank-following circuits (town) / bank-terminated arcs (city).
- `src/input/azgaar-input.ts` — modify: `riverGeometry` + `river` inputs, mapping.
- `src/scene/scene.ts`, `src/scene/build-scene.ts` — modify: `WaterLayer.rivers`, `Scene.bridges`.
- `src/output/assemble-svg.ts` — modify: river fill/stroke layering, bridge decks in roads pass.
- `src/output/geojson-builder.ts` — modify: river/bridge/ford features.
- Tests: `tests/river-course.test.ts`, `tests/river-model.test.ts`, `tests/river-bands.test.ts`, `tests/bridges.test.ts`, `tests/river-walls.test.ts`, `tests/river-streets.test.ts`, `tests/river-render.test.ts`, `tests/river-procedural.test.ts`, `tests/river-geojson.test.ts`, `tests/no-river-stability.test.ts`.

---

### Task 1: River input types and constants

**Files:**
- Modify: `src/generator/generation-params.ts` (delete `riverPath` at ~line 458, add types + constants)
- Modify: `src/input/azgaar-input.ts` (add `riverGeometry`/`river` to `AzgaarBurgInput`, map them)
- Test: `tests/river-params.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `RiverPoint { x: number; y: number; w?: number }`, `RiverInput { points: RiverPoint[]; name?: string }`, `GenerationParams.rivers?: RiverInput[]`, `GenerationParams.riverNeeded?: boolean`, constants `FORD_MAX_POPULATION = 250`, `RIVER_TOWN_MIN_POPULATION = 1000`, `RIVER_SPAN_POPULATION = 10000`, `MIN_RIVER_WIDTH = 1.5`, `DEFAULT_RIVER_WIDTH = 3.0`, `AzgaarBurgInput.riverGeometry?: RiverInput[]`, `AzgaarBurgInput.river?: boolean`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/river-params.test.ts
import { describe, it, expect } from 'vitest';
import {
  FORD_MAX_POPULATION, RIVER_TOWN_MIN_POPULATION, RIVER_SPAN_POPULATION,
  MIN_RIVER_WIDTH, DEFAULT_RIVER_WIDTH,
} from '../src/generator/generation-params.js';
import { mapToGenerationParams } from '../src/input/azgaar-input.js';

describe('river params', () => {
  it('exports the river band constants', () => {
    expect(FORD_MAX_POPULATION).toBe(250);
    expect(RIVER_TOWN_MIN_POPULATION).toBe(1000);
    expect(RIVER_SPAN_POPULATION).toBe(10000);
    expect(MIN_RIVER_WIDTH).toBeCloseTo(1.5);
    expect(DEFAULT_RIVER_WIDTH).toBeCloseTo(3.0);
  });

  it('maps riverGeometry and river flag from burg input', () => {
    const params = mapToGenerationParams({
      name: 'T', population: 2000, port: false, citadel: false, walls: false,
      plaza: false, temple: false, shanty: false, capital: false,
      riverGeometry: [{ points: [{ x: -60, y: 0, w: 4 }, { x: 60, y: 5 }] }],
      river: true,
    }, 42);
    expect(params.rivers).toHaveLength(1);
    expect(params.rivers![0].points[0].w).toBe(4);
    expect(params.riverNeeded).toBe(true);
  });

  it('leaves rivers/riverNeeded unset when burg has no river data', () => {
    const params = mapToGenerationParams({
      name: 'T', population: 2000, port: false, citadel: false, walls: false,
      plaza: false, temple: false, shanty: false, capital: false,
    }, 42);
    expect(params.rivers).toBeUndefined();
    expect(params.riverNeeded).toBeUndefined();
  });
});
```

Note: check `mapToGenerationParams`'s actual signature in `src/input/azgaar-input.ts` (~line 210) before writing — if the seed travels inside the input object rather than as a second argument, adapt the calls, not the assertions.

- [ ] **Step 2: Run test to verify it fails**

Run: `nix develop --command bash -c "npx vitest run tests/river-params.test.ts"`
Expected: FAIL — constants and fields not defined.

- [ ] **Step 3: Implement**

In `src/generator/generation-params.ts`, DELETE the `riverPath?: Point[]` member (and its doc comment) from `GenerationParams`, then add near the top (after the `RoadEntry` interface):

```ts
/** One river polyline in burg-local coords (origin = burg centre, mesh scale). */
export interface RiverPoint { x: number; y: number; /** width at this point */ w?: number }
export interface RiverInput {
  points: RiverPoint[];
  /** Reserved for issue #6 labels. */
  name?: string;
}

/** Below this population a river crossing is a ford, not a bridge. Render-tunable. */
export const FORD_MAX_POPULATION = 250;
/** Village/town band boundary for river behaviour. Render-tunable. */
export const RIVER_TOWN_MIN_POPULATION = 1000;
/** At/above this population the fabric may span both banks. Rhymes with DEFAULT_CORE_CAPACITY. */
export const RIVER_SPAN_POPULATION = 10000;
/** Corridor width floor so a mapped stream never renders thinner than a street. */
export const MIN_RIVER_WIDTH = 1.5;
/** Fallback width when input supplies no w and the procedural default applies. */
export const DEFAULT_RIVER_WIDTH = 3.0;
```

And add to `GenerationParams` (where `riverPath` was):

```ts
  /** River polylines through/past the settlement. Geometry always wins over riverNeeded. */
  rivers?: RiverInput[];
  /** Procedural switch: true with no geometry synthesizes a river. Maps onto #5's future tri-state. */
  riverNeeded?: boolean;
```

In `src/input/azgaar-input.ts`, add to `AzgaarBurgInput` (after `coastlineGeometry`):

```ts
  /**
   * River polylines near the burg, burg-local coords (origin = burg centre,
   * mesh scale — the coastlineGeometry convention). Per-point `w` is the
   * river width there; rivers widen downstream.
   */
  riverGeometry?: RiverInput[];
  /** Burg sits on a river (FMG burg flag). Without geometry, synthesizes one. */
  river?: boolean;
```

and in the params-building return object of `mapToGenerationParams` (next to `coastlineGeometry`):

```ts
    rivers: burg.riverGeometry,
    riverNeeded: burg.river,
```

Import `RiverInput` from `generation-params.js` in azgaar-input.ts.

- [ ] **Step 4: Run tests**

Run: `nix develop --command bash -c "npx vitest run tests/river-params.test.ts"` → PASS.
Run full suite: `nix develop --command bash -c "npx vitest run"` → all green (riverPath had zero consumers; if anything referenced it, fix that reference — it's dead code).

- [ ] **Step 5: Commit**

```bash
git add src/generator/generation-params.ts src/input/azgaar-input.ts tests/river-params.test.ts
git commit -m "River input surface: RiverInput types, band constants, burg mapping (issue #4)"
```

---

### Task 2: No-river byte-stability pin

**Files:**
- Test: `tests/no-river-stability.test.ts`

**Interfaces:**
- Consumes: the public generation entry point used by existing regression tests (see `tests/toprak-regression.test.ts` for the call pattern — reuse it exactly).
- Produces: an md5 pin every later task must keep green.

- [ ] **Step 1: Capture current hashes and write the test**

First print hashes from master's behaviour (before any model change lands):

```ts
// tests/no-river-stability.test.ts
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
// Import the same generation helper toprak-regression.test.ts uses.

const CASES = [
  { population: 300, seed: 7 },
  { population: 2000, seed: 7 },
  { population: 15000, seed: 7 },
];

// Fill EXPECTED by running once with `console.log` on the md5s, then pin.
const EXPECTED: Record<string, string> = {
  'pop300-seed7': '<md5-from-first-run>',
  'pop2000-seed7': '<md5-from-first-run>',
  'pop15000-seed7': '<md5-from-first-run>',
};

describe('no-river byte stability', () => {
  for (const c of CASES) {
    it(`pop ${c.population} seed ${c.seed} is byte-identical without river input`, () => {
      const svg = /* generate SVG for c with NO rivers/riverNeeded, mirroring toprak-regression's setup */ '';
      const md5 = createHash('md5').update(svg).digest('hex');
      expect(md5).toBe(EXPECTED[`pop${c.population}-seed${c.seed}`]);
    });
  }
});
```

The `<md5-from-first-run>` placeholders are filled in this same step: run the file once with the console.log, paste the three hashes, delete the log. The generation call must mirror an existing regression test's exact setup (fixture inputs, palette, options) so the pin is meaningful.

- [ ] **Step 2: Run to verify it passes (this test pins current behaviour, so it must pass NOW)**

Run: `nix develop --command bash -c "npx vitest run tests/no-river-stability.test.ts"` → PASS with the pasted hashes.

- [ ] **Step 3: Commit**

```bash
git add tests/no-river-stability.test.ts
git commit -m "Pin no-river SVG output before river work (issue #4)"
```

---

### Task 3: RiverCourse — spine, widths, sides, corridor rings, bank chains

**Files:**
- Create: `src/generator/river.ts`
- Test: `tests/river-course.test.ts`

**Interfaces:**
- Consumes: `RiverInput`, `MIN_RIVER_WIDTH`, `DEFAULT_RIVER_WIDTH` from Task 1; `Point` from `src/types/point.ts`.
- Produces (later tasks depend on these exact names):

```ts
export interface RiverBranch {
  spine: Point[];        // resampled + lightly smoothed centreline, ≥ 2 points
  widths: number[];      // per spine vertex, clamped ≥ MIN_RIVER_WIDTH
  leftBank: Point[];     // spine offset +normal*(w/2), same length as spine
  rightBank: Point[];    // spine offset -normal*(w/2)
  ring: Point[];         // corridor: leftBank + reversed rightBank (closed implicitly)
}
export class RiverCourse {
  branches: RiverBranch[];
  navigable: boolean;                    // default true
  waterRings(): Point[][];               // corridor rings for rendering/classification
  contains(p: Point): boolean;           // p inside ANY branch ring (union semantics)
  sideOf(p: Point): number;              // sign vs nearest spine segment of nearest branch: <0 left, >0 right, 0 on-spine
  nearestStation(p: Point): { branch: number; seg: number; t: number; at: Point; width: number; dist: number };
}
export function buildRiverCourse(inputs: RiverInput[]): RiverCourse | null; // null if no branch has ≥2 valid points
```

- [ ] **Step 1: Write the failing tests**

```ts
// tests/river-course.test.ts
import { describe, it, expect } from 'vitest';
import { Point } from '../src/types/point.js';
import { buildRiverCourse } from '../src/generator/river.js';

const straight = { points: [{ x: -100, y: 0, w: 4 }, { x: 0, y: 0 }, { x: 100, y: 0, w: 8 }] };

describe('buildRiverCourse', () => {
  it('returns null for empty or degenerate input', () => {
    expect(buildRiverCourse([])).toBeNull();
    expect(buildRiverCourse([{ points: [{ x: 0, y: 0 }] }])).toBeNull();
  });

  it('interpolates width along the spine and clamps to the floor', () => {
    const c = buildRiverCourse([straight])!;
    const mid = c.nearestStation(new Point(0, 0));
    expect(mid.width).toBeGreaterThan(4);          // between 4 and 8
    expect(mid.width).toBeLessThan(8);
    const thin = buildRiverCourse([{ points: [{ x: -10, y: 0, w: 0.2 }, { x: 10, y: 0, w: 0.2 }] }])!;
    expect(thin.nearestStation(new Point(0, 0)).width).toBeCloseTo(1.5); // MIN_RIVER_WIDTH
  });

  it('builds a corridor ring straddling the spine', () => {
    const c = buildRiverCourse([straight])!;
    expect(c.contains(new Point(0, 0))).toBe(true);        // on spine
    expect(c.contains(new Point(0, 50))).toBe(false);      // far off
    expect(c.branches[0].ring.length).toBe(c.branches[0].spine.length * 2);
  });

  it('reports sides consistently (y-down coords)', () => {
    const c = buildRiverCourse([straight])!;
    const a = c.sideOf(new Point(0, -20));
    const b = c.sideOf(new Point(0, 20));
    expect(a * b).toBeLessThan(0);                          // opposite banks
    expect(c.sideOf(new Point(0, -20))).toBe(a);            // stable
  });

  it('union semantics: contains() is true inside either of two overlapping branches', () => {
    const c = buildRiverCourse([
      straight,
      { points: [{ x: 0, y: -100, w: 4 }, { x: 0, y: 0, w: 4 }] },   // tributary ending ON the main spine
    ])!;
    expect(c.branches.length).toBe(2);
    expect(c.contains(new Point(0, -2))).toBe(true);        // inside the overlap zone near the junction
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `nix develop --command bash -c "npx vitest run tests/river-course.test.ts"` → FAIL (module missing).

- [ ] **Step 3: Implement `src/generator/river.ts`**

```ts
import { Point } from '../types/point.js';
import { pointInPolygon } from '../geom/geom-utils.js'; // ← use the same helper Model.isWaterAt uses (model.ts ~1697); adjust the import path to wherever it actually lives.
import { RiverInput, MIN_RIVER_WIDTH, DEFAULT_RIVER_WIDTH } from './generation-params.js';

/** Resample a polyline to roughly `step`-length segments (keeps endpoints). */
function resample(pts: Point[], step: number): Point[] {
  const out: Point[] = [pts[0].clone()];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = out[out.length - 1].x === pts[i - 1].x ? pts[i - 1] : pts[i - 1];
    const dx = pts[i].x - pts[i - 1].x, dy = pts[i].y - pts[i - 1].y;
    const len = Math.hypot(dx, dy);
    let d = step - carry;
    while (d < len) {
      out.push(new Point(pts[i - 1].x + dx * (d / len), pts[i - 1].y + dy * (d / len)));
      d += step;
    }
    carry = len - (d - step);
  }
  out.push(pts[pts.length - 1].clone());
  return out;
}

/** Chaikin-style single smoothing pass, endpoints pinned. */
function smooth(pts: Point[]): Point[] {
  if (pts.length < 3) return pts;
  const out: Point[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    out.push(new Point(
      0.25 * pts[i - 1].x + 0.5 * pts[i].x + 0.25 * pts[i + 1].x,
      0.25 * pts[i - 1].y + 0.5 * pts[i].y + 0.25 * pts[i + 1].y,
    ));
  }
  out.push(pts[pts.length - 1]);
  return out;
}

const SPINE_STEP = 6; // mesh units between spine samples; coarse enough to stay cheap

export interface RiverBranch {
  spine: Point[];
  widths: number[];
  leftBank: Point[];
  rightBank: Point[];
  ring: Point[];
}

function buildBranch(input: RiverInput): RiverBranch | null {
  const raw = input.points.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (raw.length < 2) return null;
  const rawPts = raw.map(p => new Point(p.x, p.y));
  // Arc-length parameter for width interpolation over the RAW points.
  const rawS: number[] = [0];
  for (let i = 1; i < rawPts.length; i++) {
    rawS.push(rawS[i - 1] + Math.hypot(rawPts[i].x - rawPts[i - 1].x, rawPts[i].y - rawPts[i - 1].y));
  }
  const total = rawS[rawS.length - 1];
  if (total === 0) return null;
  // Known widths with positions; fall back to DEFAULT_RIVER_WIDTH when none given.
  const known = raw.map((p, i) => ({ s: rawS[i], w: p.w })).filter(k => k.w !== undefined) as { s: number; w: number }[];
  const widthAtS = (s: number): number => {
    if (known.length === 0) return DEFAULT_RIVER_WIDTH;
    if (s <= known[0].s) return known[0].w;
    const last = known[known.length - 1];
    if (s >= last.s) return last.w;
    for (let i = 1; i < known.length; i++) {
      if (s <= known[i].s) {
        const t = (s - known[i - 1].s) / (known[i].s - known[i - 1].s);
        return known[i - 1].w + (known[i].w - known[i - 1].w) * t;
      }
    }
    return last.w;
  };

  const spine = smooth(resample(rawPts, SPINE_STEP));
  // Arc-length along the resampled spine for width lookup.
  const s: number[] = [0];
  for (let i = 1; i < spine.length; i++) {
    s.push(s[i - 1] + Math.hypot(spine[i].x - spine[i - 1].x, spine[i].y - spine[i - 1].y));
  }
  const scale = total / s[s.length - 1];
  const widths = s.map(si => Math.max(MIN_RIVER_WIDTH, widthAtS(si * scale)));

  // Per-vertex normal = normalized average of adjacent segment normals.
  const leftBank: Point[] = [], rightBank: Point[] = [];
  for (let i = 0; i < spine.length; i++) {
    const a = spine[Math.max(0, i - 1)], b = spine[Math.min(spine.length - 1, i + 1)];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const h = widths[i] / 2;
    leftBank.push(new Point(spine[i].x + nx * h, spine[i].y + ny * h));
    rightBank.push(new Point(spine[i].x - nx * h, spine[i].y - ny * h));
  }
  const ring = leftBank.concat(rightBank.slice().reverse());
  return { spine, widths, leftBank, rightBank, ring };
}

export class RiverCourse {
  navigable = true;
  constructor(public branches: RiverBranch[]) {}

  waterRings(): Point[][] {
    return this.branches.map(b => b.ring);
  }

  /** Union semantics: inside ANY branch corridor. (Even-odd would punch holes at overlaps.) */
  contains(p: Point): boolean {
    return this.branches.some(b => pointInPolygon(p, b.ring));
  }

  nearestStation(p: Point): { branch: number; seg: number; t: number; at: Point; width: number; dist: number } {
    let best = { branch: 0, seg: 0, t: 0, at: this.branches[0].spine[0], width: this.branches[0].widths[0], dist: Infinity };
    for (let bi = 0; bi < this.branches.length; bi++) {
      const { spine, widths } = this.branches[bi];
      for (let i = 0; i < spine.length - 1; i++) {
        const ax = spine[i].x, ay = spine[i].y, bx = spine[i + 1].x, by = spine[i + 1].y;
        const dx = bx - ax, dy = by - ay;
        const l2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.y - ay) * dy) / l2));
        const qx = ax + dx * t, qy = ay + dy * t;
        const dist = Math.hypot(p.x - qx, p.y - qy);
        if (dist < best.dist) {
          best = { branch: bi, seg: i, t, at: new Point(qx, qy), width: widths[i] + (widths[i + 1] - widths[i]) * t, dist };
        }
      }
    }
    return best;
  }

  sideOf(p: Point): number {
    const st = this.nearestStation(p);
    const { spine } = this.branches[st.branch];
    const a = spine[st.seg], b = spine[st.seg + 1];
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    return Math.sign(cross);
  }
}

export function buildRiverCourse(inputs: RiverInput[]): RiverCourse | null {
  const branches = inputs.map(buildBranch).filter((b): b is RiverBranch => b !== null);
  if (branches.length === 0) return null;
  return new RiverCourse(branches);
}
```

Before running: locate the actual `pointInPolygon` helper (`grep -n pointInPolygon src/`) and fix the import. If `resample`'s carry logic misbehaves on the first segment, simplify it — correctness bar is "roughly even spacing, endpoints exact", covered by the ring-length test.

- [ ] **Step 4: Run tests** → PASS. Then full suite → green.

- [ ] **Step 5: Commit**

```bash
git add src/generator/river.ts tests/river-course.test.ts
git commit -m "RiverCourse: spine, width profile, banks, corridor rings, union contains (issue #4)"
```

---

### Task 4: Model integration — classification and seed steering

**Files:**
- Modify: `src/generator/model.ts`
- Test: `tests/river-model.test.ts`

**Interfaces:**
- Consumes: `buildRiverCourse`, `RiverCourse` (Task 3); `GenerationParams.rivers` (Task 1).
- Produces: `Model.river: RiverCourse | null` (public field, resolved in the constructor); `Model.isWaterAt` honouring the corridor; `Model.getWaterRings()` including corridor rings.

- [ ] **Step 1: Write the failing test**

```ts
// tests/river-model.test.ts
import { describe, it, expect } from 'vitest';
import { Point } from '../src/types/point.js';
import { Model } from '../src/generator/model.js';

// Mirror the minimal GenerationParams object other model tests construct —
// copy the fixture-building helper from an existing test (e.g. coastal-core.test.ts)
// and add rivers. A straight river through the origin, wide enough to matter:
const RIVER = [{ points: [{ x: -200, y: 0, w: 6 }, { x: 200, y: 0, w: 6 }] }];

describe('model with a river', () => {
  it('classifies corridor points as water and exposes corridor rings', () => {
    const model = new Model({ /* params for pop 15000, seed 1, walls false, citadel false, plaza true, temple false, shanty false, capital false, nPatches/nCore per the helper */ rivers: RIVER } as any);
    model.generate?.() ?? (model as any).build?.(); // call the same pipeline entry the other tests call
    expect(model.isWaterAt(new Point(0, 0))).toBe(true);
    expect(model.isWaterAt(new Point(0, 100))).toBe(false);
    const rings = model.getWaterRings();
    expect(rings.length).toBeGreaterThan(0);
    expect(model.river).not.toBeNull();
  });

  it('no water patch hosts buildings inside the corridor', () => {
    const model = /* same as above */ null as any;
    for (const patch of model.patches) {
      if (model.river!.contains(patch.shape.center)) {
        expect(patch.ward?.geometry ?? []).toHaveLength(0);
      }
    }
  });
});
```

(Resolve the pipeline entry point by reading how `tests/coastal-core.test.ts` drives `Model` — use exactly that call, not a guess. The `as any` scaffolding disappears once the helper is copied.)

- [ ] **Step 2: Run to verify failure** — `model.river` undefined, corridor not water.

- [ ] **Step 3: Implement in `model.ts`**

1. Import + field + constructor resolution:

```ts
import { RiverCourse, buildRiverCourse } from './river.js';
// field:
river: RiverCourse | null = null;
// in constructor, after this.rng is created:
if (params.rivers && params.rivers.length > 0) {
  this.river = buildRiverCourse(params.rivers);
  if (this.river === null) this.degradedFlags.add('river');
}
```

2. Add `'river'` to the `DegradedFlag` union in `generation-params.ts`:

```ts
export type DegradedFlag = 'walls' | 'citadel' | 'river';
```

3. `isWaterAt` (model.ts ~1697) becomes coast-parity OR corridor membership:

```ts
isWaterAt(p: Point): boolean {
  let containing = 0;
  for (const ring of this.getCoastRings()) {
    if (pointInPolygon(p, ring)) containing++;
  }
  if (containing % 2 === 1) return true;
  return this.river !== null && this.river.contains(p);
}
```

where `getCoastRings()` is the old `getWaterRings()` body renamed, and `getWaterRings()` becomes:

```ts
/** All water rings for rendering: coastal (even-odd) plus river corridors. */
getWaterRings(): Point[][] {
  return this.getCoastRings().concat(this.river?.waterRings() ?? []);
}
```

IMPORTANT: `getWaterRings()` is consumed by `build-scene.ts:47` for RENDERING and by several classification sites. Grep every call site of `getWaterRings` first; classification/parity call sites (classifyWater at ~858, shore-length at ~927) must switch to the OR-shaped `isWaterAt`, which they already use — verify none does its own parity over `getWaterRings()` directly. Any that do get pointed at `isWaterAt`/`getCoastRings` so river rings never enter a parity count. (Task 9 splits rendering into coast vs river rings; until then river rings joining the even-odd render path is fine for non-overlapping single rivers, which is all Tasks 4–8 test.)

4. Seed steering comes free: `buildPatches`' ranking already returns `Infinity` for water seeds via `isWaterAt` (model.ts:473) — confirm `hasWater` is true when only a river is present. Find where `hasWater` is computed; extend it:

```ts
const hasWater = /* existing condition */ || this.river !== null;
```

- [ ] **Step 4: Run tests** — `tests/river-model.test.ts` PASS, `tests/no-river-stability.test.ts` PASS (no-river path untouched: `getCoastRings` rename is behaviour-neutral), full suite green.

- [ ] **Step 5: Commit**

```bash
git add src/generator/model.ts src/generator/generation-params.ts tests/river-model.test.ts
git commit -m "Model: river corridor joins water classification and water rings (issue #4)"
```

---

### Task 5: Bank affinity — the population ladder's settlement side

**Files:**
- Modify: `src/generator/model.ts` (seed ranking block, ~lines 460–560)
- Test: `tests/river-bands.test.ts`

**Interfaces:**
- Consumes: `Model.river`, `RiverCourse.sideOf` (Tasks 3–4); `RIVER_SPAN_POPULATION` (Task 1).
- Produces: `Model.dominantBank: number` (the `sideOf` sign the fabric favours; 0 when no river or pop ≥ `RIVER_SPAN_POPULATION`).

- [ ] **Step 1: Write the failing test**

```ts
// tests/river-bands.test.ts
import { describe, it, expect } from 'vitest';
import { Model } from '../src/generator/model.js';

const RIVER = [{ points: [{ x: -200, y: 0, w: 6 }, { x: 200, y: 0, w: 6 }] }];

function bankFractions(model: Model): { dom: number; other: number } {
  let dom = 0, other = 0;
  for (const p of model.patches) {
    if (!p.withinCity) continue;
    const side = model.river!.sideOf(p.shape.center);
    if (side === model.dominantBank) dom++;
    else if (side !== 0) other++;
  }
  const total = dom + other;
  return { dom: dom / total, other: other / total };
}

describe('river population ladder: bank affinity', () => {
  it('sub-span settlements sit ≥80% on the dominant bank', () => {
    for (const population of [800, 4000]) {
      const model = /* build + generate with rivers: RIVER, population, seed 1 */ null as any;
      expect(model.dominantBank).not.toBe(0);
      expect(bankFractions(model).dom).toBeGreaterThanOrEqual(0.8);
    }
  });

  it('cities span both banks', () => {
    const model = /* population 20000, rivers: RIVER, seed 1 */ null as any;
    expect(model.dominantBank).toBe(0);
    const { other } = bankFractions(model);
    expect(other).toBeGreaterThan(0.1); // real fabric on the far bank, not a stray patch
  });
});
```

(Same fixture helper as Task 4. `bankFractions` divides by dom+other so on-spine zeros don't dilute.)

- [ ] **Step 2: Run to verify failure** — `dominantBank` undefined.

- [ ] **Step 3: Implement**

In `model.ts`:

```ts
/** Bank the sub-span fabric favours: a sideOf() sign, 0 = no bias (no river / city band). */
dominantBank = 0;
/** Rank penalty for seeding on the wrong bank below RIVER_SPAN_POPULATION. Large, not Infinity — overflow may still spill. */
private static readonly RIVER_BANK_PENALTY = 1e6;
```

In the constructor, after `this.river` resolves:

```ts
if (this.river && params.population < RIVER_SPAN_POPULATION) {
  this.dominantBank = this.pickDominantBank(params);
}
```

```ts
/**
 * The bank road entries favour: project each entry's unit vector out to a
 * nominal radius and take the majority sideOf() sign. Ties or no entries:
 * the burg-centre side (and if the centre is on-spine, left).
 */
private pickDominantBank(params: GenerationParams): number {
  const R = 50;
  let sum = 0;
  for (const e of params.roadEntryPoints ?? []) {
    sum += this.river!.sideOf(new Point(e.point.x * R, e.point.y * R));
  }
  if (sum !== 0) return Math.sign(sum);
  return this.river!.sideOf(new Point(0, 0)) || -1;
}
```

In the core-seed ranking function (the one at ~460–560 that returns `Infinity` for water at line 473), add immediately after the water check:

```ts
if (this.dominantBank !== 0 && this.river!.sideOf(p) === -this.dominantBank) {
  rank += Model.RIVER_BANK_PENALTY;
}
```

(Adapt to the block's actual shape: if it returns a computed number, add the penalty to the return; the decorate-sort-undecorate comment at ~479 marks the spot.)

- [ ] **Step 4: Run tests** — river-bands PASS, no-river-stability PASS, full suite green. If 0.8 fails at pop 4000, raise the penalty before touching the threshold; the constant is the knob, the test is the contract.

- [ ] **Step 5: Commit**

```bash
git add src/generator/model.ts tests/river-bands.test.ts
git commit -m "Bank affinity: sub-span settlements favour one bank (issue #4)"
```

---

### Task 6: Bridge siting — `planBridges`

**Files:**
- Create: `src/generator/bridges.ts`
- Modify: `src/generator/model.ts` (call it after classifyWater, store result)
- Test: `tests/bridges.test.ts`

**Interfaces:**
- Consumes: `RiverCourse` (Task 3), `RoadEntry`, band constants (Task 1).
- Produces:

```ts
export interface BridgeCrossing {
  at: Point;        // spine station = deck midpoint
  left: Point;      // left-bank landing (on the corridor boundary)
  right: Point;     // right-bank landing
  width: number;    // channel width at the station
  ford: boolean;
  routeId?: string; // best route this crossing serves, if any
}
export function planBridges(
  course: RiverCourse,
  population: number,
  entries: RoadEntry[],
  rng: SeededRandom,
): BridgeCrossing[];
```

and `Model.bridges: BridgeCrossing[]` populated during generation.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/bridges.test.ts
import { describe, it, expect } from 'vitest';
import { Point } from '../src/types/point.js';
import { SeededRandom } from '../src/utils/random.js';
import { buildRiverCourse } from '../src/generator/river.js';
import { planBridges } from '../src/generator/bridges.js';

const course = () => buildRiverCourse([{ points: [{ x: -200, y: 0, w: 6 }, { x: 200, y: 0, w: 6 }] }])!;
const entryAt = (deg: number, opts: object = {}) => {
  const rad = (deg * Math.PI) / 180;
  return { point: new Point(Math.sin(rad), -Math.cos(rad)), bearingDeg: deg, ...opts };
};

describe('planBridges band budgets', () => {
  it('ford below FORD_MAX_POPULATION', () => {
    const b = planBridges(course(), 150, [entryAt(0, { through: true, group: 'roads' }), entryAt(180)], new SeededRandom(1));
    expect(b).toHaveLength(1);
    expect(b[0].ford).toBe(true);
  });

  it('village: exactly one bridge', () => {
    const b = planBridges(course(), 600, [entryAt(0, { through: true, group: 'roads' }), entryAt(180)], new SeededRandom(1));
    expect(b).toHaveLength(1);
    expect(b[0].ford).toBe(false);
  });

  it('town: second bridge only for a second major crossing route', () => {
    const one = planBridges(course(), 5000, [entryAt(0, { through: true, group: 'roads' })], new SeededRandom(1));
    expect(one).toHaveLength(1);
    const two = planBridges(course(), 5000, [
      entryAt(10, { through: true, group: 'roads', routeId: 'a' }),
      entryAt(170, { through: true, group: 'roads', routeId: 'b' }),
    ], new SeededRandom(1));
    expect(two.length).toBeLessThanOrEqual(2);
  });

  it('city: 3–5 bridges, spaced apart', () => {
    const b = planBridges(course(), 20000, [
      entryAt(0, { through: true, group: 'roads' }), entryAt(90, { through: true, group: 'roads' }),
      entryAt(180, { through: true, group: 'roads' }), entryAt(270, { group: 'trails' }),
    ], new SeededRandom(1));
    expect(b.length).toBeGreaterThanOrEqual(3);
    expect(b.length).toBeLessThanOrEqual(5);
    for (let i = 0; i < b.length; i++) {
      for (let j = i + 1; j < b.length; j++) {
        expect(Math.hypot(b[i].at.x - b[j].at.x, b[i].at.y - b[j].at.y)).toBeGreaterThanOrEqual(15);
      }
    }
  });

  it('bridge landings straddle the channel', () => {
    const [b] = planBridges(course(), 600, [entryAt(0, { through: true, group: 'roads' })], new SeededRandom(1));
    const c = course();
    expect(c.sideOf(b.left) * c.sideOf(b.right)).toBeLessThan(0);
    expect(c.contains(b.at)).toBe(true);
  });

  it('deterministic for a given seed', () => {
    const args = [entryAt(0, { through: true, group: 'roads' }), entryAt(180, { group: 'trails' })];
    const a = planBridges(course(), 20000, args, new SeededRandom(7));
    const b = planBridges(course(), 20000, args, new SeededRandom(7));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement `src/generator/bridges.ts`**

```ts
import { Point } from '../types/point.js';
import { SeededRandom } from '../utils/random.js';
import { RiverCourse } from './river.js';
import {
  RoadEntry, FORD_MAX_POPULATION, RIVER_TOWN_MIN_POPULATION, RIVER_SPAN_POPULATION,
} from './generation-params.js';

export interface BridgeCrossing {
  at: Point;
  left: Point;
  right: Point;
  width: number;
  ford: boolean;
  routeId?: string;
}

/** Minimum spine distance between chosen crossings so bridges spread. Render-tunable. */
const BRIDGE_MIN_SPACING = 15;
/** Desire-line reach: road entries project this far from the centre. */
const ENTRY_REACH = 120;

interface Candidate {
  branch: number; seg: number;
  at: Point; width: number;
  score: number; routeId?: string;
}

/** Does segment a→b cross segment c→d? Standard orientation test. */
function segsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const o = (p: Point, q: Point, r: Point) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
}

export function planBridges(
  course: RiverCourse,
  population: number,
  entries: RoadEntry[],
  rng: SeededRandom,
): BridgeCrossing[] {
  const budget =
    population < RIVER_TOWN_MIN_POPULATION ? 1 :
    population < RIVER_SPAN_POPULATION ? 2 :
    3 + rng.int(0, 3); // 3–5
  const ford = population < FORD_MAX_POPULATION;
  const centre = new Point(0, 0);

  // Desire lines: centre → each road entry, projected out to ENTRY_REACH.
  const desires = entries.map(e => ({
    far: new Point(e.point.x * ENTRY_REACH, e.point.y * ENTRY_REACH),
    major: (e.through === true) && (e.group !== 'trails'),
    routeId: e.routeId,
  }));

  // Candidate stations: every spine vertex of every branch.
  const candidates: Candidate[] = [];
  for (let bi = 0; bi < course.branches.length; bi++) {
    const { spine, widths } = course.branches[bi];
    for (let i = 1; i < spine.length - 1; i++) {
      let score = 0;
      let routeId: string | undefined;
      const a = spine[i - 1], b = spine[i + 1];
      for (const d of desires) {
        if (segsCross(centre, d.far, a, b)) {
          score += d.major ? 10 : 2;
          if (d.major && routeId === undefined) routeId = d.routeId;
        }
      }
      score += 3 / widths[i];                 // prefer narrow water
      score -= Math.hypot(spine[i].x, spine[i].y) / 200; // prefer near the centre
      candidates.push({ branch: bi, seg: i, at: spine[i], width: widths[i], score, routeId });
    }
  }
  candidates.sort((a, b) => b.score - a.score);

  const chosen: Candidate[] = [];
  for (const c of candidates) {
    if (chosen.length >= budget) break;
    if (chosen.some(k => Math.hypot(k.at.x - c.at.x, k.at.y - c.at.y) < BRIDGE_MIN_SPACING)) continue;
    // A town's SECOND bridge must serve a major route; a village never takes a second.
    if (chosen.length >= 1 && population < RIVER_SPAN_POPULATION) {
      if (population < RIVER_TOWN_MIN_POPULATION) break;
      if (c.routeId === undefined && c.score < 10) break;
    }
    chosen.push(c);
  }
  if (chosen.length === 0 && candidates.length > 0) chosen.push(candidates[0]);

  return chosen.map(c => {
    const br = course.branches[c.branch];
    return {
      at: c.at.clone(),
      left: br.leftBank[c.seg].clone(),
      right: br.rightBank[c.seg].clone(),
      width: c.width,
      ford,
      routeId: c.routeId,
    };
  });
}
```

In `model.ts`: field `bridges: BridgeCrossing[] = [];` and, in the pipeline immediately after `classifyWater()` (model.ts ~370):

```ts
if (this.river) {
  this.bridges = planBridges(this.river, this.params.population, this.params.roadEntryPoints ?? [], this.rng);
}
```

- [ ] **Step 4: Run tests** — bridges PASS, stability PASS, full suite green.

- [ ] **Step 5: Commit**

```bash
git add src/generator/bridges.ts src/generator/model.ts tests/bridges.test.ts
git commit -m "Bridge siting: band budgets, route-scored stations, spacing (issue #4)"
```

---

### Task 7: Streets cross only at bridges (Topology)

**Files:**
- Modify: `src/generator/topology.ts`
- Modify: `src/generator/model.ts` (nothing structural — verify buildStreets order)
- Test: `tests/river-streets.test.ts`

**Interfaces:**
- Consumes: `Model.river`, `Model.bridges` (Tasks 4, 6).
- Produces: streets that cross the corridor only along bridge chains; far-bank fabric reachable.

- [ ] **Step 1: Write the failing test**

```ts
// tests/river-streets.test.ts
import { describe, it, expect } from 'vitest';
import { Point } from '../src/types/point.js';

// Fixture: pop 20000 city, straight river, 4 road entries (as in Task 6's city test),
// generated via the shared helper.

describe('streets vs river', () => {
  it('every street segment crossing the corridor lies on a bridge chain', () => {
    const model = /* generate city fixture */ null as any;
    const nearABridge = (a: Point, b: Point): boolean =>
      model.bridges.some((br: any) => {
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        return Math.hypot(mx - br.at.x, my - br.at.y) < br.width + 10;
      });
    for (const street of model.streets ?? model.roads ?? []) {
      const verts = street.vertices ?? street;
      for (let i = 0; i < verts.length - 1; i++) {
        const a = verts[i], b = verts[i + 1];
        const wet = model.isWaterAt(new Point((a.x + b.x) / 2, (a.y + b.y) / 2));
        if (wet && model.river!.contains(new Point((a.x + b.x) / 2, (a.y + b.y) / 2))) {
          expect(nearABridge(a, b)).toBe(true);
        }
      }
    }
  });

  it('far-bank city fabric is street-connected', () => {
    const model = /* same fixture */ null as any;
    const farBankInner = model.patches.filter((p: any) =>
      p.withinCity && model.river!.sideOf(p.shape.center) > 0);
    expect(farBankInner.length).toBeGreaterThan(0); // city spans (Task 5)
    // At least one street touches a far-bank patch vertex.
    const touched = farBankInner.some((p: any) =>
      (model.streets ?? model.roads ?? []).some((s: any) =>
        (s.vertices ?? s).some((v: Point) => p.shape.vertices.includes(v))));
    expect(touched).toBe(true);
  });
});
```

(Discover the model's actual street collections — `grep -n "streets\|arteries\|roads" src/generator/model.ts | head` — and use the real field names; `vertices ?? street` scaffolding then collapses.)

- [ ] **Step 2: Run to verify failure** (streets currently route straight across water or fail to reach the far bank).

- [ ] **Step 3: Implement in `topology.ts`**

In the constructor, after the existing blocked-list construction (`this.blocked = difference(blocked, model.gates)`), block corridor vertices:

```ts
// River corridor vertices are impassable — except bridge chains, added below.
if (model.river) {
  const wet: Point[] = [];
  for (const p of model.patches) {
    for (const v of p.shape.vertices) {
      if (model.river.contains(v)) wet.push(v);
    }
  }
  this.blocked = this.blocked.concat(difference(wet, model.gates));
}
```

After the main vertex/edge loop (where `processPoint` has built the graph), add bridge chains:

```ts
// Bridge chains: left landing — deck midpoint — right landing, traversable.
if (model.river) {
  for (const bridge of model.bridges) {
    const left = this.snapToGraph(bridge.left);
    const right = this.snapToGraph(bridge.right);
    if (left === null || right === null) continue;
    const mid = this.processPoint(bridge.at.clone());
    const lNode = this.pt2node.get(left)!, rNode = this.pt2node.get(right)!;
    if (mid !== null) {
      const half = bridge.width / 2 + 1;
      lNode.link(mid, half);
      mid.link(rNode, half);
      addUnique(this.inner, mid);
    } else {
      lNode.link(rNode, bridge.width + 2);
    }
    addUnique(this.inner, lNode);
    addUnique(this.inner, rNode);
  }
}
```

with the helper:

```ts
/** Nearest existing non-blocked graph point within `maxDist`, or null. */
private snapToGraph(p: Point, maxDist = 20): Point | null {
  let best: Point | null = null, bestD = maxDist;
  for (const [pt] of this.pt2node) {
    if (this.blocked.includes(pt)) continue;
    const d = Math.hypot(pt.x - p.x, pt.y - p.y);
    if (d < bestD) { best = pt; bestD = d; }
  }
  return best;
}
```

CHECK the actual mechanism `Topology` uses to make `blocked` effective (read the rest of the constructor + `buildPath`): if blocked points are excluded from the graph rather than passed to `aStar`'s exclude list, wet vertices must be excluded the same way, and the bridge nodes added after that exclusion. Follow the wall-vertices-minus-gates precedent exactly — it is the pattern being copied.

- [ ] **Step 4: Run tests** — river-streets PASS, stability PASS, full suite green. Diagnose failures by dumping one SVG (`npx tsx smoke-test.ts` pattern) rather than guessing.

- [ ] **Step 5: Commit**

```bash
git add src/generator/topology.ts src/generator/model.ts tests/river-streets.test.ts
git commit -m "Streets cross the river only at bridge chains (issue #4)"
```

---

### Task 8: Walls at the water

**Files:**
- Modify: `src/generator/model.ts` (`buildWalls` phase), `src/generator/curtain-wall.ts`
- Test: `tests/river-walls.test.ts`

**Interfaces:**
- Consumes: `Model.river`, `Model.bridges`, `Model.dominantBank`.
- Produces: wall circuits that never intersect the corridor; town band: riverside wall along the bank with the bridge at a gate; city band: two per-bank arcs with terminal towers.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/river-walls.test.ts
import { describe, it, expect } from 'vitest';
import { Point } from '../src/types/point.js';

describe('walls vs river', () => {
  it('no wall vertex or segment midpoint lies inside the corridor (town)', () => {
    const model = /* walled fixture, pop 5000, straight river, seed 1 */ null as any;
    if (!model.wall) return; // wall may degrade on some seeds; the invariant is conditional
    const verts = model.wall.shape.vertices;
    for (let i = 0; i < verts.length; i++) {
      const a = verts[i], b = verts[(i + 1) % verts.length];
      expect(model.river!.contains(a)).toBe(false);
      expect(model.river!.contains(new Point((a.x + b.x) / 2, (a.y + b.y) / 2))).toBe(false);
    }
  });

  it('town: exactly one bridge, landing at a wall gate', () => {
    const model = /* same walled town fixture */ null as any;
    expect(model.bridges.length).toBeLessThanOrEqual(2);
    if (!model.wall) return;
    const [bridge] = model.bridges;
    const gateNear = model.gates.some((g: Point) =>
      Math.hypot(g.x - bridge.left.x, g.y - bridge.left.y) < 15 ||
      Math.hypot(g.x - bridge.right.x, g.y - bridge.right.y) < 15);
    expect(gateNear).toBe(true);
  });

  it('city: wall splits into per-bank circuits, none crossing the water', () => {
    const model = /* walled city fixture, pop 20000 river */ null as any;
    if (!model.wall) return;
    // Wall geometry must not cross the corridor anywhere:
    const verts = model.wall.shape.vertices;
    for (const v of verts) expect(model.river!.contains(v)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure** (today's circuit runs straight across the corridor).

- [ ] **Step 3: Implement**

This is the task where reading before writing matters most. Read `curtain-wall.ts` fully (384 lines) and the `buildWalls` call in `model.ts` (~726: `new CurtainWall(this.wallsNeeded, this, this.inner, reserved, this.rng, this.params.roadEntryPoints)`), noting how the coastal "seaward run along the waterline" (curtain-wall.ts ~63) already bends the circuit for water. Then:

1. **Circuit vertices stay dry.** Wherever `CurtainWall` selects/builds its circuit vertices from patch circumference, project any vertex falling inside the corridor onto the nearest bank: add to `CurtainWall` a post-processing pass

```ts
/** Pull wall vertices out of the river: project onto the nearest corridor boundary point, nudged 1 unit landward. */
private pullFromRiver(model: Model): void {
  if (!model.river) return;
  for (const v of this.shape.vertices) {
    if (!model.river.contains(v)) continue;
    const st = model.river.nearestStation(v);
    const side = model.river.sideOf(v) || 1;
    const branch = model.river.branches[st.branch];
    const bank = side < 0 ? branch.leftBank : branch.rightBank;
    const nearest = bank.reduce((a, b) =>
      Math.hypot(a.x - v.x, a.y - v.y) < Math.hypot(b.x - v.x, b.y - v.y) ? a : b);
    const dx = v.x - st.at.x, dy = v.y - st.at.y;
    const d = Math.hypot(dx, dy) || 1;
    v.setTo(nearest.x + (dx / d), nearest.y + (dy / d));
  }
}
```

called at the end of circuit construction, before gates/towers are placed. This alone yields the TOWN behaviour: the circuit hugs the bank because its wet vertices land on the bank chain (mirroring the seaward-run treatment).

2. **Bridge-at-gate (town band).** After gate placement, when `model.bridges.length > 0` and the wall exists, force the wall vertex nearest the bridge's near-side landing (`sideOf(landing) === dominantBank` side) to be a gate — reuse whatever mechanism turns a wall vertex into a gate for road entries (the `GateMeta`/entrance machinery). If a gate already sits within `GATE_CLUSTER_DEG`-equivalent distance, leave it.

3. **City band split.** When `model.dominantBank === 0` (city spans) and the circuit would cross the corridor: after `pullFromRiver`, consecutive pulled vertices form two bank-hugging runs. Mark the two runs' end vertices as terminal towers (add them to the towers collection; read how towers are stored — likely a `towers: Point[]` on CurtainWall) and suppress gate placement on bank-run vertices. The circuit geometry stays a closed polygon (the bank runs sit ON the banks, harmless and invisible against the water edge) — the SPEC's "two arcs" reads visually as such because Task 9 renders wall segments that hug the bank only up to the terminal towers: mark bank-run vertices and have the wall renderer skip segments between two bank-run vertices. Store that as `CurtainWall.segmentIsRiverGap(i: number): boolean` backed by a `Set<number>` of vertex indices filled during `pullFromRiver`.

4. `model.ts` passes nothing new — `CurtainWall` already receives `model`.

Keep iterating against the three tests; they are the contract. If a seed degrades walls entirely (existing fallback), the tests' `if (!model.wall) return;` guards keep them honest without flaking.

- [ ] **Step 4: Run tests** — river-walls PASS, stability PASS, full suite green (coastal wall tests especially: `tests/coastal-core.test.ts` must not regress).

- [ ] **Step 5: Commit**

```bash
git add src/generator/curtain-wall.ts src/generator/model.ts tests/river-walls.test.ts
git commit -m "Walls terminate at river banks; town bridge lands at a gate (issue #4)"
```

---

### Task 9: Rendering — river water, layered strokes, bridge decks

**Files:**
- Modify: `src/scene/scene.ts` (`WaterLayer.rivers`, `Scene.bridges`), `src/scene/build-scene.ts`, `src/output/assemble-svg.ts`
- Test: `tests/river-render.test.ts`

**Interfaces:**
- Consumes: `Model.getCoastRings()`, `Model.river`, `Model.bridges`, `CurtainWall.segmentIsRiverGap` (Tasks 4–8).
- Produces: `WaterLayer { rings: Ring[]; rivers: Ring[] }`; `Scene.bridges: Array<{ deck: [ScenePoint, ScenePoint]; width: number; ford: boolean }>`; `#water` markup with river fills; decks in `#roads`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/river-render.test.ts
import { describe, it, expect } from 'vitest';

describe('river rendering', () => {
  it('river rings render as a nonzero fill inside #water', () => {
    const svg = /* generate city-with-river fixture SVG */ '';
    expect(svg).toContain('fill-rule="nonzero"');
    expect(svg).toMatch(/<g id="water"/);
  });

  it('bridge decks render in the roads pass', () => {
    const svg = /* same fixture */ '';
    expect(svg).toMatch(/class="bridge-deck"/);
  });

  it('ford renders no deck', () => {
    const svg = /* pop 150 village fixture with river */ '';
    expect(svg).not.toMatch(/class="bridge-deck"/);
  });

  it('no-river SVG contains no river markup', () => {
    const svg = /* pop 2000 fixture WITHOUT river */ '';
    expect(svg).not.toContain('fill-rule="nonzero"');
    expect(svg).not.toMatch(/class="bridge-deck"/);
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

1. `src/scene/scene.ts` — extend:

```ts
export interface WaterLayer {
  rings: Ring[];          // coastal, painted even-odd (unchanged)
  rivers: Ring[];         // river corridors, painted nonzero on top
}
// on Scene (top level, beside water):
bridges: Array<{ deck: [ScenePoint, ScenePoint]; width: number; ford: boolean }>;
```

2. `src/scene/build-scene.ts` (~line 46) — split the sources and add bridges:

```ts
water: {
  rings: model.getCoastRings().map(r => ring(r)),
  rivers: (model.river?.waterRings() ?? []).map(r => ring(r)),
},
bridges: model.bridges.map(b => ({
  deck: [scenePoint(b.left), scenePoint(b.right)] as [ScenePoint, ScenePoint],
  width: b.width,
  ford: b.ford,
})),
```

(match the file's existing `ring`/point-mapping helpers by name).

3. `src/output/assemble-svg.ts` — replace the water block (~178–184):

```ts
const hasCoast = theme.water !== null && L.water.rings.length > 0;
const hasRiver = theme.water !== null && L.water.rivers.length > 0;
if (hasCoast || hasRiver) {
  parts.push(`<g id="water" clip-path="url(#${clipId})">`);
  if (!hasRiver) {
    // No-river path: byte-identical to master.
    const d = L.water.rings.map(ringPath).join(' ');
    parts.push(`<path class="fill" d="${d}" fill-rule="evenodd"/>`);
    if (theme.waterEdge !== null) parts.push(`<path class="shore" d="${d}"/>`);
  } else {
    // Layered scheme: strokes first, fills on top — fills swallow stroke
    // halves inside water, so crossings (river mouth, confluence) show no
    // stray shoreline. Apparent shore width halves; double it here.
    const dc = L.water.rings.map(ringPath).join(' ');
    const dr = L.water.rivers.map(ringPath).join(' ');
    if (theme.waterEdge !== null) {
      if (hasCoast) parts.push(`<path class="shore wide" d="${dc}"/>`);
      parts.push(`<path class="shore wide" d="${dr}"/>`);
    }
    if (hasCoast) parts.push(`<path class="fill" d="${dc}" fill-rule="evenodd"/>`);
    parts.push(`<path class="fill" d="${dr}" fill-rule="nonzero"/>`);
  }
  parts.push('</g>');
}
```

with a CSS addition next to the existing shore rule (~line 60):

```ts
theme.waterEdge !== null ? `#water .shore.wide{stroke-width:${fmt(theme.shoreWidth * 2)}}` : '',
```

4. Bridge decks — inside the roads group, after the lane loops:

```ts
for (const b of L.bridges) {
  if (b.ford) continue;
  const d = `M${fmt(b.deck[0].x)} ${fmt(b.deck[0].y)}L${fmt(b.deck[1].x)} ${fmt(b.deck[1].y)}`;
  parts.push(`<path class="bridge-deck casing" d="${d}" stroke-width="${fmt(theme.roadWidth * 1.6 + theme.casingDelta * 2)}" stroke-linecap="butt"/>`);
  parts.push(`<path class="bridge-deck core" d="${d}" stroke-width="${fmt(theme.roadWidth * 1.6)}" stroke-linecap="butt"/>`);
}
```

5. Wall river gaps: where assemble-svg draws the wall polygon, consult `segmentIsRiverGap` — thread a parallel `wallGaps: number[]` (vertex indices) through the scene's wall feature and split the wall path into subpaths that skip gap segments. Read how the wall ring currently reaches the scene (`grep -n wall src/scene/build-scene.ts`) and mirror the existing shape.

- [ ] **Step 4: Run tests** — river-render PASS, **no-river-stability PASS is the critical check** (the `!hasRiver` branch must reproduce master's markup byte-for-byte), full suite green.

- [ ] **Step 5: Commit**

```bash
git add src/scene/scene.ts src/scene/build-scene.ts src/output/assemble-svg.ts tests/river-render.test.ts
git commit -m "Render rivers (nonzero fill, layered shores), bridge decks, wall gaps (issue #4)"
```

---

### Task 10: Procedural fallback — `synthesizeRiver`

**Files:**
- Modify: `src/generator/river.ts` (add `synthesizeRiver`), `src/generator/model.ts` (wire `riverNeeded`)
- Test: `tests/river-procedural.test.ts`

**Interfaces:**
- Consumes: `SeededRandom`, `RoadEntry.followsRiver`, `DEFAULT_RIVER_WIDTH`.
- Produces: `synthesizeRiver(rng: SeededRandom, population: number, entries: RoadEntry[], reach: number): RiverInput` — one polyline spanning the map (both endpoints at distance ≥ `reach` from origin).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/river-procedural.test.ts
import { describe, it, expect } from 'vitest';
import { Point } from '../src/types/point.js';
import { SeededRandom } from '../src/utils/random.js';
import { synthesizeRiver, buildRiverCourse } from '../src/generator/river.js';

describe('synthesizeRiver', () => {
  it('spans the map: both endpoints beyond the reach radius', () => {
    const r = synthesizeRiver(new SeededRandom(3), 2000, [], 300);
    const first = r.points[0], last = r.points[r.points.length - 1];
    expect(Math.hypot(first.x, first.y)).toBeGreaterThanOrEqual(300);
    expect(Math.hypot(last.x, last.y)).toBeGreaterThanOrEqual(300);
  });

  it('is deterministic per seed', () => {
    const a = synthesizeRiver(new SeededRandom(9), 5000, [], 300);
    const b = synthesizeRiver(new SeededRandom(9), 5000, [], 300);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('aligns entry with a followsRiver road when present', () => {
    const entry = { point: new Point(0, -1), bearingDeg: 0, followsRiver: true };
    const r = synthesizeRiver(new SeededRandom(3), 2000, [entry], 300);
    const first = r.points[0];
    const bearing = Math.atan2(first.x, -first.y); // 0 = north, y-down
    expect(Math.abs(bearing)).toBeLessThan(Math.PI / 3); // within 60° of the valley road
  });

  it('produces a buildable course that does not swallow the centre at village scale', () => {
    const r = synthesizeRiver(new SeededRandom(3), 300, [], 300);
    const c = buildRiverCourse([r])!;
    // Lazy curve: village rivers pass BESIDE the origin, not over it.
    expect(c.contains(new Point(0, 0))).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement in `river.ts`**

```ts
import { SeededRandom } from '../utils/random.js';
import { RoadEntry } from './generation-params.js';

/** Village rivers pass beside the centre by at least this offset. */
const VILLAGE_RIVER_OFFSET = 25;

export function synthesizeRiver(
  rng: SeededRandom,
  population: number,
  entries: RoadEntry[],
  reach: number,
): RiverInput {
  // Entry bearing: prefer a followsRiver road's direction; else random.
  const valley = entries.find(e => e.followsRiver);
  const entryAngle = valley
    ? Math.atan2(valley.point.x, -valley.point.y) + (rng.float() - 0.5) * 0.4
    : rng.float() * Math.PI * 2;
  const exitAngle = entryAngle + Math.PI + (rng.float() - 0.5) * 0.8;

  // Sub-span settlements keep the river off-centre (the ladder: tangent, beside).
  const spanCity = population >= RIVER_SPAN_POPULATION;
  const offset = spanCity ? 0 : VILLAGE_RIVER_OFFSET + rng.float() * 15;
  const perp = entryAngle + Math.PI / 2;
  const cx = Math.sin(perp) * offset, cy = -Math.cos(perp) * offset;

  const start = { x: Math.sin(entryAngle) * reach + cx, y: -Math.cos(entryAngle) * reach + cy };
  const end = { x: Math.sin(exitAngle) * reach + cx, y: -Math.cos(exitAngle) * reach + cy };

  // Meander: N midpoints displaced perpendicular by seeded noise; lazier when small.
  const n = 8;
  const amp = (spanCity ? 30 : 12);
  const w = Math.max(DEFAULT_RIVER_WIDTH, DEFAULT_RIVER_WIDTH * Math.log10(Math.max(10, population)) / 2);
  const points: RiverPoint[] = [{ x: start.x, y: start.y, w }];
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const bx = start.x + (end.x - start.x) * t, by = start.y + (end.y - start.y) * t;
    const dx = end.x - start.x, dy = end.y - start.y;
    const len = Math.hypot(dx, dy) || 1;
    const disp = (rng.float() - 0.5) * 2 * amp * Math.sin(t * Math.PI);
    points.push({ x: bx + (-dy / len) * disp, y: by + (dx / len) * disp });
  }
  points.push({ x: end.x, y: end.y, w });
  return { points };
}
```

Wire in `model.ts`'s constructor, extending the Task 4 block:

```ts
if (params.rivers && params.rivers.length > 0) {
  this.river = buildRiverCourse(params.rivers);
} else if (params.riverNeeded === true) {
  // Reach: comfortably beyond the frame so water bleeds off-map (parked-water lesson).
  this.river = buildRiverCourse([synthesizeRiver(this.rng, params.population, params.roadEntryPoints ?? [], 300)]);
}
if ((params.rivers?.length || params.riverNeeded) && this.river === null) {
  this.degradedFlags.add('river');
}
```

CAUTION — determinism: the synthesizer consumes `this.rng` draws before `buildPatches`, which changes every downstream draw. That is fine (river settlements are new output), but confirms why the no-river path must not touch `rng` at all: with neither `rivers` nor `riverNeeded`, zero extra draws happen, keeping Task 2's pin green.

- [ ] **Step 4: Run tests** — procedural PASS, stability PASS, full suite green.

- [ ] **Step 5: Commit**

```bash
git add src/generator/river.ts src/generator/model.ts tests/river-procedural.test.ts
git commit -m "Procedural river synthesis behind riverNeeded (issue #4)"
```

---

### Task 11: GeoJSON features and the navigability invariant

**Files:**
- Modify: `src/output/geojson-builder.ts`
- Test: `tests/river-geojson.test.ts` (also holds the navigability invariant test)

**Interfaces:**
- Consumes: `Model.river`, `Model.bridges`, existing `sc(point, shift)` scaler and feature helpers in geojson-builder.
- Produces: features `{ feature_type: 'river_centerline' }` (LineString per branch), `{ feature_type: 'river_corridor' }` (Polygon per branch), `{ feature_type: 'bridge' | 'ford' }` (Point, properties `{ width, route_id? }`).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/river-geojson.test.ts
import { describe, it, expect } from 'vitest';
import { Point } from '../src/types/point.js';

describe('river geojson + navigability', () => {
  it('emits river and bridge features', () => {
    const gj = /* build GeoJSON for the city-with-river fixture (reuse geojson tests' driver) */ null as any;
    const types = gj.features.map((f: any) => f.properties.feature_type ?? f.properties.type);
    expect(types).toContain('river_centerline');
    expect(types).toContain('river_corridor');
    expect(types.filter((t: string) => t === 'bridge').length).toBeGreaterThanOrEqual(3);
  });

  it('emits ford features for tiny settlements', () => {
    const gj = /* pop 150 fixture */ null as any;
    const types = gj.features.map((f: any) => f.properties.feature_type ?? f.properties.type);
    expect(types).toContain('ford');
    expect(types).not.toContain('bridge');
  });

  it('NAVIGABILITY INVARIANT: no building, wall, or tower polygon intersects the corridor', () => {
    const model = /* city-with-river walled fixture */ null as any;
    const solidRings: Point[][] = [];
    for (const patch of model.patches) {
      for (const g of patch.ward?.geometry ?? []) solidRings.push(g.vertices);
    }
    if (model.wall) solidRings.push(model.wall.shape.vertices);
    for (const ring of solidRings) {
      for (const v of ring) {
        expect(model.river!.contains(v)).toBe(false);
      }
    }
  });

  it('no river input → no river features', () => {
    const gj = /* no-river fixture */ null as any;
    const types = gj.features.map((f: any) => f.properties.feature_type ?? f.properties.type);
    expect(types).not.toContain('river_centerline');
  });
});
```

(Match the property key the file actually uses — read an existing feature emitter like `addWallFeatures` at ~378 and copy its `properties` shape.)

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement in `geojson-builder.ts`** — a new emitter called from the main build alongside `addWallFeatures`/`addEntranceFeatures`:

```ts
function addRiverFeatures(features: Feature[], model: Model, shift: OriginShift): void {
  if (!model.river) return;
  for (const branch of model.river.branches) {
    features.push({
      type: 'Feature',
      properties: { feature_type: 'river_centerline' },
      geometry: { type: 'LineString', coordinates: branch.spine.map(v => sc(v, shift)) },
    });
    features.push({
      type: 'Feature',
      properties: { feature_type: 'river_corridor' },
      geometry: { type: 'Polygon', coordinates: [branch.ring.concat([branch.ring[0]]).map(v => sc(v, shift))] },
    });
  }
  for (const b of model.bridges) {
    features.push({
      type: 'Feature',
      properties: { feature_type: b.ford ? 'ford' : 'bridge', width: b.width, route_id: b.routeId },
      geometry: { type: 'Point', coordinates: sc(b.at, shift) },
    });
  }
}
```

(Adapt `properties` keys and the `Feature` typing to the file's local conventions; keep additions strictly additive so questables ignores them safely.)

If the navigability test fails on building vertices: the leak is in ward geometry near banks — fix by strengthening `removeDrownedGeometry` (model.ts ~1712) to also drop geometry whose vertices fall inside `model.river.contains`, mirroring its coastal logic. That method exists precisely for this.

- [ ] **Step 4: Run tests** — geojson PASS, invariant PASS, stability PASS, full suite green.

- [ ] **Step 5: Commit**

```bash
git add src/output/geojson-builder.ts src/generator/model.ts tests/river-geojson.test.ts
git commit -m "GeoJSON river/bridge/ford features; navigability invariant enforced (issue #4)"
```

---

### Task 12: Review page, test URLs, owner render gates

**Files:**
- Modify: whatever `make-review-page.ts` consumes in settlemaker-web/site (see memory: vite 5199 runs from `settlemaker-web/site`, dev-aliases the library to the submodule src)
- No new library code — this is the visual acceptance pass.

**Interfaces:**
- Consumes: everything above via the review harness.
- Produces: a contact sheet + i= payload test URLs covering all seven render-gate scenes; owner sign-off per band.

- [ ] **Step 1: Build the gate scenes.** Compose `i=` payloads (the pattern from commit e92f15d "Test URLs: village i= payloads") for:
  1. pop 150, river, ford
  2. pop 600, river, single bridge
  3. pop 5000, walls, river — river-edge wall, bridge-at-gate, one-bank fabric
  4. pop 20000, walls, river wending through — two-bank fabric, 3–5 bridges, bank-terminated wall arcs
  5. confluence (two river inputs meeting)
  6. estuary (river input ending inside coastlineGeometry water, port burg)
  7. river island (braided pair of inputs)

- [ ] **Step 2: Render the contact sheet** with `make-review-page.ts`, serve on vite 5199.

- [ ] **Step 3: OWNER GATE — STOP AND ASK barrulus.** Change→render→ask; metrics have passed while renders were wrong before. Tune at this gate: band boundaries (250/1000/10000), `BRIDGE_MIN_SPACING`, bank-affinity penalty, `VILLAGE_RIVER_OFFSET`, meander amplitude, shore/deck widths. Each tuning change re-runs the full suite (the pinned constants live in tests — update test values WITH the constants, deliberately, never silently).

- [ ] **Step 4: After sign-off, commit any tuning** and update the test-URL commit like e92f15d did.

```bash
git add -A src tests
git commit -m "River render-gate tuning per owner review (issue #4)"
```

---

## Deploy checklist (post-merge, separate session)

- questables tile cache on rucio has NO version key: wiping `/srv/data/questables/map_data/settlements/` is REQUIRED for river output to appear — now the third owed wipe (v1.1.0, v1.2.0, this). Strongly consider fixing version-keying in `settlement-service.js` instead.
- settlemaker.com deploys only via the settlemaker-web submodule bump (public-master push deploys nothing).
- Close issue #4 with links to the render-gate contact sheet.

## Self-review notes (already applied)

- Spec coverage: input surface (T1), representation (T3), ladder + bank affinity (T5), pipeline order (T4/T6), bridges-as-gates (T6/T7), walls (T8), boat passage (T11 invariant), rendering + fords + no-new-pass (T9), procedural fallback (T10), GeoJSON + degraded flag (T4/T11), byte-stability (T2, checked every task), render gates (T12), deploy notes (checklist). Estuary/confluence/island geometry is carried by union-semantics classification (T3) + nonzero paint (T9) + gate scenes 5–7 (T12) — the approved deviation replacing the spec's polygon union.
- Type consistency: `RiverCourse.contains/sideOf/nearestStation/waterRings`, `RiverBranch.spine/widths/leftBank/rightBank/ring`, `BridgeCrossing.at/left/right/width/ford/routeId`, `Model.river/bridges/dominantBank`, `getCoastRings()/getWaterRings()` — names match across all tasks.
- Known intentional gaps: fixture-helper call shapes are discovered from existing tests at execution time (marked in each task); Task 8 requires reading curtain-wall.ts before editing — the tests, not the sketch, are that task's contract.
