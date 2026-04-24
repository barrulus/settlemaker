# Graceful Degradation for Unsatisfiable Burg Inputs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure every valid `AzgaarBurgInput` produces a sidecar — drop infeasible `walls`/`citadel` flags rather than throwing, and surface the dropped flags so consumers can tell "no walls because FMG said so" from "no walls because settlemaker downgraded."

**Architecture:**
- `Model` gains a `degradedFlags` set populated at three points: (1) up-front population check for walls, (2) in-build citadel compactness check (replaces the current throw), (3) post-retry fallbacks that drop walls then citadel if the default retry loop still exhausts.
- The flags propagate out via `Model.degradedFlags` → `GenerateFromBurgResult.degradedFlags` → `metadata.degraded_flags` on the GeoJSON sidecar.
- `SETTLEMAKER_VERSION` bumps `0.4.0` → `0.5.0` so consumers can re-ingest only sidecars older than the new version.

**Tech Stack:** TypeScript, vitest, Node 22 (via `nix develop`).

---

## File Structure

**Create:**
- `tests/degraded-generation.test.ts` — acceptance tests for the five known-failing burgs + fuzz over `population × walls × citadel`.

**Modify:**
- `src/generator/model.ts` — add `degradedFlags`, population-based walls threshold, in-build citadel compactness drop, staged fallback retries.
- `src/generator/generation-params.ts` — export `DegradedFlag` type.
- `src/index.ts` — add `degradedFlags` to `GenerateFromBurgResult`, re-export `DegradedFlag`.
- `src/output/geojson-builder.ts` — add `degraded_flags` to `OutputMetadata`, bump `SETTLEMAKER_VERSION` to `0.5.0`.
- `package.json` — bump `version` to `0.5.0`.

---

## Design notes

- **Walls threshold:** `MIN_POPULATION_FOR_WALLS = 150`. Chosen because every observed wall failure has `population ≤ 50` (yields 3–4 Voronoi patches, too few for a coherent wall ring). 150 adds headroom; the fuzz test in Task 8 will flag any regression in the [150, 300] range.
- **Citadel threshold:** keep the existing `0.75` compactness lower bound — relaxing it produces cramped citadels that render badly. Prefer dropping over degrading.
- **In-build citadel drop:** when compactness is bad, we demote the citadel patch (`withinCity = false`, `this.citadel = null`, `this.citadelNeeded = false`). `buildFarms()` later reclassifies the patch as farm/wilderness. No retry needed — this is a single-pass fix.
- **Staged fallback retries:** after the default 20-attempt loop exhausts, drop walls and retry; if that still fails, drop citadel and retry. These fallbacks are defensive — the up-front walls check + in-build citadel drop should cover all known failures. Without the fallbacks an unknown future failure mode with walls/citadel as root cause would still throw.
- **Flag stability:** `degradedFlags` is a `Set<DegradedFlag>` internally, exported as a sorted `DegradedFlag[]` so output is deterministic.

---

## Task 1: Add `DegradedFlag` type and `degradedFlags` field to Model

**Files:**
- Modify: `src/generator/generation-params.ts` (add export at bottom)
- Modify: `src/generator/model.ts` (lines 25–88)
- Test: none (type/field change; exercised by Task 5+ tests)

- [ ] **Step 1: Add `DegradedFlag` type export**

Edit `src/generator/generation-params.ts`, append at the end of the file (after the `GenerationParams` interface):

```ts
/**
 * Flags the generator may auto-disable when the requested feature is
 * geometrically infeasible. Surfaced on the output so consumers can
 * distinguish "FMG didn't ask for this" from "settlemaker couldn't build it".
 */
export type DegradedFlag = 'walls' | 'citadel';
```

- [ ] **Step 2: Import `DegradedFlag`, declare field, constant, and fallback scaffolding in `Model`**

In `src/generator/model.ts`:

At the top, change the `import type { GenerationParams }` line to also import `DegradedFlag`:

```ts
import type { GenerationParams, DegradedFlag } from './generation-params.js';
```

Below the `const MAX_ATTEMPTS = 20;` line, add:

```ts
const MIN_POPULATION_FOR_WALLS = 150;
const MIN_CITADEL_COMPACTNESS = 0.75;
```

Inside the `Model` class, add a new public field after `gates` (around line 49):

```ts
readonly degradedFlags: Set<DegradedFlag> = new Set();
```

- [ ] **Step 3: Run typecheck to verify no compile errors**

Run: `nix develop --command bash -c "npx tsc --noEmit"`
Expected: PASS (exit 0, no output).

- [ ] **Step 4: Commit**

```bash
git add src/generator/generation-params.ts src/generator/model.ts
git commit -m "Add DegradedFlag type + degradedFlags set on Model"
```

---

## Task 2: Up-front walls threshold in the Model constructor

**Files:**
- Modify: `src/generator/model.ts` (constructor, lines 55–62)
- Test: `tests/degraded-generation.test.ts` (created fresh)

- [ ] **Step 1: Write the failing test**

Create `tests/degraded-generation.test.ts` with:

```ts
import { describe, it, expect } from 'vitest';
import { Model, mapToGenerationParams, type AzgaarBurgInput } from '../src/index.js';

function burg(overrides: Partial<AzgaarBurgInput>): AzgaarBurgInput {
  return {
    name: 'Test',
    population: 100,
    port: false,
    citadel: false,
    walls: false,
    plaza: false,
    temple: false,
    shanty: false,
    capital: false,
    ...overrides,
  };
}

describe('up-front walls threshold', () => {
  it('drops walls when population is below the threshold', () => {
    const model = new Model(mapToGenerationParams(burg({
      name: 'Tiny',
      population: 50,
      walls: true,
    })));
    // Field must be populated BEFORE generate() runs, at construction time.
    expect(model.degradedFlags.has('walls')).toBe(true);
    expect((model as unknown as { wallsNeeded: boolean }).wallsNeeded).toBe(false);
  });

  it('keeps walls when population is at or above the threshold', () => {
    const model = new Model(mapToGenerationParams(burg({
      name: 'Big',
      population: 500,
      walls: true,
    })));
    expect(model.degradedFlags.has('walls')).toBe(false);
  });

  it('does not add walls to degradedFlags if walls were never requested', () => {
    const model = new Model(mapToGenerationParams(burg({
      name: 'Tiny',
      population: 50,
      walls: false,
    })));
    expect(model.degradedFlags.has('walls')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nix develop --command bash -c "npx vitest run tests/degraded-generation.test.ts"`
Expected: FAIL — first test fails because `wallsNeeded` stays `true` and `degradedFlags` is empty.

- [ ] **Step 3: Implement the constructor check**

In `src/generator/model.ts`, replace the constructor body:

```ts
  constructor(params: GenerationParams) {
    this.params = params;
    this.rng = new SeededRandom(params.seed);
    this.nPatches = params.nPatches;
    this.plazaNeeded = params.plazaNeeded;
    this.citadelNeeded = params.citadelNeeded;
    this.wallsNeeded = params.wallsNeeded;

    if (this.wallsNeeded && params.population < MIN_POPULATION_FOR_WALLS) {
      this.wallsNeeded = false;
      this.degradedFlags.add('walls');
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `nix develop --command bash -c "npx vitest run tests/degraded-generation.test.ts"`
Expected: PASS (3 passing).

- [ ] **Step 5: Commit**

```bash
git add src/generator/model.ts tests/degraded-generation.test.ts
git commit -m "Force-drop walls for populations below the wall-ring threshold"
```

---

## Task 3: Extract `reset()` helper from retry loop

**Files:**
- Modify: `src/generator/model.ts` (generate + new private method)

This is a refactor to make the staged-fallback structure in Task 5 readable. No behaviour change.

- [ ] **Step 1: Extract `reset()` from the catch block**

In `src/generator/model.ts`, replace the `generate()` method (currently lines 65–88) with:

```ts
  /** Run the full 6-phase generation pipeline. Retries on failure up to MAX_ATTEMPTS. */
  generate(): Model {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        this.build();
        return this;
      } catch (e) {
        this.reset();
      }
    }
    throw new Error(`Failed to generate after ${MAX_ATTEMPTS} attempts`);
  }

  private reset(): void {
    this.patches = [];
    this.inner = [];
    this.waterbody = [];
    this.citadel = null;
    this.plaza = null;
    this.harbour = null;
    this.border = null;
    this.wall = null;
    this.gates = [];
    this.streets = [];
    this.roads = [];
    this.arteries = [];
    this.topology = null;
  }
```

- [ ] **Step 2: Run the full test suite to verify no regression**

Run: `nix develop --command bash -c "npx vitest run"`
Expected: PASS (all existing tests still green).

- [ ] **Step 3: Commit**

```bash
git add src/generator/model.ts
git commit -m "Extract reset() helper from retry loop (prep for fallbacks)"
```

---

## Task 4: In-build citadel compactness drop (replaces the throw at model.ts:227)

**Files:**
- Modify: `src/generator/model.ts` (`buildWalls`, around line 222–232)
- Test: `tests/degraded-generation.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Append to `tests/degraded-generation.test.ts`:

```ts
import { generateFromBurg } from '../src/index.js';

describe('in-build citadel compactness drop', () => {
  // Atarten: pop=199, citadel=true, walls=false — every seed produces a
  // citadel with compactness < 0.75 on the current geometry pipeline.
  it('drops citadel for the Atarten case instead of throwing', () => {
    const result = generateFromBurg(burg({
      name: 'Atarten',
      population: 199,
      citadel: true,
      walls: false,
    }));
    expect(result.model.degradedFlags.has('citadel')).toBe(true);
    expect(result.model.citadel).toBeNull();
  });

  // Undraladrynn: pop=181, citadel=true, walls=false.
  it('drops citadel for the Undraladrynn case instead of throwing', () => {
    const result = generateFromBurg(burg({
      name: 'Undraladrynn',
      population: 181,
      citadel: true,
      walls: false,
    }));
    expect(result.model.degradedFlags.has('citadel')).toBe(true);
    expect(result.model.citadel).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nix develop --command bash -c "npx vitest run tests/degraded-generation.test.ts"`
Expected: FAIL — `generateFromBurg` throws `Failed to generate after 20 attempts` (because every seed hits the `Bad citadel shape!` throw).

- [ ] **Step 3: Replace the throw with a graceful drop**

In `src/generator/model.ts`, replace the citadel block in `buildWalls` (currently lines 222–232):

```ts
    if (this.citadel !== null) {
      if (this.citadel.shape.compactness < MIN_CITADEL_COMPACTNESS) {
        this.citadel.withinCity = false;
        this.citadel = null;
        this.citadelNeeded = false;
        this.degradedFlags.add('citadel');
      } else {
        const castle = new Castle(this, this.citadel);
        castle.wall.buildTowers();
        this.citadel.ward = castle;

        this.gates = this.gates.concat(castle.wall.gates);
      }
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `nix develop --command bash -c "npx vitest run tests/degraded-generation.test.ts"`
Expected: PASS (both new citadel-drop tests).

- [ ] **Step 5: Run full suite to confirm no regression**

Run: `nix develop --command bash -c "npx vitest run"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/generator/model.ts tests/degraded-generation.test.ts
git commit -m "Drop citadel instead of throwing when compactness is too low"
```

---

## Task 5: Staged fallback retries after default loop exhausts

**Files:**
- Modify: `src/generator/model.ts` (`generate()`)
- Test: `tests/degraded-generation.test.ts` (extend)

Purpose: defense-in-depth for unknown wall/citadel failure modes. The up-front check and in-build drop cover every known case, but a future geometry regression could still reach this path.

- [ ] **Step 1: Write the failing test**

Append to `tests/degraded-generation.test.ts`:

```ts
describe('staged fallback retries', () => {
  // Monmouth/Wargmore/Skipton all have population=50, walls=true.
  // The constructor check (Task 2) drops walls up-front for these; the
  // generation must therefore complete without throwing.
  const failingWallBurgs = ['Monmouth', 'Wargmore', 'Skipton'];
  for (const name of failingWallBurgs) {
    it(`generates ${name} (pop=50, walls=true) without throwing`, () => {
      const result = generateFromBurg(burg({
        name,
        population: 50,
        walls: true,
      }));
      expect(result.model.degradedFlags.has('walls')).toBe(true);
      expect(result.model.wall).toBeNull();
    });
  }
});
```

- [ ] **Step 2: Run test to verify it passes already (Task 2 covers this)**

Run: `nix develop --command bash -c "npx vitest run tests/degraded-generation.test.ts"`
Expected: PASS — the up-front constructor check handles these.

- [ ] **Step 3: Add the staged fallback to `generate()`**

Even though the existing tests pass, wire the defensive fallback now so future unknown failures degrade gracefully. Replace `generate()`:

```ts
  /**
   * Run the full 6-phase generation pipeline. Retries up to MAX_ATTEMPTS per
   * pass; if that exhausts, drops `walls` and retries, then drops `citadel`
   * and retries. Only throws when every fallback has been exhausted.
   */
  generate(): Model {
    if (this.tryGenerate()) return this;

    if (this.wallsNeeded) {
      this.wallsNeeded = false;
      this.degradedFlags.add('walls');
      if (this.tryGenerate()) return this;
    }

    if (this.citadelNeeded) {
      this.citadelNeeded = false;
      this.degradedFlags.add('citadel');
      if (this.tryGenerate()) return this;
    }

    throw new Error(
      `Failed to generate after ${MAX_ATTEMPTS} attempts with walls/citadel fallbacks`,
    );
  }

  private tryGenerate(): boolean {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        this.build();
        return true;
      } catch (e) {
        this.reset();
      }
    }
    return false;
  }
```

- [ ] **Step 4: Run full suite to confirm no regression**

Run: `nix develop --command bash -c "npx vitest run"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/generator/model.ts tests/degraded-generation.test.ts
git commit -m "Fall back by dropping walls then citadel when retries exhaust"
```

---

## Task 6: Surface `degradedFlags` in `GenerateFromBurgResult`

**Files:**
- Modify: `src/index.ts` (`GenerateFromBurgResult`, `generateFromBurg`)
- Test: `tests/degraded-generation.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Append to `tests/degraded-generation.test.ts`:

```ts
describe('degradedFlags on generateFromBurg result', () => {
  it('exposes degradedFlags as a sorted array', () => {
    const result = generateFromBurg(burg({
      name: 'BothDegraded',
      population: 50,    // forces walls drop
      walls: true,
      citadel: true,     // pop=50 → 3-4 patches, compactness will likely fail too;
                         // but even if not, walls is the guaranteed entry.
    }));
    expect(Array.isArray(result.degradedFlags)).toBe(true);
    expect(result.degradedFlags).toContain('walls');
    // Array must be sorted for deterministic consumer output.
    const copy = [...result.degradedFlags].sort();
    expect(result.degradedFlags).toEqual(copy);
  });

  it('returns an empty array when nothing is degraded', () => {
    const result = generateFromBurg(burg({
      name: 'Clean',
      population: 5000,
      walls: true,
      citadel: false,
    }));
    expect(result.degradedFlags).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nix develop --command bash -c "npx vitest run tests/degraded-generation.test.ts"`
Expected: FAIL — `result.degradedFlags` is `undefined`.

- [ ] **Step 3: Update `GenerateFromBurgResult` and `generateFromBurg`**

In `src/index.ts`:

Add to the re-exports (next to `GenerationParams`):

```ts
export { GenerationParams, RoadEntry, RouteKind, DegradedFlag } from './generator/generation-params.js';
```

Change `GenerateFromBurgResult` and `generateFromBurg`:

```ts
import type { DegradedFlag } from './generator/generation-params.js';

export interface GenerateFromBurgResult {
  model: Model;
  svg: string;
  geojson: FeatureCollection;
  /**
   * Input flags that settlemaker was forced to disable because the requested
   * feature wasn't geometrically feasible (e.g. walls on a population-50
   * hamlet, citadel on a very non-compact patch). Sorted, stable order.
   */
  degradedFlags: DegradedFlag[];
}

/**
 * Convenience function: Azgaar burg data → generated model + SVG + GeoJSON.
 */
export function generateFromBurg(
  burg: AzgaarBurgInput,
  options?: { seed?: number; svg?: SvgOptions; geojson?: GenerateGeoJsonOptions },
): GenerateFromBurgResult {
  const params = mapToGenerationParams(burg, options?.seed);
  const model = new Model(params).generate();
  const svg = generateSvg(model, options?.svg);
  const geojson = generateGeoJson(model, options?.geojson);
  const degradedFlags = [...model.degradedFlags].sort() as DegradedFlag[];
  return { model, svg, geojson, degradedFlags };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `nix develop --command bash -c "npx vitest run tests/degraded-generation.test.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts
git commit -m "Expose degradedFlags on GenerateFromBurgResult"
```

---

## Task 7: Surface `degraded_flags` in GeoJSON metadata + bump `SETTLEMAKER_VERSION`

**Files:**
- Modify: `src/output/geojson-builder.ts` (metadata + version)
- Modify: `package.json` (version)
- Test: `tests/degraded-generation.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Append to `tests/degraded-generation.test.ts`:

```ts
import { SETTLEMAKER_VERSION } from '../src/index.js';
import type { FeatureCollection } from 'geojson';

function meta(fc: FeatureCollection): Record<string, unknown> {
  return (fc as unknown as { metadata: Record<string, unknown> }).metadata;
}

describe('degraded_flags in GeoJSON metadata', () => {
  it('includes degraded_flags in metadata for a degraded generation', () => {
    const result = generateFromBurg(burg({
      name: 'Tiny',
      population: 50,
      walls: true,
    }));
    const m = meta(result.geojson);
    expect(m.degraded_flags).toEqual(['walls']);
  });

  it('emits an empty degraded_flags array when nothing is degraded', () => {
    const result = generateFromBurg(burg({
      name: 'Clean',
      population: 5000,
    }));
    expect(meta(result.geojson).degraded_flags).toEqual([]);
  });

  it('bumps settlemaker_version to 0.5.0', () => {
    expect(SETTLEMAKER_VERSION).toBe('0.5.0');
    const result = generateFromBurg(burg({ name: 'V', population: 5000 }));
    expect(meta(result.geojson).settlemaker_version).toBe('0.5.0');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nix develop --command bash -c "npx vitest run tests/degraded-generation.test.ts"`
Expected: FAIL — `degraded_flags` missing; `SETTLEMAKER_VERSION` still `0.4.0`.

- [ ] **Step 3: Update `SETTLEMAKER_VERSION`, `OutputMetadata`, and `buildMetadata`**

In `src/output/geojson-builder.ts`:

Change the `SETTLEMAKER_VERSION` constant:

```ts
export const SETTLEMAKER_VERSION = '0.5.0';
```

Extend the `OutputMetadata` interface (add `degraded_flags` next to `poi_density`):

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
  degraded_flags: string[];
}
```

Extend the `buildMetadata` return value (add the field after `poi_density`):

```ts
    poi_density: regimeFor(params.population),
    degraded_flags: [...model.degradedFlags].sort(),
```

- [ ] **Step 4: Bump `package.json`**

In `package.json`, change:

```json
  "version": "0.4.0",
```

to:

```json
  "version": "0.5.0",
```

- [ ] **Step 5: Run test to verify it passes**

Run: `nix develop --command bash -c "npx vitest run tests/degraded-generation.test.ts"`
Expected: PASS.

- [ ] **Step 6: Run full suite — existing tests referencing `SETTLEMAKER_VERSION` should still pass because they import the constant**

Run: `nix develop --command bash -c "npx vitest run"`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/output/geojson-builder.ts package.json tests/degraded-generation.test.ts
git commit -m "Add degraded_flags to metadata and bump settlemaker_version to 0.5.0"
```

---

## Task 8: Acceptance test — five named failing burgs all succeed

**Files:**
- Modify: `tests/degraded-generation.test.ts` (extend)

Explicit block so a regression on any of the five known-bad inputs is immediately obvious in test output.

- [ ] **Step 1: Write the test**

Append to `tests/degraded-generation.test.ts`:

```ts
describe('acceptance: the five known-failing burgs', () => {
  const cases: Array<{
    input: AzgaarBurgInput;
    expectDegraded: Array<'walls' | 'citadel'>;
  }> = [
    {
      input: burg({ name: 'Atarten',      population: 199, walls: false, citadel: true }),
      expectDegraded: ['citadel'],
    },
    {
      input: burg({ name: 'Monmouth',     population: 50,  walls: true,  citadel: false }),
      expectDegraded: ['walls'],
    },
    {
      input: burg({ name: 'Wargmore',     population: 50,  walls: true,  citadel: false }),
      expectDegraded: ['walls'],
    },
    {
      input: burg({ name: 'Skipton',      population: 50,  walls: true,  citadel: false }),
      expectDegraded: ['walls'],
    },
    {
      input: burg({ name: 'Undraladrynn', population: 181, walls: false, citadel: true }),
      expectDegraded: ['citadel'],
    },
  ];

  for (const { input, expectDegraded } of cases) {
    it(`generates ${input.name} with degradedFlags = ${JSON.stringify(expectDegraded)}`, () => {
      const result = generateFromBurg(input);
      expect(result.degradedFlags).toEqual(expectDegraded);
    });
  }
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `nix develop --command bash -c "npx vitest run tests/degraded-generation.test.ts"`
Expected: PASS (5 new tests).

- [ ] **Step 3: Commit**

```bash
git add tests/degraded-generation.test.ts
git commit -m "Acceptance tests: 5 known-failing burgs now generate with degradedFlags"
```

---

## Task 9: Fuzz test — population × walls × citadel

**Files:**
- Modify: `tests/degraded-generation.test.ts` (extend)

User-specified fuzz: `population ∈ [30, 300] × walls ∈ {true,false} × citadel ∈ {true,false}` must produce zero throws. 271 populations × 4 combinations = 1084 runs. Each run is fast but the total may take a few seconds — if the suite is too slow, sample the population axis (every 5th value) as a follow-up.

- [ ] **Step 1: Write the test**

Append to `tests/degraded-generation.test.ts`:

```ts
describe('fuzz: population × walls × citadel', () => {
  // 271 × 4 = 1084 cases. Each burg generates in ~5-20 ms on a warm process,
  // which keeps total fuzz under a few seconds. If the CI budget tightens we
  // can step population by 5.
  const populations = Array.from({ length: 271 }, (_, i) => 30 + i);
  const flags = [
    { walls: false, citadel: false },
    { walls: true,  citadel: false },
    { walls: false, citadel: true  },
    { walls: true,  citadel: true  },
  ];

  it('produces zero throws across the full grid', () => {
    const failures: string[] = [];
    for (const population of populations) {
      for (const f of flags) {
        try {
          generateFromBurg(burg({
            name: `Fuzz-${population}-${f.walls}-${f.citadel}`,
            population,
            walls: f.walls,
            citadel: f.citadel,
          }));
        } catch (e) {
          failures.push(`pop=${population} walls=${f.walls} citadel=${f.citadel}: ${(e as Error).message}`);
        }
      }
    }
    expect(failures, failures.slice(0, 5).join('\n')).toEqual([]);
  }, 120_000); // 120s safety ceiling
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `nix develop --command bash -c "npx vitest run tests/degraded-generation.test.ts"`
Expected: PASS. If any combination throws, the assertion message lists the first 5 failures — treat each as a tightening of `MIN_POPULATION_FOR_WALLS` or a new degradation case.

- [ ] **Step 3: Run the full suite one last time**

Run: `nix develop --command bash -c "npx vitest run"`
Expected: PASS across all test files.

- [ ] **Step 4: Commit**

```bash
git add tests/degraded-generation.test.ts
git commit -m "Fuzz: population × walls × citadel grid produces zero throws"
```

---

## Self-Review Notes

**Spec coverage:**
- Auto-disable walls when geometry can't support them → Task 2 (up-front threshold) + Task 5 (fallback).
- Auto-disable citadel when compactness would throw → Task 4 (in-build drop); user's optional "relax threshold" knob is left OFF per design notes.
- Surface `degradedFlags` on the response → Task 6 (result field) + Task 7 (GeoJSON metadata).
- Bump `settlemaker_version` → Task 7.
- Acceptance: 5 named burgs return a sidecar → Task 8.
- Acceptance: fuzz over pop × walls × citadel produces zero throws → Task 9.
- Out-of-scope preservation (don't change the 16,081 working burgs, don't change gate/bearing contracts) → no Task touches `CurtainWall.ts`, `curtain-wall.ts` ordering, or output gate/bearing fields.

**Placeholder scan:** none.

**Type consistency:** `DegradedFlag` defined once in `generation-params.ts`, re-exported from `index.ts`, used in `Model.degradedFlags: Set<DegradedFlag>`, surfaced as `DegradedFlag[]` on `GenerateFromBurgResult`, and as `string[]` on `OutputMetadata.degraded_flags` (widened at the JSON boundary — intentional, since downstream JSON has no type narrowing).
