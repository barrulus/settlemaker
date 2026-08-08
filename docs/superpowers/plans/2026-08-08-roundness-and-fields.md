# Roundness and Field Placement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make settlement outlines terrain-driven rather than circular by capping the walled core at `coreCapacity` people and growing the overflow along roads, and place fields against the real built edge instead of a global radius.

**Architecture:** Two pure functions — a *shape field* (function of direction, warps core selection) and an *urbanisation field* (function of position, scores extramural growth) — are consumed by existing pipeline phases. A new zoning step labels every patch `core`/`suburb`/`satellite`/`farm`/`wilderness`, and those labels reach the `Scene` as semantic data for the future symbol library.

**Tech Stack:** TypeScript (ES2022 + DOM lib), zero runtime dependencies, vitest. Dev commands run inside the nix shell.

**Spec:** `docs/superpowers/specs/2026-08-08-roundness-and-fields-design.md`

## Global Constraints

- **Zero runtime dependencies.** Everything is hand-rolled; do not add a package.
- **All commands run in the nix shell:** `nix develop --command bash -c "..."`. Tests: `nix develop --command bash -c "npx vitest run"`.
- **Determinism is non-negotiable.** Same seed + same input → byte-identical SVG. Never call `Math.random()`, `Date.now()`, or iterate a `Set`/`Map` whose insertion order depends on anything but deterministic code. All randomness comes from the model's `SeededRandom` instance.
- **Total built patches ≤ `MAX_PATCHES` (220).** Core and sprawl share this one pool. This cap was fitted to an 8-second generation budget; do not raise it.
- **`URL_PAYLOAD_VERSION` stays `1`.** All API changes are additive optional fields.
- **Output will change for every settlement, including villages.** Pinned hashes in `tests/fidelity-round4.test.ts` and `tests/toprak-regression.test.ts` must be regenerated — deliberately, in the task that causes the change, never pre-emptively.
- **`SETTLEMAKER_VERSION` bumps to `0.10.0`** in the final task (invalidates downstream tile caches).
- Angles: model space uses `atan2(y, x)` math angles. Compass bearings appear only at the input boundary. **Fields consume unit direction vectors (`RoadEntry.point`), never degrees.**
- **`coreCapacity` is a CEILING, not a target.** A settlement below the cap must not put its whole population inside the walls — faubourgs outside the gates and ribbon development along the approach roads were normal at every size. The core holds `min(population × (1 − extramuralShare(population)), coreCapacity)` people, where

  ```
  extramuralShare(pop) = clamp(0.20 + 0.1642 × (log10(pop) − log10(300)), 0.20, 0.45)
  ```

  giving ~20% outside at population 300, ~30% at 1 200, ~38.5% at 4 000, ~45% at 10 000, after which the cap binds instead. The curve is continuous, so nothing changes abruptly at the cap boundary. **These values are set by what renders as a visible skirt at small walled settlements, not by a demographic estimate** — the original curve (8% → 25%) bought a 4 000-person town only 5 patches of extramural growth, too few to ring a core, and measured 11–17 of 24 angular sectors covered against 24/24 for cities.

  **Why this is called out:** `min(population, coreCapacity)` and `population` are the SAME expression for any burg at or below the cap, so a naive `nCore` makes the sprawl budget `nPatches − nCore` evaluate to exactly zero and every settlement under 10 000 becomes 100% intramural. This was a real defect in the first implementation.

---

### Task 1: Shape field

Pure function of direction. No model, no patches — just angles in, scale out.

**Files:**
- Create: `src/generator/shape-field.ts`
- Test: `tests/shape-field.test.ts`

**Interfaces:**
- Consumes: `Point` from `../types/point.js`, `SeededRandom` from `../utils/random.js`
- Produces: `createShapeField(opts: ShapeFieldOptions): ShapeField`, where `ShapeField` has `scaleAt(angleRad: number): number`. Task 4 consumes this.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/shape-field.test.ts
import { describe, it, expect } from 'vitest';
import { createShapeField } from '../src/generator/shape-field.js';
import { Point } from '../src/types/point.js';
import { SeededRandom } from '../src/utils/random.js';

/** Unit vector for a math angle. */
function dir(angleRad: number): Point {
  return new Point(Math.cos(angleRad), Math.sin(angleRad));
}

describe('shape field', () => {
  it('elongates along road directions', () => {
    const field = createShapeField({
      roadDirections: [dir(0), dir(Math.PI)],
      probeRadius: 100,
      rng: new SeededRandom(1),
    });
    // Along the road (angle 0) vs perpendicular to it (angle pi/2).
    expect(field.scaleAt(0)).toBeGreaterThan(field.scaleAt(Math.PI / 2) * 1.2);
  });

  it('suppresses directions that meet water', () => {
    // Water occupies the entire +x half-plane beyond the origin.
    const field = createShapeField({
      roadDirections: [],
      probeRadius: 100,
      isWaterAt: (p: Point) => p.x > 10,
      rng: new SeededRandom(1),
    });
    expect(field.scaleAt(0)).toBeLessThan(field.scaleAt(Math.PI));
  });

  it('is not perfectly circular with no roads and no water', () => {
    const field = createShapeField({
      roadDirections: [],
      probeRadius: 100,
      rng: new SeededRandom(7),
    });
    const samples = Array.from({ length: 32 }, (_, i) => field.scaleAt(i * Math.PI / 16));
    const min = Math.min(...samples), max = Math.max(...samples);
    expect(max - min).toBeGreaterThan(0.05);
  });

  it('has mean scale ~1 so enclosed area is preserved', () => {
    const field = createShapeField({
      roadDirections: [dir(0), dir(2), dir(4)],
      probeRadius: 100,
      rng: new SeededRandom(3),
    });
    const samples = Array.from({ length: 64 }, (_, i) => field.scaleAt(i * Math.PI / 32));
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    expect(mean).toBeCloseTo(1, 1);
  });

  it('is deterministic for a given seed', () => {
    const build = () => createShapeField({
      roadDirections: [dir(1)],
      probeRadius: 100,
      rng: new SeededRandom(42),
    });
    expect(build().scaleAt(0.3)).toBe(build().scaleAt(0.3));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nix develop --command bash -c "npx vitest run tests/shape-field.test.ts"`
Expected: FAIL — cannot resolve `../src/generator/shape-field.js`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/generator/shape-field.ts
import { Point } from '../types/point.js';
import type { SeededRandom } from '../utils/random.js';

/** Peak radial gain directly along a road. */
const ROAD_LOBE_AMPLITUDE = 0.45;
/** Higher = tighter lobe. cos^k falloff. */
const ROAD_LOBE_SHARPNESS = 2;
/** Radial loss for a direction that is entirely water. */
const WATER_PENALTY = 0.55;
/** Per-harmonic amplitude for the organic term. */
const HARMONIC_AMPLITUDE = 0.09;
/** Clamp before normalisation — keeps pathological inputs from folding the shape inside out. */
const MIN_SCALE = 0.35;
const MAX_SCALE = 2.2;
/** Directions sampled to compute the normalisation mean. */
const NORMALISE_SAMPLES = 64;

export interface ShapeFieldOptions {
  /** Unit direction vectors of approaching roads (`RoadEntry.point`). May be empty. */
  roadDirections: Point[];
  /** Distance at which water is probed; roughly the expected core radius. */
  probeRadius: number;
  /** Water test in model coordinates. Omit for landlocked burgs. */
  isWaterAt?: (p: Point) => boolean;
  rng: SeededRandom;
}

export interface ShapeField {
  /** Radial multiplier for a math-space angle. Mean over all directions ≈ 1. */
  scaleAt(angleRad: number): number;
}

export function createShapeField(opts: ShapeFieldOptions): ShapeField {
  const { roadDirections, probeRadius, isWaterAt, rng } = opts;

  // Draw harmonic phases up front so rng consumption is fixed regardless of
  // how many times scaleAt is later called.
  const phase2 = rng.float() * Math.PI * 2;
  const phase3 = rng.float() * Math.PI * 2;

  const roadAngles = roadDirections.map(d => Math.atan2(d.y, d.x));

  /** Fraction of the probe ray that is wet, sampled at 0.6R and 1.0R. */
  function wetFraction(angleRad: number): number {
    if (isWaterAt === undefined) return 0;
    const cx = Math.cos(angleRad), cy = Math.sin(angleRad);
    let wet = 0;
    for (const t of [0.6, 1.0]) {
      if (isWaterAt(new Point(cx * probeRadius * t, cy * probeRadius * t))) wet++;
    }
    return wet / 2;
  }

  function raw(angleRad: number): number {
    let s = 1;

    for (const ra of roadAngles) {
      const c = Math.cos(angleRad - ra);
      if (c > 0) s += ROAD_LOBE_AMPLITUDE * Math.pow(c, ROAD_LOBE_SHARPNESS);
    }

    s += HARMONIC_AMPLITUDE * Math.sin(2 * angleRad + phase2);
    s += HARMONIC_AMPLITUDE * Math.sin(3 * angleRad + phase3);

    s -= WATER_PENALTY * wetFraction(angleRad);

    return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
  }

  // Normalise so the mean radial scale is 1: the core keeps the area its
  // population budget paid for, it just stops being a disc.
  let total = 0;
  for (let i = 0; i < NORMALISE_SAMPLES; i++) {
    total += raw(i * 2 * Math.PI / NORMALISE_SAMPLES);
  }
  const mean = total / NORMALISE_SAMPLES;
  const norm = mean > 0 ? 1 / mean : 1;

  return { scaleAt: (angleRad: number) => raw(angleRad) * norm };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `nix develop --command bash -c "npx vitest run tests/shape-field.test.ts"`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/generator/shape-field.ts tests/shape-field.test.ts
git commit -m "Shape field: direction-dependent radial scale from roads, water and harmonics"
```

---

### Task 2: Patch adjacency index

`Model.getNeighbours` filters all patches per call (`model.ts:1147`). Zoning and field placement need adjacency across ~1500 patches, so build the graph once.

**Files:**
- Create: `src/generator/adjacency.ts`
- Test: `tests/adjacency.test.ts`

**Interfaces:**
- Consumes: `Patch` from `./patch.js`
- Produces: `buildAdjacency(patches: Patch[]): PatchAdjacency`, where `PatchAdjacency` has `neighboursOf(patch: Patch): Patch[]` and `hopDistances(seeds: Patch[], maxHops: number): Map<Patch, number>`. Tasks 4, 6 and 8 consume this.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/adjacency.test.ts
import { describe, it, expect } from 'vitest';
import { buildAdjacency } from '../src/generator/adjacency.js';
import { Patch } from '../src/generator/patch.js';
import { Point } from '../src/types/point.js';

/** Two unit squares sharing the edge x=1, plus a detached third square. */
function grid(): { a: Patch; b: Patch; far: Patch } {
  const p00 = new Point(0, 0), p10 = new Point(1, 0);
  const p11 = new Point(1, 1), p01 = new Point(0, 1);
  const p20 = new Point(2, 0), p21 = new Point(2, 1);
  // Shared vertices are the SAME object — Polygon compares by identity.
  const a = new Patch([p00, p10, p11, p01]);
  const b = new Patch([p10, p20, p21, p11]);
  const far = new Patch([new Point(9, 9), new Point(10, 9), new Point(10, 10)]);
  return { a, b, far };
}

describe('patch adjacency', () => {
  it('links patches that share an edge', () => {
    const { a, b, far } = grid();
    const adj = buildAdjacency([a, b, far]);
    expect(adj.neighboursOf(a)).toContain(b);
    expect(adj.neighboursOf(b)).toContain(a);
  });

  it('does not link detached patches', () => {
    const { a, b, far } = grid();
    const adj = buildAdjacency([a, b, far]);
    expect(adj.neighboursOf(far)).toHaveLength(0);
  });

  it('computes hop distance from seeds', () => {
    const { a, b, far } = grid();
    const adj = buildAdjacency([a, b, far]);
    const d = adj.hopDistances([a], 5);
    expect(d.get(a)).toBe(0);
    expect(d.get(b)).toBe(1);
    expect(d.has(far)).toBe(false);
  });

  it('respects maxHops', () => {
    const { a, b, far } = grid();
    const adj = buildAdjacency([a, b, far]);
    const d = adj.hopDistances([a], 0);
    expect(d.get(a)).toBe(0);
    expect(d.has(b)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nix develop --command bash -c "npx vitest run tests/adjacency.test.ts"`
Expected: FAIL — cannot resolve `../src/generator/adjacency.js`.

- [ ] **Step 3: Write the implementation**

Patches share vertex *objects* (the codebase compares vertices by identity, `===`), so a vertex→patch index finds candidates in near-linear time. Two patches are neighbours when they share two or more vertices.

```typescript
// src/generator/adjacency.ts
import type { Patch } from './patch.js';
import type { Point } from '../types/point.js';

export interface PatchAdjacency {
  /** Patches sharing an edge. Stable order: the order given to buildAdjacency. */
  neighboursOf(patch: Patch): Patch[];
  /** BFS hop counts from any seed, inclusive of seeds at 0. Unreachable patches are absent. */
  hopDistances(seeds: Patch[], maxHops: number): Map<Patch, number>;
}

export function buildAdjacency(patches: Patch[]): PatchAdjacency {
  const index = new Map<Patch, number>();
  patches.forEach((p, i) => index.set(p, i));

  // Vertex identity → patches touching it.
  const byVertex = new Map<Point, Patch[]>();
  for (const patch of patches) {
    for (const v of patch.shape.vertices) {
      const bucket = byVertex.get(v);
      if (bucket === undefined) byVertex.set(v, [patch]);
      else bucket.push(patch);
    }
  }

  const neighbours = new Map<Patch, Patch[]>();
  for (const patch of patches) {
    const shared = new Map<Patch, number>();
    for (const v of patch.shape.vertices) {
      for (const other of byVertex.get(v) ?? []) {
        if (other === patch) continue;
        shared.set(other, (shared.get(other) ?? 0) + 1);
      }
    }
    // Two or more shared vertices means a shared edge, not a corner touch.
    const list = [...shared.entries()]
      .filter(([, count]) => count >= 2)
      .map(([p]) => p)
      .sort((x, y) => index.get(x)! - index.get(y)!);
    neighbours.set(patch, list);
  }

  return {
    neighboursOf: (patch: Patch) => neighbours.get(patch) ?? [],
    hopDistances(seeds: Patch[], maxHops: number): Map<Patch, number> {
      const dist = new Map<Patch, number>();
      let frontier: Patch[] = [];
      for (const s of seeds) {
        if (!dist.has(s)) { dist.set(s, 0); frontier.push(s); }
      }
      for (let hop = 1; hop <= maxHops && frontier.length > 0; hop++) {
        const next: Patch[] = [];
        for (const p of frontier) {
          for (const n of neighbours.get(p) ?? []) {
            if (!dist.has(n)) { dist.set(n, hop); next.push(n); }
          }
        }
        frontier = next;
      }
      return dist;
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `nix develop --command bash -c "npx vitest run tests/adjacency.test.ts"`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/generator/adjacency.ts tests/adjacency.test.ts
git commit -m "Patch adjacency index: vertex-identity graph with BFS hop distances"
```

---

### Task 3: `coreCapacity` input and the split patch budget

Plumbing only — no shape change yet, so existing output must stay byte-identical at the end of this task.

**Files:**
- Modify: `src/input/azgaar-input.ts` (interface, `populationToPatches`, `mapToGenerationParams`)
- Modify: `src/generator/generation-params.ts` (add `coreCapacity`, `nCore`)
- Modify: `src/url/params.ts:75-78` (`FLAT_DATA_PARAMS`) and the flat burg literal at `:137`
- Test: `tests/core-capacity.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `DEFAULT_CORE_CAPACITY = 10000` and `corePatchCount(population, coreCapacity, urbanDensity?): number` exported from `src/input/azgaar-input.ts`; `GenerationParams.nCore: number` (total mesh budget stays `nPatches`). Task 4 consumes both.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/core-capacity.test.ts
import { describe, it, expect } from 'vitest';
import { mapToGenerationParams, corePatchCount, DEFAULT_CORE_CAPACITY, MAX_PATCHES } from '../src/input/azgaar-input.js';
import { parseSettlementUrl } from '../src/url/params.js';
import type { AzgaarBurgInput } from '../src/index.js';

function burg(population: number, coreCapacity?: number): AzgaarBurgInput {
  return {
    name: 'Capsford', population,
    port: false, citadel: false, walls: true,
    plaza: true, temple: false, shanty: false, capital: false,
    ...(coreCapacity !== undefined ? { coreCapacity } : {}),
  };
}

describe('coreCapacity', () => {
  it('defaults to 10000', () => {
    expect(DEFAULT_CORE_CAPACITY).toBe(10000);
  });

  it('caps core size once population exceeds the capacity', () => {
    const atCap = corePatchCount(10000, DEFAULT_CORE_CAPACITY);
    const wayOver = corePatchCount(250000, DEFAULT_CORE_CAPACITY);
    expect(wayOver).toBe(atCap);
  });

  it('leaves small settlements uncapped', () => {
    expect(corePatchCount(800, DEFAULT_CORE_CAPACITY))
      .toBeLessThan(corePatchCount(9000, DEFAULT_CORE_CAPACITY));
  });

  it('honours an explicit capacity', () => {
    expect(corePatchCount(250000, 40000)).toBeGreaterThan(corePatchCount(250000, 10000));
  });

  it('keeps nCore within the total budget', () => {
    const params = mapToGenerationParams(burg(250000));
    expect(params.nCore).toBeLessThanOrEqual(params.nPatches);
    expect(params.nPatches).toBeLessThanOrEqual(MAX_PATCHES);
  });

  it('is accepted as a flat URL param', async () => {
    const parsed = await parseSettlementUrl(new URLSearchParams('pop=250000&coreCapacity=40000'));
    expect(parsed.burg.coreCapacity).toBe(40000);
  });

  it('ignores a non-positive flat coreCapacity', async () => {
    const parsed = await parseSettlementUrl(new URLSearchParams('pop=1000&coreCapacity=0'));
    expect(parsed.burg.coreCapacity).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nix develop --command bash -c "npx vitest run tests/core-capacity.test.ts"`
Expected: FAIL — `corePatchCount` / `DEFAULT_CORE_CAPACITY` are not exported.

- [ ] **Step 3: Add the input field and the split budget**

In `src/input/azgaar-input.ts`, add to the `AzgaarBurgInput` interface after `urbanDensity`:

```typescript
  /**
   * People the walled core may hold. Population beyond this grows outside
   * the walls along roads. Default DEFAULT_CORE_CAPACITY (10 000) — walls
   * historically enclosed a core, not an entire metropolis.
   */
  coreCapacity?: number;
```

Add alongside `MAX_PATCHES`:

```typescript
/** People a walled core holds unless the caller says otherwise. */
export const DEFAULT_CORE_CAPACITY = 10000;

/**
 * Patches in the walled core. Population above `coreCapacity` does not
 * enlarge the core — it becomes extramural sprawl (see `urbanisation.ts`).
 */
export function corePatchCount(
  population: number,
  coreCapacity: number,
  urbanDensity?: number,
): number {
  return populationToPatches(Math.min(population, coreCapacity), urbanDensity);
}
```

In `mapToGenerationParams`, add to the returned object (leave `nPatches` exactly as it is — it remains the total budget):

```typescript
    nCore: corePatchCount(
      burg.population,
      burg.coreCapacity ?? DEFAULT_CORE_CAPACITY,
      burg.urbanDensity,
    ),
```

In `src/generator/generation-params.ts`, add to `GenerationParams` after `nPatches`:

```typescript
  /**
   * Patches in the walled core. `nPatches` is the TOTAL built budget (core
   * plus extramural sprawl); this is the core's share of it.
   */
  nCore: number;
```

- [ ] **Step 4: Add the flat URL param**

In `src/url/params.ts`, extend `FLAT_DATA_PARAMS` (line 75) to include `'coreCapacity'`, and in the flat burg literal add after the `urbanDensity` line:

```typescript
      ...(coreCapacity !== undefined && coreCapacity > 0 ? { coreCapacity } : {}),
```

with, next to the existing `const urbanDensity = num(params, 'urbanDensity');`:

```typescript
    const coreCapacity = num(params, 'coreCapacity');
```

- [ ] **Step 5: Run the new test and the full suite**

Run: `nix develop --command bash -c "npx vitest run"`
Expected: PASS. `tests/core-capacity.test.ts` passes; **every existing test still passes unchanged** — nothing reads `nCore` yet, so output is byte-identical. If a pinned hash moved here, something consumed `nCore` prematurely; fix that rather than regenerating the hash.

- [ ] **Step 6: Commit**

```bash
git add src/input/azgaar-input.ts src/generator/generation-params.ts src/url/params.ts tests/core-capacity.test.ts
git commit -m "coreCapacity input and nCore budget split (plumbing only, output unchanged)"
```

---

### Task 4: Warped core selection and the connectivity pass

This is the task that makes settlements non-round. Output changes here.

**Files:**
- Modify: `src/generator/model.ts` — `buildPatches` (`:316-372`), constructor (`:174`), `buildWalls` (`:415`)
- Test: `tests/roundness.test.ts`

**Interfaces:**
- Consumes: `createShapeField` (Task 1), `buildAdjacency` (Task 2), `GenerationParams.nCore` (Task 3).
- Produces: `Model.shapeField: ShapeField`, `Model.nCore: number`, and `Model.adjacency: PatchAdjacency` (built after `buildPatches`). Tasks 6 and 8 consume `adjacency`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/roundness.test.ts
import { describe, it, expect } from 'vitest';
import { generateFromBurg, type AzgaarBurgInput } from '../src/index.js';
import { Polygon } from '../src/geom/polygon.js';

function crossroads(population: number, seed: number): AzgaarBurgInput {
  return {
    name: `Crossford${seed}`, population,
    port: false, citadel: false, walls: true,
    plaza: true, temple: false, shanty: false, capital: false,
    roadBearings: [0, 90, 180, 270],
  };
}

describe('core outline is not a disc', () => {
  it.each([1, 2, 3, 4, 5])('seed %i: walled core is measurably non-circular', (seed) => {
    const { model } = generateFromBurg(crossroads(4000, seed), { seed });
    const outline = new Polygon(model.border!.shape.vertices);
    // 1.0 is a perfect circle. Measured pre-change baseline over these seeds:
    // min 0.858, median 0.889, max 0.951. The bar sits well below the old
    // minimum so passing it proves the shape field did real work.
    expect(outline.compactness).toBeLessThan(0.75);
  });

  it('elongates along the road axis when roads are opposed', () => {
    const burg: AzgaarBurgInput = {
      name: 'Ribbonford', population: 4000,
      port: false, citadel: false, walls: true,
      plaza: true, temple: false, shanty: false, capital: false,
      roadBearings: [90, 270],   // due east and due west
    };
    const { model } = generateFromBurg(burg, { seed: 11 });
    const vs = model.border!.shape.vertices;
    const spanX = Math.max(...vs.map(v => v.x)) - Math.min(...vs.map(v => v.x));
    const spanY = Math.max(...vs.map(v => v.y)) - Math.min(...vs.map(v => v.y));
    expect(spanX).toBeGreaterThan(spanY * 1.15);
  });

  it('keeps the core connected', () => {
    const { model } = generateFromBurg(crossroads(4000, 9), { seed: 9 });
    // Every inner patch must be reachable from the first by adjacency.
    const reached = model.adjacency.hopDistances([model.inner[0]], model.inner.length);
    const innerReached = model.inner.filter(p => reached.has(p)).length;
    expect(innerReached).toBe(model.inner.length);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nix develop --command bash -c "npx vitest run tests/roundness.test.ts"`
Expected: FAIL — compactness ≈ 0.9x (still a disc), and `model.adjacency` is undefined.

- [ ] **Step 3: Warp the selection metric**

In `src/generator/model.ts`, add the imports:

```typescript
import { createShapeField, type ShapeField } from './shape-field.js';
import { buildAdjacency, type PatchAdjacency } from './adjacency.js';
```

Add fields to the class next to `nPatches`:

```typescript
  private nCore: number;
  /** Direction-dependent radial scale; warps core selection away from a disc. */
  shapeField: ShapeField | null = null;
  /** Built once per buildPatches pass. Null before phase 1 completes. */
  adjacency: PatchAdjacency | null = null;
```

In the constructor after `this.nPatches = params.nPatches;`:

```typescript
    this.nCore = Math.min(params.nCore, params.nPatches);
```

Replace the sort and selection in `buildPatches`. The current body between `let voronoi = Voronoi.build(points);` and the region loop keeps its relaxation; only the sort changes, and the selection count becomes `nCore`:

```typescript
    // Estimated core radius from the spiral seeding (r ≈ 10 + i·2.5), used
    // only to probe water at a plausible distance.
    const probeRadius = 10 + this.nCore * 2.5;
    this.shapeField = createShapeField({
      roadDirections: (this.params.roadEntryPoints ?? []).map(r => r.point),
      probeRadius,
      ...(this.getWaterRings().length > 0 ? { isWaterAt: (p: Point) => this.isWaterAt(p) } : {}),
      rng,
    });
    const field = this.shapeField;

    /** Distance warped by the shape field: small = "belongs in the core". */
    const warped = (p: Point): number => p.length / field.scaleAt(Math.atan2(p.y, p.x));

    voronoi.points.sort((p1, p2) => sign(warped(p1) - warped(p2)));
```

Then in the region loop, replace every comparison against `this.nPatches` with `this.nCore`:

```typescript
      } else if (count === this.nCore && this.citadelNeeded) {
```
```typescript
      if (count < this.nCore) {
```

And relaxation's guard likewise:

```typescript
      if (this.nCore < voronoi.points.length) {
        toRelax.push(voronoi.points[this.nCore]);
      }
```

- [ ] **Step 4: Add the connectivity pass**

Warped selection can pick a core in two pieces, which is exactly what makes `findCircumference` walk a wrong boundary. Add at the end of `buildPatches`:

```typescript
    this.adjacency = buildAdjacency(this.patches);
    this.enforceCoreConnectivity();
```

And the method:

```typescript
  /**
   * Keep only the connected component of `inner` containing the centre,
   * then top up from adjacent unselected patches until nCore is reached.
   * A disconnected core makes findCircumference walk a spurious boundary
   * (the round-4 failure mode), so this runs before buildWalls.
   */
  private enforceCoreConnectivity(): void {
    if (this.inner.length === 0) return;
    const adj = this.adjacency!;
    const innerSet = new Set(this.inner);

    // Flood-fill from the centre patch through inner patches only.
    const seed = this.inner[0];
    const connected = new Set<Patch>([seed]);
    let frontier = [seed];
    while (frontier.length > 0) {
      const next: Patch[] = [];
      for (const p of frontier) {
        for (const n of adj.neighboursOf(p)) {
          if (innerSet.has(n) && !connected.has(n)) { connected.add(n); next.push(n); }
        }
      }
      frontier = next;
    }

    if (connected.size === this.inner.length) return;

    // Drop strays, then grow back to nCore through adjacency so the count
    // (and so the population the core holds) is preserved.
    for (const p of this.inner) {
      if (!connected.has(p)) { p.withinCity = false; p.withinWalls = false; }
    }
    this.inner = this.inner.filter(p => connected.has(p));

    while (this.inner.length < this.nCore) {
      const candidates = new Set<Patch>();
      for (const p of this.inner) {
        for (const n of adj.neighboursOf(p)) {
          if (!connected.has(n)) candidates.add(n);
        }
      }
      if (candidates.size === 0) break;
      const best = minBy([...candidates], (p: Patch) => p.shape.center.length);
      connected.add(best);
      best.withinCity = true;
      best.withinWalls = this.wallsNeeded;
      this.inner.push(best);
    }
  }
```

- [ ] **Step 5: Run the roundness test**

Run: `nix develop --command bash -c "npx vitest run tests/roundness.test.ts"`
Expected: PASS, 3 tests. If compactness sits above 0.86, raise `ROAD_LOBE_AMPLITUDE` in `shape-field.ts` — do not weaken the assertion.

- [ ] **Step 6: Run the full suite and regenerate pinned hashes**

Run: `nix develop --command bash -c "npx vitest run"`
Expected: FAIL in `tests/fidelity-round4.test.ts` and `tests/toprak-regression.test.ts` — pinned hashes moved. **This is the intended, spec-approved fallout.** For each failure, confirm the diff is a shape change and not a crash or an empty render, then update the pinned hash to the newly measured value in the test file. Re-run until green.

- [ ] **Step 7: Commit**

```bash
git add src/generator/model.ts tests/roundness.test.ts tests/fidelity-round4.test.ts tests/toprak-regression.test.ts
git commit -m "Warp core selection by the shape field; cores are lobed, not discs

Selection sorts by |p| / shapeField.scaleAt(theta) instead of raw |p|, and
takes nCore rather than nPatches. Adds a connectivity pass so a split core
never reaches findCircumference. Pinned hashes regenerated: this changes
output for every settlement, as designed."
```

---

### Task 5: Urbanisation field

Pure function of position. Ribbons, belt and satellites are all features of this one scalar field.

**Files:**
- Create: `src/generator/urbanisation.ts`
- Test: `tests/urbanisation.test.ts`

**Interfaces:**
- Consumes: `Point`.
- Produces: `createUrbanisationField(opts: UrbanisationOptions): UrbanisationField` with `scoreAt(p: Point): number`, and `SATELLITE_POP_THRESHOLD = 50000`. Task 6 consumes both.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/urbanisation.test.ts
import { describe, it, expect } from 'vitest';
import { createUrbanisationField } from '../src/generator/urbanisation.js';
import { Point } from '../src/types/point.js';

const eastward = () => createUrbanisationField({
  roadDirections: [new Point(1, 0)],
  coreRadius: 100,
  reach: 400,
  corridorHalfWidth: 40,
  satellites: false,
  satelliteSpacing: 150,
});

describe('urbanisation field', () => {
  it('scores on-road points above off-road points at the same distance', () => {
    const f = eastward();
    expect(f.scoreAt(new Point(200, 0))).toBeGreaterThan(f.scoreAt(new Point(0, 200)));
  });

  it('decays with distance along the road', () => {
    const f = eastward();
    expect(f.scoreAt(new Point(150, 0))).toBeGreaterThan(f.scoreAt(new Point(350, 0)));
  });

  it('decays with perpendicular offset', () => {
    const f = eastward();
    expect(f.scoreAt(new Point(200, 0))).toBeGreaterThan(f.scoreAt(new Point(200, 60)));
  });

  it('scores nothing inside the core radius', () => {
    const f = eastward();
    expect(f.scoreAt(new Point(50, 0))).toBe(0);
  });

  it('scores nothing beyond reach when satellites are off', () => {
    const f = eastward();
    expect(f.scoreAt(new Point(600, 0))).toBe(0);
  });

  it('places satellite bumps along the road beyond reach when enabled', () => {
    const f = createUrbanisationField({
      roadDirections: [new Point(1, 0)],
      coreRadius: 100, reach: 400, corridorHalfWidth: 40,
      satellites: true, satelliteSpacing: 150,
    });
    // On-ray at the first bump beats off-ray at the same distance.
    expect(f.scoreAt(new Point(550, 0))).toBeGreaterThan(f.scoreAt(new Point(0, 550)));
  });

  it('overlapping corridors sum, producing a belt between close roads', () => {
    const f = createUrbanisationField({
      roadDirections: [new Point(1, 0), new Point(0.966, 0.259)],  // 15 degrees apart
      coreRadius: 100, reach: 400, corridorHalfWidth: 40,
      satellites: false, satelliteSpacing: 150,
    });
    const between = f.scoreAt(new Point(197, 26));   // between the two rays
    const outside = f.scoreAt(new Point(193, -52));  // same distance, outside both
    expect(between).toBeGreaterThan(outside);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nix develop --command bash -c "npx vitest run tests/urbanisation.test.ts"`
Expected: FAIL — cannot resolve `../src/generator/urbanisation.js`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/generator/urbanisation.ts
import { Point } from '../types/point.js';

/** Population above which outlying hamlets appear along the road corridors. */
export const SATELLITE_POP_THRESHOLD = 50000;
/** Satellite bumps to emit per road, each weaker than the last. */
const SATELLITE_COUNT = 3;
/** Score multiplier per successive satellite. */
const SATELLITE_FALLOFF = 0.6;

export interface UrbanisationOptions {
  /** Unit direction vectors of approaching roads (`RoadEntry.point`). */
  roadDirections: Point[];
  /** Sprawl starts outside this radius — inside it is the core's business. */
  coreRadius: number;
  /** Distance at which continuous ribbon growth has decayed to nothing. */
  reach: number;
  /** Perpendicular distance at which a corridor has decayed to ~37%. */
  corridorHalfWidth: number;
  satellites: boolean;
  /** Gap between satellite bumps beyond `reach`. */
  satelliteSpacing: number;
}

export interface UrbanisationField {
  /** Built-ness at a point. 0 means "not a candidate for sprawl". */
  scoreAt(p: Point): number;
}

export function createUrbanisationField(opts: UrbanisationOptions): UrbanisationField {
  const { roadDirections, coreRadius, reach, corridorHalfWidth, satellites, satelliteSpacing } = opts;
  const span = Math.max(1, reach - coreRadius);

  function scoreAt(p: Point): number {
    let score = 0;

    for (const d of roadDirections) {
      const along = p.x * d.x + p.y * d.y;
      if (along <= coreRadius) continue;

      const perpX = p.x - along * d.x;
      const perpY = p.y - along * d.y;
      const perp = Math.sqrt(perpX * perpX + perpY * perpY);
      const lateral = Math.exp(-(perp * perp) / (corridorHalfWidth * corridorHalfWidth));

      // Continuous ribbon: linear decay from the core out to `reach`.
      if (along < reach) {
        score += lateral * (1 - (along - coreRadius) / span);
      }

      // Satellites: gaussian bumps further out on the SAME ray, so outlying
      // hamlets are on-road by construction.
      if (satellites) {
        for (let k = 1; k <= SATELLITE_COUNT; k++) {
          const centre = reach + k * satelliteSpacing;
          const t = (along - centre) / (satelliteSpacing * 0.5);
          score += lateral * Math.exp(-t * t) * Math.pow(SATELLITE_FALLOFF, k);
        }
      }
    }

    return score;
  }

  return { scoreAt };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `nix develop --command bash -c "npx vitest run tests/urbanisation.test.ts"`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/generator/urbanisation.ts tests/urbanisation.test.ts
git commit -m "Urbanisation field: road corridors, overlap belts and on-ray satellites"
```

---

### Task 6: Zoning — grow the sprawl

**Files:**
- Create: `src/generator/zoning.ts`
- Modify: `src/generator/patch.ts` (add `zone`)
- Modify: `src/generator/model.ts` — `buildWalls` radius filter (`:451`), `createWards` outskirts probability (`:835`), new zoning call
- Test: `tests/zoning.test.ts`

**Interfaces:**
- Consumes: `createUrbanisationField`, `SATELLITE_POP_THRESHOLD` (Task 5); `PatchAdjacency` (Task 2); `Model.inner`, `Model.adjacency`.
- Produces: `Zone` type (`'core' | 'suburb' | 'satellite' | 'farm' | 'wilderness'`), `assignSprawl(args: SprawlArgs): UrbanisationField` (it returns the field it built), `Patch.zone: Zone`, and `Model.urbanisationField: UrbanisationField | null`. Tasks 7, 8 and 9 consume these.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/zoning.test.ts
import { describe, it, expect } from 'vitest';
import { generateFromBurg, type AzgaarBurgInput } from '../src/index.js';
import { MAX_PATCHES } from '../src/input/azgaar-input.js';

function metropolis(roadBearings: number[]): AzgaarBurgInput {
  return {
    name: 'Sprawlington', population: 250000,
    port: false, citadel: true, walls: true,
    plaza: true, temple: true, shanty: true, capital: false,
    roadBearings,
  };
}

describe('zoning', () => {
  it('grows suburbs outside the walls for a metropolis', () => {
    const { model } = generateFromBurg(metropolis([0, 120, 240]), { seed: 5 });
    const suburbs = model.patches.filter(p => p.zone === 'suburb');
    expect(suburbs.length).toBeGreaterThan(20);
  });

  it('keeps the walled core small regardless of population', () => {
    const { model } = generateFromBurg(metropolis([0, 120, 240]), { seed: 5 });
    const small = generateFromBurg({ ...metropolis([0, 120, 240]), population: 10000 }, { seed: 5 });
    // A 250k city's core is no bigger than a 10k city's core.
    expect(model.inner.length).toBeLessThanOrEqual(small.model.inner.length + 2);
  });

  it('never exceeds the total built patch budget', () => {
    const { model } = generateFromBurg(metropolis([0, 120, 240]), { seed: 5 });
    const built = model.patches.filter(p => p.zone === 'core' || p.zone === 'suburb' || p.zone === 'satellite');
    expect(built.length).toBeLessThanOrEqual(MAX_PATCHES);
  });

  it('puts every suburb within reach of a road', () => {
    const { model } = generateFromBurg(metropolis([90]), { seed: 5 });
    // One road due east: no suburb may sit to the west of the core.
    const suburbs = model.patches.filter(p => p.zone === 'suburb');
    expect(suburbs.length).toBeGreaterThan(0);
    expect(suburbs.every(p => p.shape.center.x > -model.border!.getRadius())).toBe(true);
  });

  it('falls back to a belt when the burg has no roads', () => {
    const { model } = generateFromBurg({ ...metropolis([]), roadBearings: [] }, { seed: 5 });
    const built = model.patches.filter(p => p.zone === 'suburb');
    expect(built.length).toBeGreaterThan(20);
  });

  it('emits satellites only above the population threshold', () => {
    const big = generateFromBurg(metropolis([0, 180]), { seed: 5 });
    const small = generateFromBurg({ ...metropolis([0, 180]), population: 12000 }, { seed: 5 });
    expect(big.model.patches.some(p => p.zone === 'satellite')).toBe(true);
    expect(small.model.patches.some(p => p.zone === 'satellite')).toBe(false);
  });

  it('builds nothing on water', () => {
    const port: AzgaarBurgInput = {
      ...metropolis([0, 120]), port: true, oceanBearing: 90, harbourSize: 'large',
    };
    const { model } = generateFromBurg(port, { seed: 5 });
    const built = model.patches.filter(p => p.zone === 'suburb' || p.zone === 'satellite');
    expect(built.every(p => !model.isWaterAt(p.shape.center))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nix develop --command bash -c "npx vitest run tests/zoning.test.ts"`
Expected: FAIL — `p.zone` is undefined everywhere.

- [ ] **Step 3: Add the zone field to Patch**

In `src/generator/patch.ts`, import the type and add the property:

```typescript
import type { Zone } from './zoning.js';
```
```typescript
  /** Settlement role. Set by zoning; drives ward choice, fields and symbols. */
  zone: Zone = 'wilderness';
```

- [ ] **Step 4: Write the zoning module**

```typescript
// src/generator/zoning.ts
import type { Patch } from './patch.js';
import type { PatchAdjacency } from './adjacency.js';
import { Point } from '../types/point.js';
import { createUrbanisationField, SATELLITE_POP_THRESHOLD, type UrbanisationField } from './urbanisation.js';

export type Zone = 'core' | 'suburb' | 'satellite' | 'farm' | 'wilderness';

/** Ribbon reach as a multiple of the core radius. */
const REACH_MULTIPLIER = 4;
/** Corridor half-width as a fraction of the core radius. */
const CORRIDOR_FRACTION = 0.45;
/** Extra score for touching already-built fabric — this is what fuses ribbons into a belt. */
const NEIGHBOUR_BONUS = 0.35;
/** Beyond this multiple of the core radius, a built patch reads as an outlying hamlet. */
const SATELLITE_DISTANCE = 4;

export interface SprawlArgs {
  patches: Patch[];
  inner: Patch[];
  adjacency: PatchAdjacency;
  roadDirections: Point[];
  coreRadius: number;
  population: number;
  /** Patches to leave alone: water, and anything already given a ward. */
  isBuildable: (patch: Patch) => boolean;
  /** How many patches sprawl may claim (total budget minus the core). */
  budget: number;
}

/**
 * Label every patch. The core is already chosen; this grows extramural
 * fabric outward along road corridors, greedily and one patch at a time so
 * that the neighbour bonus can fuse crowded ribbons into a continuous belt.
 *
 * Returns the field it built so callers (and tests) can score patches
 * against the very field that produced the zoning, rather than rebuilding
 * it from constants that may later be tuned.
 */
export function assignSprawl(args: SprawlArgs): UrbanisationField {
  const { patches, inner, adjacency, roadDirections, coreRadius, population, isBuildable, budget } = args;

  for (const p of patches) p.zone = 'wilderness';
  for (const p of inner) p.zone = 'core';

  const satellites = population >= SATELLITE_POP_THRESHOLD;
  const reach = coreRadius * REACH_MULTIPLIER;

  // No roads is a real case (roadBearings: [] is authoritative). Fall back to
  // a ring of directions so the overflow forms a belt rather than a disc of
  // the same shape as the core.
  const directions = roadDirections.length > 0
    ? roadDirections
    : Array.from({ length: 6 }, (_, i) => {
        const a = i * Math.PI / 3;
        return new Point(Math.cos(a), Math.sin(a));
      });

  const field = createUrbanisationField({
    roadDirections: directions,
    coreRadius,
    reach,
    corridorHalfWidth: Math.max(1, coreRadius * CORRIDOR_FRACTION),
    satellites,
    satelliteSpacing: coreRadius,
  });

  // Nothing to claim (core already fills the budget) — the field is still
  // returned so callers can score against it.
  if (budget <= 0) return field;

  const candidates = patches.filter(p => p.zone === 'wilderness' && isBuildable(p));
  const base = new Map<Patch, number>();
  for (const p of candidates) base.set(p, field.scoreAt(p.shape.center));

  const built = new Set<Patch>(inner);
  const remaining = candidates.filter(p => (base.get(p) ?? 0) > 0);

  for (let claimed = 0; claimed < budget && remaining.length > 0; claimed++) {
    let bestIdx = -1;
    let bestScore = 0;
    for (let i = 0; i < remaining.length; i++) {
      const p = remaining[i];
      let score = base.get(p)!;
      for (const n of adjacency.neighboursOf(p)) {
        if (built.has(n)) { score += NEIGHBOUR_BONUS; break; }
      }
      if (score > bestScore) { bestScore = score; bestIdx = i; }
    }
    if (bestIdx === -1) break;

    const chosen = remaining.splice(bestIdx, 1)[0];
    built.add(chosen);
    chosen.zone = chosen.shape.center.length > coreRadius * SATELLITE_DISTANCE
      ? 'satellite'
      : 'suburb';
    chosen.withinCity = true;
  }

  return field;
}
```

- [ ] **Step 5: Call zoning from the model and fix the radius cull**

In `src/generator/model.ts`, import:

```typescript
import { assignSprawl } from './zoning.js';
import type { UrbanisationField } from './urbanisation.js';
```

Add the field to the class next to `adjacency`:

```typescript
  /** The field zoning used to place sprawl. Null before createWards runs. */
  urbanisationField: UrbanisationField | null = null;
```

`buildWalls` culls patches beyond `radius * 3` (`:451`). With a small core that radius collapses and would delete the countryside the sprawl needs. Replace that filter with one keyed off sprawl reach:

```typescript
    // Sprawl reaches ~4x the core radius along roads, plus satellites beyond
    // that; keep enough countryside for both, and for the farm belt outside
    // them. (Was `radius * 3`, which assumed the wall bounded the settlement.)
    const keepRadius = radius * 12;
    this.patches = this.patches.filter(p => p.shape.distance(this.center) < keepRadius);
```

In `createWards`, the outskirts probability `1 / (this.nPatches - 5)` (`:835`) assumed `nPatches` meant the inner city. Point it at the core:

```typescript
        if (!rng.bool(1 / Math.max(2, this.nCore - 5))) {
```

Then call zoning at the start of `createWards`, before wards are assigned, so ward selection can see the zones:

```typescript
    this.urbanisationField = assignSprawl({
      patches: this.patches,
      inner: this.inner,
      adjacency: this.adjacency!,
      roadDirections: (this.params.roadEntryPoints ?? []).map(r => r.point),
      coreRadius: this.border!.getRadius(),
      population: this.params.population,
      isBuildable: (p) => p.ward === null && !this.waterbody.includes(p) && !this.isWaterAt(p.shape.center),
      budget: Math.max(0, this.nPatches - this.inner.length),
    });
```

Suburb and satellite patches now need wards. In `createWards`, after the existing inner-city assignment loop and before `this.buildFarms()`, add:

```typescript
    // Extramural fabric: ordinary wards, denser near the walls, poorer further out.
    for (const patch of this.patches) {
      if (patch.ward !== null) continue;
      if (patch.zone === 'suburb') patch.ward = new CommonWard(this, patch);
      else if (patch.zone === 'satellite') patch.ward = new Slum(this, patch);
    }
```

- [ ] **Step 6: Run the zoning test**

Run: `nix develop --command bash -c "npx vitest run tests/zoning.test.ts"`
Expected: PASS, 7 tests.

- [ ] **Step 7: Run the full suite and regenerate pinned hashes**

Run: `nix develop --command bash -c "npx vitest run"`
Expected: pinned-hash failures again in `tests/fidelity-round4.test.ts` and `tests/toprak-regression.test.ts`. Confirm each diff is a shape/zoning change, then update the pinned values. Re-run until green.

- [ ] **Step 8: Commit**

```bash
git add src/generator/zoning.ts src/generator/patch.ts src/generator/model.ts tests/zoning.test.ts tests/fidelity-round4.test.ts tests/toprak-regression.test.ts
git commit -m "Zoning: ribbons, belt and satellites grow outside the walls

Sprawl claims the total budget minus the core, greedily by urbanisation
score plus a neighbour bonus that fuses crowded ribbons into a belt.
Roadless burgs fall back to a six-direction belt. buildWalls' radius*3 cull
becomes radius*12 — it assumed the wall bounded the settlement."
```

---

### Task 7: Fields hug the built edge

**Files:**
- Modify: `src/generator/model.ts` — `buildFarms` (`:855-888`)
- Test: `tests/field-placement.test.ts`

**Interfaces:**
- Consumes: `Patch.zone` (Task 6), `Model.adjacency` (Task 4).
- Produces: `Model.farmRingDepth: number` and `Patch.ringDepth: number` (hops from built fabric, 0 for built patches). Task 8 consumes `ringDepth`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/field-placement.test.ts
import { describe, it, expect } from 'vitest';
import { generateFromBurg, WardType, type AzgaarBurgInput } from '../src/index.js';

function farmtown(roadBearings: number[], population = 4000): AzgaarBurgInput {
  return {
    name: 'Fieldbury', population,
    port: false, citadel: false, walls: true,
    plaza: true, temple: false, shanty: false, capital: false,
    roadBearings,
  };
}

describe('field placement', () => {
  it('always produces fields on every side', () => {
    // The old sinusoid could go negative over an arc and blank out one side.
    const { model } = generateFromBurg(farmtown([0, 90, 180, 270]), { seed: 3 });
    const farms = model.patches.filter(p => p.ward?.type === WardType.Farm);
    const quadrants = new Set(farms.map(p => {
      const c = p.shape.center;
      return `${c.x >= 0 ? 'E' : 'W'}${c.y >= 0 ? 'N' : 'S'}`;
    }));
    expect(quadrants.size).toBe(4);
  });

  it('places fields adjacent to built fabric, not at a fixed radius', () => {
    const { model } = generateFromBurg(farmtown([90, 270]), { seed: 4 });
    const farms = model.patches.filter(p => p.ward?.type === WardType.Farm);
    expect(farms.length).toBeGreaterThan(0);
    // Every farm is within the configured ring depth of something built.
    expect(farms.every(p => p.ringDepth > 0 && p.ringDepth <= model.farmRingDepth)).toBe(true);
  });

  it('does not put fields inside road corridors', () => {
    const { model } = generateFromBurg(farmtown([90, 270], 120000), { seed: 6 });
    const farms = model.patches.filter(p => p.ward?.type === WardType.Farm);
    const suburbs = model.patches.filter(p => p.zone === 'suburb');
    expect(farms.length).toBeGreaterThan(0);
    expect(suburbs.length).toBeGreaterThan(0);

    // The design promise: subtracting built(p) pushes fields OUT of the
    // corridors and into the wedges between ribbons. Compare the two
    // populations against the very field the model used, so tuning the
    // zoning constants cannot silently invalidate this test.
    const field = model.urbanisationField!;
    const mean = (ps: typeof farms) =>
      ps.reduce((sum, p) => sum + field.scoreAt(p.shape.center), 0) / ps.length;
    expect(mean(farms)).toBeLessThan(mean(suburbs) * 0.5);
  });

  it('never places fields on water', () => {
    const port: AzgaarBurgInput = { ...farmtown([0, 180]), port: true, oceanBearing: 90 };
    const { model } = generateFromBurg(port, { seed: 8 });
    const farms = model.patches.filter(p => p.ward?.type === WardType.Farm);
    expect(farms.every(p => !model.isWaterAt(p.shape.center))).toBe(true);
  });

  it('gives larger populations a deeper field belt', () => {
    const small = generateFromBurg(farmtown([0, 180], 600), { seed: 2 });
    const large = generateFromBurg(farmtown([0, 180], 40000), { seed: 2 });
    expect(large.model.farmRingDepth).toBeGreaterThan(small.model.farmRingDepth);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nix develop --command bash -c "npx vitest run tests/field-placement.test.ts"`
Expected: FAIL — `ringDepth` and `farmRingDepth` do not exist.

- [ ] **Step 3: Add ringDepth to Patch**

In `src/generator/patch.ts`:

```typescript
  /** Adjacency hops from the nearest built patch. 0 = built. -1 = unreached. */
  ringDepth: number = -1;
```

- [ ] **Step 4: Rewrite buildFarms**

Replace the whole body of `buildFarms` in `src/generator/model.ts`. The sinusoid, its unbounded `a`/`b` amplitudes and the global `cityRadius` comparison all go; `cityRadius` itself stays as a public field because other code reports it.

```typescript
  /**
   * Fields hug the built edge. A patch is farmland when it is near built
   * fabric but not itself built, measured in adjacency hops rather than by
   * radius — a radius cannot track a lobed outline, which is what left the
   * old sinusoidal belt detached from the short axis of an elongated town.
   * Depth scales with population: more mouths, more fields.
   */
  private buildFarms(): void {
    const rng = this.rng;

    this.cityRadius = 0;
    for (const patch of this.patches) {
      if (patch.withinCity) {
        for (const v of patch.shape.vertices) {
          this.cityRadius = Math.max(this.cityRadius, v.length);
        }
      }
    }

    const built = this.patches.filter(
      p => p.zone === 'core' || p.zone === 'suburb' || p.zone === 'satellite',
    );
    this.farmRingDepth = this.params.population >= 20000 ? 3
      : this.params.population >= 2000 ? 2
      : 1;

    const hops = this.adjacency!.hopDistances(built, this.farmRingDepth);
    for (const patch of this.patches) {
      patch.ringDepth = hops.get(patch) ?? -1;
    }

    for (const patch of this.patches) {
      if (patch.withinCity || patch.ward !== null || this.waterbody.includes(patch)) continue;
      if (this.isWaterAt(patch.shape.center)) { patch.ward = new Ward(this, patch); continue; }

      // Within the belt, and not itself built. A single rng draw per patch
      // keeps the outer edge ragged instead of a uniform offset curve.
      const depth = patch.ringDepth;
      const inBelt = depth > 0 && depth <= this.farmRingDepth;
      if (inBelt && rng.bool(depth === this.farmRingDepth ? 0.6 : 0.95)) {
        patch.zone = 'farm';
        patch.ward = new Farm(this, patch);
      } else {
        patch.ward = new Ward(this, patch);
      }
    }
  }
```

Add the field to the class next to `cityRadius`:

```typescript
  /** Adjacency-hop depth of the farm belt; scales with population. */
  farmRingDepth: number = 1;
```

- [ ] **Step 5: Run the field test**

Run: `nix develop --command bash -c "npx vitest run tests/field-placement.test.ts"`
Expected: PASS, 5 tests.

- [ ] **Step 6: Run the full suite, regenerate hashes**

Run: `nix develop --command bash -c "npx vitest run"`
Expected: pinned-hash failures; confirm and update as in Task 4 Step 6.

- [ ] **Step 7: Commit**

```bash
git add src/generator/model.ts src/generator/patch.ts tests/field-placement.test.ts tests/fidelity-round4.test.ts tests/toprak-regression.test.ts
git commit -m "Fields hug the built edge by adjacency hops, not a global radius

Drops the sinusoidal belt whose unbounded amplitudes could blank out one
side entirely, and whose single cityRadius could not track a lobed outline."
```

---

### Task 8: Zone data reaches the Scene

The hook the symbol library will key off. Symbols themselves are out of scope.

**Files:**
- Modify: `src/scene/scene.ts` (`BuildingFeature`, `FieldPlot`, `SCENE_VERSION`)
- Modify: `src/scene/build-scene.ts:82` (building emit) and the field emit
- Test: `tests/scene.test.ts` (extend)

**Interfaces:**
- Consumes: `Patch.zone` (Task 6), `Patch.ringDepth` (Task 7).
- Produces: `BuildingFeature.zone: Zone` and `FieldPlot.ringDepth: number` in the Scene contract.

- [ ] **Step 1: Write the failing test**

Append to `tests/scene.test.ts`:

```typescript
// `generateFromBurg` returns no scene — build it from the model, exactly as
// the existing tests at the top of this file do.
describe('scene carries zone semantics for the symbol library', () => {
  it('tags buildings with their zone', () => {
    const result = generateFromBurg({
      name: 'Zoneville', population: 120000,
      port: false, citadel: false, walls: true,
      plaza: true, temple: false, shanty: false, capital: false,
      roadBearings: [0, 120, 240],
    }, { seed: 5 });
    const scene = buildScene(result.model, { shift: result.originShift });
    const zones = new Set(scene.layers.buildings.map(b => b.zone));
    expect(zones.has('core')).toBe(true);
    expect(zones.has('suburb')).toBe(true);
  });

  it('tags field plots with their ring depth', () => {
    const result = generateFromBurg({
      name: 'Plotville', population: 4000,
      port: false, citadel: false, walls: true,
      plaza: true, temple: false, shanty: false, capital: false,
      roadBearings: [0, 180],
    }, { seed: 5 });
    const scene = buildScene(result.model, { shift: result.originShift });
    expect(scene.layers.fields.length).toBeGreaterThan(0);
    expect(scene.layers.fields.every(f => f.ringDepth >= 1)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nix develop --command bash -c "npx vitest run tests/scene.test.ts"`
Expected: FAIL — `zone` and `ringDepth` are not on the emitted features.

- [ ] **Step 3: Extend the Scene contract**

In `src/scene/scene.ts`, import the zone type and extend both interfaces, then bump the version:

```typescript
import type { Zone } from '../generator/zoning.js';
```
```typescript
export interface FieldPlot {
  ring: ScenePoint[];
  /** Furrow-hatch direction in degrees, from the plot's OBB. */
  angleDeg: number;
  /** Adjacency hops from built fabric — 1 is closest in. Selects near-vs-far crops. */
  ringDepth: number;
}
```
```typescript
export interface BuildingFeature {
  ring: ScenePoint[];
  /** Ward type string (WardType value) — semantic, drives styling/symbols. */
  kind: string;
  /** Settlement role: core fabric, ribbon suburb, outlying hamlet. */
  zone: Zone;
  landmark: boolean;
}
```

Bump `SCENE_VERSION` to the next integer.

- [ ] **Step 4: Emit the new data**

In `src/scene/build-scene.ts`, the building emit at `:82` gains `zone: patch.zone` (use whichever variable holds the patch in that loop), and the field-plot emit gains `ringDepth: patch.ringDepth`.

- [ ] **Step 5: Run the suite**

Run: `nix develop --command bash -c "npx vitest run"`
Expected: PASS. `tests/assemble-svg.test.ts` may need its fixture objects updated with the new required properties — update them; do not make the properties optional.

- [ ] **Step 6: Commit**

```bash
git add src/scene/scene.ts src/scene/build-scene.ts tests/scene.test.ts tests/assemble-svg.test.ts
git commit -m "Scene carries zone and ringDepth — the hook for the symbol library"
```

---

### Task 9: Performance guard and the roundness baseline

**Files:**
- Create: `tests/roundness-perf.test.ts`
- Test: itself

**Interfaces:**
- Consumes: everything above.
- Produces: nothing consumed downstream.

- [ ] **Step 1: Write the test**

```typescript
// tests/roundness-perf.test.ts
import { describe, it, expect } from 'vitest';
import { generateFromBurg, type AzgaarBurgInput } from '../src/index.js';
import { MAX_PATCHES } from '../src/input/azgaar-input.js';

function megacity(seed: number): AzgaarBurgInput {
  return {
    name: `Megaford${seed}`, population: 250000,
    port: false, citadel: true, walls: true,
    plaza: true, temple: true, shanty: true, capital: false,
    roadBearings: [0, 72, 144, 216, 288],
  };
}

describe('sprawl stays inside the generation budget', () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])('seed %i generates within 8s', (seed) => {
    const start = performance.now();
    const { model } = generateFromBurg(megacity(seed), { seed });
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(8000);
    const built = model.patches.filter(
      p => p.zone === 'core' || p.zone === 'suburb' || p.zone === 'satellite',
    );
    expect(built.length).toBeLessThanOrEqual(MAX_PATCHES);
  }, 20000);

  it('is deterministic: same seed renders identically twice', () => {
    const a = generateFromBurg(megacity(3), { seed: 3 });
    const b = generateFromBurg(megacity(3), { seed: 3 });
    expect(a.svg).toBe(b.svg);
  });
});
```

- [ ] **Step 2: Run it**

Run: `nix develop --command bash -c "npx vitest run tests/roundness-perf.test.ts"`
Expected: PASS. If any seed exceeds 8s, reduce `REACH_MULTIPLIER` in `zoning.ts` or the `keepRadius` multiplier in `buildWalls` — both control how much countryside the mesh carries — and re-run. Do not raise the timeout.

- [ ] **Step 3: Commit**

```bash
git add tests/roundness-perf.test.ts
git commit -m "Perf guard: 250k sprawl stays inside the 8s budget across 10 seeds"
```

---

### Task 10: Documentation and version bump

**Files:**
- Modify: `package.json` (version → `0.10.0`)
- Modify: `src/index.ts` if `SETTLEMAKER_VERSION` is a literal there
- Modify: `docs/url-api.md` (§3 interface block, §4 flat table, §6 guarantees)
- Modify: `docs/scene-schema.md` (zone/ringDepth)
- Modify: `docs/test-urls.md` known-issues section
- Modify: `web/src/builder.ts` and `web/index.html` (coreCapacity control)

- [ ] **Step 1: Bump the version**

Set `package.json` version to `0.10.0`. Confirm `SETTLEMAKER_VERSION` follows it (it is hashed into the generation version, which invalidates downstream tile caches — that is intended).

Run: `nix develop --command bash -c "npx vitest run"`
Expected: PASS — unless a test pins the version string, in which case update it.

- [ ] **Step 2: Update the URL API doc**

In `docs/url-api.md`:

1. §3 — re-copy the `AzgaarBurgInput` block verbatim from `src/input/azgaar-input.ts` so `coreCapacity` appears with its comment.
2. §4 — add the row and update the count sentence to "all 16 flat data params":

```markdown
| `coreCapacity` | number | `10000` | people the walled core may hold; overflow grows outside the walls along roads. Only kept if `> 0` |
```

3. §6 — replace the final paragraph of the population-budget bullet. The old text says the walled area grows with population; that is no longer true and it is the one substantive contract change in this round:

```markdown
  **The walls bound the core, not the settlement.** A settlement holds at
  most `coreCapacity` people (default 10 000) inside its walls; population
  beyond that grows *outside* them, as ribbon suburbs along the supplied
  road bearings, merging into a continuous belt where those ribbons crowd
  together, and — above population 50 000 — as outlying satellite hamlets
  further along the same roads. A 250 000-person city therefore renders as a
  modest walled core inside extensive extramural sprawl, not as a giant
  walled disc. Burgs with `roadBearings: []` have no corridors to grow
  along and instead form a belt around the core. Total built patches remain
  capped at 220, shared between core and sprawl.
```

- [ ] **Step 3: Update the scene schema doc**

In `docs/scene-schema.md`, document `BuildingFeature.zone` (`core`/`suburb`/`satellite`) and `FieldPlot.ringDepth`, and note the `SCENE_VERSION` bump. State that these are the semantic hooks the symbol library will select on.

- [ ] **Step 4: Update known issues**

In `docs/test-urls.md`, remove "Settlement outlines are still quite circular" from the known-issues list — this round fixes it. Leave the harbour, pier, `.furrow` and palette entries.

- [ ] **Step 5: Add the builder control**

In `web/index.html` add a `coreCapacity` number input (default 10000) alongside the population field, and in `web/src/builder.ts` include it in the burg object it composes when the value is present and `> 0`, matching how `urbanDensity` is handled.

Run: `nix develop --command bash -c "cd web && npx vite build"`
Expected: build succeeds.

- [ ] **Step 6: Regenerate the test URLs**

Run: `nix develop --command bash -c "npx tsx generate-test-urls.ts"`
Expected: `docs/test-urls.md` rewritten. Add a metropolis entry to `generate-test-urls.ts` first if none exercises sprawl — a pop-250 000 burg with 4 road bearings.

- [ ] **Step 7: Full verification**

Run: `nix develop --command bash -c "npx vitest run"`
Expected: PASS, all files.

Run: `nix develop --command bash -c "npx tsc --noEmit"`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add package.json src/index.ts docs/ web/
git commit -m "0.10.0: document coreCapacity and extramural growth, bump scene version

url-api.md §6 no longer claims the walled area grows with population — the
walls bound a coreCapacity-sized core and overflow grows along roads."
```

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| Shape field (roads, water, harmonics, normalised) | 1 |
| Warped core selection | 4 |
| Urbanisation field (ribbons, belt, satellites) | 5 |
| Zoning labels | 6 |
| Fields hug built edge by hops | 7 |
| `coreCapacity` default 10 000, flat param | 3 |
| Total built ≤ 220, one pool | 3 (budget), 6 (enforcement), 9 (test) |
| Mesh sized from total budget | 3 — `nPatches` unchanged as the total; `nCore` is the new split |
| `radius × 3` cull fixed | 6 |
| `nPatches` uses audited | 4 (relaxation, citadel, inner), 6 (outskirts) |
| Roadless fallback | 6 |
| Disconnected core guard | 4 |
| Scene `zone` + `SCENE_VERSION` | 8 |
| Compactness metric pinned | 4 |
| Core population tolerance | 6 |
| Suburbs within corridors, none in water | 6 |
| 8s budget re-verified | 9 |
| Pinned hashes regenerated, version bump | 4, 6, 7 (hashes), 10 (version) |
| Symbols out of scope | stated in Task 8 |

**Deviation from the spec, deliberate:** the spec says `FieldPlot` gains `zone`. Every field plot is by definition in the `farm` zone, so that carries no information; `ringDepth` (hops from built fabric) is emitted instead, which is what actually lets the symbol library choose orchards near the town against open crop further out. `BuildingFeature.zone` is as specified.

**Placeholder scan:** none — every code step contains the code to write, every test step the assertions, every run step the command and expected result.

**Type consistency:** `ShapeField.scaleAt`, `PatchAdjacency.neighboursOf`/`hopDistances`, `UrbanisationField.scoreAt`, `assignSprawl(SprawlArgs)`, `Zone`, `Patch.zone`, `Patch.ringDepth`, `Model.farmRingDepth`, `corePatchCount`, `DEFAULT_CORE_CAPACITY`, `GenerationParams.nCore` are each defined once and referenced consistently downstream.

**Known ordering constraint:** Tasks 1–3 are independent of each other and can run in parallel. Task 4 needs 1, 2, 3. Task 6 needs 4 and 5. Task 7 needs 6. Tasks 8 and 9 need 7.
