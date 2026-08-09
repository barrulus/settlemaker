# Round Cores, Asymmetric Faubourgs, Coastal Walls — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Circular/ovoid walled cores holding ~80–90% of below-cap population at Saint-Malo density, faubourgs concentrated on route-data-weighted approaches, walls along the water's edge for coastal burgs, and a road network that always joins.

**Architecture:** Builds on the committed-in-Task-1 mesh reseed (uniform patch density near the settlement). Core selection loses the shape field and becomes plain-distance-under-mild-ovoid with water excluded (water is classified before core selection). Sprawl keeps `assignSprawl`'s greedy loop but corridor scores are multiplied by per-route weights from FMG data + seeded rank decay; the ring-completion bonus is deleted. Streets gain a plaza-perimeter junction ring and faubourg back lanes.

**Tech Stack:** TypeScript, zero runtime deps, vitest. All commands run as `nix develop --command bash -c "..."` from the worktree root (`.claude/worktrees/roundness-and-fields`).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-09-round-cores-faubourgs-design.md`. Where this plan and the spec disagree, the spec wins.
- **The owner's eyes are the only gate for anything visual.** Tasks marked **RENDER GATE** end with: regenerate `web/public/review.html` (`npx tsx make-review-page.ts`), confirm http://localhost:5199/review.html serves it, screenshot key cells headlessly, and STOP for Barry's approval before the next task. Do not substitute metrics for this gate.
- **A plan's reference code is a hypothesis, not an answer** (2026-08-09 handoff, lesson 5). If a snippet below contradicts observed behavior, trust the observation and say so.
- **Verify every new regression test by watching it fail** (revert fix → red → restore → green).
- Numeric weights/anchors marked `TUNE` are starting points; final values come from renders.
- No Co-Authored-By lines in commit messages.
- Seeds: all pinned-hash movement is expected until Task 9 re-pins; do not re-pin earlier.
- `.gitignore` contains `output/` which matches `src/output/` — use `git add -f` for files there.

---

### Task 1: Commit the mesh reseed

The uniform-density seeding change in `src/generator/model.ts` (already implemented and visually approved in direction) is uncommitted. Land it as its own commit so later tasks diff cleanly.

**Files:**
- Modify (already modified, commit as-is): `src/generator/model.ts`
- Commit as review aids: `diag-render.ts`, `diag-patch-sizes.ts`
- Delete: `diag-pop60.ts`, `diag-timing.ts`

- [ ] **Step 1: Verify the tree state**

Run: `git status --short` — expect `M src/generator/model.ts` plus untracked `diag-*.ts`.
Run: `npx tsc --noEmit` — expect clean.

- [ ] **Step 2: Sanity-run the diagnostics**

Run: `npx tsx diag-patch-sizes.ts`
Expected: farm/core mean patch area ratio 1.0–1.3× at every pop (NOT 2–8×).

- [ ] **Step 3: Delete throwaway diagnostics, commit**

```bash
rm diag-pop60.ts diag-timing.ts
git add src/generator/model.ts diag-render.ts diag-patch-sizes.ts
git commit -m "Mesh: uniform patch density near the settlement

Replace the linear spiral (density ∝ 1/r, patch area ∝ r) with a
density-controlled golden-angle spiral: core-sized cells out to 4x the
estimated core radius, linear coarsening beyond. Fixes farm belts
reading as landscape and the settlement being a speck in its own frame.
Ships diag-render.ts / diag-patch-sizes.ts as review aids."
```

---

### Task 2: Input contract — per-approach route character

**Files:**
- Modify: `src/input/azgaar-input.ts` (RoadBearingInput, mapping at ~line 193)
- Modify: `src/generator/generation-params.ts` (RoadEntry, ~line 11)
- Test: `tests/azgaar-input.test.ts` (extend existing file if present, else create)

**Interfaces:**
- Produces: `RoadEntry` gains `group?: 'roads' | 'trails'`, `through?: boolean`, `relief?: RouteRelief`, `followsRiver?: boolean`; exported type `RouteRelief = 'descent' | 'ascent' | 'valley' | 'ridge' | 'flat'`. Task 6 consumes these.

- [ ] **Step 1: Write the failing test**

```ts
// tests/azgaar-input.test.ts
import { describe, test, expect } from 'vitest';
import { mapToGenerationParams } from '../src/input/azgaar-input.js';

describe('route character fields', () => {
  test('object bearings carry group/through/relief/followsRiver into RoadEntry', () => {
    const params = mapToGenerationParams({
      name: 'T', population: 4000, port: false, citadel: false, walls: true,
      plaza: true, temple: false, shanty: false, capital: false,
      roadBearings: [
        { bearing_deg: 90, route_id: 'r1', kind: 'road', group: 'roads', through: true, relief: 'valley', followsRiver: true },
        180,
      ],
    }, 1);
    const [rich, bare] = params.roadEntryPoints!;
    expect(rich.group).toBe('roads');
    expect(rich.through).toBe(true);
    expect(rich.relief).toBe('valley');
    expect(rich.followsRiver).toBe(true);
    expect(bare.group).toBeUndefined();
    expect(bare.through).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run tests/azgaar-input.test.ts`
Expected: FAIL (properties undefined / type error).

- [ ] **Step 3: Implement**

In `generation-params.ts`:

```ts
export type RouteRelief = 'descent' | 'ascent' | 'valley' | 'ridge' | 'flat';

export interface RoadEntry {
  point: Point;
  bearingDeg: number;
  routeId?: string;
  kind?: RouteKind;
  /** FMG land-route group. Absent = unknown, treated like 'roads'. */
  group?: 'roads' | 'trails';
  /** Route continues past the burg (true) vs terminates here. */
  through?: boolean;
  /** Corridor relief walking outward. */
  relief?: RouteRelief;
  /** Road runs along a river (valley road). */
  followsRiver?: boolean;
}
```

In `azgaar-input.ts`, extend the object arm of `RoadBearingInput` with the same four optional fields, and the mapping:

```ts
return {
  point, bearingDeg, routeId: b.route_id, kind: b.kind,
  group: b.group, through: b.through, relief: b.relief, followsRiver: b.followsRiver,
};
```

- [ ] **Step 4: Run test + typecheck, verify pass**

Run: `npx vitest run tests/azgaar-input.test.ts && npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add src/input/azgaar-input.ts src/generator/generation-params.ts tests/azgaar-input.test.ts
git commit -m "Contract: per-approach group/through/relief/followsRiver (additive, optional)"
```

---

### Task 3: Water classified before core selection

Move the coastline synthesis out of `classifyWater` so `buildPatches` can exclude water from the core. The synthesized ring currently uses `this.border.getRadius()` (post-walls); switch it to the estimated core radius `coreR = 10 + nCore * 2.5` already computed in `buildPatches`.

**Files:**
- Modify: `src/generator/model.ts` — extract ring synthesis from `classifyWater` (~lines 618–660) into a private `ensureWaterRings(estimatedRadius: number): Point[][]`; call it from `buildPatches` before core selection; have `getWaterRings()` and `classifyWater` consume the cached rings.
- Test: `tests/coastal-core.test.ts` (new)

**Interfaces:**
- Produces: `Model.ensureWaterRings(estimatedRadius)` — idempotent, caches on first call; returns `params.coastlineGeometry` when supplied, else synthesizes from `oceanBearing`, else `[]`. `isWaterAt(p)` works from `buildPatches` onward. Task 4 consumes `isWaterAt` during core ranking; Task 7 relies on the wall never crossing water.

- [ ] **Step 1: Write the failing test**

```ts
// tests/coastal-core.test.ts
import { describe, test, expect } from 'vitest';
import { Model, mapToGenerationParams } from '../src/index.js';

const portBurg = (seed: number) => mapToGenerationParams({
  name: 'Port', population: 20000, port: true, citadel: false, walls: true,
  plaza: true, temple: false, shanty: false, capital: false,
  roadBearings: [0, 240], oceanBearing: 90, harbourSize: 'large',
}, seed);

describe('water-first classification', () => {
  test('no core patch centroid is in water, any seed', () => {
    for (const seed of [1, 2, 3, 5, 8]) {
      const m = new Model(portBurg(seed)).generate();
      for (const p of m.inner) {
        expect(m.isWaterAt(p.shape.center)).toBe(false);
      }
    }
  });
  test('no wall vertex is in water', () => {
    for (const seed of [1, 2, 3, 5, 8]) {
      const m = new Model(portBurg(seed)).generate();
      for (const v of m.border!.shape.vertices) {
        expect(m.isWaterAt(v)).toBe(false);
      }
    }
  });
});
```

Note: `isWaterAt` may currently be private — make it public (it is a pure query).

- [ ] **Step 2: Run, verify it fails**

Run: `npx vitest run tests/coastal-core.test.ts`
Expected: FAIL — today water is classified after walls, so cores straddle the coast on some seeds. If it unexpectedly PASSES on all five seeds, widen the seed sweep to 1–20 until a red seed is found and keep that seed in the test; do not proceed with a test that cannot fail.

- [ ] **Step 3: Implement the reorder**

In `buildPatches`, right after `coreR` is computed and before the decorate-sort:

```ts
this.ensureWaterRings(coreR);
```

`ensureWaterRings` holds the exact synthesis code lifted from `classifyWater` (wobble phases from seed arithmetic — unchanged), with `radius` replaced by the `estimatedRadius` argument. `classifyWater` keeps its classification loop but reads `this.getWaterRings()` instead of synthesizing. Water exclusion from the core happens in Task 4's ranking; for THIS task, exclude water the minimal way — after the decorate-sort, skip patches whose centroid is in water when assigning `count < nCore` core membership (compensate by letting the loop run further down the sorted order so the core still gets `nCore` patches).

- [ ] **Step 4: Run new test + full suite**

Run: `npx vitest run tests/coastal-core.test.ts` — expect PASS.
Run: `npx vitest run` — expect no NEW failures beyond the 17 known (pinned hashes may shift again for coastal seeds; note the count).

- [ ] **Step 5: Commit**

```bash
git add src/generator/model.ts tests/coastal-core.test.ts
git commit -m "Water first: classify coastline before core selection; core and wall stay on land"
```

---

### Task 4: Round ovoid core; delete the shape field — **RENDER GATE**

**Files:**
- Modify: `src/generator/model.ts` — replace shape-field ranking in `buildPatches` (~lines 376–395) with ovoid ranking; delete `this.shapeField`, `probeRadius` probe wiring.
- Delete: `src/generator/shape-field.ts` and its test file (`tests/shape-field.test.ts` or similar — find with `grep -rl createShapeField tests/`).
- Test: `tests/core-shape.test.ts` (new)

**Interfaces:**
- Consumes: `ensureWaterRings`/`isWaterAt` from Task 3.
- Produces: core ranking = `hypot(u/ecc, v)` with `ecc ∈ [1.0, 1.25]` seeded, random axis; water patches rank `Infinity`. `assignSprawl` still receives `coreOutline` (the wall shape) — unchanged signature.

- [ ] **Step 1: Write the failing test**

```ts
// tests/core-shape.test.ts
import { describe, test, expect } from 'vitest';
import { Model, mapToGenerationParams } from '../src/index.js';

function convexHullCompactness(vertices: {x:number;y:number}[]): number {
  // Andrew's monotone chain -> hull area & perimeter -> 4πA/P²
  const pts = [...vertices].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: any, a: any, b: any) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: any[] = [], upper: any[] = [];
  for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length-2], lower[lower.length-1], p) <= 0) lower.pop(); lower.push(p); }
  for (const p of [...pts].reverse()) { while (upper.length >= 2 && cross(upper[upper.length-2], upper[upper.length-1], p) <= 0) upper.pop(); upper.push(p); }
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
  let area = 0, per = 0;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    area += a.x * b.y - b.x * a.y;
    per += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return 4 * Math.PI * (Math.abs(area) / 2) / (per * per);
}

describe('round walled core', () => {
  test('wall outline hull compactness >= 0.85 and Rmin/Rmax >= 0.6 across seeds', () => {
    for (const seed of [1, 2, 3, 5, 8, 13]) {
      const m = new Model(mapToGenerationParams({
        name: 'Round', population: 4000, port: false, citadel: false, walls: true,
        plaza: true, temple: false, shanty: false, capital: false, roadBearings: [0, 120, 240],
      }, seed)).generate();
      const verts = m.border!.shape.vertices;
      expect(convexHullCompactness(verts)).toBeGreaterThanOrEqual(0.85);
      const rs = verts.map(v => Math.hypot(v.x, v.y));
      expect(Math.min(...rs) / Math.max(...rs)).toBeGreaterThanOrEqual(0.6); // TUNE: no deep notches
    }
  });
});
```

CAUTION (handoff §4.1): hull compactness alone was fooled before — that is why the `Rmin/Rmax` bound is here too. Neither replaces the render gate.

- [ ] **Step 2: Run, verify it fails**

Run: `npx vitest run tests/core-shape.test.ts`
Expected: FAIL on Rmin/Rmax (lobed cores today have ratios near 0.44).

- [ ] **Step 3: Implement**

In `buildPatches`, replace the shape-field block:

```ts
// Mild seeded ovoid: the walled core is relatively circular/ovoid; routes
// and terrain shape the OUTSIDE (spec 2026-08-09 §2). Water never joins
// the core.
const ecc = 1 + rng.float() * 0.25;
const axisA = rng.float() * Math.PI;
const cosA = Math.cos(axisA), sinA = Math.sin(axisA);
const coreRank = (p: Point): number => {
  if (this.getWaterRings().length > 0 && this.isWaterAt(p)) return Infinity;
  const u = p.x * cosA + p.y * sinA;
  const v = -p.x * sinA + p.y * cosA;
  return Math.hypot(u / ecc, v);
};
const decorated = voronoi.points.map((p): [Point, number] => [p, coreRank(p)]);
```

Delete `createShapeField` import, `this.shapeField` field and all reads (grep `shapeField` across `src/` — `assignSprawl` callers must pass what they already pass, the wall outline, NOT the shape field). Delete `src/generator/shape-field.ts` and its tests. Remove Task 3's temporary skip-water-in-count loop if it duplicates `coreRank`'s Infinity.

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run tests/core-shape.test.ts tests/coastal-core.test.ts && npx tsc --noEmit` — expect PASS/clean.

- [ ] **Step 5: Commit**

```bash
git add -A src/generator tests/core-shape.test.ts
git commit -m "Core: plain distance under mild seeded ovoid; shape field deleted"
```

- [ ] **Step 6: RENDER GATE**

```bash
npx tsx make-review-page.ts
npx tsx diag-render.ts /tmp/render-task4
```
Screenshot pop 1200/4000/10000/port cells (chromium headless as in diag workflow), LOOK at them (walls round? no notches? port wall on shore?), then STOP and present to Barry. Do not start Task 5 without approval.

---

### Task 5: Population split and dense core — **RENDER GATE**

**Files:**
- Modify: `src/input/azgaar-input.ts` — `extramuralShare` (~line 136), doc comments.
- Modify: `src/generator/generation-params.ts` — `perPatchDensity` (~line 36) anchors.
- Test: modify `tests/zoning.test.ts` structural cases that assert the old curve; `tests/density-target.test.ts` stays as the yield gate.

**Interfaces:**
- Produces: `extramuralShare` returns 0.10–0.20; `perPatchDensity` anchors `(≤600, 9)` → `(10000, 30)` `TUNE`. Consumed everywhere via existing call sites — no signature changes.

- [ ] **Step 1: Update the structural share test (write failing first)**

In `tests/zoning.test.ts` (or a new `tests/share-curve.test.ts` if zoning.test.ts has no such case):

```ts
test('extramural share: 10% at 300 rising to 20% at the cap', () => {
  expect(extramuralShare(300)).toBeCloseTo(0.10, 2);
  expect(extramuralShare(10000)).toBeCloseTo(0.20, 2);
  expect(extramuralShare(2000)).toBeGreaterThan(0.10);
  expect(extramuralShare(2000)).toBeLessThan(0.20);
  expect(extramuralShare(100)).toBeCloseTo(0.10, 2);  // clamped
  expect(extramuralShare(250000)).toBeCloseTo(0.20, 2); // clamped; cap governs above anyway
});
```

Run: `npx vitest run -t 'extramural share'` — expect FAIL against the old 0.20–0.45 curve.

- [ ] **Step 2: Implement the curve**

```ts
export function extramuralShare(population: number): number {
  // 10% at pop 300 rising log-linearly to 20% at DEFAULT_CORE_CAPACITY
  // (10 000), where the capacity ceiling takes over as the binding
  // constraint. Owner decision 2026-08-09 (replaces the 20-45% curve):
  // most people stay inside; growth outside is sparse and asymmetric.
  const raw = 0.10 + 0.0657 * (Math.log10(population) - Math.log10(300));
  return Math.min(0.20, Math.max(0.10, raw));
}
```

Update the doc comment to reference the 2026-08-09 spec. Run the test — PASS.

- [ ] **Step 3: Densify — raise per-patch density anchors**

```ts
export function perPatchDensity(population: number): number {
  // Walled settlements pack tight (Saint-Malo ~6000 in a compact circuit):
  // city texture is reached at the coreCapacity default (10 000), not
  // 20 000. TUNE on renders + calibrate-yield.ts; villages stay airy.
  if (population <= 600) return 9;
  return Math.min(30, 9 + 21 * Math.log10(population / 600) / Math.log10(10000 / 600));
}
```

Then re-run yield calibration: `npx tsx calibrate-yield.ts` — read its output; if pre-trim yield vs target drifts outside the <12%-trim margin the `baseScaleForYield` anchors were fitted for, refit that curve's midpoint per the procedure in its doc comment (task-2-report.md).

- [ ] **Step 4: Yield gate**

Run: `npx vitest run tests/density-target.test.ts`
Expected: pop 350/1200/4500 cases PASS (pop 60 may still fail — that is Task 9's debt, note the number). If 4500 fails low, densify is undershooting: revisit Step 3 anchors before touching any test bound.

- [ ] **Step 5: Commit**

```bash
git add src/input/azgaar-input.ts src/generator/generation-params.ts tests/
git commit -m "Split: 10-20% extramural below the cap; city texture reached at the cap"
```

- [ ] **Step 6: RENDER GATE**

Regenerate + screenshot the full ladder. Look for: compact dense walled cores; villages still airy; metropolis unchanged in character (cap-bound). STOP for Barry.

---

### Task 6: Asymmetric faubourgs — **RENDER GATE**

**Files:**
- Modify: `src/generator/urbanisation.ts` — `UrbanisationOptions.roadDirections: Point[]` → `roads: WeightedRoad[]`; weight multiplies corridor + satellite terms.
- Create: `src/generator/route-weight.ts`
- Modify: `src/generator/zoning.ts` — delete COVERAGE_* machinery (~lines 29–58, 132–152, 167–169, 176–177); shrink halo (`HALO_REACH_MULTIPLIER` 2.5 → 1.5 `TUNE`); pass weighted roads.
- Modify: `src/generator/model.ts` — build `WeightedRoad[]` from `params.roadEntryPoints` + rng where `assignSprawl` is called (grep `assignSprawl(`).
- Test: `tests/route-weight.test.ts` (new), `tests/zoning.test.ts` (rewrite affected cases)

**Interfaces:**
- Consumes: `RoadEntry` fields from Task 2.
- Produces:

```ts
// route-weight.ts
export interface WeightedRoad { direction: Point; weight: number }
/** Raw data-driven weight, before rank decay. Bare entries (no fields) return 1.0. */
export function rawRouteWeight(e: RoadEntry): number;
/** Full per-route weights: raw weight x seeded rank decay so 1-2 approaches dominate. */
export function routeWeights(entries: RoadEntry[], rng: SeededRandom): WeightedRoad[];
```

- [ ] **Step 1: Write failing unit tests for the weights**

```ts
// tests/route-weight.test.ts
import { describe, test, expect } from 'vitest';
import { rawRouteWeight, routeWeights } from '../src/generator/route-weight.js';
import { SeededRandom } from '../src/utils/random.js';
import { Point } from '../src/types/point.js';

const entry = (over: object) => ({ point: new Point(0, -1), bearingDeg: 0, ...over });

describe('rawRouteWeight', () => {
  test('trails are heavily suppressed', () => {
    expect(rawRouteWeight(entry({ group: 'trails' }))).toBeLessThan(0.2);
  });
  test('through-routes outweigh terminal ones', () => {
    expect(rawRouteWeight(entry({ through: true }))).toBeGreaterThan(rawRouteWeight(entry({ through: false })));
  });
  test('ridge approaches are suppressed below ascent below flat', () => {
    const w = (relief: string) => rawRouteWeight(entry({ relief }));
    expect(w('ridge')).toBeLessThan(w('ascent'));
    expect(w('ascent')).toBeLessThan(w('flat'));
  });
  test('bare entries weigh 1.0', () => {
    expect(rawRouteWeight(entry({}))).toBe(1.0);
  });
});

describe('routeWeights', () => {
  test('equal raw weights still produce a dominant approach (seeded decay)', () => {
    const rng = new SeededRandom(7);
    const ws = routeWeights([entry({}), entry({ bearingDeg: 120 }), entry({ bearingDeg: 240 })], rng)
      .map(r => r.weight).sort((a, b) => b - a);
    expect(ws[0] / ws[2]).toBeGreaterThan(2); // TUNE: top approach at least 2x the weakest
  });
  test('deterministic for a given seed', () => {
    const a = routeWeights([entry({}), entry({ bearingDeg: 120 })], new SeededRandom(9));
    const b = routeWeights([entry({}), entry({ bearingDeg: 120 })], new SeededRandom(9));
    expect(a.map(r => r.weight)).toEqual(b.map(r => r.weight));
  });
});
```

Run: `npx vitest run tests/route-weight.test.ts` — FAIL (module absent).

- [ ] **Step 2: Implement route-weight.ts**

```ts
import { Point } from '../types/point.js';
import type { RoadEntry } from './generation-params.js';
import type { SeededRandom } from '../utils/random.js';

export interface WeightedRoad { direction: Point; weight: number }

const RANK_DECAY = 0.55; // TUNE: weight multiplier per rank step down

export function rawRouteWeight(e: RoadEntry): number {
  const base = e.group === 'trails' || e.kind === 'foot' ? 0.15 : 1.0;
  const through = e.through ? 1.5 : 1.0;
  const relief = e.relief === 'ridge' ? 0.25 : e.relief === 'ascent' ? 0.5 : 1.0;
  const river = e.followsRiver ? 1.2 : 1.0;
  return base * through * relief * river;
}

/**
 * Raw weights x seeded rank decay. The decay is what makes 1-2 approaches
 * dominate even when FMG sends no distinguishing data (bare bearings):
 * routes are ranked by raw weight with seeded jitter breaking ties, then
 * rank k keeps RANK_DECAY^k of its weight.
 */
export function routeWeights(entries: RoadEntry[], rng: SeededRandom): WeightedRoad[] {
  const jittered = entries.map(e => ({ e, key: rawRouteWeight(e) * (0.75 + 0.5 * rng.float()) }));
  const order = [...jittered].sort((a, b) => b.key - a.key);
  const rankOf = new Map(order.map((o, i) => [o.e, i]));
  return entries.map(e => ({
    direction: e.point,
    weight: rawRouteWeight(e) * Math.pow(RANK_DECAY, rankOf.get(e)!),
  }));
}
```

Run unit tests — PASS.

- [ ] **Step 3: Thread weights through the field**

`UrbanisationOptions`: replace `roadDirections: Point[]` with `roads: WeightedRoad[]`. In `scoreAt`, the corridor loop becomes `for (const { direction: d, weight } of roads)` and both the ribbon term and the satellite term are multiplied by `weight`. `assignSprawl` accepts and forwards `roads` (SprawlArgs: `roadDirections: Point[]` → `roads: WeightedRoad[]`). In `model.ts`, at the `assignSprawl` call, build `roads = routeWeights(this.params.roadEntryPoints ?? [], this.rng)`; with no entries pass `[]` (roadless belt fallback must keep working — the halo is what serves it).

- [ ] **Step 4: Delete ring completion, shrink halo**

In `zoning.ts`: delete `COVERAGE_BINS`, `COVERAGE_SPAN_BINS`, `COVERAGE_BONUS`, the `occupied`/`gapBins`/`binOf` machinery and the `anyOccupied` score term. Change `HALO_REACH_MULTIPLIER` from 2.5 to 1.5 (`TUNE`) and update its comment: the halo is now a thin apron so weighted corridors, not an even ring, carry extramural growth.

- [ ] **Step 5: Rewrite zoning tests — watch old ones fail first**

DELETE (they encode the corrected-away even ring): `'wraps the walls in a continuous band of building, not spokes with gaps between them'`, `'a walled town rings its core too, not just a metropolis'`, `'the halo carries the majority of extramural fabric; arms are the minority'`. KEEP: budget caps, water, satellite threshold/reproducer cases, roadless belt fallback.

ADD:

```ts
test('sprawl concentrates on high-weight approaches', () => {
  const { model } = generateFromBurg({
    name: 'Asym', population: 4000, port: false, citadel: false, walls: true,
    plaza: true, temple: false, shanty: false, capital: false,
    roadBearings: [
      { bearing_deg: 0, group: 'roads', through: true, relief: 'flat' },
      { bearing_deg: 120, group: 'trails' },
      { bearing_deg: 240, group: 'roads', relief: 'ridge' },
    ],
  }, { seed: 3 });
  const sectorCount = (bearing: number) => model.patches.filter(p => {
    if (p.zone !== 'suburb' && p.zone !== 'satellite') return false;
    const c = p.shape.center;
    const a = ((Math.atan2(c.x, -c.y) * 180 / Math.PI) + 360) % 360; // y-down compass
    const d = Math.abs(((a - bearing + 540) % 360) - 180);
    return d <= 45;
  }).length;
  expect(sectorCount(0)).toBeGreaterThan(sectorCount(120));
  expect(sectorCount(0)).toBeGreaterThan(sectorCount(240));
});

test('bare-number bearings still sprawl, asymmetrically (seeded fallback)', () => {
  const { model } = generateFromBurg({
    name: 'Bare', population: 4000, port: false, citadel: false, walls: true,
    plaza: true, temple: false, shanty: false, capital: false, roadBearings: [0, 120, 240],
  }, { seed: 3 });
  const sprawl = model.patches.filter(p => p.zone === 'suburb' || p.zone === 'satellite');
  expect(sprawl.length).toBeGreaterThan(0);
});
```

Verify the deleted tests DID fail before deleting them (run the suite once after Step 4 — they must be red; if any still passes, the coverage machinery is not fully out).

- [ ] **Step 6: Run the zoning + route suites**

Run: `npx vitest run tests/zoning.test.ts tests/route-weight.test.ts tests/core-shape.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A src/generator tests/
git commit -m "Faubourgs: per-route weights (data + seeded decay); ring-completion bonus deleted"
```

- [ ] **Step 8: RENDER GATE**

Regenerate + screenshot: pop 4000 (bare bearings — is one approach visibly dominant?), the two-road and roadless controls, pop 50000. Extend `make-review-page.ts` with one new cell exercising rich route data:

```ts
{ label: 'pop 4 000 · rich routes', note: 'through flat road N, trail SE, ridge road SW — growth should favour N', burg: burg({ name: 'Datadriven', population: 4000, roadBearings: [
  { bearing_deg: 0, group: 'roads', through: true, relief: 'flat' },
  { bearing_deg: 120, group: 'trails' },
  { bearing_deg: 240, group: 'roads', relief: 'ridge' },
] as any }), seed: 3 },
```

STOP for Barry.

---

### Task 7: Coastal wall on the shoreline — **RENDER GATE**

Tasks 3–4 should already keep the wall on land. This task verifies the seaward wall READS like Saint-Malo and fixes what does not: towers along the waterfront and the harbour gate onto the quay.

**Files:**
- Modify (as findings dictate): `src/generator/curtain-wall.ts` (`buildTowers`, gate placement), `src/wards/harbour.ts` (pier/quay junction)
- Test: extend `tests/coastal-core.test.ts`

- [ ] **Step 1: Regression test for towers on the waterfront**

```ts
test('a walled port has wall towers on its seaward side', () => {
  const m = new Model(portBurg(3)).generate();
  const ocean = new Point(1, 0); // oceanBearing 90 => +x in local coords
  const seaward = m.wall!.towers.filter(t => (t.x * ocean.x + t.y * ocean.y) > 0);
  expect(seaward.length).toBeGreaterThan(0);
});
```

(Adjust the `towers` accessor to the real field name in `curtain-wall.ts` — grep `buildTowers`.) Run it; whether it fails depends on findings from the render below — if it passes immediately, verify it CAN fail by temporarily filtering seaward towers out of `buildTowers`, confirm red, restore.

- [ ] **Step 2: Generate and LOOK**

```bash
npx tsx diag-render.ts /tmp/render-task7
```
Rasterize the port cell at 2–3 seeds. Compare against Saint-Malo: wall runs along the water's edge, towers included, piers/quay outside the wall at the harbour gate, "just enough water". Fix what falls short in `curtain-wall.ts`/`harbour.ts` — each fix gets its own red-first regression test in `tests/coastal-core.test.ts`.

- [ ] **Step 3: Full suite + commit**

```bash
npx vitest run
git add -A src tests
git commit -m "Coastal walls: shoreline circuit verified; towers and harbour gate on the waterfront"
```

- [ ] **Step 4: RENDER GATE** — port renders (2–3 seeds, small + large harbour) to Barry. STOP.

---

### Task 8: Streets — plaza junction ring and faubourg lanes — **RENDER GATE**

**Files:**
- Modify: `src/generator/model.ts` — `buildStreets` (~line 784), `tidyUpRoads` (~line 860)
- Test: `tests/street-continuity.test.ts` (new)

**Interfaces:**
- Consumes: `this.topology` (`Topology.buildPath(from, to, exclude)`), `this.gates`, `this.plaza`, `patch.zone` labels from Task 6.
- Produces: `this.streets` additionally contains (a) plaza-perimeter junction segments, (b) faubourg lanes. Renderer needs no change (streets pass already draws them).

- [ ] **Step 1: Write the failing continuity test**

```ts
// tests/street-continuity.test.ts
import { describe, test, expect } from 'vitest';
import { Model, mapToGenerationParams } from '../src/index.js';
import { Point } from '../src/types/point.js';

function connectedComponents(polylines: Point[][]): number {
  // Union endpoints by identity of coordinates (streets share vertex objects,
  // but roads may duplicate coords) — join vertices closer than 0.5 units.
  const nodes: Point[] = [];
  const parent: number[] = [];
  const find = (i: number): number => parent[i] === i ? i : (parent[i] = find(parent[i]));
  const idOf = (p: Point): number => {
    for (let i = 0; i < nodes.length; i++) if (Math.hypot(nodes[i].x - p.x, nodes[i].y - p.y) < 0.5) return i;
    nodes.push(p); parent.push(nodes.length - 1); return nodes.length - 1;
  };
  for (const line of polylines) {
    let prev = idOf(line[0]);
    for (let i = 1; i < line.length; i++) {
      const cur = idOf(line[i]);
      parent[find(prev)] = find(cur);
      prev = cur;
    }
  }
  const roots = new Set<number>();
  for (let i = 0; i < nodes.length; i++) roots.add(find(i));
  return roots.size;
}

describe('road continuity', () => {
  test('all streets+roads form ONE connected network (hamlet, village, town)', () => {
    for (const pop of [300, 1200, 4000]) {
      const m = new Model(mapToGenerationParams({
        name: `C${pop}`, population: pop, port: false, citadel: false, walls: pop >= 1000,
        plaza: true, temple: false, shanty: false, capital: false, roadBearings: [0, 120, 240],
      }, 3)).generate();
      const lines = [...m.arteries].map(a => a.vertices);
      expect(connectedComponents(lines)).toBe(1);
    }
  });
});
```

Run: expect FAIL (today's hamlet/village networks are disjoint stubs around the plaza).

- [ ] **Step 2: Implement the plaza junction ring**

In `buildStreets`, after the per-gate loop and before `clipRoadsAtWater`: collect the distinct plaza vertices used as street endpoints; if ≥ 2, walk the plaza perimeter and push each perimeter segment BETWEEN consecutive used endpoints into `this.streets` as a 2-vertex `Polygon`. Then in `tidyUpRoads`'s `cut2segments`, keep the skip-plaza filter for ordinary streets but not for these ring segments (tag them in a `Set<Polygon>` built in `buildStreets`; check membership in the filter). Result: every approach joins every other around (not across) the square — houses align along roads, and the roads actually join.

- [ ] **Step 3: Implement faubourg lanes**

After the junction ring, for each suburb cluster (flood-fill `zone === 'suburb'` patches over `this.adjacency`): find the gate nearest the cluster's centroid; for the cluster patch FARTHEST from that gate, run `this.topology.buildPath(nearestVertexOfThatPatchToGate, gate, this.topology.outer)` and push the result into `this.streets`. One lane per cluster (`TUNE`: if renders want more, one per 3 patches). Skip clusters whose path is null. Satellites get no lanes. No lanes for farm/wilderness.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/street-continuity.test.ts` — PASS all three pops.
Run: `npx vitest run` — no new failures.

- [ ] **Step 5: Commit**

```bash
git add src/generator/model.ts tests/street-continuity.test.ts
git commit -m "Streets: plaza junction ring joins all approaches; faubourg back lanes"
```

- [ ] **Step 6: RENDER GATE** — hamlet + village centres (Barry's circled complaint), pop 4000 faubourg lanes. STOP for Barry.

---

### Task 9: Debt, recalibration, re-pin — runs ONLY after Barry approves Tasks 4–8 renders

**Files:**
- Modify: `tests/fidelity-round4.test.ts` (re-pin hashes), `tests/density-target.test.ts`, `tests/origin-shift.test.ts` findings, `src/wards/ward.ts` or `src/generator/model.ts` (pop-60 fix), stale docs.

- [ ] **Step 1: pop-60 zero-building core patches**

Reproduce: sweep pops 40–120 × seeds 1–20; find seeds where a core `CommonWard` yields 0 buildings. Diagnose WHY `createAlleys` returns nothing for a 4-vertex patch with edge ratio ~0.4 (hypothesis: all bisection products fall below `minSq` — verify by instrumenting, not by guessing). Fix at the root (e.g. a single-building fallback in `createOrthoBuilding` when subdivision yields nothing — decide from evidence). Red-first regression test with a reproducing seed.

- [ ] **Step 2: origin-shift investigation**

`tests/origin-shift.test.ts` — 'SVG viewBox shifts with the origin' and the coastal acceptance band. Read the test, reproduce, trace whether the bounds change (farms-set-frame) broke the shift plumbing or only moved the pinned expectations. Fix code if real; update expectations if merely moved — and say which in the commit message.

- [ ] **Step 3: density floors at the new calibration**

Run: `npx vitest run tests/density-target.test.ts tests/fidelity-round2.test.ts` — all cases must pass with the Task 5 calibration; any still-failing case is a real yield defect to fix, not a bound to lower.

- [ ] **Step 4: re-pin fidelity hashes**

Run: `npx vitest run` — for each pinned-hash failure, confirm the corresponding render was part of an approved render gate, then update the hash. Never re-pin a render Barry has not seen.

- [ ] **Step 5: docs + full suite green**

Update `docs/` where the old share curve / shape field are described as current (grep `0.45`, `shape field`, `extramuralShare`). Run `npx vitest run` — expect 100% green. Commit:

```bash
git add -A
git commit -m "Recalibrate: re-pin fidelity to approved renders; pop-60 yield fix; origin-shift resolution"
```

- [ ] **Step 6: Final ladder render for the record + hand back to Barry** for branch integration (superpowers:finishing-a-development-branch).
