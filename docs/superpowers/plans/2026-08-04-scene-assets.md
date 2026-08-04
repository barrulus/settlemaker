# Scene, Assets & Density Implementation Plan (Plan B of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Settlements look like a home for X people (density targeting), and rendering is restructured into the spec's scene → asset-set → assembler architecture with the FMG-aligned group/style contract, biome and trade inputs included.

**Architecture:** Task 1 tunes generation (households-driven patch count + one adaptive density refinement pass). Tasks 2–5 build the pipeline the spec mandates: a versioned semantic `Scene` extracted from `Model` (Task 2), an assembler that renders SVG *from the scene* into named groups styled by a `<style>` block (Task 3), an asset-set registry with a starter tree symbol and scene vegetation instances (Task 4), and `biome`/`trade` inputs steering defaults (Task 5). `generateSvg` keeps its exact public signature as a thin wrapper, so questables and the tiler are untouched. Spec: `docs/superpowers/specs/2026-08-04-netlify-pivot-design.md` (sections: Architecture overview, SVG style contract, Biome and trade, Assets).

**Tech Stack:** TypeScript (strict), vitest, zero runtime dependencies. No new packages.

## Global Constraints

- Run everything through the nix shell: `nix develop --command bash -c "<cmd>"` from the repo root.
- Zero runtime dependencies — no new packages, devDependencies included.
- Determinism: same input → byte-identical SVG. New randomness must come from `SeededRandom` seeded arithmetically from `params.seed` (never `Math.random`), and must not perturb the existing model rng stream unless the task explicitly says the layout is allowed to change (Task 1 changes layouts by design).
- **Hard rule from the spec:** after Task 3, the SVG builder renders *from the scene, never from model internals.* `assembleSvg(scene, …)` must not import `Model`.
- The `data-bg="paper"` rect keeps its attribute markup and inline `fill` — contract with `cropSvgToTile` (`src/output/settlement-tiler.ts`).
- `SvgOptions` keeps every existing option working: `palette`, `padding`, `theme`, `shift`, `clipId`.
- Group ids are the spec contract, in paint order: `#fields #greens #water #roads #shadows #buildings #landmarks #walls`. Theme colors/opacity live in one `<style>` block keyed to those groups; per-element geometric values (path data, individual stroke-widths for road lanes, shadow transform) may stay attributes.
- Float assertions use `toBeCloseTo`, never `toBe`.
- Do not add `Co-Authored-By` lines to commit messages.
- Suite is 307 tests green at start; every task ends green (updating stale expectations is in-scope where a task says so, with the decision rule given there).

## File Structure

- `src/input/azgaar-input.ts` — MODIFY: households-driven `populationToPatches`; `biome`/`trade` fields (Tasks 1, 5)
- `src/generator/model.ts` — MODIFY: `minSqScale`, `refineDensity`, `countOrdinaryBuildings` (Task 1)
- `src/wards/common-ward.ts` — MODIFY: apply `minSqScale` (Task 1)
- `src/scene/scene.ts` — CREATE: scene types + `SCENE_VERSION` (Task 2)
- `src/scene/build-scene.ts` — CREATE: `buildScene(model, opts)` (Tasks 2, 4)
- `src/output/assemble-svg.ts` — CREATE: `themeToCss` + `assembleSvg(scene, opts)` (Tasks 3, 4)
- `src/output/svg-builder.ts` — MODIFY: `generateSvg` becomes wrapper; paint passes deleted (Task 3)
- `src/assets/asset-sets.ts` — CREATE: `AssetSet`, starter set, biome lookups (Task 4)
- `src/output/render-theme.ts` — MODIFY: `treeFill` slot (Task 4)
- `src/generator/generation-params.ts` — MODIFY: `biome` (Task 5)
- `src/index.ts` — MODIFY: new exports (Tasks 2–5)
- Tests: `tests/density-target.test.ts`, `tests/scene.test.ts`, `tests/assemble-svg.test.ts`, `tests/asset-sets.test.ts`, `tests/biome-trade.test.ts` — CREATE
- `docs/scene-schema.md` — CREATE (Task 6): the artist/integrator-facing contract

---

### Task 1: Density targeting — buildings ≈ households

Today pop 1200 yields ~80 buildings; watabou's own ratio (Lukewharf pop 200 ≈ 50 buildings) says ≈ 1 per 4–5 people. Two mechanisms: (a) patch count derives from the household target (`buildingBudget`, Plan A) instead of raw population bands; (b) one adaptive refinement pass shrinks `minSq` when the first geometry build lands far under target. Layout changes for existing seeds are expected and intended.

**Files:**
- Modify: `src/input/azgaar-input.ts` (populationToPatches, ~line 66)
- Modify: `src/generator/model.ts` (buildGeometry, new methods)
- Modify: `src/wards/common-ward.ts` (createGeometry, line 26)
- Test: `tests/density-target.test.ts` (create)

**Interfaces:**
- Consumes: `buildingBudget(population, urbanDensity?)` (exported from `src/generator/model.ts`, Plan A), `BUDGET_EXEMPT_WARD_TYPES` (module-private there), `CommonWard` (`src/wards/common-ward.ts`).
- Produces: `Model.minSqScale: number` (default 1; read by `CommonWard.createGeometry`); `BUILDINGS_PER_PATCH = 9` exported from `src/input/azgaar-input.ts` (calibration constant — Task 6 may adjust within 7–12).

- [ ] **Step 1: Write the failing test**

Create `tests/density-target.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { generateFromBurg, WardType, type AzgaarBurgInput, type Model } from '../src/index.js';
import { buildingBudget } from '../src/generator/model.js';

const EXEMPT = new Set<WardType>([
  WardType.Castle, WardType.Cathedral, WardType.Market, WardType.Harbour, WardType.Park,
]);

function countOrdinaryBuildings(model: Model): number {
  let n = 0;
  for (const patch of model.patches) {
    if (!patch.ward || EXEMPT.has(patch.ward.type)) continue;
    n += patch.ward.geometry.length;
  }
  return n;
}

function inland(population: number): AzgaarBurgInput {
  return {
    name: `Densitown${population}`,
    population,
    port: false, citadel: false, walls: population >= 2000,
    plaza: true, temple: false, shanty: false, capital: false,
  };
}

describe('density targeting: buildings ≈ households', () => {
  it.each([60, 350, 1200, 4500])('pop %i lands within [60%, 100%] of target', (pop) => {
    const { model } = generateFromBurg(inland(pop));
    const target = buildingBudget(pop);
    const n = countOrdinaryBuildings(model);
    expect(n).toBeGreaterThanOrEqual(Math.floor(target * 0.6));
    expect(n).toBeLessThanOrEqual(target); // Plan A cap still binds from above
  });

  it('urbanDensity moves the target', () => {
    const dense = generateFromBurg({ ...inland(1200), urbanDensity: 3 });
    const sparse = generateFromBurg({ ...inland(1200), urbanDensity: 8 });
    expect(countOrdinaryBuildings(dense.model)).toBeGreaterThan(countOrdinaryBuildings(sparse.model));
  });

  it('tiny burgs keep the patch floor (no degenerate meshes)', () => {
    const { model } = generateFromBurg(inland(13));
    expect(model.patches.length).toBeGreaterThanOrEqual(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nix develop --command bash -c "npx vitest run tests/density-target.test.ts"`
Expected: FAIL — pop 1200/4500 counts land far below 60% of target.

- [ ] **Step 3: Households-driven patch count**

`src/input/azgaar-input.ts` — replace `populationToPatches` (keep the name; delete the old population-band doc comment):

```typescript
/**
 * Calibration: observed ordinary-buildings-per-patch at default minSq.
 * Task 6 of this plan may tune within [7, 12] after visual review.
 */
export const BUILDINGS_PER_PATCH = 9;

/**
 * Patch count derives from the household target (pop / urbanDensity) so the
 * settlement's footprint scales with how many buildings it must hold —
 * "looks like a home for X people". Floor 3 keeps tiny meshes viable
 * (Voronoi with <3 patches degenerates); cap 60 bounds cost for
 * metropolises, where the adaptive minSq refinement makes up the rest.
 */
function populationToPatches(population: number, urbanDensity?: number): number {
  const households = Math.max(2, Math.round(population / (urbanDensity ?? 4)));
  return Math.max(3, Math.min(60, Math.ceil(households / BUILDINGS_PER_PATCH)));
}
```

and in `mapToGenerationParams` change the call site:

```typescript
    nPatches: populationToPatches(burg.population, burg.urbanDensity),
```

- [ ] **Step 4: Adaptive minSq refinement in Model**

`src/generator/model.ts`:

Add `CommonWard` to the ward imports:

```typescript
import { CommonWard } from '../wards/common-ward.js';
```

Add the field near `syntheticCoast`:

```typescript
  /**
   * Multiplier applied to CommonWard minSq during geometry builds. Set by
   * refineDensity's second pass to shrink block size when the first build
   * lands far below the household target; 1 otherwise.
   */
  minSqScale = 1;
```

(also reset `this.minSqScale = 1;` inside `reset()`).

Change `buildGeometry` and add the two methods:

```typescript
  // Phase 6: Build geometry
  private buildGeometry(): void {
    for (const patch of this.patches) {
      if (patch.ward && !this.waterbody.includes(patch)) {
        patch.ward.createGeometry();
      }
    }
    this.refineDensity();
    this.removeDrownedGeometry();
    this.applyBuildingBudget();
  }

  private countOrdinaryBuildings(): number {
    let n = 0;
    for (const patch of this.patches) {
      const ward = patch.ward;
      if (!ward || ward.type === WardType.Park || BUDGET_EXEMPT_WARD_TYPES.has(ward.type)) continue;
      n += ward.geometry.length;
    }
    return n;
  }

  /**
   * One adaptive pass toward the household target: patch geometry cannot
   * know in advance how many buildings subdivision will yield, so if the
   * first build lands under 65% of target, shrink CommonWard block size
   * (minSqScale ≈ count/target ⇒ new count ≈ target) and rebuild ordinary
   * wards once. Deterministic — extra rng draws, fixed sequence per seed.
   * Runs before the drowning filter (target is approximate on coasts).
   */
  private refineDensity(): void {
    const target = buildingBudget(this.params.population, this.params.urbanDensity);
    const count = this.countOrdinaryBuildings();
    if (count === 0 || count >= target * 0.65) return;

    this.minSqScale = Math.max(0.25, count / target);
    for (const patch of this.patches) {
      if (patch.ward instanceof CommonWard && !this.waterbody.includes(patch)) {
        patch.ward.createGeometry();
      }
    }
    this.minSqScale = 1;
  }
```

`src/wards/common-ward.ts` line 26 — apply the scale:

```typescript
    this.geometry = createAlleys(block, this.rng, this.minSq * this.model.minSqScale, this.gridChaos, this.sizeChaos, this.emptyProb);
```

- [ ] **Step 5: Run the new test to verify it passes**

Run: `nix develop --command bash -c "npx vitest run tests/density-target.test.ts"`
Expected: PASS. If a population misses the 60% floor, do NOT weaken the assertion: first check whether `refineDensity` triggered (add a temporary log); if it triggered and still undershot, lower the trigger threshold 0.65 → 0.8; if patch counts are the limiter, adjust `BUILDINGS_PER_PATCH` within [7, 12]. Record what you changed in the report.

- [ ] **Step 6: Full suite + reconciliation**

Run: `nix develop --command bash -c "npx vitest run"`

Layouts change for any population whose patch count moved — expected and intended. Decision rule: assertions about *structure and invariants* (counts > 0, roads == routes, water membership, determinism, budget ≤ cap) must pass unchanged — investigate failures there as real bugs. Assertions pinning *exact emergent values* (a specific building count, a specific POI on a specific building, an exact SVG byte string) may be re-derived — but only after regenerating and eyeballing the affected fixture via `compare-versions.ts` (add a temporary case if needed). List every re-derived value in the report.

- [ ] **Step 7: Visual calibration check**

Run: `nix develop --command bash -c "npx tsx compare-versions.ts"` and inspect `output/compare/index.html` (rasterize panels with sharp if headless — see repo history for the snippet). Check: pop 350 Saltmere reads as a village of ~75–88 houses; pop 4500 Grimhaven reads dense but not confetti (buildings should not be absurdly tiny — if they are, prefer more patches via `BUILDINGS_PER_PATCH` ↓ over deeper minSq shrink via trigger ↑). Record a rasterized before/after pair in the report.

- [ ] **Step 8: Commit**

```bash
git add src/input/azgaar-input.ts src/generator/model.ts src/wards/common-ward.ts tests/density-target.test.ts
git commit -m "Derive patch count from household target; adaptive minSq refinement toward density"
```

(Plus any re-derived test files, listed in the message body.)

---

### Task 2: Scene schema — semantic extraction from Model

The versioned `Scene` is the long-term AFMG contract: typed features with meaning, in **output-frame coordinates** (shift already applied), extracted from `Model` by one pure function. No rendering here.

**Files:**
- Create: `src/scene/scene.ts`
- Create: `src/scene/build-scene.ts`
- Modify: `src/index.ts` (exports)
- Test: `tests/scene.test.ts` (create)

**Interfaces:**
- Consumes: `Model` public surface (`patches`, `arteries`, `roads`, `wall`, `border`, `citadel`, `getWaterRings()`, `syntheticCoast`), `computeLocalBounds`, `applyOutputShift`/`NO_SHIFT` (`src/generator/origin-shift.ts`), `Farm`/`Harbour`/`Castle` ward classes, `LANDMARK_STROKE`-equivalent landmark set {castle, cathedral, market}, `GateMeta` from `border.gateMeta`.
- Produces: `SCENE_VERSION = 1`; `interface Scene`; `buildScene(model: Model, opts?: { shift?: OriginShift; padding?: number }): Scene`. Task 3's assembler consumes exactly these; Task 4 appends `vegetation`.

- [ ] **Step 1: Write the scene types**

Create `src/scene/scene.ts`:

```typescript
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

export interface FieldPlot { ring: ScenePoint[] }
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
    furrows: Furrow[];
    greens: GreenFeature[];
    vegetation: VegetationInstance[];
    roads: RoadFeature[];
    buildings: BuildingFeature[];
    piers: PierFeature[];
    walls: WallFeature[];
  };
}
```

- [ ] **Step 2: Write buildScene**

Create `src/scene/build-scene.ts`:

```typescript
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
```

- [ ] **Step 3: Write the failing test**

Create `tests/scene.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { generateFromBurg } from '../src/index.js';
import { buildScene } from '../src/scene/build-scene.js';
import { SCENE_VERSION } from '../src/scene/scene.js';
import { toprak } from './fixtures/toprak.js';

describe('buildScene', () => {
  const result = generateFromBurg(toprak);
  const scene = buildScene(result.model, { shift: result.originShift });

  it('carries version, identity, and bounds', () => {
    expect(scene.version).toBe(SCENE_VERSION);
    expect(scene.population).toBe(13);
    expect(scene.bounds.max_x).toBeGreaterThan(scene.bounds.min_x);
  });

  it('water rings are output-frame (match the fixture coastline)', () => {
    expect(scene.layers.water.rings.length).toBe(1);
    expect(scene.layers.water.synthetic).toBe(false);
    const xs = scene.layers.water.rings[0].map(p => p.x);
    expect(Math.min(...xs)).toBeCloseTo(40, 0); // fixture shoreline
  });

  it('roads carry kinds; buildings carry ward kinds', () => {
    expect(scene.layers.roads.filter(r => r.kind === 'road').length).toBe(1);
    expect(scene.layers.buildings.length).toBeGreaterThan(0);
    for (const b of scene.layers.buildings) {
      expect(typeof b.kind).toBe('string');
      expect(b.ring.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('is pure: building twice gives deep-equal scenes', () => {
    const again = buildScene(result.model, { shift: result.originShift });
    expect(again).toEqual(scene);
  });

  it('synthetic flag set for oceanBearing burgs', () => {
    const bearing = generateFromBurg({ ...toprak, name: 'ToprakB', coastlineGeometry: undefined, oceanBearing: 90 });
    const s2 = buildScene(bearing.model, { shift: bearing.originShift });
    expect(s2.layers.water.synthetic).toBe(true);
    expect(s2.layers.water.rings.length).toBe(1);
  });
});
```

- [ ] **Step 4: Run tests, export, verify pass**

Add to `src/index.ts`:

```typescript
export { SCENE_VERSION } from './scene/scene.js';
export type {
  Scene, ScenePoint, WaterLayer, FieldPlot, Furrow, GreenFeature,
  VegetationInstance, RoadFeature, BuildingFeature, PierFeature,
  WallFeature, WallGate,
} from './scene/scene.js';
export { buildScene } from './scene/build-scene.js';
export type { BuildSceneOptions } from './scene/build-scene.js';
```

Run: `nix develop --command bash -c "npx vitest run tests/scene.test.ts && npx vitest run"`
Expected: new tests PASS; full suite stays green (nothing existing changed).

- [ ] **Step 5: Commit**

```bash
git add src/scene/ src/index.ts tests/scene.test.ts
git commit -m "Scene v1: versioned semantic extraction from Model"
```

---

### Task 3: Assembler — scene-driven SVG with the group/style contract

`assembleSvg(scene, opts)` replaces the paint passes: named groups in paint order, one `<style>` block from the theme, no theme colors as inline attributes. `generateSvg(model, options)` keeps its exact signature as `buildScene` + `assembleSvg`, so every caller (index.ts, tiler, tests, questables) is untouched at the API level. The SVG *markup* changes shape — reconciliation of markup-grepping tests is in-scope and guided below.

**Files:**
- Create: `src/output/assemble-svg.ts`
- Modify: `src/output/svg-builder.ts` (gut to a wrapper; delete paint passes and `outerWaterEdges`)
- Modify: `src/index.ts` (export `assembleSvg`, `themeToCss`)
- Test: `tests/assemble-svg.test.ts` (create)
- Reconcile: `tests/svg-render.test.ts`, `tests/toprak-regression.test.ts`, `tests/water-geometry.test.ts`, `tests/settlement-tiler.test.ts`

**Interfaces:**
- Consumes: `Scene` (Task 2), `RenderTheme`/`themeFrom`/`PALETTES` (existing).
- Produces:
  - `assembleSvg(scene: Scene, options?: AssembleOptions): string` where `AssembleOptions = { palette?: Palette; theme?: Partial<RenderTheme>; clipId?: string; assetSet?: AssetSet }` (`assetSet` lands in Task 4 — declare it now as optional, unused, typed `unknown` until then is NOT allowed; instead omit the field entirely in this task and add it in Task 4).
  - `themeToCss(theme: RenderTheme): string`.
  - Markup contract (Task 4 + Plan C depend on it): groups `<g id="fields|greens|water|roads|shadows|buildings|landmarks|walls">` in that order (empty groups may be omitted); water fill path is `<path class="fill" d="…" fill-rule="evenodd"/>`; shore is `<path class="shore" d="…"/>`; road lanes are `<path class="casing|core" stroke-width="…"/>`; buildings `<path class="<kind>"/>`; landmark strokes via classes `.castle/.cathedral/.market`; piers `<path class="pier"/>`; gate bars `<line class="gate"/>`.

- [ ] **Step 1: Write the failing structure test**

Create `tests/assemble-svg.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { generateFromBurg, generateSvg } from '../src/index.js';
import { toprak } from './fixtures/toprak.js';

const GROUP_ORDER = ['fields', 'greens', 'water', 'roads', 'shadows', 'buildings', 'landmarks', 'walls'];

describe('assembleSvg group/style contract', () => {
  const { svg, model } = generateFromBurg({ ...toprak, name: 'Contract', population: 400, plaza: true });

  it('emits the spec groups in paint order', () => {
    const present = GROUP_ORDER
      .map(id => ({ id, at: svg.indexOf(`<g id="${id}"`) }))
      .filter(g => g.at !== -1);
    expect(present.map(g => g.id)).toContain('buildings');
    expect(present.map(g => g.id)).toContain('water');
    const positions = present.map(g => g.at);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('has one style block carrying theme colors; buildings carry no inline fill', () => {
    expect(svg.match(/<style>/g)?.length).toBe(1);
    const buildingsGroup = svg.match(/<g id="buildings">([\s\S]*?)<\/g>/)![1];
    expect(buildingsGroup).not.toContain('fill="');
  });

  it('theme overrides land in the style block', () => {
    const themed = generateSvg(model, { theme: { buildingFill: '#123456' } });
    expect(themed).toContain('#123456');
    const buildingsGroup = themed.match(/<g id="buildings">([\s\S]*?)<\/g>/)![1];
    expect(buildingsGroup).not.toContain('#123456'); // in <style>, not inline
  });

  it('keeps the data-bg contract and clipId', () => {
    expect(svg).toContain('data-bg="paper"');
    expect(svg).toMatch(/<rect data-bg="paper" x="-?[\d.]+" y="-?[\d.]+" width="[\d.]+" height="[\d.]+" fill="#/);
    const custom = generateSvg(model, { clipId: 'abc' });
    expect(custom).toContain('<clipPath id="abc">');
    expect(custom).toContain('clip-path="url(#abc)"');
  });

  it('is deterministic', () => {
    expect(generateSvg(model)).toBe(generateSvg(model));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `nix develop --command bash -c "npx vitest run tests/assemble-svg.test.ts"`
Expected: FAIL — no `<g id=`, no `<style>`.

- [ ] **Step 3: Write the assembler**

Create `src/output/assemble-svg.ts`:

```typescript
import type { Palette } from '../types/interfaces.js';
import type { Scene, ScenePoint } from '../scene/scene.js';
import { PALETTES } from './palette.js';
import { themeFrom, type RenderTheme } from './render-theme.js';

const NORMAL_STROKE = 0.15;
const THICK_STROKE = 1.8;

export interface AssembleOptions {
  palette?: Palette;
  theme?: Partial<RenderTheme>;
  clipId?: string;
}

function fmt(n: number): string { return n.toFixed(2); }

function ringPath(ring: ScenePoint[]): string {
  if (ring.length === 0) return '';
  const parts = [`M${fmt(ring[0].x)},${fmt(ring[0].y)}`];
  for (let i = 1; i < ring.length; i++) parts.push(`L${fmt(ring[i].x)},${fmt(ring[i].y)}`);
  parts.push('Z');
  return parts.join('');
}

function linePath(pts: ScenePoint[]): string {
  if (pts.length === 0) return '';
  const parts = [`M${fmt(pts[0].x)},${fmt(pts[0].y)}`];
  for (let i = 1; i < pts.length; i++) parts.push(`L${fmt(pts[i].x)},${fmt(pts[i].y)}`);
  return parts.join('');
}

/** All theme-derived colors/opacities as rules keyed to the spec groups. */
export function themeToCss(theme: RenderTheme): string {
  const rules = [
    `#fields path{fill:${theme.fieldFill};stroke:none}`,
    `#fields line{stroke:${theme.fieldFurrow};stroke-width:0.15;opacity:0.3}`,
    `#greens path{fill:${theme.greenFill};stroke:none}`,
    theme.water !== null ? `#water .fill{fill:${theme.water};stroke:none}` : '',
    theme.waterEdge !== null ? `#water .shore{fill:none;stroke:${theme.waterEdge};stroke-width:${fmt(theme.shoreWidth)};stroke-linejoin:round}` : '',
    `#roads path{fill:none;stroke-linecap:round;stroke-linejoin:round}`,
    `#roads .casing{stroke:${theme.roadCasing}}`,
    `#roads .core{stroke:${theme.roadCore}}`,
    `#shadows{fill:${theme.shadowColor};opacity:${fmt(theme.shadowOpacity)}}`,
    `#buildings path{fill:${theme.buildingFill};stroke:${theme.buildingStroke};stroke-width:${fmt(NORMAL_STROKE)}}`,
    `#buildings .pier{stroke-width:${fmt(NORMAL_STROKE * 2)}}`,
    `#landmarks path{fill:${theme.landmarkFill};stroke:${theme.buildingStroke}}`,
    `#landmarks .castle{stroke-width:${fmt(NORMAL_STROKE * 4)}}`,
    `#landmarks .cathedral{stroke-width:${fmt(NORMAL_STROKE * 2)}}`,
    `#landmarks .market{stroke-width:${fmt(NORMAL_STROKE)}}`,
    `#walls path{fill:none;stroke:${theme.buildingStroke};stroke-width:${fmt(THICK_STROKE)};stroke-linecap:round}`,
    `#walls circle{fill:${theme.buildingStroke}}`,
    `#walls .gate{stroke:${theme.buildingStroke};stroke-width:${fmt(THICK_STROKE * 2)};stroke-linecap:butt}`,
  ];
  return rules.filter(Boolean).join('\n');
}

/**
 * Render a Scene to SVG. Consumes ONLY the scene (spec hard rule: the
 * assembler never sees Model). Groups follow the FMG-aligned contract:
 * #fields #greens #water #roads #shadows #buildings #landmarks #walls.
 */
export function assembleSvg(scene: Scene, options: AssembleOptions = {}): string {
  const palette = options.palette ?? PALETTES.default;
  const overrides = Object.fromEntries(
    Object.entries(options.theme ?? {}).filter(([, v]) => v !== undefined),
  );
  const theme: RenderTheme = { ...themeFrom(palette), ...overrides };
  const clipId = options.clipId ?? 'frame-clip';
  const b = scene.bounds;
  const w = b.max_x - b.min_x, h = b.max_y - b.min_y;
  const L = scene.layers;

  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${b.min_x.toFixed(1)} ${b.min_y.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}">`);
  parts.push(`<defs><clipPath id="${clipId}"><rect x="${b.min_x.toFixed(1)}" y="${b.min_y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}"/></clipPath></defs>`);
  parts.push(`<style>\n${themeToCss(theme)}\n</style>`);
  // data-bg contract with cropSvgToTile: attribute markup + inline fill.
  parts.push(`<rect data-bg="paper" x="${b.min_x.toFixed(1)}" y="${b.min_y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="${theme.paper}"/>`);

  if (L.fields.length > 0 || L.furrows.length > 0) {
    parts.push('<g id="fields">');
    for (const f of L.fields) parts.push(`<path d="${ringPath(f.ring)}"/>`);
    for (const fu of L.furrows) {
      parts.push(`<line x1="${fmt(fu.start.x)}" y1="${fmt(fu.start.y)}" x2="${fmt(fu.end.x)}" y2="${fmt(fu.end.y)}"/>`);
    }
    parts.push('</g>');
  }

  if (L.greens.length > 0) {
    parts.push('<g id="greens">');
    for (const g of L.greens) parts.push(`<path d="${ringPath(g.ring)}"/>`);
    parts.push('</g>');
  }

  if (theme.water !== null && L.water.rings.length > 0) {
    const d = L.water.rings.map(ringPath).join(' ');
    parts.push(`<g id="water" clip-path="url(#${clipId})">`);
    parts.push(`<path class="fill" d="${d}" fill-rule="evenodd"/>`);
    if (theme.waterEdge !== null) parts.push(`<path class="shore" d="${d}"/>`);
    parts.push('</g>');
  }

  if (L.roads.length > 0) {
    parts.push('<g id="roads">');
    const lanes = L.roads.map(r => ({
      path: linePath(r.path),
      width: r.kind === 'artery' ? theme.arteryWidth : theme.roadWidth,
    }));
    for (const lane of lanes) {
      parts.push(`<path class="casing" d="${lane.path}" stroke-width="${fmt(lane.width + theme.casingDelta * 2)}"/>`);
    }
    for (const lane of lanes) {
      parts.push(`<path class="core" d="${lane.path}" stroke-width="${fmt(lane.width)}"/>`);
    }
    parts.push('</g>');
  }

  const shadowable = [...L.buildings];
  if (shadowable.length > 0) {
    const { dx, dy } = theme.shadowOffset;
    parts.push(`<g id="shadows" transform="translate(${fmt(dx)},${fmt(dy)})">`);
    for (const bld of shadowable) parts.push(`<path d="${ringPath(bld.ring)}"/>`);
    parts.push('</g>');
  }

  const ordinary = L.buildings.filter(x => !x.landmark);
  if (ordinary.length > 0 || L.piers.length > 0) {
    parts.push('<g id="buildings">');
    for (const bld of ordinary) parts.push(`<path class="${bld.kind}" d="${ringPath(bld.ring)}"/>`);
    for (const pier of L.piers) parts.push(`<path class="pier" d="${ringPath(pier.ring)}"/>`);
    parts.push('</g>');
  }

  const landmarks = L.buildings.filter(x => x.landmark);
  if (landmarks.length > 0) {
    parts.push('<g id="landmarks">');
    for (const bld of landmarks) parts.push(`<path class="${bld.kind}" d="${ringPath(bld.ring)}"/>`);
    parts.push('</g>');
  }

  if (L.walls.length > 0) {
    parts.push('<g id="walls">');
    for (const wallF of L.walls) {
      for (const pl of wallF.polylines) parts.push(`<path d="${linePath(pl)}"/>`);
      for (const gate of wallF.gates) {
        parts.push(`<line class="gate" x1="${fmt(gate.p1.x)}" y1="${fmt(gate.p1.y)}" x2="${fmt(gate.p2.x)}" y2="${fmt(gate.p2.y)}"/>`);
      }
      const r = THICK_STROKE * (wallF.large ? 1.5 : 1);
      for (const t of wallF.towers) {
        parts.push(`<circle cx="${fmt(t.x)}" cy="${fmt(t.y)}" r="${fmt(r)}"/>`);
      }
    }
    parts.push('</g>');
  }

  parts.push('</svg>');
  return parts.join('\n');
}
```

- [ ] **Step 4: Gut svg-builder to a wrapper**

Replace the body of `src/output/svg-builder.ts` with (keep `SvgOptions` shape exactly, including doc comments):

```typescript
import type { Palette } from '../types/interfaces.js';
import type { Model } from '../generator/model.js';
import type { RenderTheme } from './render-theme.js';
import { NO_SHIFT, type OriginShift } from '../generator/origin-shift.js';
import { buildScene } from '../scene/build-scene.js';
import { assembleSvg } from './assemble-svg.js';

export interface SvgOptions {
  palette?: Palette;
  /** Additional padding around the city bounds */
  padding?: number;
  /** Fine-grained overrides applied on top of the palette-derived theme. */
  theme?: Partial<RenderTheme>;
  /**
   * Translation applied to every emitted coordinate. Defaults to
   * `NO_SHIFT`. Set by `generateFromBurg` after its coast-pull
   * computation so the SVG viewport tracks the shifted geometry.
   */
  shift?: OriginShift;
  /**
   * Id of the frame clipPath (default "frame-clip"). SVG ids are
   * document-global: override with a unique value whenever multiple
   * settlement SVGs are inlined into one HTML document, or each water
   * layer clips against whichever #frame-clip appears first.
   */
  clipId?: string;
}

/**
 * Model → SVG. Thin wrapper preserving the historical signature: extracts
 * the semantic Scene, then assembles it. All rendering decisions live in
 * assemble-svg.ts; this file owns no paint logic (spec hard rule).
 */
export function generateSvg(model: Model, options: SvgOptions = {}): string {
  const scene = buildScene(model, {
    shift: options.shift ?? NO_SHIFT,
    padding: options.padding ?? 20,
  });
  return assembleSvg(scene, {
    palette: options.palette,
    theme: options.theme,
    clipId: options.clipId,
  });
}
```

Add to `src/index.ts`:

```typescript
export { assembleSvg, themeToCss } from './output/assemble-svg.js';
export type { AssembleOptions } from './output/assemble-svg.js';
```

- [ ] **Step 5: Run the structure test, then the full suite**

Run: `nix develop --command bash -c "npx vitest run tests/assemble-svg.test.ts && npx vitest run"`

Reconciliation rules (markup changed shape; semantics must not):
- `tests/toprak-regression.test.ts`: the water-orientation guard regex `/<path d="([^"]+)" fill="[^"]*" fill-rule="evenodd"/` becomes `/<path class="fill" d="([^"]+)" fill-rule="evenodd"/`. All four assertions still hold conceptually — update matching only.
- `tests/water-geometry.test.ts`: marker strings stay valid (`clipPath id`, `clip-path=`, `fill-rule="evenodd"`) — expect no change; if the evenodd assertion fails, that is a real assembler bug.
- `tests/svg-render.test.ts`: color-as-attribute greps move to style-block assertions (`expect(svg).toContain('#water .fill{fill:#85bcb2')` style). Counts of water fill paths: still exactly one.
- `tests/settlement-tiler.test.ts`: must pass UNCHANGED (data-bg contract) — a failure here is a real regression, do not touch the tiler.
- Byte-level determinism tests keep passing (same input → same string, just a different string than before this task).

- [ ] **Step 6: Visual sanity + commit**

Regenerate `output/compare/index.html` (`npx tsx compare-versions.ts` in the nix shell) and rasterize one coastal panel — the image must be visually identical to pre-task output (same colors/shapes; only markup internals changed). Then:

```bash
git add src/output/assemble-svg.ts src/output/svg-builder.ts src/index.ts tests/assemble-svg.test.ts tests/toprak-regression.test.ts tests/svg-render.test.ts
git commit -m "Scene-driven assembler: spec groups + style block; generateSvg is a wrapper"
```

---

### Task 4: Asset sets — registry, starter tree symbol, scene vegetation

The artist-facing seam: an `AssetSet` maps semantic kinds to SVG symbol markup; the assembler resolves them via `<defs><symbol>` + `<use>`. Starter content: one schematic tree, scattered deterministically in park groves. Biome selects the default set (single set today — the lookup exists so Task 5 and artists have the hook).

**Files:**
- Create: `src/assets/asset-sets.ts`
- Modify: `src/scene/build-scene.ts` (vegetation scatter)
- Modify: `src/output/assemble-svg.ts` (symbol defs + `#greens` `<use>`; `assetSet` option)
- Modify: `src/output/render-theme.ts` (add `treeFill` slot to `RenderTheme` + `themeFrom`)
- Modify: `src/index.ts` (exports)
- Test: `tests/asset-sets.test.ts` (create)

**Interfaces:**
- Consumes: `Palette.tree?: number` (exists in `src/types/interfaces.ts:30`), `darken`/`cssHex` from render-theme, `SeededRandom` (`src/utils/random.ts`), `pointInPolygon` (`src/geom/point-in-polygon.ts`), `Scene.layers.vegetation` (typed in Task 2, empty until now).
- Produces: `interface AssetSet { name: string; symbols: Record<string, string> }`; `SCHEMATIC_SET`; `assetSetFor(biome?: string): AssetSet`; `RenderTheme.treeFill: string`; assembler markup `<symbol id="asset-<kind>" viewBox="-1 -1 2 2">` + `<use href="#asset-tree" …/>` inside `#greens`; CSS rule `#greens use{fill:<treeFill>}`.

- [ ] **Step 1: Write the failing test**

Create `tests/asset-sets.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { generateFromBurg, WardType, type AzgaarBurgInput } from '../src/index.js';
import { SCHEMATIC_SET, assetSetFor } from '../src/assets/asset-sets.js';

const parky: AzgaarBurgInput = {
  name: 'Groveton',
  population: 2500,
  port: false, citadel: false, walls: true,
  plaza: true, temple: true, shanty: false, capital: false,
};

describe('asset sets', () => {
  it('starter set has a tree symbol and is the default for any biome', () => {
    expect(SCHEMATIC_SET.symbols.tree).toContain('circle');
    expect(assetSetFor(undefined).name).toBe('schematic');
    expect(assetSetFor('desert').name).toBe('schematic');
  });

  it('park groves gain deterministic tree instances rendered as <use>', () => {
    // Pop 2500 with temple+walls reliably rolls Park wards across seeds is
    // NOT guaranteed — find greens first, assert conditionally but strictly.
    const { svg, model } = generateFromBurg(parky);
    const hasPark = model.patches.some(p => p.ward?.type === WardType.Park && p.ward.geometry.length > 0);
    if (!hasPark) {
      // Fixture must produce a park for the test to mean anything — fail loudly
      // so the implementer picks a different name/seed rather than skipping.
      throw new Error('Fixture produced no park ward; adjust the fixture name (new seed) until one exists.');
    }
    expect(svg).toContain('<symbol id="asset-tree"');
    expect(svg.match(/<use href="#asset-tree"/g)!.length).toBeGreaterThan(0);
    expect(svg).toContain('#greens use{fill:');
  });

  it('vegetation is deterministic', () => {
    const a = generateFromBurg(parky).svg;
    const b = generateFromBurg(parky).svg;
    expect(a).toBe(b);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `nix develop --command bash -c "npx vitest run tests/asset-sets.test.ts"`
Expected: FAIL — module `src/assets/asset-sets.ts` does not exist.

- [ ] **Step 3: Asset registry**

Create `src/assets/asset-sets.ts`:

```typescript
/**
 * Asset sets map semantic kinds to SVG symbol markup — the seam where a
 * community artist works without touching generator code. Symbols are
 * authored in a unit box (viewBox -1 -1 2 2), unstyled: color comes from
 * the theme via CSS on the consuming group.
 */
export interface AssetSet {
  name: string;
  /** semantic kind → inner markup of a <symbol viewBox="-1 -1 2 2"> */
  symbols: Record<string, string>;
}

/** Starter set: deliberately simple, proves symbol resolution end-to-end. */
export const SCHEMATIC_SET: AssetSet = {
  name: 'schematic',
  symbols: {
    tree: '<circle cx="0" cy="0.12" r="0.44"/><circle cx="-0.3" cy="-0.1" r="0.32"/><circle cx="0.28" cy="-0.16" r="0.34"/><circle cx="-0.02" cy="-0.36" r="0.28"/>',
  },
};

/**
 * Biome → asset set. One set exists today; the lookup is the contract —
 * per-biome sets (desert dunes/palms, temperate oaks) plug in here without
 * code changes elsewhere.
 */
export function assetSetFor(_biome?: string): AssetSet {
  return SCHEMATIC_SET;
}
```

- [ ] **Step 4: treeFill theme slot**

`src/output/render-theme.ts`: add to `RenderTheme`:

```typescript
  treeFill: string;          // vegetation symbols; darkened green
```

and in `themeFrom` (where greenFill is derived — follow the existing derivation style):

```typescript
    treeFill: cssHex(darken(palette.tree ?? palette.green ?? palette.medium, 0.15)),
```

(Match the actual fallback chain used for `greenFill` in that file — read it and mirror; `palette.tree` first.)

- [ ] **Step 5: Vegetation scatter in buildScene**

In `src/scene/build-scene.ts`, add imports:

```typescript
import { SeededRandom } from '../utils/random.js';
import { pointInPolygon } from '../geom/point-in-polygon.js';
import { Polygon } from '../geom/polygon.js';
```

and after the walls are appended in `buildScene`, before `return scene`:

```typescript
  scatterVegetation(model, scene, sc);
```

with:

```typescript
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
      const n = Math.max(1, Math.min(24, Math.round(area / 12)));
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const v of grove.vertices) {
        if (v.x < minX) minX = v.x;
        if (v.y < minY) minY = v.y;
        if (v.x > maxX) maxX = v.x;
        if (v.y > maxY) maxY = v.y;
      }
      let placed = 0;
      for (let attempt = 0; attempt < n * 10 && placed < n; attempt++) {
        const p = { x: minX + rng.float() * (maxX - minX), y: minY + rng.float() * (maxY - minY) };
        if (!pointInPolygon(p as never, grove.vertices)) continue;
        scene.layers.vegetation.push({
          at: sc(p),
          kind: 'tree',
          scale: 1.6 + rng.float() * 1.2,
          rotationDeg: Math.round(rng.float() * 360),
        });
        placed++;
      }
    }
  }
}
```

(If `Polygon.square` is signed area — it is, see `src/geom/polygon.ts` — `Math.abs` handles winding. If `pointInPolygon`'s first parameter type rejects the literal, construct `new Point(x, y)` instead of casting.)

- [ ] **Step 6: Assembler renders vegetation via symbols**

`src/output/assemble-svg.ts`:

- Add to `AssembleOptions`: `assetSet?: AssetSet;` with `import type { AssetSet } from '../assets/asset-sets.js';` and `import { assetSetFor } from '../assets/asset-sets.js';`
- In `assembleSvg`: `const assets = options.assetSet ?? assetSetFor(scene.biome);`
- In the `<defs>` push, append symbols for every kind used by the scene:

```typescript
  const usedKinds = [...new Set(scene.layers.vegetation.map(v => v.kind))];
  const symbolDefs = usedKinds
    .filter(k => assets.symbols[k] !== undefined)
    .map(k => `<symbol id="asset-${k}" viewBox="-1 -1 2 2">${assets.symbols[k]}</symbol>`)
    .join('');
```

and include `${symbolDefs}` inside the existing `<defs>…</defs>` string, after the clipPath.
- In the greens group (create the group when `L.greens.length > 0 || L.vegetation.length > 0`), after grove paths:

```typescript
    for (const v of L.vegetation) {
      const s = v.scale;
      parts.push(`<use href="#asset-${v.kind}" x="${fmt(-1)}" y="${fmt(-1)}" width="2" height="2" transform="translate(${fmt(v.at.x)},${fmt(v.at.y)}) scale(${fmt(s / 2)}) rotate(${v.rotationDeg})"/>`);
    }
```

- In `themeToCss`, add the rule: `` `#greens use{fill:${theme.treeFill}}` ``.
- `generateSvg` wrapper: no change needed (assetSet defaults from biome).

Add to `src/index.ts`:

```typescript
export { SCHEMATIC_SET, assetSetFor } from './assets/asset-sets.js';
export type { AssetSet } from './assets/asset-sets.js';
```

- [ ] **Step 7: Run tests, full suite, visual check, commit**

Run: `nix develop --command bash -c "npx vitest run tests/asset-sets.test.ts && npx vitest run"`
Reconcile: `tests/render-theme.test.ts` may enumerate theme keys — add `treeFill`. Determinism tests keep passing (scene rng is stream-isolated).
Regenerate the compare gallery; confirm trees render in any park-bearing panel and look proportionate (adjust the `1.6 + 1.2` scale range only if trees are grossly over/under-sized; note the change).

```bash
git add src/assets/ src/scene/build-scene.ts src/output/assemble-svg.ts src/output/render-theme.ts src/index.ts tests/asset-sets.test.ts
git commit -m "Asset sets: registry, starter tree symbol, deterministic park vegetation"
```

---

### Task 5: Biome and trade inputs

Data, not presentation: both ride the `i=` payload (Plan C). `biome` flows to the scene and selects default palette/asset set; `trade` guarantees a market (Azgaar: "trade center → market place").

**Files:**
- Modify: `src/input/azgaar-input.ts` (fields + mapping)
- Modify: `src/generator/generation-params.ts` (`biome`)
- Modify: `src/scene/build-scene.ts` (scene.biome)
- Modify: `src/output/assemble-svg.ts` + `src/output/palette.ts` (biome default palette lookup)
- Test: `tests/biome-trade.test.ts` (create)

**Interfaces:**
- Consumes: `PALETTES` (`src/output/palette.ts` — read it first: palettes are `parchment` (default) and `classic`), `Market` ward assignment via `plazaNeeded` (`Model.createWards` gives the plaza patch a Market ward).
- Produces: `AzgaarBurgInput.biome?: string`, `AzgaarBurgInput.trade?: boolean`, `GenerationParams.biome?: string`; `paletteForBiome(biome?: string): Palette` exported from `src/output/palette.ts`; `Scene.biome` populated; `mapToGenerationParams` maps `plazaNeeded: burg.plaza || burg.trade === true`.

- [ ] **Step 1: Write the failing test**

Create `tests/biome-trade.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { generateFromBurg, WardType, type AzgaarBurgInput } from '../src/index.js';
import { buildScene } from '../src/scene/build-scene.js';
import { paletteForBiome } from '../src/output/palette.js';
import { PALETTES } from '../src/output/palette.js';

const base: AzgaarBurgInput = {
  name: 'Souktown',
  population: 900,
  port: false, citadel: false, walls: false,
  plaza: false, temple: false, shanty: false, capital: false,
};

describe('biome and trade inputs', () => {
  it('trade guarantees a market ward even without plaza', () => {
    const { model } = generateFromBurg({ ...base, trade: true });
    expect(model.patches.some(p => p.ward?.type === WardType.Market)).toBe(true);
  });

  it('no trade, no plaza — no market', () => {
    const { model } = generateFromBurg(base);
    expect(model.patches.some(p => p.ward?.type === WardType.Market)).toBe(false);
  });

  it('biome reaches the scene', () => {
    const r = generateFromBurg({ ...base, biome: 'desert' });
    const scene = buildScene(r.model, { shift: r.originShift });
    expect(scene.biome).toBe('desert');
  });

  it('paletteForBiome returns a defined palette and defaults sanely', () => {
    expect(paletteForBiome(undefined)).toBe(PALETTES.default);
    expect(paletteForBiome('desert')).toBeDefined();
  });

  it('explicit palette option beats the biome default', () => {
    const a = generateFromBurg({ ...base, biome: 'desert' }, { svg: { palette: PALETTES.classic } });
    const classicPaper = themeFrom(PALETTES.classic).paper;
    expect(a.svg).toContain(`fill="${classicPaper}"`); // data-bg rect carries inline paper fill
    const b = generateFromBurg({ ...base, biome: 'desert' });
    const defaultPaper = themeFrom(PALETTES.default).paper;
    expect(b.svg).toContain(`fill="${defaultPaper}"`);
  });
});
```

(Add `import { themeFrom } from '../src/output/render-theme.js';` to the test's imports. Note `PALETTES.classic` and `PALETTES.default` both exist — `classic` aliases the pre-parchment default palette. If `classicPaper === defaultPaper` the test proves nothing; check the two hex values differ and pick another theme slot, e.g. `buildingFill`, if they collide.)

- [ ] **Step 2: Run to verify failure**

Run: `nix develop --command bash -c "npx vitest run tests/biome-trade.test.ts"`
Expected: FAIL — `trade`/`biome` unknown fields, `paletteForBiome` missing.

- [ ] **Step 3: Implement the plumbing**

`src/input/azgaar-input.ts` — add to `AzgaarBurgInput` (below `urbanDensity`):

```typescript
  /** Azgaar biome name (e.g. "desert", "temperate") — selects default asset set + palette. */
  biome?: string;
  /** Trade-center burg — guarantees a market/plaza ward (Azgaar wishlist). */
  trade?: boolean;
```

In `mapToGenerationParams`:

```typescript
    plazaNeeded: burg.plaza || burg.trade === true,
    ...(burg.biome != null ? { biome: burg.biome } : {}),
```

`src/generator/generation-params.ts` — add below `urbanDensity`:

```typescript
  /** Azgaar biome name; flows to the scene for asset-set/palette defaults. */
  biome?: string;
```

`src/scene/build-scene.ts` — in the `Scene` literal: `...(model.params.biome != null ? { biome: model.params.biome } : {}),` (place alongside `seed`/`population`; TypeScript: add via conditional spread or assign after construction — either, consistently).

`src/output/palette.ts` — add:

```typescript
/**
 * Biome → default palette. Both current palettes are temperate-ish; the
 * table is the extension point for artist-supplied biome palettes. Unknown
 * or missing biome → default.
 */
export function paletteForBiome(biome?: string): Palette {
  const table: Record<string, Palette> = {
    // e.g. desert: PALETTES.desert — when an artist supplies one
  };
  return (biome != null ? table[biome] : undefined) ?? PALETTES.default;
}
```

`src/output/assemble-svg.ts` — default palette becomes biome-aware:

```typescript
  const palette = options.palette ?? paletteForBiome(scene.biome);
```

(with the import; `PALETTES.default` is what `paletteForBiome` falls back to, so behavior without biome is unchanged.)

- [ ] **Step 4: Run tests, full suite, commit**

Run: `nix develop --command bash -c "npx vitest run tests/biome-trade.test.ts && npx vitest run"`
Expected: green (the `trade` spread must not alter any existing fixture — none set `trade`).

```bash
git add src/input/azgaar-input.ts src/generator/generation-params.ts src/scene/build-scene.ts src/output/palette.ts src/output/assemble-svg.ts tests/biome-trade.test.ts
git commit -m "Biome and trade inputs: market guarantee, biome-aware scene and palette defaults"
```

---

### Task 6: Verification, calibration, and the contract document

**Files:**
- Create: `docs/scene-schema.md`
- Possibly modify: `src/input/azgaar-input.ts` (`BUILDINGS_PER_PATCH` calibration only)
- No other source changes expected.

**Interfaces:**
- Consumes: everything above.
- Produces: green suite, calibrated density, and the artist/integrator-facing contract doc that Plan C's `docs/url-api.md` will link to.

- [ ] **Step 1: Full suite + build + smoke**

Run: `nix develop --command bash -c "npx vitest run && npm run build && npx tsx smoke-test.ts"`
Expected: all green, tsc exit 0, smoke completes.

- [ ] **Step 2: Visual calibration sweep**

Regenerate the gallery (`npx tsx compare-versions.ts` in the nix shell); rasterize every NEW panel (sharp snippet from repo history) and check against the watabou reference vocabulary in the spec:
- Toprak (pop 13): ≤3 houses, sea to frame edge, 1 road.
- Saltmere (pop 350): ~70–88 houses, village reads as village.
- Grimhaven (pop 4500): dense walled town, buildings not confetti-sized.
- Highbury (pop 9000): city-dense, plausible footprint.
- Trees visible in park groves where parks rolled.
If density misses, adjust ONLY `BUILDINGS_PER_PATCH` within [7, 12] and/or the `refineDensity` trigger within [0.6, 0.8]; re-run the suite after any adjustment. Record final values and rasterized panels in the report.

- [ ] **Step 3: Write the contract doc**

Create `docs/scene-schema.md` documenting, with one example snippet each: the `Scene` v1 shape (copy the interfaces), the coordinate frame (output coords, y-down, `bounds`), the SVG group/style contract (group ids, class vocabulary, style-block ownership, `data-bg` and `clipId` notes), the `AssetSet` manifest format with the tree symbol as the worked example and authoring rules (unit box `viewBox="-1 -1 2 2"`, unstyled markup, color via group CSS), and the biome hooks (`assetSetFor`, `paletteForBiome`). Close with the evolution policy: additive fields only, bump `SCENE_VERSION` on breaking change. This is the document a community artist and Azgaar both read — write for them, not for us.

- [ ] **Step 4: Commit**

```bash
git add docs/scene-schema.md src/input/azgaar-input.ts
git commit -m "Plan B verification: density calibration and scene/asset contract doc"
```

---

## Deferred (do NOT implement in this plan)

- URL codec (`i=`, `style=` params), `web/` Vite app, `netlify.toml`, `docs/url-api.md` → Plan C.
- GeoJSON builder migration onto the scene vocabulary → Plan C or later (it works as-is; unify when the URL layer stabilizes).
- Shore-following road routing (the cheap waterline clip from the fidelity round stands until then).
- Pictorial asset family (roof ridges, furrow patterns as textures, water depth banding, shore strips), per-biome art, culture-derived house shapes → community-artist work on the `AssetSet` seam.
- Labels/district names in the scene → needs the POI/naming pass, own plan.
- `kind: 'sea'` route bearings orienting piers → harbour rework, own task later.
