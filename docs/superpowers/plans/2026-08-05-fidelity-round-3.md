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

### Task 1 (REVISED): Fields as assets — pattern-rendered parcels

> Revision note (2026-08-05, mid-execution): the original geometry fix was proven a no-op under review (pierce() already sorts; the TDD test passes against base code). Real defect: field READABILITY — `fieldFill` is an 8% paper tint (invisible parcels) while furrow lines render prominently, so correctly-clipped hatching reads as loose lines. User direction: fields become assets — semantic plot data rendered via SVG patterns from the asset set, eliminating per-furrow geometry entirely. Commit ef3d046 (the guard) stays; this task removes furrow generation wholesale.

**Files:**
- Modify: `src/wards/farm.ts` (drop furrow generation; record per-plot angles)
- Modify: `src/scene/scene.ts` (FieldPlot.angleDeg — additive; furrows layer deprecated)
- Modify: `src/scene/build-scene.ts` (fields carry angles; furrows emit `[]`)
- Modify: `src/assets/asset-sets.ts` (AssetSet.patterns + field pattern)
- Modify: `src/output/assemble-svg.ts` (pattern defs + two-pass plot rendering; CSS)
- Modify: `src/output/render-theme.ts` (fieldFill 0.08 → 0.18 blend)
- Modify: `src/generator/model.ts` (removeDrownedGeometry: drop the furrow filter — furrows no longer exist)
- Test: rewrite the round-3 furrow test block in `tests/fidelity-round3.test.ts`

**Interfaces:**
- `FieldPlot` becomes `{ ring: ScenePoint[]; angleDeg: number }` (additive field; `Scene.layers.furrows` stays typed but is always `[]` — deprecate in the doc comment: "always empty since scene v1.1; fields carry angleDeg instead").
- `Farm` gains `plotAngles: number[]` parallel to `subPlots` (angle in degrees of the furrow direction, from the plot's OBB: direction `box[3] − box[0]`, i.e. `Math.atan2(box[3].y - box[0].y, box[3].x - box[0].x) * 180 / Math.PI`). `Farm.furrows` stays declared but is never populated.
- `AssetSet` gains `patterns?: Record<string, { width: number; height: number; content: string }>`; `SCHEMATIC_SET.patterns = { field: { width: 2, height: 1.3, content: '<line x1="0" y1="0.65" x2="2" y2="0.65" class="furrow"/>' } }` (1.3 = the old MIN_FURROW spacing).
- Assembler contract: for each 15°-quantized angle bucket actually used, one def `<pattern id="${clipId}-field-a${bucket}" patternUnits="userSpaceOnUse" width="…" height="…" patternTransform="rotate(${bucket})">…</pattern>`; each plot renders twice inside `#fields`: `<path class="plot" d="…"/>` (base fill + border via CSS) then `<path class="hatch" d="…" fill="url(#${clipId}-field-a${bucket})"/>`. CSS: replace the old `#fields path`/`#fields line` rules with `#fields .plot{fill:${fieldFill};stroke:${fieldFurrow};stroke-width:0.2}` and `.furrow{stroke:${fieldFurrow};stroke-width:0.15;opacity:0.5}` (the `.furrow` rule styles pattern content — document-level CSS reaches `<defs>`). Bucket function: `const bucket = ((Math.round(a / 15) * 15) % 180 + 180) % 180;`.
- Pattern ids embed `clipId` — same per-document uniqueness mechanism as the clip path (multi-SVG pages stay collision-free).

- [ ] **Step 1: Rewrite the failing test block**

Replace the round-3 furrow describe-block in `tests/fidelity-round3.test.ts` with:

```typescript
describe('fidelity round 3: fields as assets', () => {
  it('Farm emits plots with angles and NO furrow segments', () => {
    const { model } = generateFromBurg(fenwick, { seed: 21 });
    let plots = 0;
    for (const patch of model.patches) {
      const ward = patch.ward;
      if (!(ward instanceof Farm)) continue;
      expect(ward.furrows.length).toBe(0);
      expect(ward.plotAngles.length).toBe(ward.subPlots.length);
      for (const a of ward.plotAngles) expect(Number.isFinite(a)).toBe(true);
      plots += ward.subPlots.length;
    }
    expect(plots).toBeGreaterThan(0);
  });

  it('scene fields carry angleDeg; furrows layer is empty', async () => {
    const r = generateFromBurg(fenwick, { seed: 21 });
    const { buildScene } = await import('../src/scene/build-scene.js');
    const scene = buildScene(r.model, { shift: r.originShift });
    expect(scene.layers.furrows).toEqual([]);
    expect(scene.layers.fields.length).toBeGreaterThan(0);
    for (const f of scene.layers.fields) {
      expect(Number.isFinite(f.angleDeg)).toBe(true);
    }
  });

  it('SVG renders parcels as bordered plots with rotated hatch patterns', () => {
    const { svg } = generateFromBurg(fenwick, { seed: 21 });
    expect(svg).toMatch(/<pattern id="frame-clip-field-a\d+"/);
    expect(svg).toMatch(/patternTransform="rotate\(\d+\)"/);
    const fields = svg.match(/<g id="fields">([\s\S]*?)<\/g>/)![1];
    expect(fields).toContain('class="plot"');
    expect(fields).toMatch(/class="hatch" d="[^"]+" fill="url\(#frame-clip-field-a\d+\)"/);
    expect(fields).not.toContain('<line'); // furrow line segments are gone
  });

  it('pattern ids follow a custom clipId (multi-SVG documents)', () => {
    const { model } = generateFromBurg(fenwick, { seed: 21 });
    const svg = generateSvg(model, { clipId: 'zzz' });
    expect(svg).toMatch(/<pattern id="zzz-field-a\d+"/);
    expect(svg).not.toContain('frame-clip-field');
  });
});
```

(Add `generateSvg` to the imports from `../src/index.js`.)

- [ ] **Step 2: Run to verify failure**

Run: `nix develop --command bash -c "npx vitest run tests/fidelity-round3.test.ts"`
Expected: FAIL — no `plotAngles`, furrows still emitted, no patterns.

- [ ] **Step 3: Implement across the six source files**

Per the Interfaces block. Farm: delete the furrow loop; push `this.plotAngles.push(angleOf(box))` per surviving plot (initialize `plotAngles = []` beside `furrows = []` in `createGeometry`; the OBB is already computed per plot). build-scene: `scene.layers.fields.push({ ring: ring(plot), angleDeg: ward.plotAngles[i] ?? 0 })`. model.ts `removeDrownedGeometry`: when dropping a drowned subPlot, drop its angle at the same index (filter both arrays in lockstep — iterate indexes, keep pairs); delete the furrow filter lines. Assembler: collect used buckets from `scene.layers.fields`, emit pattern defs after the clipPath, render the two-pass plots; update `themeToCss`. render-theme: fieldFill blend 0.08 → 0.18.

- [ ] **Step 4: Run the new tests, then full suite + reconciliation**

Rules: the orphan-furrow test in `tests/water-geometry.test.ts` is obsolete — DELETE it (furrows no longer exist; the plot drowning filter keeps its own coverage). `tests/svg-render.test.ts` furrow-line expectations → replace with pattern/plot assertions. `tests/scene.test.ts` purity/deep-equal still passes (additive field). `docs/scene-schema.md` update happens in Task 4, not here. No rng changes (the furrow loop used none): layout determinism suites must pass unchanged.

- [ ] **Step 5: Visual spot-check + commit**

Rasterize Fenwick seed 21: parcels must read as bordered fields with rotated hatching contained by construction. PNG path in the report.

```bash
git add src/wards/farm.ts src/scene/ src/assets/asset-sets.ts src/output/assemble-svg.ts src/output/render-theme.ts src/generator/model.ts tests/
git commit -m "Fields as assets: semantic plots + rotated hatch patterns; furrow geometry removed"
```

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
