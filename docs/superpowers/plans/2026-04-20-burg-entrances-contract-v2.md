# Burg Entrances & Bounds Contract v2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Emit unified entrance features for walled AND unwalled burgs, plus `local_bounds` and settlement-intrinsic `scale` in metadata, so questables Plan 3b can translate world-pixel positions to tile-pixel positions for any burg.

**Architecture:** Reuse `model.border` (which always exists post-`buildWalls()` and already has populated `gateMeta`) as the source of entrance points for walled and unwalled alike. Extract a shared `computeLocalBounds` helper used by both the SVG viewBox and GeoJSON metadata so they can't drift. Decouple the emitted scale from tile geometry by dividing `diameter_meters` (population heuristic) by `diameter_local` (the border polygon's circumscribed-circle diameter), independent of any tiler choices.

**Tech Stack:** TypeScript 5.7, vitest 3.0, `nix develop` shell, no runtime deps beyond `@types/geojson`.

**Spec:** `docs/superpowers/specs/2026-04-20-burg-entrances-contract-v2-design.md`

---

## File structure

**Create:**
- `src/generator/bounds.ts` — `computeLocalBounds`, `computeDiameterLocal`, `LocalBounds` type
- `tests/bounds.test.ts` — unit tests for the helpers

**Modify:**
- `src/generator/generation-params.ts` — add required `population: number` field
- `src/input/azgaar-input.ts` — pass `burg.population` into `GenerationParams`
- `src/output/svg-builder.ts` — replace inline AABB loop with `computeLocalBounds` call
- `src/output/geojson-builder.ts` — bump schema to 2; add `local_bounds` and `scale` to metadata; rename gate→entrance; drop walled-only guard; add `arrival_local`; add `padding` option
- `src/index.ts` — re-export the new `bounds.ts` helpers and types
- `tests/gate-output.test.ts` — rename to `tests/entrance-output.test.ts`; rename all `gate` references to `entrance`; invert the "unwalled burgs emit zero gates" test into a positive assertion

**Untouched:**
- `src/generator/curtain-wall.ts` — existing gate-placement logic already produces correct `gateMeta` for both walled and unwalled
- `src/output/settlement-tiler.ts` — internal `metersPerUnit` math is a separate concern; defer unification
- `ingest-burg-entrances.ts` and `migrations/001_burg_entrances.sql` — questables-side, out of scope

---

## Task 1: Thread `population` through `GenerationParams`

**Files:**
- Modify: `src/generator/generation-params.ts`
- Modify: `src/input/azgaar-input.ts:91-105`

**Why this comes first:** Task 5's metadata needs `population` available inside `geojson-builder.buildMetadata(params, options)`. Today `GenerationParams` doesn't carry it — `populationToPatches` consumes it in `azgaar-input.ts` but doesn't pass it on.

- [ ] **Step 1: Add the `population` field to the `GenerationParams` interface**

Edit `src/generator/generation-params.ts` — add one line inside the interface. Place it adjacent to the existing scalar fields, above `// Future extension points`:

```ts
export interface GenerationParams {
  /** Number of Voronoi patches for the inner city */
  nPatches: number;
  /** Population used for scale emission in GeoJSON metadata. */
  population: number;
  /** Whether to generate a central market plaza */
  plazaNeeded: boolean;
  // ... rest unchanged
}
```

- [ ] **Step 2: Include `population` in `mapToGenerationParams` output**

In `src/input/azgaar-input.ts`, modify the return object inside `mapToGenerationParams` (lines 91–105). Add `population: burg.population,` immediately after `nPatches`:

```ts
return {
  nPatches: populationToPatches(burg.population),
  population: burg.population,
  plazaNeeded: burg.plaza,
  // ... rest unchanged
};
```

- [ ] **Step 3: Run existing tests to verify no regression**

Run: `nix develop --command bash -c "npx vitest run"`
Expected: all 120 existing tests still pass. `GenerationParams` is an interface used structurally; adding a required field causes TypeScript to fail on any construct-site that doesn't include it — but `mapToGenerationParams` is the only construction site in test code.

If any test fails to compile with `Property 'population' is missing in type`, that test constructs `GenerationParams` directly — add `population: <any reasonable number>` to it.

- [ ] **Step 4: Commit**

```bash
git add src/generator/generation-params.ts src/input/azgaar-input.ts
git commit -m "Thread population through GenerationParams for metadata scale"
```

---

## Task 2: Create `computeLocalBounds` helper

**Files:**
- Create: `src/generator/bounds.ts`
- Create: `tests/bounds.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/bounds.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { generateFromBurg, type AzgaarBurgInput } from '../src/index.js';
import { computeLocalBounds } from '../src/generator/bounds.js';

function makeBurg(overrides: Partial<AzgaarBurgInput> = {}): AzgaarBurgInput {
  return {
    name: 'BoundsBurg',
    population: 5000,
    port: false,
    citadel: false,
    walls: true,
    plaza: true,
    temple: false,
    shanty: false,
    capital: false,
    ...overrides,
  };
}

describe('computeLocalBounds', () => {
  it('returns an AABB that contains every patch vertex plus padding', () => {
    const { model } = generateFromBurg(makeBurg(), { seed: 42 });
    const bounds = computeLocalBounds(model, 20);

    for (const patch of model.patches) {
      for (const v of patch.shape.vertices) {
        expect(v.x).toBeGreaterThanOrEqual(bounds.min_x);
        expect(v.x).toBeLessThanOrEqual(bounds.max_x);
        expect(v.y).toBeGreaterThanOrEqual(bounds.min_y);
        expect(v.y).toBeLessThanOrEqual(bounds.max_y);
      }
    }
  });

  it('respects the padding argument', () => {
    const { model } = generateFromBurg(makeBurg(), { seed: 42 });
    const tight = computeLocalBounds(model, 0);
    const padded = computeLocalBounds(model, 20);
    expect(padded.min_x).toBeCloseTo(tight.min_x - 20);
    expect(padded.min_y).toBeCloseTo(tight.min_y - 20);
    expect(padded.max_x).toBeCloseTo(tight.max_x + 20);
    expect(padded.max_y).toBeCloseTo(tight.max_y + 20);
  });

  it('covers street and road polylines', () => {
    const { model } = generateFromBurg(makeBurg({ population: 15000 }), { seed: 42 });
    const bounds = computeLocalBounds(model, 0);

    for (const artery of model.arteries) {
      for (const v of artery.vertices) {
        expect(v.x).toBeGreaterThanOrEqual(bounds.min_x);
        expect(v.x).toBeLessThanOrEqual(bounds.max_x);
        expect(v.y).toBeGreaterThanOrEqual(bounds.min_y);
        expect(v.y).toBeLessThanOrEqual(bounds.max_y);
      }
    }
    for (const road of model.roads) {
      for (const v of road.vertices) {
        expect(v.x).toBeGreaterThanOrEqual(bounds.min_x);
        expect(v.x).toBeLessThanOrEqual(bounds.max_x);
        expect(v.y).toBeGreaterThanOrEqual(bounds.min_y);
        expect(v.y).toBeLessThanOrEqual(bounds.max_y);
      }
    }
  });

  it('is deterministic for the same seed', () => {
    const a = generateFromBurg(makeBurg(), { seed: 42 }).model;
    const b = generateFromBurg(makeBurg(), { seed: 42 }).model;
    expect(computeLocalBounds(a, 20)).toEqual(computeLocalBounds(b, 20));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nix develop --command bash -c "npx vitest run tests/bounds.test.ts"`
Expected: FAIL — `Cannot find module '../src/generator/bounds.js'` or equivalent.

- [ ] **Step 3: Create `bounds.ts` with `LocalBounds` and `computeLocalBounds`**

Create `src/generator/bounds.ts`:

```ts
import type { Model } from './model.js';
import type { Point } from '../types/point.js';

/** Axis-aligned bounding box in settlement-local coordinates (y-down). */
export interface LocalBounds {
  min_x: number;
  min_y: number;
  max_x: number;
  max_y: number;
}

/**
 * Compute the AABB of every geometrically-placed feature in the model —
 * patches, walls, streets/arteries/roads, harbour piers — plus a uniform
 * padding applied to all four sides.
 *
 * Both the SVG viewBox and the GeoJSON `metadata.local_bounds` derive from
 * this so they cannot drift. Pass the same padding to both callers.
 */
export function computeLocalBounds(model: Model, padding = 20): LocalBounds {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  const expand = (p: Point) => {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  };

  for (const patch of model.patches) {
    for (const v of patch.shape.vertices) expand(v);
  }
  if (model.wall !== null) {
    for (const v of model.wall.shape.vertices) expand(v);
  }
  if (model.border !== null) {
    for (const v of model.border.shape.vertices) expand(v);
  }
  for (const artery of model.arteries) {
    for (const v of artery.vertices) expand(v);
  }
  for (const road of model.roads) {
    for (const v of road.vertices) expand(v);
  }
  for (const street of model.streets) {
    for (const v of street.vertices) expand(v);
  }

  return {
    min_x: minX - padding,
    min_y: minY - padding,
    max_x: maxX + padding,
    max_y: maxY + padding,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `nix develop --command bash -c "npx vitest run tests/bounds.test.ts"`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/generator/bounds.ts tests/bounds.test.ts
git commit -m "Add computeLocalBounds helper for shared AABB computation"
```

---

## Task 3: Add `computeDiameterLocal` to `bounds.ts`

**Files:**
- Modify: `src/generator/bounds.ts`
- Modify: `tests/bounds.test.ts`

- [ ] **Step 1: Extend the test file with a `computeDiameterLocal` suite**

Append to `tests/bounds.test.ts` (after the `computeLocalBounds` describe block):

```ts
import { computeDiameterLocal } from '../src/generator/bounds.js';

describe('computeDiameterLocal', () => {
  it('returns 2 * max vertex distance from origin on the border polygon', () => {
    const { model } = generateFromBurg(makeBurg(), { seed: 42 });
    expect(model.border).not.toBeNull();

    let maxDist = 0;
    for (const v of model.border!.shape.vertices) {
      maxDist = Math.max(maxDist, v.length);
    }

    expect(computeDiameterLocal(model)).toBeCloseTo(maxDist * 2);
  });

  it('is non-zero for a tiny hamlet', () => {
    const { model } = generateFromBurg(
      makeBurg({ population: 80, walls: false, plaza: false }),
      { seed: 42 },
    );
    expect(computeDiameterLocal(model)).toBeGreaterThan(0);
  });

  it('is deterministic for the same seed', () => {
    const a = generateFromBurg(makeBurg(), { seed: 42 }).model;
    const b = generateFromBurg(makeBurg(), { seed: 42 }).model;
    expect(computeDiameterLocal(a)).toBeCloseTo(computeDiameterLocal(b));
  });
});
```

Merge the import with the existing one at the top of the file so there's a single `import` statement from `../src/generator/bounds.js`.

- [ ] **Step 2: Run test to verify it fails**

Run: `nix develop --command bash -c "npx vitest run tests/bounds.test.ts"`
Expected: FAIL — `computeDiameterLocal` is not exported.

- [ ] **Step 3: Add the function to `bounds.ts`**

Append to `src/generator/bounds.ts`:

```ts
/**
 * Diameter (in local units) of the smallest origin-centred circle enclosing
 * the settlement's outer perimeter. Divided into `diameter_meters` (from the
 * population heuristic) this yields a tile-geometry-independent
 * `meters_per_unit` ratio.
 *
 * `model.border` always exists post-`buildWalls()`, for both walled and
 * unwalled burgs. Throws if called before generation completes.
 */
export function computeDiameterLocal(model: Model): number {
  if (model.border === null) {
    throw new Error('computeDiameterLocal called before buildWalls()');
  }
  let maxR = 0;
  for (const v of model.border.shape.vertices) {
    if (v.length > maxR) maxR = v.length;
  }
  return maxR * 2;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `nix develop --command bash -c "npx vitest run tests/bounds.test.ts"`
Expected: PASS — 7 tests total.

- [ ] **Step 5: Commit**

```bash
git add src/generator/bounds.ts tests/bounds.test.ts
git commit -m "Add computeDiameterLocal helper for settlement-intrinsic scale"
```

---

## Task 4: Refactor `svg-builder.ts` to use `computeLocalBounds`

**Files:**
- Modify: `src/output/svg-builder.ts:1-76`

- [ ] **Step 1: Replace the inline AABB loop with `computeLocalBounds`**

Edit `src/output/svg-builder.ts`. Add the import at the top (after the other imports, e.g. after line 10):

```ts
import { computeLocalBounds } from '../generator/bounds.js';
```

Replace lines 56-76 (from `const padding = options.padding ?? 20;` through the `parts.push('<svg xmlns...')` line) with:

```ts
  const padding = options.padding ?? 20;
  const bounds = computeLocalBounds(model, padding);
  const viewMinX = bounds.min_x;
  const viewMinY = bounds.min_y;
  const viewWidth = bounds.max_x - bounds.min_x;
  const viewHeight = bounds.max_y - bounds.min_y;

  const parts: string[] = [];

  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewMinX.toFixed(1)} ${viewMinY.toFixed(1)} ${viewWidth.toFixed(1)} ${viewHeight.toFixed(1)}">`);
```

Leave everything below line 76 (the background `<rect>`, water, roads, etc.) unchanged.

- [ ] **Step 2: Run full test suite to verify no regressions**

Run: `nix develop --command bash -c "npx vitest run"`
Expected: all tests pass. The SVG output may include a few more units of coverage (viewBox widens to include walls/streets that previously fell outside), but no existing test asserts the exact viewBox numbers.

If `parseSvgViewBox`-related tests in `settlement-tiler.test.ts` fail, the values changed by a few units; update the expected values to match the new bounds.

- [ ] **Step 3: Commit**

```bash
git add src/output/svg-builder.ts
git commit -m "Use computeLocalBounds for SVG viewBox to cover non-patch features"
```

---

## Task 5: Add `local_bounds` + `scale` to metadata; bump schema to 2

**Files:**
- Modify: `src/output/geojson-builder.ts`
- Modify: `tests/gate-output.test.ts` (will be renamed in Task 6)

- [ ] **Step 1: Write the failing tests**

Append to `tests/gate-output.test.ts` (or add a new `describe` block at the end):

```ts
describe('GeoJSON metadata — local_bounds and scale', () => {
  it('emits schema_version 2', () => {
    const result = generateFromBurg(makeBurg(), { seed: 42 });
    expect(metadata(result.geojson).schema_version).toBe(2);
  });

  it('emits local_bounds with four numeric fields', () => {
    const result = generateFromBurg(makeBurg(), { seed: 42 });
    const lb = metadata(result.geojson).local_bounds as Record<string, number>;
    expect(typeof lb.min_x).toBe('number');
    expect(typeof lb.min_y).toBe('number');
    expect(typeof lb.max_x).toBe('number');
    expect(typeof lb.max_y).toBe('number');
    expect(lb.max_x).toBeGreaterThan(lb.min_x);
    expect(lb.max_y).toBeGreaterThan(lb.min_y);
  });

  it('emits scale with meters_per_unit = diameter_meters / diameter_local', () => {
    const result = generateFromBurg(makeBurg({ population: 5000 }), { seed: 42 });
    const scale = metadata(result.geojson).scale as Record<string, number | string>;
    expect(typeof scale.meters_per_unit).toBe('number');
    expect(typeof scale.diameter_meters).toBe('number');
    expect(typeof scale.diameter_local).toBe('number');
    expect(scale.source).toBe('population_heuristic_v1');
    const ratio = (scale.diameter_meters as number) / (scale.diameter_local as number);
    expect(scale.meters_per_unit as number).toBeCloseTo(ratio);
  });

  it('scale.diameter_meters matches computeSettlementScale(population)', () => {
    // Independently compute the expected value so a regression in the heuristic shows up here.
    const pop = 5000;
    const expected = 200 * Math.pow(pop / 100, 0.4);
    const result = generateFromBurg(makeBurg({ population: pop }), { seed: 42 });
    const scale = metadata(result.geojson).scale as Record<string, number>;
    expect(scale.diameter_meters).toBeCloseTo(expected);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `nix develop --command bash -c "npx vitest run tests/gate-output.test.ts"`
Expected: 4 new tests FAIL. The `schema_version` test fails because the current value is 1. The `local_bounds` and `scale` tests fail because those fields don't exist yet. Also: some existing `schema_version` tests that used `toBe(GEOJSON_SCHEMA_VERSION)` will still pass because they use the constant — make sure the failing ones are the newly-added tests.

- [ ] **Step 3: Implement the metadata extension**

Edit `src/output/geojson-builder.ts`.

Change line 14:
```ts
export const GEOJSON_SCHEMA_VERSION = 2;
```

Add imports at the top (after existing imports, before the `GEOJSON_SCHEMA_VERSION` export):
```ts
import { computeLocalBounds, computeDiameterLocal } from '../generator/bounds.js';
import { computeSettlementScale } from './settlement-tiler.js';
import type { LocalBounds } from '../generator/bounds.js';
```

Extend the `OutputMetadata` interface (around line 116):
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
}
```

Change `buildMetadata`'s signature to accept the model so it can compute bounds and diameter. The current signature is `buildMetadata(params: GenerationParams, options: GenerateGeoJsonOptions)`. Change to:

```ts
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
  };
}
```

Update the call site at line 112-113 to pass the model:
```ts
    metadata: buildMetadata(model, model.params, options),
```

Add `padding?: number` to `GenerateGeoJsonOptions` (around line 22):
```ts
export interface GenerateGeoJsonOptions {
  /** ISO-8601 timestamp to stamp on the output. Defaults to `new Date().toISOString()`. */
  generatedAt?: string;
  /** Override the library version string (mostly for tests). */
  settlemakerVersion?: string;
  /** Padding (local units) for `metadata.local_bounds`. MUST match SvgOptions.padding if both generators are invoked on the same model. Defaults to 20 to match the SVG default. */
  padding?: number;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `nix develop --command bash -c "npx vitest run tests/gate-output.test.ts"`
Expected: the 4 new tests PASS. Existing tests that use `GEOJSON_SCHEMA_VERSION` continue to pass against the new value of 2.

- [ ] **Step 5: Run the full suite to check for fallout**

Run: `nix develop --command bash -c "npx vitest run"`
Expected: all tests pass. Any determinism test that depends on `settlement_generation_version` will still work — bumping the schema changes the hash inputs, but each run produces the same new hash, so intra-run stability holds.

- [ ] **Step 6: Commit**

```bash
git add src/output/geojson-builder.ts tests/gate-output.test.ts
git commit -m "Emit local_bounds and settlement-intrinsic scale in GeoJSON metadata; bump schema to 2"
```

---

## Task 6: Rename `gate` → `entrance` across output and tests

**Files:**
- Modify: `src/output/geojson-builder.ts`
- Rename + modify: `tests/gate-output.test.ts` → `tests/entrance-output.test.ts`

- [ ] **Step 1: Rename the output layer and property names in `geojson-builder.ts`**

Edit `src/output/geojson-builder.ts`.

Rename the function `addGateFeatures` → `addEntranceFeatures`. Update its call site (search for `addGateFeatures(` in the file — there's one call around line 106).

Rename `gateFeatureFor` → `entranceFeatureFor`. Update its one call site inside the renamed function.

Inside `entranceFeatureFor`, rename property keys:
- `layer: 'gate'` → `layer: 'entrance'`
- `const gateId = \`g${meta.wallVertexIndex}\`;` → `const entranceId = \`g${meta.wallVertexIndex}\`;`
- `gate_id: gateId` → `entrance_id: entranceId`
- Rename the `neighbours.prev` / `neighbours.next` assignments from `prev_gate_id` / `next_gate_id` to `prev_entrance_id` / `next_entrance_id`.

Rename `findNeighbourGates` → `findNeighbourEntrances`. Inside the function, the values it returns are strings that get stored in `prev_entrance_id` / `next_entrance_id`; the values themselves (e.g. `g12`) don't change.

Do NOT yet drop the `if (model.wall === null) return` guard — that's Task 7's job. Do NOT yet add `arrival_local` — that's Task 8's job.

- [ ] **Step 2: Rename the test file**

```bash
git mv tests/gate-output.test.ts tests/entrance-output.test.ts
```

- [ ] **Step 3: Update the test file contents**

Edit `tests/entrance-output.test.ts`. Do a find-and-replace pass (not `replace_all` globally, because some text should stay unchanged — `roadBearings`, comments about "bearings", etc.):

- `gate_id` → `entrance_id` (all occurrences)
- `prev_gate_id` → `prev_entrance_id`
- `next_gate_id` → `next_entrance_id`
- `layer: 'gate'` → `layer: 'entrance'`
- `layer === 'gate'` → `layer === 'entrance'`
- Rename the helper function `gateFeatures` → `entranceFeatures`.
- Rename the `describe('Gate features', ...)` block → `describe('Entrance features', ...)`.

Skip the `describe('Unwalled burgs', ...)` block for now — it still says unwalled burgs emit zero entrance features. Task 7 will flip that assertion.

- [ ] **Step 4: Run tests to verify the rename is internally consistent**

Run: `nix develop --command bash -c "npx vitest run tests/entrance-output.test.ts"`
Expected: all existing tests PASS (they assert the same shape, just under the new names). The unwalled-burg "emits no entrance features" test is still passing — that's about to change in Task 7.

- [ ] **Step 5: Run the full suite**

Run: `nix develop --command bash -c "npx vitest run"`
Expected: all tests pass. If `integration.test.ts` or any other file reads `layer === 'gate'`, update those references too.

- [ ] **Step 6: Commit**

```bash
git add src/output/geojson-builder.ts tests/entrance-output.test.ts tests/gate-output.test.ts
git commit -m "Rename GeoJSON gate layer and property names to entrance"
```

---

## Task 7: Emit entrances for unwalled burgs

**Files:**
- Modify: `src/output/geojson-builder.ts`
- Modify: `tests/entrance-output.test.ts`

- [ ] **Step 1: Flip the failing "unwalled emits zero" tests into positive assertions**

Edit `tests/entrance-output.test.ts`. Replace the `describe('Unwalled burgs', ...)` block with:

```ts
describe('Unwalled burgs', () => {
  it('emits entrance features matching roadBearings', () => {
    const result = generateFromBurg(
      makeBurg({
        walls: false,
        population: 400,
        citadel: false,
        plaza: false,
        roadBearings: [
          { bearing_deg: 0, route_id: 'route-north', kind: 'road' },
          { bearing_deg: 180, route_id: 'route-south', kind: 'road' },
        ],
      }),
      { seed: 42 },
    );
    const entrances = entranceFeatures(result.geojson);
    expect(entrances.length).toBeGreaterThan(0);
    const matched = entrances
      .map(e => e.properties!['matched_route_id'])
      .filter((v): v is string => typeof v === 'string');
    expect(matched.length).toBeGreaterThan(0);
    for (const id of matched) {
      expect(['route-north', 'route-south']).toContain(id);
    }
  });

  it('emits entrance features for unwalled burgs without bearings (random placement)', () => {
    const result = generateFromBurg(
      makeBurg({ walls: false, population: 300, citadel: false, plaza: false }),
      { seed: 42 },
    );
    const entrances = entranceFeatures(result.geojson);
    expect(entrances.length).toBeGreaterThan(0);
    for (const e of entrances) {
      // No route hints → no match
      expect(e.properties!['matched_route_id']).toBeUndefined();
      expect(e.properties!['layer']).toBe('entrance');
    }
  });

  it('still emits a valid metadata block for unwalled burgs', () => {
    const result = generateFromBurg(
      makeBurg({ walls: false, population: 300, citadel: false, plaza: false }),
      { seed: 42 },
    );
    expect(metadata(result.geojson).schema_version).toBe(2);
    expect(metadata(result.geojson).local_bounds).toBeDefined();
    expect(metadata(result.geojson).scale).toBeDefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `nix develop --command bash -c "npx vitest run tests/entrance-output.test.ts"`
Expected: the new unwalled tests FAIL — `expected 0 to be greater than 0`. The metadata block test passes (metadata is emitted already); the entrance-count tests fail because the walled-only guard still bails.

- [ ] **Step 3: Drop the walled-only guard and use `model.border`**

Edit `src/output/geojson-builder.ts`.

Replace the body of `addEntranceFeatures`:

```ts
function addEntranceFeatures(features: Feature[], model: Model): void {
  // model.border always exists post-buildWalls(); it holds gateMeta for
  // walled AND unwalled burgs. Citadel-wall gates live on a different
  // CurtainWall and are excluded naturally by the gateMeta.get() filter.
  if (model.border === null) return;
  const border = model.border;

  for (const gate of model.gates) {
    const meta = border.gateMeta.get(gate);
    if (!meta) continue;
    features.push(entranceFeatureFor(gate, meta, border, model));
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `nix develop --command bash -c "npx vitest run tests/entrance-output.test.ts"`
Expected: all tests in the file PASS, including the new unwalled assertions.

- [ ] **Step 5: Run full suite**

Run: `nix develop --command bash -c "npx vitest run"`
Expected: all tests pass. Flag any integration test that asserts `features.filter(... 'gate')` length and update.

- [ ] **Step 6: Commit**

```bash
git add src/output/geojson-builder.ts tests/entrance-output.test.ts
git commit -m "Emit entrance features for unwalled burgs via model.border"
```

---

## Task 8: Add `arrival_local` to entrance features

**Files:**
- Modify: `src/output/geojson-builder.ts`
- Modify: `tests/entrance-output.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/entrance-output.test.ts`, inside the `describe('Entrance features', ...)` block:

```ts
it('emits arrival_local offset inward from the entrance point', () => {
  const result = generateFromBurg(makeBurg(), { seed: 42 });
  const entrances = entranceFeatures(result.geojson);
  expect(entrances.length).toBeGreaterThan(0);
  for (const e of entrances) {
    const arrival = e.properties!['arrival_local'] as [number, number];
    expect(Array.isArray(arrival)).toBe(true);
    expect(arrival).toHaveLength(2);

    const coords = (e.geometry as { coordinates: [number, number] }).coordinates;
    const entranceR = Math.hypot(coords[0], coords[1]);
    const arrivalR = Math.hypot(arrival[0], arrival[1]);
    // Arrival point is offset toward the origin (inward).
    expect(arrivalR).toBeLessThan(entranceR);
    // But not past the origin for non-trivial settlements.
    expect(arrivalR).toBeGreaterThan(0);
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `nix develop --command bash -c "npx vitest run tests/entrance-output.test.ts"`
Expected: FAIL — `arrival_local` is `undefined`.

- [ ] **Step 3: Implement `arrival_local` in `entranceFeatureFor`**

Edit `src/output/geojson-builder.ts`.

Inside `entranceFeatureFor`, the function receives `model` as the fourth argument. Use it to read `diameter_local` via `computeDiameterLocal(model)`. To avoid recomputing per entrance, lift the diameter computation to the caller:

In `addEntranceFeatures`, compute once:
```ts
function addEntranceFeatures(features: Feature[], model: Model): void {
  if (model.border === null) return;
  const border = model.border;
  const diameterLocal = computeDiameterLocal(model);

  for (const gate of model.gates) {
    const meta = border.gateMeta.get(gate);
    if (!meta) continue;
    features.push(entranceFeatureFor(gate, meta, border, model, diameterLocal));
  }
}
```

Update `entranceFeatureFor`'s signature and add the arrival computation just before the `return` statement:

```ts
function entranceFeatureFor(
  gate: Point,
  meta: GateMeta,
  border: CurtainWall,
  model: Model,
  diameterLocal: number,
): Feature {
  const isHarbour = meta.kind === 'sea' || isOnHarbourWater(gate, model);
  const kind: 'land' | 'harbour' = isHarbour ? 'harbour' : 'land';
  const subKind = isHarbour ? 'harbour' : (meta.kind === 'foot' ? 'foot' : 'road');
  const entranceId = `g${meta.wallVertexIndex}`;

  const neighbours = findNeighbourEntrances(gate, border);

  // Offset arrival a short distance inward from the entrance point so tokens
  // render inside the boundary, not on it. For tiny settlements (small
  // diameter_local) cap the offset so we don't overshoot past the origin.
  const r = Math.hypot(gate.x, gate.y);
  const offset = Math.min(3, 0.05 * diameterLocal);
  const arrivalScale = r > 0 ? (r - offset) / r : 0;
  const arrivalLocal: [number, number] = [
    Math.round(gate.x * arrivalScale * 100) / 100,
    Math.round(gate.y * arrivalScale * 100) / 100,
  ];

  const properties: Record<string, unknown> = {
    layer: 'entrance',
    entrance_id: entranceId,
    kind,
    sub_kind: subKind,
    wall_vertex_index: meta.wallVertexIndex,
    bearing_deg: meta.bearingDeg,
    arrival_local: arrivalLocal,
  };
  if (meta.routeId != null) properties.matched_route_id = meta.routeId;
  if (meta.matchDeltaDeg != null) properties.bearing_match_delta_deg = meta.matchDeltaDeg;
  if (neighbours.prev != null) properties.prev_entrance_id = neighbours.prev;
  if (neighbours.next != null) properties.next_entrance_id = neighbours.next;

  return {
    type: 'Feature',
    properties,
    geometry: { type: 'Point', coordinates: [gate.x, gate.y] },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `nix develop --command bash -c "npx vitest run tests/entrance-output.test.ts"`
Expected: PASS including the new `arrival_local` test.

- [ ] **Step 5: Commit**

```bash
git add src/output/geojson-builder.ts tests/entrance-output.test.ts
git commit -m "Emit arrival_local offset inward from each entrance"
```

---

## Task 9: Thread `padding` through `generateFromBurg` and add the invariant test

**Files:**
- Modify: `src/index.ts:46-64`
- Modify: `tests/entrance-output.test.ts`

- [ ] **Step 1: Write the failing invariant test**

Add a new `describe` block at the end of `tests/entrance-output.test.ts`:

```ts
import { parseSvgViewBox } from '../src/index.js';

describe('Padding coupling invariant', () => {
  it('SVG viewBox equals metadata.local_bounds for default padding', () => {
    const result = generateFromBurg(makeBurg(), { seed: 42 });
    const vb = parseSvgViewBox(result.svg)!;
    const lb = metadata(result.geojson).local_bounds as Record<string, number>;
    expect(vb.x).toBeCloseTo(lb.min_x);
    expect(vb.y).toBeCloseTo(lb.min_y);
    expect(vb.x + vb.width).toBeCloseTo(lb.max_x);
    expect(vb.y + vb.height).toBeCloseTo(lb.max_y);
  });

  it('SVG viewBox equals metadata.local_bounds when custom padding is threaded via generateFromBurg', () => {
    const result = generateFromBurg(makeBurg(), {
      seed: 42,
      svg: { padding: 50 },
      geojson: { padding: 50 },
    });
    const vb = parseSvgViewBox(result.svg)!;
    const lb = metadata(result.geojson).local_bounds as Record<string, number>;
    expect(vb.x).toBeCloseTo(lb.min_x);
    expect(vb.y).toBeCloseTo(lb.min_y);
    expect(vb.x + vb.width).toBeCloseTo(lb.max_x);
    expect(vb.y + vb.height).toBeCloseTo(lb.max_y);
  });
});
```

Merge the `parseSvgViewBox` import with the existing `from '../src/index.js'` line at the top of the file.

- [ ] **Step 2: Run tests**

Run: `nix develop --command bash -c "npx vitest run tests/entrance-output.test.ts"`
Expected: the default-padding test PASSES already (both use default 20). The custom-padding test PASSES too — the SVG receives `padding: 50`, and GeoJSON already reads `options.padding ?? 20` from its own `padding` field (added in Task 5), which is set to 50. No code change required if Task 5 already wired it through.

If the custom-padding test fails, trace whether `generateFromBurg` passes `options?.geojson` through. Looking at `src/index.ts:60-63`:
```ts
const svg = generateSvg(model, options?.svg);
const geojson = generateGeoJson(model, options?.geojson);
```
It does. No change needed.

- [ ] **Step 3: (If needed) If the test fails because padding isn't threaded, fix it**

Only if step 2 failed: verify `GenerateGeoJsonOptions` includes `padding?: number` (added in Task 5) and that `buildMetadata` reads `options.padding ?? 20`. If not, apply those changes.

- [ ] **Step 4: Commit**

```bash
git add tests/entrance-output.test.ts
git commit -m "Assert SVG viewBox matches metadata.local_bounds under matched padding"
```

---

## Task 10: Re-export helpers from `src/index.ts`

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Add the new exports**

Edit `src/index.ts`. After the `SeededRandom` export (around line 37), add:

```ts
export { computeLocalBounds, computeDiameterLocal } from './generator/bounds.js';
export type { LocalBounds } from './generator/bounds.js';
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `nix develop --command bash -c "npx tsc --noEmit"`
Expected: no errors.

- [ ] **Step 3: Run full suite**

Run: `nix develop --command bash -c "npx vitest run"`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "Export bounds helpers from public API"
```

---

## Task 11: Final validation — full suite + determinism spot-check

**Files:**
- None modified (validation only)

- [ ] **Step 1: Run the complete test suite**

Run: `nix develop --command bash -c "npx vitest run"`
Expected: all tests pass — the original 120 (minus any removed unwalled-zero tests) plus roughly 15-20 new tests added across Tasks 2, 3, 5, 7, 8, 9.

- [ ] **Step 2: Determinism spot-check — run smoke test twice, compare GeoJSON output**

Run:
```bash
nix develop --command bash -c "npx tsx -e \"
import { generateFromBurg } from './src/index.js';
const input = { name: 'SnapShot', population: 5000, port: true, citadel: false, walls: true, plaza: true, temple: false, shanty: false, capital: false, harbourSize: 'small', oceanBearing: 90, roadBearings: [{bearing_deg: 0, route_id: 'n', kind: 'road'}, {bearing_deg: 180, route_id: 's', kind: 'foot'}] };
const a = generateFromBurg(input, { seed: 1234, geojson: { generatedAt: '2026-01-01T00:00:00Z' } });
const b = generateFromBurg(input, { seed: 1234, geojson: { generatedAt: '2026-01-01T00:00:00Z' } });
const sa = JSON.stringify(a.geojson); const sb = JSON.stringify(b.geojson);
if (sa !== sb) { console.error('DRIFT'); process.exit(1); }
console.log('ok — byte-identical output across runs');
console.log('schema_version', a.geojson.metadata.schema_version);
console.log('entrances', a.geojson.features.filter(f => f.properties.layer === 'entrance').length);
console.log('local_bounds', JSON.stringify(a.geojson.metadata.local_bounds));
console.log('scale', JSON.stringify(a.geojson.metadata.scale));
\""
```
Expected output:
```
ok — byte-identical output across runs
schema_version 2
entrances <N>
local_bounds {...}
scale {...}
```

- [ ] **Step 3: Smoke-check an unwalled hamlet emits entrances**

Run:
```bash
nix develop --command bash -c "npx tsx -e \"
import { generateFromBurg } from './src/index.js';
const input = { name: 'Millbrook', population: 400, port: false, citadel: false, walls: false, plaza: false, temple: false, shanty: false, capital: false, roadBearings: [{bearing_deg: 90, route_id: 'east', kind: 'road'}, {bearing_deg: 270, route_id: 'west', kind: 'road'}] };
const r = generateFromBurg(input, { seed: 777 });
const entrances = r.geojson.features.filter(f => f.properties.layer === 'entrance');
console.log('unwalled entrances:', entrances.length);
for (const e of entrances) console.log(' ', e.properties.entrance_id, e.properties.sub_kind, 'matched:', e.properties.matched_route_id ?? 'none');
\""
```
Expected: at least 2 entrances printed, at least one with `matched: east` or `matched: west`.

- [ ] **Step 4: Bump package.json version**

Edit `package.json` — change `"version": "0.2.0"` to `"version": "0.3.0-rc.1"`.

Also edit `src/output/geojson-builder.ts` — update `SETTLEMAKER_VERSION` from `'0.2.0'` to `'0.3.0-rc.1'`.

Run: `nix develop --command bash -c "npx vitest run"` — expect all tests pass (the `SETTLEMAKER_VERSION` test compares via the exported constant, so no test change needed).

- [ ] **Step 5: Commit the version bump**

```bash
git add package.json src/output/geojson-builder.ts
git commit -m "Bump to 0.3.0-rc.1 for questables Plan 3b integration"
```

- [ ] **Step 6: Summary log**

Print the commit graph for the implementation:
```bash
git log --oneline master..HEAD
```
Expected: roughly 11 commits, one per task, in order.

---

## Self-review

Against the spec at `docs/superpowers/specs/2026-04-20-burg-entrances-contract-v2-design.md`:

- ✅ Spec §"Output contract" — metadata `local_bounds` (Task 5) and `scale` block (Task 5); `entrance` feature with all renamed properties (Tasks 6, 7) and `arrival_local` (Task 8).
- ✅ Spec §"Implementation" — `src/generator/bounds.ts` (Tasks 2, 3); `svg-builder.ts` refactor (Task 4); `geojson-builder.ts` changes (Tasks 5, 6, 7, 8); `generation-params.ts` + `azgaar-input.ts` (Task 1); `src/index.ts` re-exports (Task 10).
- ✅ Spec §"Padding coupling invariant" — `GenerateGeoJsonOptions.padding` (Task 5); invariant test (Task 9).
- ✅ Spec §"Testing" — `tests/bounds.test.ts` (Tasks 2, 3); metadata tests (Task 5); walled-regression and unwalled-new-capability (Tasks 6, 7); `arrival_local` (Task 8); padding invariant (Task 9); determinism spot-check (Task 11).
- ✅ Spec §"TypeScript API breaking change" — `GenerationParams.population` added in Task 1.
- ✅ Spec §"Rollout sequence" step 1 — version bumped to `0.3.0-rc.1` in Task 11 Step 4.

No placeholders, no TBDs, no unreferenced types. `computeLocalBounds` / `computeDiameterLocal` / `LocalBounds` / `GenerateGeoJsonOptions.padding` / `entrance_id` are consistently named across all tasks.
