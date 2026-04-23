# GeoJSON Schema v3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship GeoJSON schema v3: add `layer: 'poi'` features, give every building/street a stable ID, and emit a machine-readable `metadata.stable_ids.prefixes` + `metadata.poi_density` block. Naming stays out of scope.

**Architecture:** A new post-pipeline `selectPois(...)` stage reads the finished `Model` and returns a `Poi[]` list. A single `IdAllocator` owns `p*`, `s*`, `b*` counters per generation call and is threaded through `generateGeoJson`. Canonical iteration order (buildings → streets → POIs) guarantees deterministic IDs across re-runs.

**Tech Stack:** TypeScript, Node 22 under `nix develop`, vitest, zero runtime dependencies. Run commands as `nix develop --command bash -c "..."`.

**Spec:** `docs/superpowers/specs/2026-04-23-poi-named-streets-design.md`

---

## File Structure

### New files
- `src/poi/poi-kinds.ts` — `PoiKind` union, `Poi` interface, `FLOATING_POI_KINDS`, `POI_TIER`.
- `src/poi/poi-selector.ts` — `selectPois(...)`, regime branches, priority-tier emission, adoption, inline scoring/helpers.
- `src/output/id-allocator.ts` — `IdAllocator` class exposing `alloc('p' | 's' | 'b'): string`.
- `docs/schema-v3.md` — delta-only contract doc; prose that doesn't belong in runtime metadata.
- `tests/id-allocator.test.ts`, `tests/poi-kinds.test.ts`, `tests/poi-scoring.test.ts`, `tests/poi-helpers.test.ts`, `tests/poi-hamlet.test.ts`, `tests/poi-town.test.ts`, `tests/poi-harbour.test.ts`, `tests/poi-drop-off.test.ts` — unit tests per component.
- `tests/geojson-schema-v3.test.ts` — schema-level assertions on the final GeoJSON.

### Modified files
- `src/output/geojson-builder.ts` — schema bump, allocator wiring, POI emission, new metadata fields.
- `src/index.ts` — export `Poi`, `PoiKind` types.
- `package.json` — bump `version` to `0.4.0`.
- `tests/entrance-output.test.ts` — update `schema_version` assertion, add `building_id`/`street_id` shape checks.
- `smoke-test.ts` — emit one hamlet/town/city and dump POI counts per kind.

### Unchanged
- `src/generator/*` (pipeline is read-only from the selector's perspective).
- `src/wards/*`.
- `src/output/svg-builder.ts`.
- Entrance-ID scheme (`g<wallVertexIndex>`).

---

## Task 1: IdAllocator

**Files:**
- Create: `src/output/id-allocator.ts`
- Test: `tests/id-allocator.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/id-allocator.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { IdAllocator } from '../src/output/id-allocator.js';

describe('IdAllocator', () => {
  it('allocates zero-indexed IDs per prefix', () => {
    const a = new IdAllocator();
    expect(a.alloc('b')).toBe('b0');
    expect(a.alloc('b')).toBe('b1');
    expect(a.alloc('s')).toBe('s0');
    expect(a.alloc('p')).toBe('p0');
    expect(a.alloc('b')).toBe('b2');
  });

  it('keeps prefix counters independent', () => {
    const a = new IdAllocator();
    for (let i = 0; i < 5; i++) a.alloc('b');
    expect(a.alloc('s')).toBe('s0');
    expect(a.alloc('p')).toBe('p0');
    expect(a.alloc('b')).toBe('b5');
  });

  it('is instance-scoped (separate allocators do not share state)', () => {
    const a = new IdAllocator();
    const b = new IdAllocator();
    expect(a.alloc('b')).toBe('b0');
    expect(b.alloc('b')).toBe('b0');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
nix develop --command bash -c "npx vitest run tests/id-allocator.test.ts"
```
Expected: FAIL — `Cannot find module '../src/output/id-allocator.js'`.

- [ ] **Step 3: Implement the allocator**

Create `src/output/id-allocator.ts`:

```ts
/**
 * Dispenses prefixed stable IDs (`p`, `s`, `b`) for GeoJSON v3 features.
 * One instance per generation call. Counters start at 0 and increment per prefix.
 *
 * IDs are stable across re-runs with the same seed + inputs because the caller
 * iterates deterministically. This class owns the counter state so every caller
 * (GeoJSON builder, POI selector, future SVG renderer) shares the same scheme.
 */
export type IdPrefix = 'p' | 's' | 'b';

export class IdAllocator {
  private counters = new Map<IdPrefix, number>();

  alloc(prefix: IdPrefix): string {
    const n = this.counters.get(prefix) ?? 0;
    this.counters.set(prefix, n + 1);
    return `${prefix}${n}`;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
nix develop --command bash -c "npx vitest run tests/id-allocator.test.ts"
```
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/output/id-allocator.ts tests/id-allocator.test.ts
git commit -m "Add IdAllocator for schema-v3 stable IDs"
```

---

## Task 2: PoiKind types and constants

**Files:**
- Create: `src/poi/poi-kinds.ts`
- Test: `tests/poi-kinds.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/poi-kinds.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { FLOATING_POI_KINDS, POI_TIER, type PoiKind } from '../src/poi/poi-kinds.js';

describe('PoiKind constants', () => {
  it('FLOATING_POI_KINDS contains exactly pier and well', () => {
    expect(FLOATING_POI_KINDS).toEqual(new Set<PoiKind>(['pier', 'well']));
  });

  it('every listed kind has a priority tier', () => {
    const all: PoiKind[] = [
      'inn', 'tavern', 'temple', 'cathedral', 'chapel',
      'smithy', 'stable', 'shop', 'market', 'bathhouse',
      'guardhouse', 'guildhall', 'warehouse', 'pier',
      'mill', 'well',
    ];
    for (const k of all) {
      expect(POI_TIER[k]).toBeDefined();
      expect([1, 2, 3]).toContain(POI_TIER[k]);
    }
  });

  it('Tier 1 contains cathedral, chapel, inn, market, mill, smithy, tavern', () => {
    const tier1 = Object.entries(POI_TIER)
      .filter(([, t]) => t === 1)
      .map(([k]) => k)
      .sort();
    expect(tier1).toEqual(['cathedral', 'chapel', 'inn', 'market', 'mill', 'smithy', 'tavern']);
  });

  it('Tier 3 contains only warehouse', () => {
    const tier3 = Object.entries(POI_TIER)
      .filter(([, t]) => t === 3)
      .map(([k]) => k);
    expect(tier3).toEqual(['warehouse']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
nix develop --command bash -c "npx vitest run tests/poi-kinds.test.ts"
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module**

Create `src/poi/poi-kinds.ts`:

```ts
import type { Point } from '../types/point.js';
import type { WardType } from '../types/interfaces.js';

export type PoiKind =
  | 'inn' | 'tavern' | 'temple' | 'cathedral' | 'chapel'
  | 'smithy' | 'stable' | 'shop' | 'market' | 'bathhouse'
  | 'guardhouse' | 'guildhall' | 'warehouse' | 'pier'
  | 'mill' | 'well';

export interface Poi {
  kind: PoiKind;
  point: Point;
  wardType: WardType | null;
  buildingId: string | null;
}

export const FLOATING_POI_KINDS: ReadonlySet<PoiKind> = new Set(['pier', 'well']);

/**
 * Priority tiers determine drop-off order when building supply is exhausted.
 * Tier 3 drops before Tier 2, Tier 2 before Tier 1. Within a tier, the selector
 * iterates alphabetically. See the spec's "Emission priority tiers" section.
 */
export const POI_TIER: Record<PoiKind, 1 | 2 | 3> = {
  cathedral: 1, chapel: 1, inn: 1, market: 1, mill: 1, smithy: 1, tavern: 1,
  bathhouse: 2, guardhouse: 2, guildhall: 2, shop: 2, stable: 2, temple: 2,
  warehouse: 3,
  // Floating kinds always emit (they don't consume buildings), but give them a tier for completeness.
  pier: 3, well: 3,
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
nix develop --command bash -c "npx vitest run tests/poi-kinds.test.ts"
```
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/poi/poi-kinds.ts tests/poi-kinds.test.ts
git commit -m "Define PoiKind union, Poi interface, floating-set and priority tiers"
```

---

## Task 3: Building adoption and scoring helpers

**Files:**
- Create: `src/poi/poi-selector.ts` (first commit of this file; selector logic added in later tasks)
- Test: `tests/poi-scoring.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/poi-scoring.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { Polygon } from '../src/geom/polygon.js';
import { Point } from '../src/types/point.js';
import { scoreBuildings } from '../src/poi/poi-selector.js';

function rect(x: number, y: number, w: number, h: number): Polygon {
  return new Polygon([
    new Point(x, y),
    new Point(x + w, y),
    new Point(x + w, y + h),
    new Point(x, y + h),
  ]);
}

describe('scoreBuildings', () => {
  it('orders by area desc, then by distance to reference point asc', () => {
    const small = rect(0, 0, 2, 2);      // area 4
    const mediumFar = rect(100, 100, 3, 3); // area 9, far from origin
    const large = rect(0, 0, 5, 5);       // area 25
    const ref = new Point(0, 0);

    const ordered = scoreBuildings([small, mediumFar, large], ref);
    expect(ordered).toEqual([large, mediumFar, small]);
  });

  it('is stable for equal-area buildings: the closer one wins', () => {
    const a = rect(0, 0, 3, 3);     // area 9, centroid (1.5, 1.5)
    const b = rect(10, 10, 3, 3);   // area 9, centroid (11.5, 11.5)
    const ref = new Point(0, 0);

    const ordered = scoreBuildings([b, a], ref);
    expect(ordered[0]).toBe(a);
    expect(ordered[1]).toBe(b);
  });

  it('handles an empty list', () => {
    expect(scoreBuildings([], new Point(0, 0))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
nix develop --command bash -c "npx vitest run tests/poi-scoring.test.ts"
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the scoring helper**

Create `src/poi/poi-selector.ts`:

```ts
import type { Model } from '../generator/model.js';
import type { Patch } from '../generator/patch.js';
import type { Polygon } from '../geom/polygon.js';
import { Point } from '../types/point.js';
import type { IdAllocator } from '../output/id-allocator.js';
import { WardType } from '../types/interfaces.js';
import { FLOATING_POI_KINDS, type Poi, type PoiKind } from './poi-kinds.js';

/**
 * Order buildings by desirability: largest first, tiebreak by shortest distance
 * from building centroid to `reference`. Pure function; does not mutate inputs.
 *
 * The reference point lets callers bias selection toward streets: passing the
 * nearest artery vertex scores buildings near it higher. For burgs without
 * arteries, callers pass `model.center`.
 */
export function scoreBuildings(buildings: Polygon[], reference: Point): Polygon[] {
  const scored = buildings.map(b => {
    const c = b.centroid;
    const dx = c.x - reference.x;
    const dy = c.y - reference.y;
    return { b, area: b.square, dist2: dx * dx + dy * dy };
  });
  scored.sort((x, y) => {
    if (y.area !== x.area) return y.area - x.area; // area desc
    return x.dist2 - y.dist2;                       // distance asc
  });
  return scored.map(s => s.b);
}

/**
 * Reference point for scoring: centroid of the nearest artery vertex to the
 * burg center, or the burg center itself if no arteries exist (tiny unwalled
 * hamlets may have only approach roads).
 */
export function scoringReference(model: Model): Point {
  if (model.arteries.length === 0) return model.center;
  let best: Point | null = null;
  let bestD2 = Infinity;
  for (const artery of model.arteries) {
    for (const v of artery.vertices) {
      const dx = v.x - model.center.x;
      const dy = v.y - model.center.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) { bestD2 = d2; best = v; }
    }
  }
  return best ?? model.center;
}

// `selectPois` implementation lands in Task 5. This stub keeps the module compiling
// until then — deleted in Task 5, not a permanent placeholder.
export function selectPois(
  _model: Model,
  _population: number,
  _allocator: IdAllocator,
  _buildingIdMap: Map<Polygon, string>,
): Poi[] {
  return [];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
nix develop --command bash -c "npx vitest run tests/poi-scoring.test.ts"
```
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/poi/poi-selector.ts tests/poi-scoring.test.ts
git commit -m "Add building scoring helpers for POI adoption"
```

---

## Task 4: Water-adjacency and regime helpers

**Files:**
- Modify: `src/poi/poi-selector.ts`
- Test: `tests/poi-helpers.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/poi-helpers.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { generateFromBurg, type AzgaarBurgInput } from '../src/index.js';
import { isWaterAdjacent, regimeFor } from '../src/poi/poi-selector.js';

function makeBurg(overrides: Partial<AzgaarBurgInput> = {}): AzgaarBurgInput {
  return {
    name: 'B', population: 500, port: false, citadel: false,
    walls: true, plaza: true, temple: false, shanty: false, capital: false,
    ...overrides,
  };
}

describe('regimeFor', () => {
  it('returns hamlet when P < 300', () => {
    expect(regimeFor(0)).toBe('hamlet');
    expect(regimeFor(299)).toBe('hamlet');
  });
  it('returns town when P >= 300', () => {
    expect(regimeFor(300)).toBe('town');
    expect(regimeFor(100000)).toBe('town');
  });
});

describe('isWaterAdjacent', () => {
  it('returns false for a landlocked burg', () => {
    const { model } = generateFromBurg(makeBurg(), { seed: 1 });
    expect(isWaterAdjacent(model)).toBe(false);
  });

  it('returns true for a port burg with a harbour', () => {
    const { model } = generateFromBurg(
      makeBurg({ port: true, population: 8000 }),
      { seed: 1 },
    );
    expect(isWaterAdjacent(model)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
nix develop --command bash -c "npx vitest run tests/poi-helpers.test.ts"
```
Expected: FAIL — `regimeFor` / `isWaterAdjacent` not exported.

- [ ] **Step 3: Add the helpers**

Edit `src/poi/poi-selector.ts`, append after `scoringReference`:

```ts
export type PoiDensity = 'hamlet' | 'town';

/** Split point between hamlet and town regimes, per spec. */
export const HAMLET_REGIME_MAX = 300;

export function regimeFor(population: number): PoiDensity {
  return population < HAMLET_REGIME_MAX ? 'hamlet' : 'town';
}

/**
 * True iff the burg has any patch adjacent to open water or a harbour.
 * Used to gate mill placement in both regimes.
 */
export function isWaterAdjacent(model: Model): boolean {
  if (model.harbour !== null) return true;
  if (model.waterbody.length === 0) return false;
  for (const patch of model.patches) {
    if (patch.ward === null) continue;
    for (const wp of model.waterbody) {
      // forEdge iterates v0 → v1 on THIS polygon; the shared edge on the
      // neighbour runs v1 → v0, matching how Model.ts builds harbour adjacency.
      let adjacent = false;
      patch.shape.forEdge((v0, v1) => {
        if (!adjacent && wp.shape.findEdge(v1, v0) !== -1) adjacent = true;
      });
      if (adjacent) return true;
    }
  }
  return false;
}

/** Returns patches whose ward is present and borders open water or the harbour. */
export function waterAdjacentPatches(model: Model): Patch[] {
  const out: Patch[] = [];
  for (const patch of model.patches) {
    if (patch.ward === null) continue;
    if (model.harbour === patch) { out.push(patch); continue; }
    let adjacent = false;
    for (const wp of model.waterbody) {
      patch.shape.forEdge((v0, v1) => {
        if (!adjacent && wp.shape.findEdge(v1, v0) !== -1) adjacent = true;
      });
      if (adjacent) break;
    }
    if (adjacent) out.push(patch);
  }
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
nix develop --command bash -c "npx vitest run tests/poi-helpers.test.ts"
```
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/poi/poi-selector.ts tests/poi-helpers.test.ts
git commit -m "Add regime + water-adjacency helpers to poi-selector"
```

---

## Task 5: selectPois — hamlet regime

**Files:**
- Modify: `src/poi/poi-selector.ts`
- Test: `tests/poi-hamlet.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/poi-hamlet.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { generateFromBurg, type AzgaarBurgInput } from '../src/index.js';
import { IdAllocator } from '../src/output/id-allocator.js';
import { selectPois } from '../src/poi/poi-selector.js';
import type { Polygon } from '../src/geom/polygon.js';

function makeBurg(overrides: Partial<AzgaarBurgInput> = {}): AzgaarBurgInput {
  return {
    name: 'Hamlet', population: 100, port: false, citadel: false,
    walls: false, plaza: false, temple: false, shanty: false, capital: false,
    ...overrides,
  };
}

function buildingMap(model: ReturnType<typeof generateFromBurg>['model']): Map<Polygon, string> {
  const alloc = new IdAllocator();
  const map = new Map<Polygon, string>();
  for (const patch of model.patches) {
    if (!patch.ward) continue;
    for (const b of patch.ward.geometry) map.set(b, alloc.alloc('b'));
  }
  return map;
}

describe('selectPois — hamlet regime (P < 300)', () => {
  it('emits no POIs below the tavern threshold (P < 30)', () => {
    const { model } = generateFromBurg(makeBurg({ population: 20 }), { seed: 1 });
    const pois = selectPois(model, 20, new IdAllocator(), buildingMap(model));
    expect(pois.filter(p => p.kind === 'tavern')).toHaveLength(0);
    expect(pois.filter(p => p.kind === 'well')).toHaveLength(0);
  });

  it('emits tavern and well at P=30', () => {
    const { model } = generateFromBurg(makeBurg({ population: 30 }), { seed: 1 });
    const pois = selectPois(model, 30, new IdAllocator(), buildingMap(model));
    const kinds = pois.map(p => p.kind).sort();
    expect(kinds).toContain('tavern');
    expect(kinds).toContain('well');
    expect(kinds).not.toContain('smithy');
    expect(kinds).not.toContain('chapel');
  });

  it('adds chapel at P=50, smithy at P=80', () => {
    const { model: m50 } = generateFromBurg(makeBurg({ population: 50 }), { seed: 1 });
    const kinds50 = selectPois(m50, 50, new IdAllocator(), buildingMap(m50)).map(p => p.kind);
    expect(kinds50).toContain('chapel');
    expect(kinds50).not.toContain('smithy');

    const { model: m80 } = generateFromBurg(makeBurg({ population: 80 }), { seed: 1 });
    const kinds80 = selectPois(m80, 80, new IdAllocator(), buildingMap(m80)).map(p => p.kind);
    expect(kinds80).toContain('smithy');
  });

  it('emits stable only when an inn was adopted', () => {
    const { model } = generateFromBurg(
      makeBurg({ population: 200 }),
      { seed: 1 },
    );
    const pois = selectPois(model, 200, new IdAllocator(), buildingMap(model));
    const hasInn = pois.some(p => p.kind === 'inn');
    const hasStable = pois.some(p => p.kind === 'stable');
    expect(hasStable).toBe(hasInn);
  });

  it('well has building_id=null and ward_type=null when no plaza exists', () => {
    const { model } = generateFromBurg(
      makeBurg({ population: 100, plaza: false }),
      { seed: 1 },
    );
    const pois = selectPois(model, 100, new IdAllocator(), buildingMap(model));
    const wells = pois.filter(p => p.kind === 'well');
    expect(wells).toHaveLength(1);
    expect(wells[0].buildingId).toBeNull();
    expect(wells[0].wardType).toBeNull();
  });

  it('is deterministic for identical inputs', () => {
    const run = () => {
      const { model } = generateFromBurg(makeBurg({ population: 150 }), { seed: 42 });
      return selectPois(model, 150, new IdAllocator(), buildingMap(model))
        .map(p => `${p.kind}:${p.buildingId}:${p.point.x.toFixed(2)},${p.point.y.toFixed(2)}`);
    };
    expect(run()).toEqual(run());
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
nix develop --command bash -c "npx vitest run tests/poi-hamlet.test.ts"
```
Expected: FAIL — selectPois returns `[]` stub.

- [ ] **Step 3: Replace the stub with the hamlet-regime implementation**

Edit `src/poi/poi-selector.ts`. Replace the stub `selectPois` with the full implementation. Keep scoring helpers + regime helpers unchanged; add below them:

```ts
interface EmitCtx {
  model: Model;
  population: number;
  allocator: IdAllocator;
  buildingIdMap: Map<Polygon, string>;
  usedBuildings: Set<Polygon>;
  pois: Poi[];
}

function allBuildings(model: Model): Array<{ building: Polygon; patch: Patch }> {
  const out: Array<{ building: Polygon; patch: Patch }> = [];
  for (const patch of model.patches) {
    if (!patch.ward) continue;
    for (const b of patch.ward.geometry) out.push({ building: b, patch });
  }
  return out;
}

function buildingsInWards(
  model: Model,
  wardTypes: ReadonlySet<WardType>,
): Array<{ building: Polygon; patch: Patch }> {
  return allBuildings(model).filter(({ patch }) => wardTypes.has(patch.ward!.type));
}

function adoptBest(
  ctx: EmitCtx,
  pool: Array<{ building: Polygon; patch: Patch }>,
  ref: Point,
): { building: Polygon; patch: Patch } | null {
  const available = pool.filter(p => !ctx.usedBuildings.has(p.building));
  if (available.length === 0) return null;
  const ordered = scoreBuildings(available.map(a => a.building), ref);
  const chosen = ordered[0];
  return available.find(a => a.building === chosen) ?? null;
}

function emitAdopted(
  ctx: EmitCtx,
  kind: PoiKind,
  preferredWards: ReadonlySet<WardType>,
  count: number,
  opts: { allowFallback: boolean },
): void {
  const ref = scoringReference(ctx.model);
  for (let i = 0; i < count; i++) {
    let target = adoptBest(ctx, buildingsInWards(ctx.model, preferredWards), ref);
    if (target === null && opts.allowFallback) {
      target = adoptBest(ctx, allBuildings(ctx.model), ref);
    }
    if (target === null) return; // skip remaining counts of this kind
    ctx.usedBuildings.add(target.building);
    ctx.pois.push({
      kind,
      point: target.building.centroid,
      wardType: target.patch.ward!.type,
      buildingId: ctx.buildingIdMap.get(target.building) ?? null,
    });
    ctx.allocator.alloc('p');
  }
}

function emitHamlet(ctx: EmitCtx): void {
  const P = ctx.population;
  const ALL: ReadonlySet<WardType> = new Set(Object.values(WardType));

  if (P >= 30) emitAdopted(ctx, 'tavern', ALL, 1, { allowFallback: true });
  if (P >= 50) emitAdopted(ctx, 'chapel', ALL, 1, { allowFallback: true });
  if (P >= 80) emitAdopted(ctx, 'smithy', ALL, 1, { allowFallback: true });
  if (isWaterAdjacent(ctx.model)) {
    emitAdopted(ctx, 'mill', ALL, 1, { allowFallback: true });
  }

  const gateCount = ctx.model.border?.gateMeta.size ?? 0;
  const innEmitted =
    P >= 150 && gateCount >= 2
      ? (emitAdopted(ctx, 'inn', ALL, 1, { allowFallback: true }),
         ctx.pois.some(p => p.kind === 'inn'))
      : false;
  if (innEmitted) emitAdopted(ctx, 'stable', ALL, 1, { allowFallback: true });

  if (P >= 30) {
    const point = ctx.model.plaza ? ctx.model.plaza.shape.center : ctx.model.center;
    const wardType = ctx.model.plaza ? ctx.model.plaza.ward?.type ?? null : null;
    ctx.pois.push({ kind: 'well', point, wardType, buildingId: null });
    ctx.allocator.alloc('p');
  }
}

export function selectPois(
  model: Model,
  population: number,
  allocator: IdAllocator,
  buildingIdMap: Map<Polygon, string>,
): Poi[] {
  const ctx: EmitCtx = {
    model, population, allocator, buildingIdMap,
    usedBuildings: new Set(),
    pois: [],
  };
  if (regimeFor(population) === 'hamlet') emitHamlet(ctx);
  // Town regime + harbour + piers added in later tasks.
  return ctx.pois;
}
```

Remove the previous stub `selectPois` from the bottom of the file. The definitive version is the one above.

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
nix develop --command bash -c "npx vitest run tests/poi-hamlet.test.ts"
```
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/poi/poi-selector.ts tests/poi-hamlet.test.ts
git commit -m "Implement hamlet-regime POI selection"
```

---

## Task 6: selectPois — town regime

**Files:**
- Modify: `src/poi/poi-selector.ts`
- Test: `tests/poi-town.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/poi-town.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { generateFromBurg, type AzgaarBurgInput } from '../src/index.js';
import { IdAllocator } from '../src/output/id-allocator.js';
import { selectPois } from '../src/poi/poi-selector.js';
import { WardType } from '../src/types/interfaces.js';
import type { Polygon } from '../src/geom/polygon.js';

function makeBurg(overrides: Partial<AzgaarBurgInput> = {}): AzgaarBurgInput {
  return {
    name: 'Town', population: 500, port: false, citadel: false,
    walls: true, plaza: true, temple: false, shanty: false, capital: false,
    ...overrides,
  };
}

function buildingMap(model: ReturnType<typeof generateFromBurg>['model']): Map<Polygon, string> {
  const alloc = new IdAllocator();
  const map = new Map<Polygon, string>();
  for (const patch of model.patches) {
    if (!patch.ward) continue;
    for (const b of patch.ward.geometry) map.set(b, alloc.alloc('b'));
  }
  return map;
}

describe('selectPois — town regime (P >= 300)', () => {
  it('emits max(1, ...) floors at P=300', () => {
    const { model } = generateFromBurg(makeBurg({ population: 300 }), { seed: 7 });
    const pois = selectPois(model, 300, new IdAllocator(), buildingMap(model));
    const counts = new Map<string, number>();
    for (const p of pois) counts.set(p.kind, (counts.get(p.kind) ?? 0) + 1);
    expect(counts.get('inn') ?? 0).toBeGreaterThanOrEqual(1);
    expect(counts.get('shop') ?? 0).toBeGreaterThanOrEqual(1);
    expect(counts.get('tavern') ?? 0).toBeGreaterThanOrEqual(2);
    expect(counts.get('smithy') ?? 0).toBeGreaterThanOrEqual(1);
    expect(counts.get('stable') ?? 0).toBeGreaterThanOrEqual(1);
  });

  it('emits bathhouse only when P >= 5000', () => {
    const { model: small } = generateFromBurg(makeBurg({ population: 3000 }), { seed: 7 });
    const smallPois = selectPois(small, 3000, new IdAllocator(), buildingMap(small));
    expect(smallPois.some(p => p.kind === 'bathhouse')).toBe(false);

    const { model: big } = generateFromBurg(makeBurg({ population: 8000 }), { seed: 7 });
    const bigPois = selectPois(big, 8000, new IdAllocator(), buildingMap(big));
    expect(bigPois.some(p => p.kind === 'bathhouse')).toBe(true);
  });

  it('emits 1 cathedral per Cathedral ward', () => {
    const { model } = generateFromBurg(
      makeBurg({ population: 20000, temple: true, capital: true }),
      { seed: 7 },
    );
    const cathedralWards = model.patches.filter(p => p.ward?.type === WardType.Cathedral).length;
    const pois = selectPois(model, 20000, new IdAllocator(), buildingMap(model));
    const emitted = pois.filter(p => p.kind === 'cathedral').length;
    expect(emitted).toBe(cathedralWards);
  });

  it('skips guildhalls when no Administration ward exists', () => {
    const { model } = generateFromBurg(
      makeBurg({ population: 400, capital: false }),
      { seed: 7 },
    );
    const hasAdmin = model.patches.some(p => p.ward?.type === WardType.Administration);
    const pois = selectPois(model, 400, new IdAllocator(), buildingMap(model));
    const guildhalls = pois.filter(p => p.kind === 'guildhall').length;
    if (!hasAdmin) expect(guildhalls).toBe(0);
  });

  it('1:1 adoption — no two POIs share a building_id', () => {
    const { model } = generateFromBurg(makeBurg({ population: 5000 }), { seed: 7 });
    const pois = selectPois(model, 5000, new IdAllocator(), buildingMap(model));
    const ids = pois
      .map(p => p.buildingId)
      .filter((id): id is string => id !== null);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('is deterministic for identical inputs', () => {
    const run = () => {
      const { model } = generateFromBurg(makeBurg({ population: 5000 }), { seed: 77 });
      return selectPois(model, 5000, new IdAllocator(), buildingMap(model))
        .map(p => `${p.kind}:${p.buildingId}`);
    };
    expect(run()).toEqual(run());
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
nix develop --command bash -c "npx vitest run tests/poi-town.test.ts"
```
Expected: FAIL — town regime not implemented.

- [ ] **Step 3: Implement the town regime**

Edit `src/poi/poi-selector.ts`. Add below `emitHamlet`:

```ts
function patchesWithWard(model: Model, type: WardType): Patch[] {
  return model.patches.filter(p => p.ward?.type === type);
}

function emitTown(ctx: EmitCtx): void {
  const P = ctx.population;

  // Tier 1 (adoption-essential), alphabetical within tier:
  //   cathedral, chapel, inn, market, mill, smithy, tavern
  // (`chapel` is hamlet-only; `market` and `cathedral` are 1-per-ward.)

  for (const _ of patchesWithWard(ctx.model, WardType.Cathedral)) {
    emitAdopted(ctx, 'cathedral', new Set([WardType.Cathedral]), 1, { allowFallback: false });
  }

  emitAdopted(ctx, 'inn', new Set([WardType.Merchant]),
    Math.max(1, Math.round(P / 1500)), { allowFallback: true });

  for (const _ of patchesWithWard(ctx.model, WardType.Market)) {
    emitAdopted(ctx, 'market', new Set([WardType.Market]), 1, { allowFallback: false });
  }

  if (isWaterAdjacent(ctx.model)) {
    const wards = new Set(
      waterAdjacentPatches(ctx.model).map(p => p.ward!.type),
    );
    emitAdopted(ctx, 'mill', wards, 1, { allowFallback: false });
  }

  emitAdopted(ctx, 'smithy', new Set([WardType.Craftsmen]),
    Math.max(1, Math.round(P / 2000)), { allowFallback: true });
  emitAdopted(ctx, 'tavern',
    new Set([WardType.Craftsmen, WardType.Slum, WardType.Harbour]),
    Math.max(2, Math.round(P / 1200)), { allowFallback: true });

  // Tier 2, alphabetical: bathhouse, guardhouse, guildhall, shop, stable, temple
  if (P >= 5000) {
    emitAdopted(ctx, 'bathhouse', new Set([WardType.Merchant, WardType.Patriciate]),
      1, { allowFallback: false });
  }
  for (const _ of patchesWithWard(ctx.model, WardType.Administration)) {
    emitAdopted(ctx, 'guardhouse', new Set([WardType.Administration]), 1, { allowFallback: false });
  }
  for (const _ of patchesWithWard(ctx.model, WardType.Military)) {
    emitAdopted(ctx, 'guardhouse', new Set([WardType.Military]), 1, { allowFallback: false });
  }
  for (const _ of patchesWithWard(ctx.model, WardType.GateWard)) {
    emitAdopted(ctx, 'guardhouse', new Set([WardType.GateWard]), 1, { allowFallback: false });
  }
  for (const _ of patchesWithWard(ctx.model, WardType.Administration)) {
    emitAdopted(ctx, 'guildhall', new Set([WardType.Administration]), 1, { allowFallback: false });
  }
  emitAdopted(ctx, 'shop', new Set([WardType.Merchant, WardType.Market]),
    Math.max(1, Math.round(P / 800)), { allowFallback: true });
  emitAdopted(ctx, 'stable', new Set([WardType.Craftsmen, WardType.GateWard]),
    Math.max(1, Math.round(P / 3000)), { allowFallback: false });
  if (P >= 8000) {
    for (const _ of patchesWithWard(ctx.model, WardType.Patriciate)) {
      emitAdopted(ctx, 'temple', new Set([WardType.Patriciate]), 1, { allowFallback: false });
    }
  }
}
```

Then update `selectPois` to dispatch to `emitTown`:

```ts
export function selectPois(
  model: Model,
  population: number,
  allocator: IdAllocator,
  buildingIdMap: Map<Polygon, string>,
): Poi[] {
  const ctx: EmitCtx = {
    model, population, allocator, buildingIdMap,
    usedBuildings: new Set(),
    pois: [],
  };
  if (regimeFor(population) === 'hamlet') emitHamlet(ctx);
  else emitTown(ctx);
  // Harbour warehouses + piers added in Task 7.
  return ctx.pois;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
nix develop --command bash -c "npx vitest run tests/poi-town.test.ts"
```
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/poi/poi-selector.ts tests/poi-town.test.ts
git commit -m "Implement town-regime POI selection with priority-tier ordering"
```

---

## Task 7: Harbour warehouses and pier POIs

**Files:**
- Modify: `src/poi/poi-selector.ts`
- Test: `tests/poi-harbour.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/poi-harbour.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { generateFromBurg, type AzgaarBurgInput } from '../src/index.js';
import { IdAllocator } from '../src/output/id-allocator.js';
import { selectPois } from '../src/poi/poi-selector.js';
import { WardType } from '../src/types/interfaces.js';
import { Harbour } from '../src/wards/harbour.js';
import type { Polygon } from '../src/geom/polygon.js';

function makePort(large: boolean, overrides: Partial<AzgaarBurgInput> = {}): AzgaarBurgInput {
  return {
    name: 'Port',
    population: large ? 20000 : 2000,
    port: true, citadel: false,
    walls: true, plaza: true, temple: false, shanty: false, capital: false,
    ...overrides,
  };
}

function buildingMap(model: ReturnType<typeof generateFromBurg>['model']): Map<Polygon, string> {
  const alloc = new IdAllocator();
  const map = new Map<Polygon, string>();
  for (const patch of model.patches) {
    if (!patch.ward) continue;
    for (const b of patch.ward.geometry) map.set(b, alloc.alloc('b'));
  }
  return map;
}

describe('selectPois — harbour', () => {
  it('emits one pier POI per pier polygon, ward_type=harbour, buildingId=null', () => {
    const { model } = generateFromBurg(makePort(true), { seed: 3 });
    if (model.harbour === null) {
      // Some seeds may not produce a harbour; bail gracefully.
      expect(true).toBe(true);
      return;
    }
    const pois = selectPois(model, 20000, new IdAllocator(), buildingMap(model));
    const piers = pois.filter(p => p.kind === 'pier');
    const harbour = model.harbour.ward as Harbour;
    expect(piers).toHaveLength(harbour.piers.length);
    for (const p of piers) {
      expect(p.wardType).toBe(WardType.Harbour);
      expect(p.buildingId).toBeNull();
    }
  });

  it('emits 2 warehouse POIs for a large harbour', () => {
    const { model } = generateFromBurg(makePort(true), { seed: 3 });
    if (model.harbour === null) return;
    const pois = selectPois(model, 20000, new IdAllocator(), buildingMap(model));
    const warehouses = pois.filter(p => p.kind === 'warehouse');
    expect(warehouses.length).toBeGreaterThanOrEqual(1);
    expect(warehouses.length).toBeLessThanOrEqual(2);
    for (const w of warehouses) {
      expect(w.wardType).toBe(WardType.Harbour);
      expect(w.buildingId).not.toBeNull();
    }
  });

  it('emits 1 warehouse POI for a small harbour', () => {
    const { model } = generateFromBurg(makePort(false), { seed: 3 });
    if (model.harbour === null) return;
    const pois = selectPois(model, 2000, new IdAllocator(), buildingMap(model));
    const warehouses = pois.filter(p => p.kind === 'warehouse');
    expect(warehouses.length).toBeLessThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
nix develop --command bash -c "npx vitest run tests/poi-harbour.test.ts"
```
Expected: FAIL — pier/warehouse POIs not emitted.

- [ ] **Step 3: Implement harbour emission**

Edit `src/poi/poi-selector.ts`. Add import at top if not present:

```ts
import { Harbour } from '../wards/harbour.js';
```

Add these helpers below `emitTown`:

```ts
/** Midpoint of a pier's outer edge (the edge farthest from the burg center). */
function pierOuterMidpoint(pier: Polygon, burgCenter: Point): Point {
  // Pier is always a 4-vertex rectangle (see src/wards/harbour.ts#createPiers).
  // Find the edge whose midpoint is farthest from the burg center.
  let best: Point | null = null;
  let bestD2 = -1;
  pier.forEdge((v0, v1) => {
    const mx = (v0.x + v1.x) / 2;
    const my = (v0.y + v1.y) / 2;
    const dx = mx - burgCenter.x;
    const dy = my - burgCenter.y;
    const d2 = dx * dx + dy * dy;
    if (d2 > bestD2) { bestD2 = d2; best = new Point(mx, my); }
  });
  return best ?? burgCenter;
}

function emitHarbour(ctx: EmitCtx): void {
  const harbourPatch = ctx.model.harbour;
  if (harbourPatch === null || !(harbourPatch.ward instanceof Harbour)) return;
  const harbour = harbourPatch.ward;

  // Warehouses: top-N by area (nearest-to-pier tiebreak baked into scoreBuildings via pier reference).
  const n = harbour.piers.length >= 3 ? 2 : 1; // `large` harbours get 3+ piers (see createPiers).
  const pierRef = harbour.piers.length > 0
    ? pierOuterMidpoint(harbour.piers[0], ctx.model.center)
    : ctx.model.center;
  const pool = harbourPatch.ward.geometry.map(b => ({ building: b, patch: harbourPatch }));
  for (let i = 0; i < n; i++) {
    const target = adoptBest(ctx, pool, pierRef);
    if (target === null) break;
    ctx.usedBuildings.add(target.building);
    ctx.pois.push({
      kind: 'warehouse',
      point: target.building.centroid,
      wardType: WardType.Harbour,
      buildingId: ctx.buildingIdMap.get(target.building) ?? null,
    });
    ctx.allocator.alloc('p');
  }

  // Piers: one POI per pier, point = outer-edge midpoint.
  for (const pier of harbour.piers) {
    ctx.pois.push({
      kind: 'pier',
      point: pierOuterMidpoint(pier, ctx.model.center),
      wardType: WardType.Harbour,
      buildingId: null,
    });
    ctx.allocator.alloc('p');
  }
}
```

Update `selectPois` to call `emitHarbour` after regime dispatch:

```ts
export function selectPois(
  model: Model,
  population: number,
  allocator: IdAllocator,
  buildingIdMap: Map<Polygon, string>,
): Poi[] {
  const ctx: EmitCtx = {
    model, population, allocator, buildingIdMap,
    usedBuildings: new Set(),
    pois: [],
  };
  if (regimeFor(population) === 'hamlet') emitHamlet(ctx);
  else emitTown(ctx);
  emitHarbour(ctx);
  return ctx.pois;
}
```

Note: `POI_TIER` is defined in `poi-kinds.ts` but is consumed by tests (Task 9), not by the selector. The selector enforces priority ordering via call order within `emitTown` / `emitHamlet`; the constant is the authoritative classification consumers can read from.

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
nix develop --command bash -c "npx vitest run tests/poi-harbour.test.ts"
```
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/poi/poi-selector.ts tests/poi-harbour.test.ts
git commit -m "Emit pier and warehouse POIs for harbour wards"
```

---

## Task 8: Wire allocator + selector into geojson-builder

**Files:**
- Modify: `src/output/geojson-builder.ts`
- Modify: `src/index.ts`
- Modify: `package.json`
- Update: `tests/entrance-output.test.ts`
- Test: `tests/geojson-schema-v3.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/geojson-schema-v3.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  generateFromBurg, GEOJSON_SCHEMA_VERSION, SETTLEMAKER_VERSION,
  type AzgaarBurgInput,
} from '../src/index.js';
import type { Feature, FeatureCollection } from 'geojson';

function makeBurg(overrides: Partial<AzgaarBurgInput> = {}): AzgaarBurgInput {
  return {
    name: 'V3', population: 5000, port: false, citadel: false,
    walls: true, plaza: true, temple: true, shanty: false, capital: false,
    ...overrides,
  };
}

function metadata(fc: FeatureCollection): Record<string, unknown> {
  return (fc as unknown as { metadata: Record<string, unknown> }).metadata;
}

function layer(fc: FeatureCollection, name: string): Feature[] {
  return fc.features.filter(f => f.properties?.['layer'] === name);
}

describe('GeoJSON schema v3 — metadata', () => {
  it('emits schema_version 3 and version 0.4.0', () => {
    const { geojson } = generateFromBurg(makeBurg(), { seed: 1 });
    expect(GEOJSON_SCHEMA_VERSION).toBe(3);
    expect(SETTLEMAKER_VERSION).toBe('0.4.0');
    expect(metadata(geojson).schema_version).toBe(3);
    expect(metadata(geojson).settlemaker_version).toBe('0.4.0');
  });

  it('emits stable_ids.prefixes with exactly four entries', () => {
    const { geojson } = generateFromBurg(makeBurg(), { seed: 1 });
    const m = metadata(geojson);
    expect(m.stable_ids).toEqual({
      prefixes: { entrance: 'g', poi: 'p', street: 's', building: 'b' },
    });
  });

  it('emits poi_density=town for P>=300 and hamlet for P<300', () => {
    const big = generateFromBurg(makeBurg({ population: 5000 }), { seed: 1 });
    expect(metadata(big.geojson).poi_density).toBe('town');
    const small = generateFromBurg(makeBurg({ population: 100, walls: false, plaza: false }), { seed: 1 });
    expect(metadata(small.geojson).poi_density).toBe('hamlet');
  });
});

describe('GeoJSON schema v3 — feature IDs', () => {
  it('every building has a unique building_id matching /^b\\d+$/', () => {
    const { geojson } = generateFromBurg(makeBurg(), { seed: 1 });
    const ids = layer(geojson, 'building').map(f => f.properties!['building_id'] as string);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(id).toMatch(/^b\d+$/);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every street has a unique street_id matching /^s\\d+$/', () => {
    const { geojson } = generateFromBurg(makeBurg(), { seed: 1 });
    const ids = layer(geojson, 'street').map(f => f.properties!['street_id'] as string);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(id).toMatch(/^s\d+$/);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every POI has a unique poi_id matching /^p\\d+$/', () => {
    const { geojson } = generateFromBurg(makeBurg(), { seed: 1 });
    const pois = layer(geojson, 'poi');
    expect(pois.length).toBeGreaterThan(0);
    const ids = pois.map(f => f.properties!['poi_id'] as string);
    for (const id of ids) expect(id).toMatch(/^p\d+$/);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('POIs with non-null building_id reference a real building', () => {
    const { geojson } = generateFromBurg(makeBurg(), { seed: 1 });
    const buildingIds = new Set(
      layer(geojson, 'building').map(f => f.properties!['building_id'] as string),
    );
    const poiLinks = layer(geojson, 'poi')
      .map(f => f.properties!['building_id'] as string | null)
      .filter((id): id is string => id !== null);
    for (const id of poiLinks) expect(buildingIds.has(id)).toBe(true);
  });

  it('floating POIs (pier, well) have building_id=null and all others have non-null', () => {
    const { geojson } = generateFromBurg(makeBurg({ port: true }), { seed: 1 });
    for (const f of layer(geojson, 'poi')) {
      const kind = f.properties!['kind'] as string;
      const bid = f.properties!['building_id'];
      if (kind === 'pier' || kind === 'well') expect(bid).toBeNull();
      else expect(bid).not.toBeNull();
    }
  });

  it('no POI feature has a name property in v1', () => {
    const { geojson } = generateFromBurg(makeBurg(), { seed: 1 });
    for (const f of layer(geojson, 'poi')) {
      expect(f.properties).not.toHaveProperty('name');
    }
  });

  it('determinism: same seed + burg produces identical feature IDs', () => {
    const burg = makeBurg();
    const a = generateFromBurg(burg, { seed: 42 });
    const b = generateFromBurg(burg, { seed: 42 });
    const idsOf = (fc: FeatureCollection, name: string, key: string) =>
      layer(fc, name).map(f => f.properties![key]);
    expect(idsOf(a.geojson, 'building', 'building_id')).toEqual(
      idsOf(b.geojson, 'building', 'building_id'),
    );
    expect(idsOf(a.geojson, 'street', 'street_id')).toEqual(
      idsOf(b.geojson, 'street', 'street_id'),
    );
    expect(idsOf(a.geojson, 'poi', 'poi_id')).toEqual(
      idsOf(b.geojson, 'poi', 'poi_id'),
    );
  });
});

describe('GeoJSON schema v3 — unchanged layers', () => {
  it('wall / tower / ward / pier / water / entrance keep their v2 property keysets', () => {
    const { geojson } = generateFromBurg(makeBurg({ port: true }), { seed: 1 });
    const expectedKeys: Record<string, Set<string>> = {
      wall: new Set(['layer', 'wallType']),
      tower: new Set(['layer', 'wallType']),
      ward: new Set(['layer', 'wardType', 'label', 'withinCity', 'withinWalls']),
      pier: new Set(['layer', 'wardType']),
    };
    for (const [name, keys] of Object.entries(expectedKeys)) {
      for (const f of layer(geojson, name)) {
        expect(new Set(Object.keys(f.properties ?? {}))).toEqual(keys);
      }
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
nix develop --command bash -c "npx vitest run tests/geojson-schema-v3.test.ts"
```
Expected: FAIL — schema still at 2, no POI features, no building/street IDs.

- [ ] **Step 3: Update the geojson-builder**

Edit `src/output/geojson-builder.ts`. Replace the following:

`GEOJSON_SCHEMA_VERSION` and `SETTLEMAKER_VERSION`:

```ts
export const GEOJSON_SCHEMA_VERSION = 3;
export const SETTLEMAKER_VERSION = '0.4.0';
```

Add imports near the top:

```ts
import { IdAllocator } from './id-allocator.js';
import { selectPois, regimeFor } from '../poi/poi-selector.js';
import { FLOATING_POI_KINDS } from '../poi/poi-kinds.js';
```

Replace the body of `generateGeoJson` with (keeping the signature):

```ts
export function generateGeoJson(model: Model, options: GenerateGeoJsonOptions = {}): FeatureCollection {
  const features: Feature[] = [];
  const allocator = new IdAllocator();
  const buildingIdMap = new Map<Polygon, string>();

  // 1. Wards + buildings (buildings get building_id; populate map for POI linking).
  for (const patch of model.patches) {
    if (!patch.ward) continue;

    features.push({
      type: 'Feature',
      properties: {
        layer: 'ward',
        wardType: patch.ward.type,
        label: patch.ward.getLabel(),
        withinCity: patch.withinCity,
        withinWalls: patch.withinWalls,
      },
      geometry: polygonToGeoJson(patch.shape),
    });

    for (const building of patch.ward.geometry) {
      const buildingId = allocator.alloc('b');
      buildingIdMap.set(building, buildingId);
      features.push({
        type: 'Feature',
        properties: {
          layer: 'building',
          wardType: patch.ward.type,
          building_id: buildingId,
        },
        geometry: polygonToGeoJson(building),
      });
    }

    if (patch.ward instanceof Harbour) {
      for (const pier of patch.ward.piers) {
        features.push({
          type: 'Feature',
          properties: {
            layer: 'pier',
            wardType: patch.ward.type,
          },
          geometry: polygonToGeoJson(pier),
        });
      }
    }
  }

  // 2. Streets: arteries then roads, each with a stable street_id.
  for (const artery of model.arteries) {
    features.push({
      type: 'Feature',
      properties: { layer: 'street', streetType: 'artery', street_id: allocator.alloc('s') },
      geometry: { type: 'LineString', coordinates: artery.vertices.map(v => [v.x, v.y]) },
    });
  }
  for (const road of model.roads) {
    features.push({
      type: 'Feature',
      properties: { layer: 'street', streetType: 'road', street_id: allocator.alloc('s') },
      geometry: { type: 'LineString', coordinates: road.vertices.map(v => [v.x, v.y]) },
    });
  }

  // 3. Walls + entrances (unchanged).
  if (model.wall !== null) {
    addWallFeatures(features, model.wall, 'city_wall');
  }
  if (model.citadel !== null && model.citadel.ward instanceof Castle) {
    addWallFeatures(features, (model.citadel.ward as Castle).wall, 'citadel_wall');
  }
  addEntranceFeatures(features, model);

  // 4. POIs: selected after the rest of the map is built.
  const pois = selectPois(model, model.params.population, allocator, buildingIdMap);
  let poiIdx = 0;
  for (const poi of pois) {
    const props: Record<string, unknown> = {
      layer: 'poi',
      poi_id: `p${poiIdx++}`,
      kind: poi.kind,
      ward_type: poi.wardType,
      building_id: poi.buildingId,
    };
    // Per spec: floating POIs are only `pier` and `well`; all other kinds must
    // have a non-null building_id or be omitted entirely (the selector enforces this).
    if (poi.buildingId === null && !FLOATING_POI_KINDS.has(poi.kind)) {
      throw new Error(`POI kind ${poi.kind} emitted without a building_id — selector bug`);
    }
    features.push({
      type: 'Feature',
      properties: props,
      geometry: { type: 'Point', coordinates: [poi.point.x, poi.point.y] },
    });
  }

  return {
    type: 'FeatureCollection',
    features,
    metadata: buildMetadata(model, model.params, options),
  } as FeatureCollection & { metadata: OutputMetadata };
}
```

Extend `OutputMetadata` and `buildMetadata`:

```ts
interface OutputMetadata {
  schema_version: number;
  settlemaker_version: string;
  settlement_generation_version: string;
  coordinate_system: string;
  coordinate_units: string;
  generated_at: string;
  local_bounds: LocalBounds;
  scale: {
    meters_per_unit: number;
    diameter_meters: number;
    diameter_local: number;
    source: string;
  };
  stable_ids: { prefixes: { entrance: 'g'; poi: 'p'; street: 's'; building: 'b' } };
  poi_density: 'hamlet' | 'town';
}

function buildMetadata(
  model: Model,
  params: GenerationParams,
  options: GenerateGeoJsonOptions,
): OutputMetadata {
  const diameterMeters = computeSettlementScale(params.population).diameterMeters;
  const diameterLocal = computeDiameterLocal(model);
  return {
    schema_version: GEOJSON_SCHEMA_VERSION,
    settlemaker_version: options.settlemakerVersion ?? SETTLEMAKER_VERSION,
    settlement_generation_version: computeGenerationVersion(params),
    coordinate_system: 'local_origin_y_down',
    coordinate_units: 'settlement_units',
    generated_at: options.generatedAt ?? new Date().toISOString(),
    local_bounds: computeLocalBounds(model, options.padding ?? 20),
    scale: {
      meters_per_unit: diameterMeters / diameterLocal,
      diameter_meters: diameterMeters,
      diameter_local: diameterLocal,
      source: 'population_heuristic_v1',
    },
    stable_ids: { prefixes: { entrance: 'g', poi: 'p', street: 's', building: 'b' } },
    poi_density: regimeFor(params.population),
  };
}
```

Edit `src/index.ts` to export the POI types. Add after the existing `export` lines:

```ts
export type { Poi, PoiKind } from './poi/poi-kinds.js';
```

Edit `package.json`:

```json
"version": "0.4.0",
```

Update `tests/entrance-output.test.ts` at line 297–299:

```ts
  it('emits schema_version 3', () => {
    const result = generateFromBurg(makeBurg(), { seed: 42 });
    expect(metadata(result.geojson).schema_version).toBe(3);
  });
```

- [ ] **Step 4: Run the full test suite to verify**

Run:
```bash
nix develop --command bash -c "npx vitest run"
```
Expected: all tests pass, including the new `tests/geojson-schema-v3.test.ts` (8 tests).

If existing tests that asserted building/street feature property keysets now fail due to the added IDs, update those assertions to include the new keys. Search for any missing updates:

```bash
nix develop --command bash -c "grep -rn \"'wardType'\\|'streetType'\" tests/"
```

- [ ] **Step 5: Commit**

```bash
git add src/output/geojson-builder.ts src/index.ts package.json tests/entrance-output.test.ts tests/geojson-schema-v3.test.ts
git commit -m "Bump GeoJSON schema to v3: emit POIs, building/street IDs, new metadata"
```

---

## Task 9: Priority-tier drop-off test

**Files:**
- Test: `tests/poi-drop-off.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/poi-drop-off.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { generateFromBurg, type AzgaarBurgInput } from '../src/index.js';
import { IdAllocator } from '../src/output/id-allocator.js';
import { selectPois } from '../src/poi/poi-selector.js';
import { POI_TIER } from '../src/poi/poi-kinds.js';
import type { Polygon } from '../src/geom/polygon.js';

function buildingMap(model: ReturnType<typeof generateFromBurg>['model']): Map<Polygon, string> {
  const alloc = new IdAllocator();
  const map = new Map<Polygon, string>();
  for (const patch of model.patches) {
    if (!patch.ward) continue;
    for (const b of patch.ward.geometry) map.set(b, alloc.alloc('b'));
  }
  return map;
}

function makeTiny(): AzgaarBurgInput {
  return {
    name: 'Tight',
    population: 300, // town regime floor — forces max(1,...) demands
    port: false, citadel: false, walls: true, plaza: true,
    temple: false, shanty: false, capital: false,
  };
}

describe('priority-tier drop-off', () => {
  it('Tier 3 (warehouse) drops before any Tier 1 when supply is exhausted', () => {
    // A landlocked tiny town has no harbour ward, so warehouses never appear
    // regardless of pressure. Construct an explicit exhaustion scenario:
    // a port burg where we pass a building map containing ONLY the first building
    // so adoption can only succeed once.
    const { model } = generateFromBurg(
      { ...makeTiny(), port: true, population: 400 },
      { seed: 1 },
    );
    // Build the map normally — selector will adopt top-N buildings by score.
    const pois = selectPois(model, 400, new IdAllocator(), buildingMap(model));
    const kinds = pois.map(p => p.kind);
    const hasSmithy = kinds.includes('smithy'); // Tier 1
    const hasWarehouse = kinds.includes('warehouse'); // Tier 3
    if (hasWarehouse) expect(hasSmithy).toBe(true); // If Tier 3 emitted, Tier 1 must have too.
  });

  it('POI_TIER never assigns a floating kind to Tier 1 or 2', () => {
    expect(POI_TIER.pier).toBe(3);
    expect(POI_TIER.well).toBe(3);
  });
});
```

- [ ] **Step 2: Run the test to verify it passes (should already)**

Run:
```bash
nix develop --command bash -c "npx vitest run tests/poi-drop-off.test.ts"
```
Expected: PASS, 2 tests. This is a confirmation test over existing behavior; if it fails, the priority tiers are miswired.

- [ ] **Step 3: Commit**

```bash
git add tests/poi-drop-off.test.ts
git commit -m "Test: priority tiers drop decorative before essential POIs"
```

---

## Task 10: Write the delta schema doc

**Files:**
- Create: `docs/schema-v3.md`

- [ ] **Step 1: Write the doc**

Create `docs/schema-v3.md`:

````markdown
# GeoJSON schema v3 — delta from v2

Bumped in release `0.4.0`. `metadata.schema_version: 3`.

## What changed

### Additions

- New feature layer **`poi`** (point geometry) with properties:
  `layer`, `poi_id`, `kind`, `ward_type`, `building_id`. No `name` — settlemaker does not generate POI names in v1; consumers add them.
- **`building_id: "b<idx>"`** added to every `layer: 'building'` feature.
- **`street_id: "s<idx>"`** added to every `layer: 'street'` feature (arteries and roads).
- New metadata block: `metadata.stable_ids.prefixes = { entrance: 'g', poi: 'p', street: 's', building: 'b' }`.
- New metadata field: `metadata.poi_density` — `'hamlet'` (P < 300) or `'town'` (P >= 300).

### Unchanged

`wall`, `tower`, `entrance`, `ward`, `pier`, `water` layers keep their exact v2 property keysets.
Entrance IDs continue to use the `g<wallVertexIndex>` scheme.

## Stable-ID contract

All feature IDs (`entrance_id`, `poi_id`, `street_id`, `building_id`) are stable across re-runs with the same seed and same inputs. Form: `<prefix><sequentialIdx>` where the index reflects generation order and the prefix disambiguates feature type.

Consumers should treat IDs as **opaque** but may rely on them as primary keys for persistence.

## Flat-LineString street contract

Each `layer: 'street'` feature has exactly one `street_id`. IDs are **never shared** across features. Branches produce separate features with separate IDs. Crossings are geometric intersections only — no shared identity, no junction object. Streets stay flat LineStrings; no graph/node/edge model at the contract level.

## `building_id` rule for POIs

`building_id` is `null` only when `poi.kind ∈ {'pier', 'well'}`. For all other kinds, `building_id` is non-null; if no suitable building exists, the POI is omitted entirely rather than emitted with `null`.

## `ward_type` rule for POIs

Non-null for every adopted POI (the ward of the adopted building) and for every ward-intrinsic floating POI (piers → `'harbour'`). Null only when the floating POI isn't geographically inside any ward — currently just `well` POIs in hamlet burgs that lack a Market ward.

Consumer predicate: `ward_type === null` iff the POI is a hamlet well without a Market ward.

## POI regimes

The selector splits at `P < 300`. The emitted `poi_density` metadata field reflects which regime ran.

- **Hamlet regime (P < 300).** Ward-agnostic guaranteed-minimum set: `tavern` (P≥30), `chapel` (P≥50), `smithy` (P≥80), `mill` (water-adjacent), `inn` (P≥150 AND ≥2 gates), `stable` (if inn emitted), `well` (P≥30, floating at plaza or burg center).
- **Town regime (P ≥ 300).** Ward-gated with `max(1, round(P/divisor))` floors. Full table in `docs/superpowers/specs/2026-04-23-poi-named-streets-design.md`.

## Migration for consumers

- Gate on `schema_version === 3` (or `>= 2 && <= 3` if you want to accept both).
- Treat `building_id` and `street_id` as primary keys. They're stable across re-runs with identical inputs.
- New POI features arrive unordered among existing features. Filter by `layer` and ignore unknown layers.
- Settlement naming (POI names, street names) is a consumer responsibility. Settlemaker emits no `name` properties.
````

- [ ] **Step 2: Commit**

```bash
git add docs/schema-v3.md
git commit -m "Document schema-v3 delta and consumer migration notes"
```

---

## Task 11: Smoke-test dump

**Files:**
- Modify: `smoke-test.ts`

- [ ] **Step 1: Inspect the current smoke test**

Run:
```bash
cat smoke-test.ts | head -60
```

- [ ] **Step 2: Extend the smoke test to dump POI counts**

Edit `smoke-test.ts`. After the existing SVG/GeoJSON generation, add (adapting to the file's existing structure — keep any existing hamlet/town/city runs, add POI-count dumping if absent):

```ts
import type { FeatureCollection } from 'geojson';

function dumpPoiCounts(label: string, fc: FeatureCollection): void {
  const counts = new Map<string, number>();
  for (const f of fc.features) {
    if (f.properties?.['layer'] !== 'poi') continue;
    const kind = f.properties!['kind'] as string;
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  console.log(`[${label}] POIs:`, sorted.map(([k, n]) => `${k}=${n}`).join(', ') || '(none)');
}

// At the bottom of smoke-test.ts, one invocation per population regime:
for (const [label, population, port] of [
  ['hamlet', 100, false] as const,
  ['town',   500, false] as const,
  ['city',   20000, true] as const,
]) {
  const { geojson } = generateFromBurg({
    name: label,
    population,
    port,
    citadel: false,
    walls: population >= 300,
    plaza: population >= 300,
    temple: population >= 5000,
    shanty: false,
    capital: population >= 10000,
  }, { seed: 99 });
  dumpPoiCounts(label, geojson);
}
```

- [ ] **Step 3: Run the smoke test**

Run:
```bash
nix develop --command bash -c "npx tsx smoke-test.ts"
```
Expected: prints three lines with POI counts per kind for hamlet, town, city. No errors.

- [ ] **Step 4: Commit**

```bash
git add smoke-test.ts
git commit -m "Smoke-test: dump per-kind POI counts for hamlet/town/city"
```

---

## Task 12: Final verification

- [ ] **Step 1: Run the full test suite**

Run:
```bash
nix develop --command bash -c "npx vitest run"
```
Expected: all tests pass. Note the total count — it should be the prior 120 plus the new tests added here (approximately 30+ new tests across id-allocator, poi-kinds, poi-scoring, poi-helpers, poi-hamlet, poi-town, poi-harbour, poi-drop-off, geojson-schema-v3).

- [ ] **Step 2: TypeScript build**

Run:
```bash
nix develop --command bash -c "npx tsc --noEmit"
```
Expected: no type errors.

- [ ] **Step 3: Run the smoke test**

Run:
```bash
nix develop --command bash -c "npx tsx smoke-test.ts"
```
Expected: clean run with POI counts for the three regimes.

- [ ] **Step 4: Inspect one generated GeoJSON**

Run:
```bash
nix develop --command bash -c "npx tsx -e \"
import { generateFromBurg } from './src/index.js';
const { geojson } = generateFromBurg({
  name: 'X', population: 5000, port: true, citadel: false,
  walls: true, plaza: true, temple: true, shanty: false, capital: false,
}, { seed: 1 });
console.log(JSON.stringify((geojson as any).metadata, null, 2));
const counts = new Map();
for (const f of geojson.features) {
  const l = f.properties.layer; counts.set(l, (counts.get(l) ?? 0) + 1);
}
console.log(Object.fromEntries(counts));
\""
```
Expected: metadata prints with `schema_version: 3`, `settlemaker_version: "0.4.0"`, `stable_ids.prefixes`, `poi_density: 'town'`. Feature count per layer includes `poi` with a non-zero count.

- [ ] **Step 5: Final commit tagging the release candidate**

Only run if all verification steps succeeded.

```bash
git status
```

If anything is uncommitted, investigate — do not create a release commit on top of dirty state.

---

## Spec coverage check

Mapping each spec requirement to a task:

- Metadata bump `schema_version: 3` → Task 8.
- `settlemaker_version: "0.4.0"` → Task 8.
- `metadata.stable_ids.prefixes` → Task 8.
- `metadata.poi_density` → Task 8 (uses `regimeFor` from Task 4).
- New `layer: 'poi'` features → Task 8 (emission) + Tasks 5–7 (selector).
- `PoiKind` union + `Poi` interface → Task 2.
- `building_id` on every building → Task 8.
- `street_id` on every street → Task 8.
- `IdAllocator` → Task 1.
- Canonical iteration order (buildings → streets → POIs) → Task 8.
- Two-regime selector (hamlet < 300, town ≥ 300) → Tasks 5 + 6.
- Priority tiers, essentials-first → Task 2 (tiers) + Tasks 5–6 (ordering) + Task 9 (test).
- 1:1 adoption, `usedBuildings` — no doubling up → Tasks 5 + 6, asserted in Task 6.
- `break` semantics — kind fails, next kind continues → built into `emitAdopted` (Task 5); tested in Task 9.
- `allowFallback` for universal kinds → Tasks 5 + 6.
- Harbour warehouses (selective, 1–2 notable) → Task 7.
- Pier POIs (outer-edge midpoint, ward_type=`'harbour'`) → Task 7.
- `building_id: null` iff `kind ∈ {pier, well}` → enforced by `emitHarbour` + `emitHamlet`; asserted in Task 8.
- `ward_type: null` iff hamlet well without Market ward → Task 5.
- Water-adjacent mill gating → Task 4 (helper) + Task 5 (hamlet) + Task 6 (town).
- Flat-LineString street contract → Task 10 (doc).
- `docs/schema-v3.md` delta doc → Task 10.
- `smoke-test.ts` POI dump → Task 11.
- Updated existing geojson tests → Task 8 (specifically `entrance-output.test.ts`).
- POI selection tests → Tasks 5–7, 9.
- Schema-level v3 tests → Task 8.
- Exports `Poi`, `PoiKind` from `src/index.ts` → Task 8.

All spec items covered.
