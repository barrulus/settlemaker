# Fidelity Round 3 Implementation Plan (fields, dense towns, visual grooming)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the three live-site defect groups from 2026-08-05 testing round two: furrow lines leaking outside field plots (root cause, at generation), sparse "emptied" walled towns (replace dilution with a sublinear density curve so walls hug dense towns), and the two visual artifacts (near-invisible landmark fill; sliver park groves with lone trees).

**Architecture:** (1) `Farm.createGeometry` furrow pairing gets a param-sort along the scan line plus a midpoint-inside guard — fixing mispaired `pierce()` hits on concave plots at the source (the round-2 midpoint filter in `removeDrownedGeometry` only treated the coastal symptom; it stays, since it still handles dropped plots). (2) A `densityCurve(pop)` (4 people/building for villages → 12 for cities, log-scaled) becomes the default for `buildingBudget` AND `populationToPatches`, so the patch footprint is sized to what the target fills at *natural* density — smaller walls, dense interiors, no cramming, no dilution; explicit FMG `urbanDensity` still overrides. This is an algorithm change for identical inputs → `SETTLEMAKER_VERSION` bumps to 0.8.0. (3) `landmarkFill` gains real contrast; `Park` culls sliver groves; vegetation skips tiny groves.

**Measured baselines:** Fenwick (pop 90, seed 21): 65/76 furrows have an endpoint outside every plot. Highbury (pop 2600, seed 4): target 650 spread over the 60-patch-cap footprint → sparse dots inside wall radius 195. Parchment `landmarkFill #e8d2af` vs paper `#fff2c8` — landmarks read as hollow outlines.

**Tech Stack:** TypeScript (strict), vitest. Zero new dependencies.

**Execution base:** current master (f17f120, includes rounds 1–2).

## Global Constraints

- Run everything through the nix shell: `nix develop --command bash -c "<cmd>"` from the repo root.
- Zero runtime dependencies; determinism: same input → byte-identical SVG. New logic must not perturb rng draw order except where a task explicitly says layouts change (Task 2 changes layouts for pop > 500 by design; Task 1 changes only which furrow segments are kept, not rng; Task 3's grove cull is post-generation filtering and the vegetation change touches only the stream-isolated scene rng).
- Explicit `urbanDensity` (FMG's input) ALWAYS overrides the curve — the curve is the default only. `buildingBudget(pop, explicitDensity)` behavior for callers passing a density is unchanged.
- Toprak and all pop ≤ 500 fixtures are unaffected by Task 2 (curve = 4 there) — their suites pass UNCHANGED; failures there are real bugs.
- `SETTLEMAKER_VERSION` → `0.8.0` and `package.json` → `0.8.0` land in Task 2 (the layout-changing task), not later.
- Float assertions `toBeCloseTo`, never `toBe`. No `Co-Authored-By` lines.
- Suite is 362 tests green at start; every task ends green under each task's reconciliation rule; structural invariants are never weakened.

## File Structure

- `src/wards/farm.ts` — MODIFY: furrow sort + midpoint guard (Task 1)
- `src/generator/generation-params.ts` — MODIFY: `densityCurve` (Task 2)
- `src/generator/model.ts` — MODIFY: `buildingBudget` default (Task 2)
- `src/input/azgaar-input.ts` — MODIFY: `populationToPatches` default (Task 2)
- `src/output/geojson-builder.ts` + `package.json` — MODIFY: 0.8.0 (Task 2)
- `src/output/render-theme.ts` — MODIFY: `landmarkFill` contrast (Task 3)
- `src/wards/park.ts` — MODIFY: sliver-grove cull (Task 3)
- `src/scene/build-scene.ts` — MODIFY: skip trees on tiny groves (Task 3)
- `tests/fidelity-round3.test.ts` — CREATE (Tasks 1–3)
- `compare-versions.ts` gallery + `generate-test-urls.ts`/`docs/test-urls.md` + `docs/url-api.md` — MODIFY (Task 4)

---

### Task 1: Furrows stay inside their plots (generation-level fix)

Mechanism (from source read, `src/wards/farm.ts:54-67`): furrow scan lines are cut against the plot with `pierce(renderPlot, lineStart, lineEnd)` and hits are paired `shift(), shift()` — with NO sort along the line and no odd-count guard. On concave plots (4+ hits) mispaired hits produce segments that span the polygon's *outside*; odd hit counts (vertex tangencies) shift every subsequent pairing. Fix: sort hits by parameter along the scan line, then keep only pairs whose midpoint is inside the plot.

**Files:**
- Modify: `src/wards/farm.ts` (the furrow loop)
- Test: `tests/fidelity-round3.test.ts` (create)

**Interfaces:**
- Consumes: `pierce` (`src/geom/geom-utils.ts` — read it first; if it already sorts hits, the odd-count/tangency case is still unguarded and the fix below remains correct), `pointInPolygon`.
- Produces: unchanged public surface; contract: every emitted furrow's quarter/mid/three-quarter points lie inside the furrow's own plot.

- [ ] **Step 1: Write the failing test**

Create `tests/fidelity-round3.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { generateFromBurg, type AzgaarBurgInput } from '../src/index.js';
import { pointInPolygon } from '../src/geom/point-in-polygon.js';
import { Farm } from '../src/wards/farm.js';
import { Point } from '../src/types/point.js';

const fenwick: AzgaarBurgInput = {
  name: 'Fenwick', population: 90, port: false, citadel: false, walls: false,
  plaza: false, temple: false, shanty: false, capital: false, roadBearings: [],
};

describe('fidelity round 3: furrows stay inside their plots', () => {
  // Baseline defect (seed 21): 65/76 furrows had an endpoint outside every
  // plot — mispaired pierce() hits spanning the outside of concave plots.
  it.each([21, 4, 7])('seed %i: every furrow lies inside its own plot', (seed) => {
    const { model } = generateFromBurg(fenwick, { seed });
    let checked = 0;
    for (const patch of model.patches) {
      const ward = patch.ward;
      if (!(ward instanceof Farm)) continue;
      for (const f of ward.furrows) {
        checked++;
        for (const t of [0.25, 0.5, 0.75]) {
          const p = new Point(
            f.start.x + (f.end.x - f.start.x) * t,
            f.start.y + (f.end.y - f.start.y) * t,
          );
          const inSomePlot = ward.subPlots.some(plot => pointInPolygon(p, plot));
          expect(inSomePlot, `seed ${seed}: furrow sample t=${t} outside all plots`).toBe(true);
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nix develop --command bash -c "npx vitest run tests/fidelity-round3.test.ts"`
Expected: FAIL on at least seed 21 (the measured baseline).

- [ ] **Step 3: Implement sort + midpoint guard**

In `src/wards/farm.ts`, replace the furrow inner loop (the `const hits = pierce(...)` block) with:

```typescript
        const hits = pierce(renderPlot, lineStart, lineEnd);
        // pierce() gives boundary intersections in polygon-edge order, not
        // scan-line order — pair them along the line, or concave plots get
        // segments spanning the OUTSIDE (mispaired in/out points). Sort by
        // parameter along the scan line, then keep only pairs whose midpoint
        // is actually inside the plot (also guards odd counts from vertex
        // tangencies).
        const dirX = lineEnd.x - lineStart.x;
        const dirY = lineEnd.y - lineStart.y;
        hits.sort((a, b) =>
          ((a.x - lineStart.x) * dirX + (a.y - lineStart.y) * dirY) -
          ((b.x - lineStart.x) * dirX + (b.y - lineStart.y) * dirY),
        );
        for (let h = 0; h + 1 < hits.length; h += 2) {
          const p = hits[h];
          const q = hits[h + 1];
          if (Point.distance(p, q) <= 1.2) continue;
          const mid = new Point((p.x + q.x) / 2, (p.y + q.y) / 2);
          if (!pointInPolygon(mid, renderPlot)) continue;
          this.furrows.push({ start: p, end: q });
        }
```

Add the import: `import { pointInPolygon } from '../geom/point-in-polygon.js';`

- [ ] **Step 4: Run the new test, then the full suite**

Run: `nix develop --command bash -c "npx vitest run tests/fidelity-round3.test.ts && npx vitest run"`
Reconciliation: no rng draws change (sorting/filtering only), so layouts are stable; only furrow-count-sensitive expectations could shift (`grep -rn furrow tests/`). The round-2 orphan-furrow test in `tests/water-geometry.test.ts` must still pass (the drowning filter is untouched). Structural failures elsewhere are real bugs.

- [ ] **Step 5: Visual spot-check + commit**

Generate Fenwick (seed 21) to SVG, rasterize with sharp (repo-history snippet), and confirm by eye: hatching sits inside plot boundaries, no crossed hatch fields. Note the raster path in the report.

```bash
git add src/wards/farm.ts tests/fidelity-round3.test.ts
git commit -m "Sort and guard furrow pierce pairs: hatching stays inside concave plots"
```

---

### Task 2: Sublinear density — dense towns, smaller walls

User-directed design change: walls must hug dense towns. Mechanism: default people-per-building follows a curve (villages 4 → cities 12, log-scaled), so the household target shrinks for big settlements, `populationToPatches` sizes the footprint to what that target fills at natural (~9/patch) density, `refineDensity` rarely triggers, and the proportional trim barely binds. Explicit `urbanDensity` still overrides everything.

**Files:**
- Modify: `src/generator/generation-params.ts` (add `densityCurve`)
- Modify: `src/generator/model.ts` (`buildingBudget` default)
- Modify: `src/input/azgaar-input.ts` (`populationToPatches` default)
- Modify: `src/output/geojson-builder.ts` (`SETTLEMAKER_VERSION` → `'0.8.0'`) + `package.json` (`0.8.0`)
- Test: `tests/fidelity-round3.test.ts` (extend)

**Interfaces:**
- Produces: `export function densityCurve(population: number): number` in `src/generator/generation-params.ts`:

```typescript
/**
 * Default people-per-building. Villages are ~4/household; urban buildings
 * house more people (historically true, and matches watabou's visual scale),
 * rising log-linearly to 12 at pop ≥ 20 000. Explicit urbanDensity (FMG's
 * urbanDensityInput) always overrides this default.
 */
export function densityCurve(population: number): number {
  if (population <= 500) return 4;
  return Math.min(12, 4 + 8 * Math.log10(population / 500) / Math.log10(40));
}
```

- `buildingBudget(population, urbanDensity?)` becomes `const d = urbanDensity ?? densityCurve(population); return Math.max(2, Math.round(population / d));`
- `populationToPatches(population, urbanDensity?)` uses the same: `const households = Math.max(2, Math.round(population / (urbanDensity ?? densityCurve(population))));` (import `densityCurve` from `../generator/generation-params.js`).
- Reference values (assert these in tests): densityCurve(13)=4, (500)=4, (2600)≈7.58, (4200)≈8.61, (20000)=12, (100000)=12. Targets: pop 2600 → ≈343 (patches ≈39); pop 4200 → ≈488 (patches ≈55).

- [ ] **Step 1: Write the failing test**

Append to `tests/fidelity-round3.test.ts`:

```typescript
import { densityCurve } from '../src/generator/generation-params.js';
import { buildingBudget } from '../src/generator/model.js';
import { WardType, type Model } from '../src/index.js';
import { CommonWard } from '../src/wards/common-ward.js';

describe('fidelity round 3: sublinear density — dense towns, smaller walls', () => {
  it('densityCurve reference points', () => {
    expect(densityCurve(13)).toBeCloseTo(4, 5);
    expect(densityCurve(500)).toBeCloseTo(4, 5);
    expect(densityCurve(2600)).toBeCloseTo(7.58, 1);
    expect(densityCurve(4200)).toBeCloseTo(8.61, 1);
    expect(densityCurve(20000)).toBeCloseTo(12, 5);
    expect(densityCurve(100000)).toBeCloseTo(12, 5);
  });

  it('explicit urbanDensity still overrides the curve', () => {
    expect(buildingBudget(4200, 4)).toBe(1050);
    expect(buildingBudget(4200)).toBe(Math.round(4200 / densityCurve(4200)));
  });

  it('a walled town is DENSE: walled CommonWard patches average ≥ 5 buildings', () => {
    const { model } = generateFromBurg({
      name: 'Highbury', population: 2600, port: false, citadel: true, walls: true,
      plaza: true, temple: true, shanty: false, capital: true,
      roadBearings: [45, 135, 225, 315],
    }, { seed: 4 });
    let wards = 0, buildings = 0;
    for (const patch of model.patches) {
      if (!(patch.ward instanceof CommonWard) || !patch.withinWalls) continue;
      wards++;
      buildings += patch.ward.geometry.length;
    }
    expect(wards).toBeGreaterThan(0);
    expect(buildings / wards).toBeGreaterThanOrEqual(5); // was ~sparse dots before
  });
});
```

(Adjust imports to merge with Task 1's header — one import block per module.)

- [ ] **Step 2: Run to verify failure**

Run: `nix develop --command bash -c "npx vitest run tests/fidelity-round3.test.ts"`
Expected: FAIL — `densityCurve` missing; density assertion fails on the old spread-out layout.

- [ ] **Step 3: Implement**

Make the four source edits per the Interfaces block, plus the version bumps (`SETTLEMAKER_VERSION = '0.8.0'`, package.json `"version": "0.8.0"`). Note `computeGenerationVersion` already hashes `urbanDensity` and `nPatches` — the curve changes `nPatches` for most pops (natural invalidation), and the library version bump covers same-`nPatches` collisions; no hash-shape change needed.

- [ ] **Step 4: Full suite + reconciliation**

Run: `nix develop --command bash -c "npx vitest run"`

Layouts change for every pop > 500 — expected. Rules:
- Pop ≤ 500 fixtures (Toprak, Fenwick, Saltmere-350, biome-trade pop 50/90, url fixtures) must pass UNCHANGED — curve = 4 there; failures are real bugs.
- `tests/density-target.test.ts`: the [60%, 100%]-of-target band assertions still hold with the NEW targets (they call `buildingBudget(pop)` which now uses the curve — self-adjusting); any hardcoded numbers (e.g. `buildingBudget(8000)` expectations) must be re-derived via `Math.round(8000 / densityCurve(8000))`.
- `tests/fidelity-round2.test.ts`: wall-gap and pier tests re-run under new patch counts — the ≤25% gap bound and pier invariants must still PASS (smaller footprint should make them easier, not harder); if a seed-dependent assertion flips (e.g. the straddle seed), re-derive per the round-2 test's own documented procedure and note it.
- Version-string tests: update `0.7.0` → `0.8.0` expectations.
- Everything else: structural invariants unchanged; exact emergent values re-derived only after eyeballing (Task 4 regenerates the gallery — a temporary local render is fine here).

- [ ] **Step 5: Commit**

```bash
git add src/generator/generation-params.ts src/generator/model.ts src/input/azgaar-input.ts src/output/geojson-builder.ts package.json tests/fidelity-round3.test.ts
git commit -m "Sublinear density curve: dense towns with walls that fit; 0.8.0"
```

(Plus reconciled test files listed in the body.)

---

### Task 3: Landmark contrast + grove/tree grooming

**Files:**
- Modify: `src/output/render-theme.ts` (`landmarkFill`)
- Modify: `src/wards/park.ts` (cull sliver groves)
- Modify: `src/scene/build-scene.ts` (skip trees on tiny groves)
- Test: `tests/fidelity-round3.test.ts` (extend)

**Interfaces & exact edits:**

1. `render-theme.ts` line ~70: `landmarkFill: cssHex(blend(palette.light, 0xffffff, 0.45))` → `landmarkFill: cssHex(blend(palette.light, palette.dark, 0.3))` and update the field comment to say landmarks read darker than ordinary buildings. (Parchment: was `#e8d2af` ≈ paper; new value must differ from `paper` and from `buildingFill` — assert, don't eyeball alone.)
2. `park.ts` `createGeometry`: after the radial/semiRadial assignment, append:

```typescript
    // Cull sliver groves — thin wedges read as artifacts, and a lone tree
    // symbol at a wedge tip looks like debris (live-site report 2026-08-05).
    this.geometry = this.geometry.filter(
      g => Math.abs(g.square) >= 30 && g.compactness >= 0.25,
    );
```

3. `build-scene.ts` `scatterVegetation`: replace the count line `const n = Math.max(1, Math.min(24, Math.round(area / 12)));` with `const n = Math.min(24, Math.floor(area / 12)); if (n === 0) continue;` — tiny groves get no tree instead of a forced one. (Scene rng is stream-isolated; skipping draws is safe.)

- [ ] **Step 1: Write the failing tests**

Append to `tests/fidelity-round3.test.ts`:

```typescript
import { themeFrom } from '../src/output/render-theme.js';
import { PALETTES } from '../src/output/palette.js';

describe('fidelity round 3: visual grooming', () => {
  it('landmarkFill has real contrast against paper and ordinary buildings', () => {
    for (const name of Object.keys(PALETTES)) {
      const t = themeFrom(PALETTES[name]);
      expect(t.landmarkFill, `palette ${name}`).not.toBe(t.paper);
      expect(t.landmarkFill, `palette ${name}`).not.toBe(t.buildingFill);
    }
  });

  it('park groves are never slivers', () => {
    // Sweep a handful of park-bearing towns; every grove that survives must
    // meet the cull thresholds.
    for (const seed of [1, 2, 3, 4, 5]) {
      const { model } = generateFromBurg({
        name: `Groveton${seed}`, population: 2500, port: false, citadel: false,
        walls: true, plaza: true, temple: true, shanty: false, capital: false,
      }, { seed });
      for (const patch of model.patches) {
        if (patch.ward?.type !== WardType.Park) continue;
        for (const g of patch.ward.geometry) {
          expect(Math.abs(g.square)).toBeGreaterThanOrEqual(30);
          expect(g.compactness).toBeGreaterThanOrEqual(0.25);
        }
      }
    }
  });
});
```

(Exact-string `toBe`/`not.toBe` on hex strings is fine — they are strings, not floats.)

- [ ] **Step 2: Verify failure, implement, verify pass, full suite**

The landmark test fails only if some palette collides — run first; the grove test should fail on at least one seed pre-cull (if all five pass pre-fix, widen the seed list until one fails, then keep that list). Implement the three edits. Full suite: `tests/render-theme.test.ts` may pin the old landmarkFill value — update it; `tests/asset-sets.test.ts`/`vegetation-visual.test.ts` park fixtures may lose trees if their groves were tiny — if a fixture loses ALL vegetation, choose a new fixture seed that keeps a legitimate grove rather than weakening assertions.

- [ ] **Step 3: Commit**

```bash
git add src/output/render-theme.ts src/wards/park.ts src/scene/build-scene.ts tests/fidelity-round3.test.ts
git commit -m "Landmark fill contrast; cull sliver groves; no lone trees on tiny groves"
```

---

### Task 4: Verification, gallery, docs

**Files:**
- Modify: `generate-test-urls.ts` + regenerate `docs/test-urls.md` (known-issues refresh)
- Modify: `docs/url-api.md` (document the density-curve default under `urbanDensity`)
- No other source changes expected.

- [ ] **Step 1: Full suite + build + smoke**

Run: `nix develop --command bash -c "npx vitest run && npm run build && npx tsx smoke-test.ts"`

- [ ] **Step 2: Visual sweep**

Regenerate the compare gallery (baseline worktree per compare-versions.ts header; recreate if missing). Rasterize NEW panels for: Fenwick (fields clean — THE check), Salt Harbour + Highbury-class (dense towns, walls hugging), Grimhaven (landmark/temple now visibly filled), any park-bearing panel (no sliver wedges). Honest per-panel verdicts + PNG paths in the report. If density visually overshoots (towns TOO small), tune only the curve's ceiling (12) within [10, 14] or the knee (500) within [400, 800], re-run suite, record.

- [ ] **Step 3: Docs**

- `docs/url-api.md` `urbanDensity` row + `style=`-adjacent guarantees: state the default is a population-scaled curve (4 villages → 12 cities), explicit values override, and same-URL determinism is unaffected.
- `generate-test-urls.ts` known-issues: remove the ≈9% trim-band bullet if the visual sweep shows it obsolete (or update the number), remove nothing else that still reproduces; regenerate `docs/test-urls.md` (i= links must stay byte-identical — they encode inputs).

- [ ] **Step 4: Commit**

```bash
git add generate-test-urls.ts docs/test-urls.md docs/url-api.md
git commit -m "Round 3 verification: gallery sweep, density-curve docs, refreshed known-issues"
```

---

## Deferred (do NOT implement in this plan)

- Layout roundness (non-circular outlines) — still the big wishlist design item.
- Spotty per-patch clustering keep-metric blend — likely moot once density is natural; re-evaluate after Task 4's sweep before scheduling.
- Shore-following roads; heavily-wet straddler warehouse loss; oblique dry piers; probe-phase perf; Scene.name/seamStroke/lean-entry parked minors.
