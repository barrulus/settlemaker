# Fidelity Round 2 Implementation Plan (post-launch defects)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the two defects found in live-site testing (2026-08-05): the empty band between a walled town's built core and its wall, and harbour districts sitting inland of the painted shoreline.

**Architecture:** Two contained changes inside `Model`: (1) `applyBuildingBudget` gains a per-patch **proportional** trim policy for walled/large settlements, so density drops uniformly instead of hollowing the periphery the wall was built around (small unwalled hamlets keep the nearest-centre "tight cluster" policy from Plan A); (2) `placeHarbour` prefers patches that **straddle the painted shoreline** (mixed wet/dry vertices against `getWaterRings()`), so the harbour district sits at the visible waterline instead of at patch-adjacency that can be well inland of the synthetic coast. Measured baseline (Salt Harbour, pop 4200, seed 7, oceanBearing 135): wall radius 214 vs outermost building 116 (46% empty band); harbour centre projects 39 units seaward vs painted shore at 64.

**Tech Stack:** TypeScript (strict), vitest. Zero new dependencies.

**Execution base:** current master (includes Plans A–C and the orphan-furrow fix `b8097dd`).

## Global Constraints

- Run everything through the nix shell: `nix develop --command bash -c "<cmd>"` from the repo root.
- Zero runtime dependencies; determinism: same input → byte-identical SVG; the new trim/placement logic must not consume rng (sorts with coordinate tiebreaks only).
- Plan-A contracts stay intact: total ordinary buildings after trim ≤ `buildingBudget(pop, urbanDensity)`; Toprak regression suite (`tests/toprak-regression.test.ts`) passes UNCHANGED — the hamlet look (nearest-centre cluster) must be preserved for small unwalled settlements.
- Harbour contracts stay intact structurally: a port burg with `harbourSize` + water still gets a harbour ward with ≥1 pier; piers touch land (rescue logic untouched); the harbour gate wiring in `placeHarbour` is not modified.
- Float assertions use `toBeCloseTo`, never `toBe`. Do not add `Co-Authored-By` lines.
- Suite is 356 tests green at start; every task ends green. Layout-dependent expectations may shift for walled/harbour fixtures — the reconciliation rule in each task governs; structural invariants are never weakened.
- After merging, the live site redeploys automatically (`src/` is in the Netlify ignore-rule paths); `docs/test-urls.md` known-issues list must be updated to match reality (Task 3).

## File Structure

- `src/generator/model.ts` — MODIFY: `applyBuildingBudget` (two policies), `placeHarbour` (straddle candidates) 
- `tests/fidelity-round2.test.ts` — CREATE: measured acceptance tests for both fixes
- `compare-versions.ts` — MODIFY: add a Salt Harbour case for visual before/after
- `docs/test-urls.md` + `generate-test-urls.ts` — MODIFY: prune fixed known-issues (Task 3)

---

### Task 1: Proportional building-budget trim (wall-gap fix)

Cause chain (measured): pop 4200 → target 1050 households → 60-patch cap → `refineDensity` shrinks `minSq` and overshoots → the global nearest-centre trim keeps the innermost 1050, stripping every outer patch bare while the wall (phase 3) still encloses the full 60-patch footprint. Fix: when the settlement is walled or the budget is large, trim **per patch proportionally** (each patch keeps `n_i × budget/total`, largest-remainder corrected), keeping buildings nearest each *patch's own centre* so blocks stay coherent. Small unwalled settlements (budget ≤ 40) keep the Plan-A global nearest-centre policy — that is the hamlet cluster look Toprak pins.

**Files:**
- Modify: `src/generator/model.ts` (`applyBuildingBudget`)
- Test: `tests/fidelity-round2.test.ts` (create)

**Interfaces:**
- Consumes: `buildingBudget`, `BUDGET_EXEMPT_WARD_TYPES`, `Ward.patch` (every ward holds its patch — see `src/wards/ward.ts` constructor), `Polygon.center`, `this.wall`.
- Produces: unchanged public surface; behavior contract: post-trim total == min(total, budget) in BOTH policies; in proportional mode every patch that had buildings keeps ≥ `floor(n_i × budget/total)` of them.

- [ ] **Step 1: Write the failing test**

Create `tests/fidelity-round2.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { generateFromBurg, WardType, type AzgaarBurgInput, type Model } from '../src/index.js';
import { buildingBudget } from '../src/generator/model.js';
import { CommonWard } from '../src/wards/common-ward.js';

const EXEMPT = new Set<WardType>([
  WardType.Castle, WardType.Cathedral, WardType.Market, WardType.Harbour, WardType.Park,
]);

function ordinaryStats(model: Model): { count: number; maxR: number } {
  let count = 0;
  let maxR = 0;
  for (const patch of model.patches) {
    if (!patch.ward || EXEMPT.has(patch.ward.type)) continue;
    count += patch.ward.geometry.length;
    for (const poly of patch.ward.geometry) {
      maxR = Math.max(maxR, Math.hypot(poly.center.x, poly.center.y));
    }
  }
  return { count, maxR };
}

// The live-site defect reproduction: Salt Harbour, walled port, pop 4200.
const saltHarbour: AzgaarBurgInput = {
  name: 'Salt Harbour', population: 4200, port: true, citadel: false, walls: true,
  plaza: true, temple: false, shanty: false, capital: false,
  oceanBearing: 135, harbourSize: 'large',
};

describe('fidelity round 2: wall gap', () => {
  const { model } = generateFromBurg(saltHarbour, { seed: 7 });

  it('the built town reaches near the wall (no hollow periphery)', () => {
    const wallR = model.wall!.getRadius();
    const { maxR } = ordinaryStats(model);
    // Baseline defect: gap was 46% of wall radius (wall 214, buildings 116).
    expect(wallR - maxR).toBeLessThan(wallR * 0.25);
  });

  it('budget cap still binds exactly', () => {
    const { count } = ordinaryStats(model);
    expect(count).toBeLessThanOrEqual(buildingBudget(4200));
    expect(count).toBeGreaterThan(buildingBudget(4200) * 0.9); // trim, not collapse
  });

  it('no walled CommonWard patch is stripped bare by the trim', () => {
    let stripped = 0;
    let withWard = 0;
    for (const patch of model.patches) {
      if (!(patch.ward instanceof CommonWard) || !patch.withinWalls) continue;
      withWard++;
      if (patch.ward.geometry.length === 0) stripped++;
    }
    expect(withWard).toBeGreaterThan(0);
    // Proportional quotas: a patch loses everything only if it had almost
    // nothing to begin with. Allow a small remainder-rounding tail.
    expect(stripped).toBeLessThanOrEqual(Math.ceil(withWard * 0.1));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nix develop --command bash -c "npx vitest run tests/fidelity-round2.test.ts"`
Expected: FAIL — the gap assertion (baseline 98 > 214×0.25≈54) and likely the stripped-patch assertion.

- [ ] **Step 3: Implement the two-policy trim**

In `src/generator/model.ts`, replace `applyBuildingBudget` (keep its doc comment, extend it):

```typescript
  /**
   * Trim ordinary buildings down to the population budget. Two policies:
   * — Small unwalled settlements (budget ≤ 40, no wall): keep the buildings
   *   closest to the town centre — hamlets read as one tight cluster.
   * — Walled or large settlements: trim each patch proportionally
   *   (largest-remainder quotas), keeping buildings nearest each patch's own
   *   centre. The wall is built around the full patch footprint in phase 3,
   *   so a global nearest-centre trim would hollow the periphery inside it
   *   (live-site defect: wall r=214 vs outermost building r=116).
   * Landmark wards and park groves are exempt; farm plots/furrows live
   * outside ward.geometry. Deterministic: sorts with coordinate tiebreaks,
   * no rng.
   */
  private applyBuildingBudget(): void {
    const budget = buildingBudget(this.params.population, this.params.urbanDensity);

    const isBudgeted = (ward: Ward): boolean =>
      ward.type !== WardType.Park && !BUDGET_EXEMPT_WARD_TYPES.has(ward.type);

    const perPatch: Array<{ ward: Ward; count: number }> = [];
    let total = 0;
    for (const patch of this.patches) {
      if (!patch.ward || !isBudgeted(patch.ward) || patch.ward.geometry.length === 0) continue;
      perPatch.push({ ward: patch.ward, count: patch.ward.geometry.length });
      total += patch.ward.geometry.length;
    }
    if (total <= budget) return;

    if (this.wall === null && budget <= 40) {
      // Hamlet policy: global nearest-centre (Plan A behavior, byte-stable).
      const entries: Array<{ poly: Polygon; dist: number }> = [];
      for (const { ward } of perPatch) {
        for (const poly of ward.geometry) {
          entries.push({ poly, dist: Point.distance(poly.center, this.center) });
        }
      }
      entries.sort((a, b) =>
        a.dist - b.dist ||
        a.poly.center.x - b.poly.center.x ||
        a.poly.center.y - b.poly.center.y,
      );
      const keep = new Set(entries.slice(0, budget).map(e => e.poly));
      for (const { ward } of perPatch) {
        ward.geometry = ward.geometry.filter(p => keep.has(p));
      }
      return;
    }

    // Proportional policy: quota per patch by largest remainder.
    const scale = budget / total;
    const quotas = perPatch.map(e => Math.floor(e.count * scale));
    let assigned = quotas.reduce((a, b) => a + b, 0);
    const byRemainder = perPatch
      .map((e, i) => ({ i, frac: e.count * scale - quotas[i] }))
      .sort((a, b) => b.frac - a.frac || a.i - b.i);
    for (let k = 0; assigned < budget && k < byRemainder.length; k++, assigned++) {
      quotas[byRemainder[k].i]++;
    }

    for (let i = 0; i < perPatch.length; i++) {
      const { ward } = perPatch[i];
      if (quotas[i] >= ward.geometry.length) continue;
      const centre = ward.patch.shape.center;
      const keep = new Set(
        ward.geometry
          .map(poly => ({ poly, d: Point.distance(poly.center, centre) }))
          .sort((a, b) =>
            a.d - b.d ||
            a.poly.center.x - b.poly.center.x ||
            a.poly.center.y - b.poly.center.y,
          )
          .slice(0, quotas[i])
          .map(e => e.poly),
      );
      ward.geometry = ward.geometry.filter(p => keep.has(p));
    }
  }
```

(`Ward.patch` is public on the base class — verify in `src/wards/ward.ts` and adjust access if it is not; do NOT add a new field if one exists.)

- [ ] **Step 4: Run the new test, then the full suite**

Run: `nix develop --command bash -c "npx vitest run tests/fidelity-round2.test.ts && npx vitest run"`

Reconciliation rule: the hamlet policy is byte-stable, so `tests/toprak-regression.test.ts`, `tests/building-budget.test.ts` (pop 13 cases) and all small-settlement fixtures must pass UNCHANGED — failures there are real bugs in the policy switch. Walled/large fixtures (`tests/density-target.test.ts` pop 1200/4500, harbour fixtures at pop 10000) may shift layouts; re-derive exact emergent values only, after eyeballing via the harness (Task 3 adds the case — a temporary local case is fine here). List every re-derived value in the report.

- [ ] **Step 5: Commit**

```bash
git add src/generator/model.ts tests/fidelity-round2.test.ts
git commit -m "Proportional per-patch budget trim for walled towns; hamlets keep the cluster policy"
```

---

### Task 2: Harbour anchored to the painted shoreline

Cause (measured): `placeHarbour` scores candidates by shared edges with waterbody *patches*; the painted shore is the coastline ring, which in `oceanBearing` mode runs seaward of those patch edges — the harbour district lands visibly inland (centre proj 39 vs shore 64 in the Salt Harbour repro). Fix: prefer candidates whose shape **straddles** the ring (has both wet and dry vertices per `Model.isWaterAt`), scored by the total length of shoreline-crossing edges; fall back to the existing waterbody-adjacency scoring when nothing straddles, so tiny meshes and edge cases keep getting harbours.

**Files:**
- Modify: `src/generator/model.ts` (`placeHarbour` candidate selection only — the `best.withinCity`/`Harbour` construction/gate-wiring tail is untouched)
- Test: `tests/fidelity-round2.test.ts` (extend)

**Interfaces:**
- Consumes: `Model.isWaterAt(p)` and `getWaterRings()` (Plan A fidelity round — both exist and are ring-based for BOTH vector-coast and bearing modes), `getNeighbours`, `waterbody`.
- Produces: unchanged public surface; behavior contract: when any straddling candidate exists, `model.harbour.shape` has ≥1 wet and ≥1 dry vertex.

- [ ] **Step 1: Write the failing test**

Append to `tests/fidelity-round2.test.ts`:

```typescript
describe('fidelity round 2: harbour at the painted shoreline', () => {
  it('bearing-mode harbour patch straddles the painted shore', () => {
    const { model } = generateFromBurg(saltHarbour, { seed: 7 });
    expect(model.harbour).not.toBeNull();
    const verts = model.harbour!.shape.vertices;
    const wet = verts.filter(v => model.isWaterAt(v)).length;
    expect(wet).toBeGreaterThan(0);          // reaches into the painted water
    expect(wet).toBeLessThan(verts.length);  // and stands on painted land
  });

  it('vector-coast harbours still place and keep piers', () => {
    const coast = [[
      { x: 40, y: -1500 }, { x: 1500, y: -1500 }, { x: 1500, y: 1500 }, { x: 40, y: 1500 },
    ]];
    const { model } = generateFromBurg({
      name: 'Pierhaven', population: 900, port: true, citadel: false, walls: false,
      plaza: true, temple: false, shanty: false, capital: false,
      coastlineGeometry: coast, harbourSize: 'small',
    });
    expect(model.harbour).not.toBeNull();
    const piers = (model.harbour!.ward as { piers: unknown[] }).piers;
    expect(piers.length).toBeGreaterThanOrEqual(1);
  });
});
```

(Move the `saltHarbour` fixture const to module scope if Step 1 of Task 1 placed it inside a describe.)

- [ ] **Step 2: Run to verify the straddle assertion fails**

Run: `nix develop --command bash -c "npx vitest run tests/fidelity-round2.test.ts"`
Expected: the straddle test FAILS pre-fix (harbour fully dry against the ring — that is the defect). If it accidentally passes for seed 7 post-Task-1, verify against the live-defect params exactly and, only if needed, adjust seed until the pre-fix failure reproduces; document the seed chosen.

- [ ] **Step 3: Implement straddle-first candidate selection**

In `placeHarbour`, replace the candidate-collection block (everything from `const candidates: Array<…> = [];` through the `if (candidates.length === 0) return;`) with:

```typescript
    // Candidates preferred: outer patches bordering the city whose shape
    // STRADDLES the painted shoreline (mixed wet/dry vertices) — the
    // harbour district then sits at the visible waterline, warehouses on
    // painted land, piers over painted water. Scored by total length of
    // shore-crossing edges. Fallback: the old waterbody-patch-adjacency
    // scoring, so small meshes where no patch straddles still get a port.
    const straddling: Array<{ patch: Patch; waterfrontLength: number }> = [];
    const adjacent: Array<{ patch: Patch; waterfrontLength: number }> = [];

    for (const patch of this.patches) {
      if (patch.withinCity) continue;
      if (patch.ward !== null) continue;
      if (this.waterbody.includes(patch)) continue;
      if (!this.getNeighbours(patch).some(n => n.withinCity)) continue;

      let crossingLength = 0;
      patch.shape.forEdge((v0, v1) => {
        if (this.isWaterAt(v0) !== this.isWaterAt(v1)) {
          crossingLength += Point.distance(v0, v1);
        }
      });
      if (crossingLength > 0) {
        straddling.push({ patch, waterfrontLength: crossingLength });
        continue; // straddler found — no need to measure patch adjacency
      }

      let sharedLength = 0;
      patch.shape.forEdge((v0, v1) => {
        for (const wp of this.waterbody) {
          if (wp.shape.findEdge(v1, v0) !== -1) {
            sharedLength += Point.distance(v0, v1);
            break;
          }
        }
      });
      if (sharedLength > 0) {
        adjacent.push({ patch, waterfrontLength: sharedLength });
      }
    }

    const candidates = straddling.length > 0 ? straddling : adjacent;
    if (candidates.length === 0) return;
```

Leave the sort + `best` selection + everything after untouched.

- [ ] **Step 4: Run the new tests, then the full suite**

Run: `nix develop --command bash -c "npx vitest run tests/fidelity-round2.test.ts && npx vitest run"`

Reconciliation rule: harbour placement shifts for bearing-mode fixtures (`tests/harbour.test.ts`, `tests/poi-harbour.test.ts`, `tests/bounds.test.ts`, `tests/ocean-water.test.ts` port cases). Structural invariants must survive unchanged: harbour exists, ≥1 pier, piers touch land, harbour gate present, POI kinds emitted. Exact positions/counts may be re-derived after eyeballing the harness output. A harbour that DISAPPEARS in any existing fixture is a real regression (the fallback path exists precisely to prevent it).

- [ ] **Step 5: Commit**

```bash
git add src/generator/model.ts tests/fidelity-round2.test.ts
git commit -m "Harbour placement prefers patches straddling the painted shoreline"
```

(Plus reconciled test files, listed in the message body.)

---

### Task 3: Verification, harness case, and doc cleanup

**Files:**
- Modify: `compare-versions.ts` (add Salt Harbour case)
- Modify: `generate-test-urls.ts` + regenerate `docs/test-urls.md` (prune fixed known-issues)
- No other source changes expected.

- [ ] **Step 1: Full suite + build + smoke**

Run: `nix develop --command bash -c "npx vitest run && npm run build && npx tsx smoke-test.ts"`
Expected: all green.

- [ ] **Step 2: Harness case + visual sweep**

Add to `compare-versions.ts` CASES (after Grimhaven):

```typescript
  {
    label: 'Salt Harbour — walled port, bearing-only water',
    note: 'pop 4200, walls, oceanBearing 135, large harbour. Round-2 fixes: town fills the walls (no hollow band); harbour district sits ON the painted shoreline.',
    burg: {
      name: 'Salt Harbour', population: 4200, port: true, citadel: false, walls: true,
      plaza: true, temple: false, shanty: false, capital: false,
      oceanBearing: 135, harbourSize: 'large',
    },
  },
```

Regenerate (`npx tsx compare-versions.ts` in the nix shell), rasterize the Salt Harbour NEW panel plus Grimhaven and Toprak NEW panels (sharp snippet from repo history), and check by eye: buildings reach the wall; harbour/warehouses at the waterline with piers in the water; Toprak unchanged (hamlet cluster preserved). Include the rasters in the report. If the wall gap is visually still prominent despite the ≤25% assertion, say so honestly — the number is a floor, the eye is the judge.

- [ ] **Step 3: Update the known-issues list**

In `generate-test-urls.ts`, edit the "Known issues" section: remove the wall-gap and harbour-inland bullets (fixed), keep the roundness bullet, and add any new residual observed in Step 2. Regenerate `docs/test-urls.md` (`npx tsx generate-test-urls.ts`). The `i=` links regenerate identically (codec unchanged) — confirm with `git diff docs/test-urls.md` showing only the known-issues section changing.

- [ ] **Step 4: Commit**

```bash
git add compare-versions.ts generate-test-urls.ts docs/test-urls.md
git commit -m "Fidelity round 2 verification: harness case, refreshed known-issues"
```

---

## Deferred (do NOT implement in this plan)

- Layout roundness (non-circular settlement outlines) — Azgaar-wishlist design work on the Voronoi seeding pattern; own plan, likely with visual iteration.
- Shore-following external roads (the waterline clip stands).
- Radius-probe perf (skip phase 6 in `generateFromBurg`'s first pass — halves generation cost at the 60-patch cap).
- Pier-offset test tolerance rework (assert relative to patch radius) — parked minor from Plan B.
- `Scene.name` population, `seamStroke` removal, lean no-GeoJSON entry point — parked minors from Plans B/C.
