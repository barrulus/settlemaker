# Fidelity Round 4 Implementation Plan (footprint scaling — the 60-patch cap)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Settlements scale with population. Today every pop ≳ 6k collapses onto the identical 60-patch mesh (same walls, farms, routes — user-verified with an Aldford seed-9 series at 20k/30k/70k/200k, where ONLY the building count changed). After this round: footprint (patches → walls/farms/routes) grows with population up to a measured performance cap, and per-patch texture scales from village-airy (~9 detached buildings) to city-packed (~30 tight blocks), so a 20k city looks like a smaller version of the 200k one — not a sparse version of it.

**Architecture:** Two curves plus the perf work to afford them. (1) Task 1 pays the performance bill first: the radius probe in `generateFromBurg` stops running the full pipeline (phases 4–6 are irrelevant to wall radius — an instant ~2× on every generation), a Voronoi point-multiplier knob is exposed, and a committed calibration harness measures generation time / buildings / wall radius across pop 300 → 200k. This is v0.9.0 (probe change can shift coastal layouts). (2) Task 2 uses those measurements to set `MAX_PATCHES` (starting point 250, latitude [120, 400], chosen so cap-sized generation stays within the measured time budget) and lands the two curves: `perPatchDensity(pop)` (9 → 30, log-scaled 1k → 20k) drives both patch count (`households / perPatchDensity`) and default block texture (`minSqScale = 9 / perPatchDensity`). (3) Task 3 verifies with the user's exact Aldford URL series, the gallery, and docs.

**Measured baselines (2026-08-05):** Aldford seed 9: pops 20k/30k/70k/200k all → 60 patches (targets were 186/278/648/1852) — identical mesh, walls, farmland, routes; only budget-cram differs. Pop 5000 generation ≈ 5.7 s at the 60-patch cap (round-1 note), with the radius probe accounting for roughly half.

**Tech Stack:** TypeScript (strict), vitest. Zero new dependencies.

**Execution base:** current master (dff313d, v0.8.0).

## Global Constraints

- Run everything through the nix shell: `nix develop --command bash -c "<cmd>"` from the repo root.
- Zero runtime dependencies. Explicit `urbanDensity` keeps its exact meaning (people per building) and keeps overriding `densityCurve` — this round changes FOOTPRINT and TEXTURE, not the household budget.
- Version `0.9.0` (`SETTLEMAKER_VERSION` + `package.json`) lands in **Task 1** (the first layout-affecting commit — the probe change can alter coastal origin-shift). The version is already hashed into `settlement_generation_version` (round 3), so caches self-invalidate.
- Inland burgs with pop ≤ 1000 must generate byte-identically (perPatchDensity = 9 and patch formula reduce to today's exactly; the probe path yields the same radius whenever the old full-pipeline probe succeeded on its first attempt, which is the overwhelmingly common case — a coastal fixture whose radius shifts because the OLD probe only succeeded after a phase-4+ retry is a legitimate, documented reconciliation).
- Determinism: same input → byte-identical SVG; no new rng draws outside existing streams.
- Measured decisions only: `MAX_PATCHES` and the point multiplier are chosen from Task 1's committed measurements against an explicit budget — **generation (single, post-probe-fix) ≤ 8 s in the nix-shell Node at the cap** — not guessed. Record chosen values and the numbers behind them.
- Float assertions `toBeCloseTo`, never `toBe`. No `Co-Authored-By` lines.
- Suite is 371 tests green at start; every task ends green under its reconciliation rule; structural invariants never weakened.

## File Structure

- `src/generator/model.ts` — MODIFY: `probeWallRadius` path (Task 1); base texture scale (Task 2)
- `src/index.ts` — MODIFY: probe wiring in `generateFromBurg` (Task 1)
- `src/generator/generation-params.ts` — MODIFY: `perPatchDensity` (Task 2)
- `src/input/azgaar-input.ts` — MODIFY: patch formula + `MAX_PATCHES` (Task 2)
- `src/output/geojson-builder.ts` + `package.json` — MODIFY: 0.9.0 (Task 1)
- `calibrate-density.ts` — CREATE at repo root (Task 1)
- `tests/fidelity-round4.test.ts` — CREATE (Tasks 1–2)
- Gallery/docs (`generate-test-urls.ts`, `docs/test-urls.md`, `docs/url-api.md` if wording touched) — MODIFY (Task 3)

---

### Task 1: Perf prerequisite + calibration harness (v0.9.0)

The radius probe currently runs the ENTIRE pipeline (streets, wards, geometry, density refinement) just to read `border.getRadius()` — a value fully determined by phases 1–3. Give `Model` a probe mode that stops after `buildWalls` (with the same retry/degrade ladder), wire `generateFromBurg` to it, expose the Voronoi point-multiplier as a named knob (unchanged value this task), and build the measurement harness that Task 2's constants will be chosen from.

**Files:**
- Modify: `src/generator/model.ts`, `src/index.ts`
- Modify: `src/output/geojson-builder.ts` (`'0.9.0'`) + `package.json` (`0.9.0`)
- Create: `calibrate-density.ts`
- Test: `tests/fidelity-round4.test.ts` (create)

**Interfaces:**
- Produces `Model.probeWallRadius(): number` — public method: runs the phase 1–3 ladder (`buildPatches → optimizeJunctions → buildWalls`) with the same `MAX_ATTEMPTS` retry loop and the same walls→citadel degrade fallbacks as `generate()`, returning `this.border!.getRadius()`; throws only when every fallback is exhausted (mirror `generate()`'s error message with "probe" in it).
- `src/generator/model.ts` gains a named constant where `buildPatches` computes its point count:

```typescript
/** Voronoi points per requested patch. Countryside ring (farms/wilderness)
 * comes from the surplus. Round-4 Task 2 may scale this down for large
 * meshes based on calibration; keep 8 for nPatches ≤ 60 regardless. */
const VORONOI_POINT_MULTIPLIER = (nPatches: number): number => 8;
```

(and `buildPatches` uses `this.nPatches * VORONOI_POINT_MULTIPLIER(this.nPatches)`).
- `src/index.ts` `generateFromBurg`: replace the pass-1 `new Model(paramsRadiusProbe).generate()` + `radiusProbe.border!.getRadius()` with `new Model(paramsRadiusProbe).probeWallRadius()`. Everything else (shift computation, pass 2) unchanged.
- `calibrate-density.ts` (committed, like `compare-versions.ts`): for pops `[300, 1000, 5000, 20000, 70000, 200000]` with the Aldford flat config (`walls, plaza, temple, seed 9`), print a table: `pop | nPatches (from mapToGenerationParams) | gen ms (Date.now around generateFromBurg) | ordinary buildings | buildings per walled CommonWard patch | wallRadius`; write each SVG to `output/calibrate/aldford-<pop>.svg`. Also accept an optional CLI arg to override the point multiplier is NOT needed — Task 2 edits the constant and re-runs.

- [ ] **Step 1: Write the failing test**

Create `tests/fidelity-round4.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { generateFromBurg, mapToGenerationParams, Model, type AzgaarBurgInput } from '../src/index.js';

const aldford = (population: number): AzgaarBurgInput => ({
  name: 'Aldford', population, port: false, citadel: false, walls: true,
  plaza: true, temple: true, shanty: false, capital: false,
});

describe('fidelity round 4: probe path', () => {
  it('probeWallRadius equals the radius of a full first-attempt generation', () => {
    const params = mapToGenerationParams(aldford(1400), 9);
    const probe = new Model({ ...params, coastlineGeometry: undefined, harbourSize: undefined });
    const r1 = probe.probeWallRadius();
    const full = new Model({ ...params, coastlineGeometry: undefined, harbourSize: undefined }).generate();
    expect(r1).toBeCloseTo(full.border!.getRadius(), 6);
  });

  it('generateFromBurg output is unchanged for an inland burg (probe swap is invisible)', () => {
    // Pinned before the swap in Step 2; regenerated constant must match after.
    const { svg } = generateFromBurg(aldford(1400), { seed: 9 });
    expect(svg.length).toBeGreaterThan(1000); // placeholder until Step 2 pins the hash
  });
});
```

The second test is completed in Step 2: BEFORE making any source change, generate `aldford(1400)` at base and record `svg` SHA-256 (node crypto) as a constant in the test; after the probe swap the hash must be identical (inland burgs take the `shift === NO_SHIFT` path, so the probe's radius value is entirely unused — this proves the swap is inert inland).

- [ ] **Step 2: Pin the inland hash at base, then verify the probe test fails**

Run a scratch script at BASE to print the SHA-256 of `generateFromBurg(aldford(1400), { seed: 9 }).svg`; hard-code it into the second test as `expect(sha256(svg)).toBe('<hash>')`. Then run: `nix develop --command bash -c "npx vitest run tests/fidelity-round4.test.ts"` — first test FAILS (`probeWallRadius` missing), second passes.

- [ ] **Step 3: Implement**

`Model.probeWallRadius()` (mirror `generate()`'s ladder; the try-loop body is `this.buildPatches(); this.optimizeJunctions(); this.buildWalls();` with `this.reset()` on catch). Extract nothing from `generate()` — a sibling method with the three-phase body is clearer than parameterizing `build()`. Add `VORONOI_POINT_MULTIPLIER` and use it in `buildPatches`. Swap the probe call in `src/index.ts`. Bump both version strings to 0.9.0 and update the three version-pinning test files (0.8.0 → 0.9.0).

- [ ] **Step 4: Full suite + reconciliation**

Run: `nix develop --command bash -c "npx vitest run"`
Inland fixtures must be byte-stable (the pinned hash is the canary). Coastal fixtures MAY shift only where the old probe needed a phase-4+ retry — for each such reconciliation, state the fixture and confirm the new value by eyeballing a regenerated render (harness or scratch raster). Version-string tests: expected-value updates only.

- [ ] **Step 5: Build the harness and record baseline measurements**

Create `calibrate-density.ts`; run it; paste the full table into the report. This is the ground truth Task 2 chooses constants from. Expect: all pops ≥ ~6k show nPatches 60 and near-identical wallRadius (the defect), and post-probe-fix gen times roughly half of any pre-fix numbers you also capture (measure base by `git stash`-free means: run the harness once before committing your source changes if convenient, else compare against the plan's 5.7 s baseline note).

- [ ] **Step 6: Commit**

```bash
git add src/generator/model.ts src/index.ts src/output/geojson-builder.ts package.json calibrate-density.ts tests/fidelity-round4.test.ts
git commit -m "Probe-only radius path (2x generation), point-multiplier knob, calibration harness; 0.9.0"
```

(Plus reconciled test files.)

---

### Task 2: Footprint + texture curves, cap from measurements

**Files:**
- Modify: `src/generator/generation-params.ts` (add `perPatchDensity`)
- Modify: `src/input/azgaar-input.ts` (patch formula, `MAX_PATCHES`, retire `BUILDINGS_PER_PATCH`)
- Modify: `src/generator/model.ts` (base texture scale; `VORONOI_POINT_MULTIPLIER` tuning if measurements demand it)
- Test: `tests/fidelity-round4.test.ts` (extend)

**Interfaces:**
- `src/generator/generation-params.ts`:

```typescript
/**
 * Ordinary buildings a patch holds at this settlement's texture. Villages
 * are airy (~9 detached houses per patch, the watabou village look);
 * cities pack ~30 tight blocks per patch (the watabou city look),
 * log-scaled between pop 1 000 and 20 000. Drives BOTH the patch count
 * (footprint) and the default block size (texture) so they stay coherent.
 */
export function perPatchDensity(population: number): number {
  if (population <= 1000) return 9;
  return Math.min(30, 9 + 21 * Math.log10(population / 1000) / Math.log10(20));
}
```

Reference values (assert): perPatchDensity(300)=9, (1000)=9, (5000)≈20.3, (20000)=30, (200000)=30.
- `src/input/azgaar-input.ts`: delete `BUILDINGS_PER_PATCH`; new formula:

```typescript
/** Hard footprint cap, chosen from round-4 calibration against the ≤8 s
 * generation budget (see docs/superpowers/plans/2026-08-05-fidelity-round-4.md).
 * Latitude [120, 400]; record the measured times behind the chosen value. */
export const MAX_PATCHES = 250;

function populationToPatches(population: number, urbanDensity?: number): number {
  const households = Math.max(2, Math.round(population / (urbanDensity ?? densityCurve(population))));
  return Math.max(3, Math.min(MAX_PATCHES, Math.ceil(households / perPatchDensity(population))));
}
```

- `src/generator/model.ts`: texture base scale. Add a private field `baseMinSqScale` set in the constructor to `9 / perPatchDensity(params.population)` (1.0 for villages → 0.3 for cities); initialize `minSqScale = this.baseMinSqScale`; `reset()` restores `this.minSqScale = this.baseMinSqScale`. `refineDensity` composes instead of overwriting: `this.minSqScale = Math.max(0.2, this.baseMinSqScale * Math.max(0.25, count / target));` and restores `this.minSqScale = this.baseMinSqScale` after its rebuild (NOT `= 1`). The 0.2 floor guards against degenerate slivers when both factors compound.
- Expected outcomes to assert (from the curves, before tuning): Aldford 20k → households 1667, patches ≈ 56; 30k → ≈ 84; 70k → ≈ 195; 200k → capped. Wall radius strictly increases across 20k → 30k → 70k.
- If Task 1's measurements show the ≤8 s budget failing at 250 patches: first scale `VORONOI_POINT_MULTIPLIER` down for large meshes (e.g. `nPatches <= 60 ? 8 : Math.max(4, Math.round(480 / nPatches) + 3)` — keep ≤60 at 8 so smaller settlements are untouched), re-measure, and only then lower `MAX_PATCHES` within its latitude. Record every measurement that drove the choice.

- [ ] **Step 1: Write the failing tests**

Append to `tests/fidelity-round4.test.ts`:

```typescript
import { perPatchDensity, densityCurve } from '../src/generator/generation-params.js';
import { MAX_PATCHES } from '../src/input/azgaar-input.js';
import { WardType } from '../src/index.js';
import { CommonWard } from '../src/wards/common-ward.js';

describe('fidelity round 4: footprint and texture scale with population', () => {
  it('perPatchDensity reference points', () => {
    expect(perPatchDensity(300)).toBeCloseTo(9, 5);
    expect(perPatchDensity(1000)).toBeCloseTo(9, 5);
    expect(perPatchDensity(5000)).toBeCloseTo(20.3, 1);
    expect(perPatchDensity(20000)).toBeCloseTo(30, 5);
    expect(perPatchDensity(200000)).toBeCloseTo(30, 5);
  });

  it('pop ≤ 1000 patch counts are unchanged (village stability)', () => {
    expect(mapToGenerationParams(aldford(300), 9).nPatches).toBe(9);   // 75 households / 9
    expect(mapToGenerationParams(aldford(1000), 9).nPatches).toBe(
      Math.max(3, Math.ceil(Math.round(1000 / densityCurve(1000)) / 9)),
    );
  });

  it('the Aldford series gets distinct growing footprints (the user-reported defect)', () => {
    const pops = [20000, 30000, 70000];
    const patchCounts = pops.map(p => mapToGenerationParams(aldford(p), 9).nPatches);
    for (let i = 1; i < patchCounts.length; i++) {
      expect(patchCounts[i]).toBeGreaterThan(patchCounts[i - 1]);
    }
    expect(patchCounts[2]).toBeLessThanOrEqual(MAX_PATCHES);

    const radii = pops.map(p => generateFromBurg(aldford(p), { seed: 9 }).model.wall!.getRadius());
    for (let i = 1; i < radii.length; i++) {
      expect(radii[i]).toBeGreaterThan(radii[i - 1]);
    }
  });

  it('city texture is packed, village texture stays airy', () => {
    const densityOf = (population: number): number => {
      const { model } = generateFromBurg(aldford(population), { seed: 9 });
      let wards = 0, buildings = 0;
      for (const patch of model.patches) {
        if (!(patch.ward instanceof CommonWard) || !patch.withinWalls) continue;
        wards++;
        buildings += patch.ward.geometry.length;
      }
      return buildings / wards;
    };
    const city = densityOf(20000);
    expect(city).toBeGreaterThanOrEqual(perPatchDensity(20000) * 0.55);
    expect(city).toBeLessThanOrEqual(perPatchDensity(20000) * 1.15);
    // Village: pop 800 walled is degraded (pop<150 rule doesn't apply; walls stay) —
    // use pop 800 with walls; texture must stay near 9.
    const village = densityOf(800);
    expect(village).toBeLessThanOrEqual(9 * 1.3);
  });
});
```

(Merge imports with the existing header. `aldford` is already defined in Task 1's block; hoist it to module scope.)

- [ ] **Step 2: Run to verify failure**

`perPatchDensity`/`MAX_PATCHES` missing; footprint test fails on identical 60-patch counts.

- [ ] **Step 3: Implement, measure, choose the cap**

Land the three source edits. Run `calibrate-density.ts` again; paste the new table (gen ms at each pop, especially at the cap) into the report. Apply the tuning ladder from the Interfaces block if the ≤8 s budget fails. The 200k row will sit at the cap with refine compressing texture further — record its buildings/patch and generation time; document "megacities compress beyond the cap" as expected behavior for Task 3's known-issues.

- [ ] **Step 4: Full suite + reconciliation**

Layouts change for every pop > 1000 — expected. Rules: pop ≤ 1000 fixtures byte-stable (Step 1's stability test is the canary; Toprak/Fenwick/biome-trade/url fixtures all sit below it); the round-2/round-3 walled fixtures (Salt Harbour 4200, Highbury 2600, harbour tests at pop 10000) re-derive under their own documented procedures with eyeball confirmation; the wall-gap ≤25% and stripped-patch bounds must still PASS (footprint now sized to fill — if a bound fails, investigate as a real interaction bug before touching any number). Version tests already at 0.9.0 from Task 1.

- [ ] **Step 5: Commit**

```bash
git add src/generator/generation-params.ts src/input/azgaar-input.ts src/generator/model.ts tests/fidelity-round4.test.ts
git commit -m "Footprint and texture scale with population: perPatchDensity curve, MAX_PATCHES from calibration"
```

(Plus reconciled tests, listed in the body.)

---

### Task 3: Verification — the Aldford series is the acceptance fixture

**Files:**
- Modify: `generate-test-urls.ts` + regenerate `docs/test-urls.md`
- No other source changes expected (curve/cap tuning latitude already spent in Task 2).

- [ ] **Step 1: Suite + build + smoke**

`nix develop --command bash -c "npx vitest run && npm run build && npx tsx smoke-test.ts"`

- [ ] **Step 2: The user's exact series, rendered**

Run `calibrate-density.ts` one final time; rasterize `output/calibrate/aldford-{20000,30000,70000,200000}.svg` side by side (sharp) plus a pop-800 village to /tmp/claude-1000/-home-barrulus-dev-settlemaker/fa8029b0-6b4d-4ee0-982e-81ff20a69ab3/scratchpad/r4-aldford-<pop>.png. Verdict honestly, per pop: distinct wall sizes? city texture at 20k+? village still airy? farms/routes proportionate? Paste the final measurement table + PNG paths in the report. Also regenerate the compare gallery for regressions in the existing panels (Toprak/Fenwick/Saltmere must be unchanged; Grimhaven/Salt Harbour/Highbury re-derive visually).

- [ ] **Step 3: Docs**

`generate-test-urls.ts`: add the four Aldford series URLs as a "scaling series" section (they are now the canonical demonstration); refresh known-issues (add "megacities beyond ~pop <cap-equivalent> share the max footprint and compress texture instead"; re-measure the trim band; drop anything the sweep disproves). Regenerate `docs/test-urls.md` (`i=` links byte-identical). If `docs/url-api.md`'s density wording needs the footprint note, add one sentence — geometry semantics, not API change.

- [ ] **Step 4: Commit**

```bash
git add generate-test-urls.ts docs/test-urls.md docs/url-api.md
git commit -m "Round 4 verification: Aldford scaling series, refreshed known-issues"
```

---

## Deferred (do NOT implement in this plan)

- Web-worker generation for the page (large cities will take multiple seconds on the main thread — UX polish, not correctness).
- Layout roundness; harbour-fallback inland; oblique piers; spotty clustering keep-metric; trim-band watch (re-measure in Task 3, still bounded by the 25% ceiling).
- Buildings/forests as assets (art-dependent); scene labels.
