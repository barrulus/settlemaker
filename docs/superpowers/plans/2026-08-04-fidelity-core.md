# Fidelity Core Implementation Plan (Plan A of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make settlemaker's output recognizable as the burg shown on the world map: water rendered from supplied world geometry, building count derived from population, external roads exactly matching supplied routes — pinned by a Toprak regression fixture.

**Architecture:** Three independent fixes inside the existing library (no new modules): `paintWater` in `svg-builder.ts` gains a geometry-driven branch, `Model` gains a post-`buildGeometry` building-budget trim, and the gate/road layer stops inventing external roads when the caller supplied a route list. Spec: `docs/superpowers/specs/2026-08-04-netlify-pivot-design.md`, section "Fidelity requirements (v1 acceptance criteria)".

**Tech Stack:** TypeScript (strict), vitest, zero runtime dependencies. No new packages.

## Global Constraints

- Run everything through the nix shell: `nix develop --command bash -c "<cmd>"` (plain `npx` is not on PATH outside it).
- Zero runtime dependencies — no new packages, devDependencies included.
- Determinism: same seed → identical SVG. New logic must not consume `rng` (use sorts with coordinate tiebreaks, never `Math.random`).
- The `data-bg="paper"` rect and its user-coordinate x/y/width/height are a contract with `cropSvgToTile` in `src/output/settlement-tiler.ts` — do not alter that rect's markup shape.
- Float assertions: use `toBeCloseTo`, never `toBe` (JS `-0` vs `+0`).
- Legacy behavior preserved: a burg with **no** `roadBearings` field and no coastline must generate exactly as today (random gates, patch-painted water fallback for `oceanBearing`).
- Do not add `Co-Authored-By` lines to commit messages (user preference).
- Existing suite (287 tests, 26 files) must be green at the end of every task.

---

### Task 1: Water rendered from coastline geometry

The pond bug: `paintWater` (src/output/svg-builder.ts:149) paints `model.waterbody` Voronoi patch shapes, so the shore follows patch edges and the water ends where the mesh ends — a closed teal blob. Fix: when the caller supplied `coastlineGeometry`, paint the supplied rings themselves as one even-odd path (holes = islands), clipped to the frame rect so open sea bleeds off the map edge. Patch classification remains placement-only. The `oceanBearing`-only fallback keeps the old patch painting.

**Files:**
- Modify: `src/output/svg-builder.ts` (generateSvg ~line 86, paintWater ~line 149)
- Test: `tests/water-geometry.test.ts` (create)

**Interfaces:**
- Consumes: `model.params.coastlineGeometry?: Point[][]` (already exists; in the returned model these rings are pre-shifted so that `sc(p, shift)` restores burg-local coordinates — same convention as every other painted feature).
- Produces: SVG with `<defs><clipPath id="frame-clip">…` immediately after the `<svg>` open tag, and (when coast geometry exists) a `<g clip-path="url(#frame-clip)">` water group containing a `fill-rule="evenodd"` path. Task 4's fixture test greps for these exact strings.

- [ ] **Step 1: Write the failing test**

Create `tests/water-geometry.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { generateFromBurg, type AzgaarBurgInput } from '../src/index.js';

// Open sea east of the burg: shoreline at x=40 (inside the frame), far edge at
// x=1500 (far beyond it). Output coords equal input coords: generateFromBurg
// pre-shifts rings before generation and re-adds the shift when painting.
const seaEast = [[
  { x: 40, y: -1500 },
  { x: 1500, y: -1500 },
  { x: 1500, y: 1500 },
  { x: 40, y: 1500 },
]];

const coastalBurg: AzgaarBurgInput = {
  name: 'Watertest',
  population: 300,
  port: false,
  citadel: false,
  walls: false,
  plaza: true,
  temple: false,
  shanty: false,
  capital: false,
  coastlineGeometry: seaEast,
};

function viewBoxOf(svg: string): { minX: number; minY: number; maxX: number; maxY: number } {
  const m = svg.match(/viewBox="(-?[\d.]+) (-?[\d.]+) ([\d.]+) ([\d.]+)"/);
  expect(m).not.toBeNull();
  const [, x, y, w, h] = m!;
  return {
    minX: parseFloat(x),
    minY: parseFloat(y),
    maxX: parseFloat(x) + parseFloat(w),
    maxY: parseFloat(y) + parseFloat(h),
  };
}

describe('water rendered from coastline geometry', () => {
  it('paints the supplied rings as one clipped even-odd path', () => {
    const { svg } = generateFromBurg(coastalBurg);
    expect(svg).toContain('<clipPath id="frame-clip">');
    expect(svg).toContain('clip-path="url(#frame-clip)"');
    expect(svg).toContain('fill-rule="evenodd"');
  });

  it('open sea extends past the frame edge instead of closing into a pond', () => {
    const { svg } = generateFromBurg(coastalBurg);
    const vb = viewBoxOf(svg);
    // Shoreline is visible inside the frame…
    expect(40).toBeLessThan(vb.maxX);
    // …and the ring continues beyond it, so after clipping the water
    // visually reaches the frame edge (no far shore inside the frame).
    expect(1500).toBeGreaterThan(vb.maxX);
  });

  it('oceanBearing-only burgs keep the patch-painted fallback', () => {
    const { svg } = generateFromBurg({
      ...coastalBurg,
      coastlineGeometry: undefined,
      oceanBearing: 90,
    });
    expect(svg).not.toContain('fill-rule="evenodd"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nix develop --command bash -c "npx vitest run tests/water-geometry.test.ts"`
Expected: FAIL — svg lacks `clipPath`/`fill-rule="evenodd"` (first two tests); third may already pass.

- [ ] **Step 3: Implement the geometry water pass**

In `src/output/svg-builder.ts`, inside `generateSvg`, add the clipPath immediately after the `<svg …>` push (before `paintBackground`):

```typescript
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${bounds.min_x.toFixed(1)} ${bounds.min_y.toFixed(1)} ${(bounds.max_x - bounds.min_x).toFixed(1)} ${(bounds.max_y - bounds.min_y).toFixed(1)}">`);
  parts.push(`<defs><clipPath id="frame-clip"><rect x="${bounds.min_x.toFixed(1)}" y="${bounds.min_y.toFixed(1)}" width="${(bounds.max_x - bounds.min_x).toFixed(1)}" height="${(bounds.max_y - bounds.min_y).toFixed(1)}"/></clipPath></defs>`);
```

Replace `paintWater` with:

```typescript
function paintWater(parts: string[], model: Model, theme: RenderTheme, shift: OriginShift): void {
  if (theme.water === null) return;

  const coast = model.params.coastlineGeometry;
  const rings = coast?.filter(ring => ring.length >= 3) ?? [];

  if (rings.length > 0) {
    // Fidelity contract (spec: "Water is world geometry, not patch paint"):
    // paint the caller's rings as ONE even-odd path — holes stay land — and
    // clip to the frame so open water bleeds off the map edge instead of
    // closing into a pond. Patch classification stays placement-only.
    const d = rings.map(ring => polygonToPath(new Polygon(ring), shift)).join(' ');
    parts.push(`<g clip-path="url(#frame-clip)">`);
    parts.push(`<path d="${d}" fill="${theme.water}" fill-rule="evenodd" stroke="none"/>`);
    if (theme.waterEdge !== null) {
      parts.push(`<path d="${d}" fill="none" stroke="${theme.waterEdge}" stroke-width="${theme.shoreWidth.toFixed(2)}" stroke-linejoin="round"/>`);
    }
    parts.push('</g>');
    return;
  }

  if (model.waterbody.length === 0) return;
  // oceanBearing-only fallback: same-color stroke fills the antialiasing
  // seams between adjacent Voronoi water patches.
  for (const patch of model.waterbody) {
    parts.push(`<path d="${polygonToPath(patch.shape, shift)}" fill="${theme.water}" stroke="${theme.water}" stroke-width="${theme.seamStroke.toFixed(2)}"/>`);
  }
  if (theme.waterEdge !== null) {
    for (const [a, b] of outerWaterEdges(model)) {
      const [x1, y1] = sc(a, shift);
      const [x2, y2] = sc(b, shift);
      parts.push(`<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${theme.waterEdge}" stroke-width="${theme.shoreWidth.toFixed(2)}" stroke-linecap="round"/>`);
    }
  }
}
```

(`polygonToPath`, `Polygon`, `outerWaterEdges`, `sc` all already exist in this file. The old `if (theme.water === null || model.waterbody.length === 0) return;` guard is superseded — coast geometry must paint even when zero patch centroids landed in water.)

- [ ] **Step 4: Run the new test to verify it passes**

Run: `nix develop --command bash -c "npx vitest run tests/water-geometry.test.ts"`
Expected: PASS (3 tests)

- [ ] **Step 5: Run the full suite and reconcile stale expectations**

Run: `nix develop --command bash -c "npx vitest run"`

Likely-affected files (they exercise coastline inputs against the old per-patch markup): `tests/coastline-geometry.test.ts`, `tests/ocean-water.test.ts`, `tests/svg-render.test.ts`, `tests/settlement-tiler.test.ts`, `tests/integration.test.ts`. For each failure, decide by this rule: assertions about **patch classification, waterbody membership, harbour placement** must still pass unchanged (that logic is untouched); assertions that grepped the SVG for per-patch water `<path>`s under a coastline input should be updated to expect the single even-odd path. `oceanBearing`-only assertions must pass unchanged.

Expected: suite green after reconciliation.

- [ ] **Step 6: Commit**

```bash
git add src/output/svg-builder.ts tests/water-geometry.test.ts tests/coastline-geometry.test.ts tests/ocean-water.test.ts tests/svg-render.test.ts
git commit -m "Render water from supplied coastline geometry, clipped to frame"
```

(Include any other reconciled test files in the `git add`.)

---

### Task 2: Population → building budget

The density bug: pop-13 Toprak rendered ~25 houses because `createAlleys` fills every patch to geometric density; nothing consults population. Fix: after `buildGeometry()`, trim ordinary buildings to a population-derived budget, keeping the ones closest to the centre so hamlets read as a tight cluster. Landmark wards (castle, cathedral, market, harbour) and park groves are exempt; farm *plots/furrows* live outside `ward.geometry` and are untouched.

**Files:**
- Modify: `src/generator/generation-params.ts` (add `urbanDensity`)
- Modify: `src/input/azgaar-input.ts` (add `urbanDensity` to `AzgaarBurgInput` + mapping)
- Modify: `src/generator/model.ts` (add `buildingBudget`, `applyBuildingBudget`; call from `buildGeometry`)
- Test: `tests/building-budget.test.ts` (create)

**Interfaces:**
- Consumes: `GenerationParams.population: number` (exists), `Ward.type: WardType`, `Ward.geometry: Polygon[]`, `Polygon.center: Point` (all exist).
- Produces: `export function buildingBudget(population: number, urbanDensity?: number): number` in `src/generator/model.ts` (default density 4, floor 2); `AzgaarBurgInput.urbanDensity?: number` and `GenerationParams.urbanDensity?: number` (people per household, FMG's `urbanDensityInput`). Task 4 imports `buildingBudget` and relies on the trim running inside `generate()`.

- [ ] **Step 1: Write the failing test**

Create `tests/building-budget.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { generateFromBurg, WardType, type AzgaarBurgInput, type Model } from '../src/index.js';
import { buildingBudget } from '../src/generator/model.js';

const BUDGET_EXEMPT = new Set<WardType>([
  WardType.Castle, WardType.Cathedral, WardType.Market, WardType.Harbour, WardType.Park,
]);

function countOrdinaryBuildings(model: Model): number {
  let n = 0;
  for (const patch of model.patches) {
    if (!patch.ward || BUDGET_EXEMPT.has(patch.ward.type)) continue;
    n += patch.ward.geometry.length;
  }
  return n;
}

const hamlet: AzgaarBurgInput = {
  name: 'Tinyville',
  population: 13,
  port: false,
  citadel: false,
  walls: false,
  plaza: false,
  temple: false,
  shanty: false,
  capital: false,
};

describe('population → building budget', () => {
  it('buildingBudget maps population to households', () => {
    expect(buildingBudget(13)).toBe(3);      // 13 / 4 ≈ 3 households
    expect(buildingBudget(13, 6.5)).toBe(2); // FMG urbanDensityInput override
    expect(buildingBudget(1)).toBe(2);       // floor: a burg is ≥ 2 buildings
    expect(buildingBudget(8000)).toBe(2000);
  });

  it('a pop-13 hamlet renders a handful of buildings, not a filled town', () => {
    const { model } = generateFromBurg(hamlet);
    const n = countOrdinaryBuildings(model);
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(buildingBudget(13));
  });

  it('urbanDensity tightens the budget', () => {
    const { model } = generateFromBurg({ ...hamlet, urbanDensity: 6.5 });
    expect(countOrdinaryBuildings(model)).toBeLessThanOrEqual(2);
  });

  it('a large town stays dense (budget only binds when it should)', () => {
    const { model } = generateFromBurg({ ...hamlet, name: 'Bigton', population: 8000, plaza: true, walls: true });
    const n = countOrdinaryBuildings(model);
    expect(n).toBeGreaterThan(100);
    expect(n).toBeLessThanOrEqual(buildingBudget(8000));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nix develop --command bash -c "npx vitest run tests/building-budget.test.ts"`
Expected: FAIL — `buildingBudget` is not exported (import error), and the hamlet count exceeds 3.

- [ ] **Step 3: Add the params fields**

`src/generator/generation-params.ts` — add below `harbourSize` in `GenerationParams`:

```typescript
  /** People per household — FMG's urbanDensityInput. Drives the building budget. Default 4. */
  urbanDensity?: number;
```

`src/input/azgaar-input.ts` — add to `AzgaarBurgInput` (below `harbourSize`):

```typescript
  /** People per household — FMG's urbanDensityInput. Drives the building budget. */
  urbanDensity?: number;
```

and in the `mapToGenerationParams` return object, alongside the other conditional spreads:

```typescript
    ...(burg.urbanDensity != null ? { urbanDensity: burg.urbanDensity } : {}),
```

- [ ] **Step 4: Implement the budget trim in Model**

`src/generator/model.ts`:

Add `WardType` to the interfaces import (line 14 currently imports only `Street`):

```typescript
import { WardType } from '../types/interfaces.js';
import type { Street } from '../types/interfaces.js';
```

Add above the `Model` class (near the existing module constants):

```typescript
/** Ward types whose buildings are feature landmarks, exempt from the population budget. */
const BUDGET_EXEMPT_WARD_TYPES = new Set<WardType>([
  WardType.Castle,
  WardType.Cathedral,
  WardType.Market,
  WardType.Harbour,
]);

/**
 * Population-derived cap on ordinary buildings: ≈ one household per
 * `urbanDensity` people (FMG's urbanDensityInput; default 4), floored at 2
 * so even a pop-1 burg reads as a settlement.
 */
export function buildingBudget(population: number, urbanDensity = 4): number {
  return Math.max(2, Math.round(population / urbanDensity));
}
```

Change `buildGeometry` to run the trim, and add the method:

```typescript
  // Phase 6: Build geometry
  private buildGeometry(): void {
    for (const patch of this.patches) {
      if (patch.ward && !this.waterbody.includes(patch)) {
        patch.ward.createGeometry();
      }
    }
    this.applyBuildingBudget();
  }

  /**
   * Trim ordinary buildings down to the population budget, keeping the ones
   * closest to the centre so small settlements read as a tight cluster.
   * Landmark wards and park groves are exempt; farm plots/furrows live
   * outside ward.geometry. Deterministic: distance sort with coordinate
   * tiebreaks, no rng.
   */
  private applyBuildingBudget(): void {
    const budget = buildingBudget(this.params.population, this.params.urbanDensity);

    const isBudgeted = (ward: Ward): boolean =>
      ward.type !== WardType.Park && !BUDGET_EXEMPT_WARD_TYPES.has(ward.type);

    const entries: Array<{ poly: Polygon; dist: number }> = [];
    for (const patch of this.patches) {
      if (!patch.ward || !isBudgeted(patch.ward)) continue;
      for (const poly of patch.ward.geometry) {
        entries.push({ poly, dist: Point.distance(poly.center, this.center) });
      }
    }
    if (entries.length <= budget) return;

    entries.sort((a, b) =>
      a.dist - b.dist ||
      a.poly.center.x - b.poly.center.x ||
      a.poly.center.y - b.poly.center.y,
    );
    const keep = new Set(entries.slice(0, budget).map(e => e.poly));

    for (const patch of this.patches) {
      if (!patch.ward || !isBudgeted(patch.ward)) continue;
      patch.ward.geometry = patch.ward.geometry.filter(p => keep.has(p));
    }
  }
```

- [ ] **Step 5: Run the new test to verify it passes**

Run: `nix develop --command bash -c "npx vitest run tests/building-budget.test.ts"`
Expected: PASS (4 tests). If "Bigton" lands under 100 buildings, that's a pre-existing density fact, not budget over-trim — verify by checking `entries.length <= budget` was the early-return path (temporarily log), then relax that bound to the observed count minus safety margin rather than weakening the ≤-budget assertion.

- [ ] **Step 6: Run the full suite**

Run: `nix develop --command bash -c "npx vitest run"`
Expected: green. Failures to reconcile: any test counting exact building geometry for *small* populations (check `tests/integration.test.ts`, `tests/poi-hamlet.test.ts`, `tests/svg-render.test.ts`). Large-population fixtures (≥ 4 × building count) are unaffected because the budget doesn't bind. POI tests that attach POIs to specific buildings may need their fixture population raised rather than assertions weakened — prefer that.

- [ ] **Step 7: Commit**

```bash
git add src/generator/model.ts src/generator/generation-params.ts src/input/azgaar-input.ts tests/building-budget.test.ts
git commit -m "Cap ordinary buildings at a population-derived budget"
```

(Include any reconciled test files.)

---

### Task 3: Route-count fidelity

The invented-roads bug, two halves: (a) `mapToGenerationParams` drops an empty `roadBearings` array and `CurtainWall.buildGates` treats "empty" as "absent" (`roadEntryPoints && roadEntryPoints.length > 0`), falling back to random gate fill; (b) `Model.buildStreets` builds an outward road for **every** border gate, even ones no supplied route matched. Contract after this task: `roadBearings` **undefined** → legacy behavior, unchanged; `roadBearings` **supplied** (even `[]`) → external roads exist only for gates with ≥ 1 matched route.

**Files:**
- Modify: `src/input/azgaar-input.ts` (pass empty arrays through, ~line 104)
- Modify: `src/generator/curtain-wall.ts` (`hasBearings`, line 176)
- Modify: `src/generator/model.ts` (`buildStreets`, ~line 424)
- Test: `tests/route-fidelity.test.ts` (create)

**Interfaces:**
- Consumes: `CurtainWall.gateMeta: Map<Point, GateMeta>` with `GateMeta.routes: GateRouteAssignment[]` (exists — routes attached per gate during `buildGates`); harbour gates are added to `model.gates` only (never `border.gates`), so they can't gain outward roads here.
- Produces: `model.roads.length ===` (number of border gates with ≥1 matched route) whenever `params.roadEntryPoints != null`. Task 4 asserts `roads.length === 1` for one supplied trail.

- [ ] **Step 1: Write the failing test**

Create `tests/route-fidelity.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { generateFromBurg, type AzgaarBurgInput } from '../src/index.js';

const base: AzgaarBurgInput = {
  name: 'Routetown',
  population: 400,
  port: false,
  citadel: false,
  walls: false,
  plaza: true,
  temple: false,
  shanty: false,
  capital: false,
};

describe('route-count fidelity', () => {
  it('one supplied trail yields exactly one external road', () => {
    const { model } = generateFromBurg({
      ...base,
      roadBearings: [{ bearing_deg: 270, kind: 'foot', route_id: 't1' }],
    });
    expect(model.roads.length).toBe(1);
  });

  it('three well-separated routes yield exactly three external roads', () => {
    const { model } = generateFromBurg({ ...base, roadBearings: [0, 120, 240] });
    expect(model.roads.length).toBe(3);
  });

  it('two clustered routes share one gate and one road, both ids echoed', () => {
    const { model } = generateFromBurg({
      ...base,
      roadBearings: [
        { bearing_deg: 85, route_id: 'a' },
        { bearing_deg: 95, route_id: 'b' },
      ],
    });
    expect(model.roads.length).toBe(1);
    const routed = [...model.border!.gateMeta.values()].flatMap(m => m.routes);
    expect(routed.map(r => r.routeId).sort()).toEqual(['a', 'b']);
  });

  it('an explicitly empty route list yields zero external roads but streets remain', () => {
    const { model } = generateFromBurg({ ...base, roadBearings: [] });
    expect(model.roads.length).toBe(0);
    expect(model.streets.length).toBeGreaterThan(0);
  });

  it('legacy: no roadBearings field keeps random gates and their roads', () => {
    const { model } = generateFromBurg(base);
    expect(model.roads.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nix develop --command bash -c "npx vitest run tests/route-fidelity.test.ts"`
Expected: FAIL on the empty-list test (random fill invents roads). The 1-trail / 3-route tests may already pass (bearing-driven gates already suppress random fill) — that's fine; they pin the behavior.

- [ ] **Step 3: Pass empty arrays through the input mapping**

`src/input/azgaar-input.ts`, in `mapToGenerationParams` — the current spread drops empty arrays:

```typescript
    ...(roadEntryPoints && roadEntryPoints.length > 0 ? { roadEntryPoints } : {}),
```

becomes (supplied-but-empty now means "zero routes", not "unknown"):

```typescript
    ...(roadEntryPoints != null ? { roadEntryPoints } : {}),
```

- [ ] **Step 4: Treat an empty supplied list as authoritative in gate building**

`src/generator/curtain-wall.ts` line 176:

```typescript
    const hasBearings = roadEntryPoints && roadEntryPoints.length > 0;
```

becomes:

```typescript
    const hasBearings = roadEntryPoints != null;
```

(With an empty list: the bearing loop places nothing, the existing "ensure at least one gate" clause still creates a single routeless gate — streets need a topology anchor — and random fill is skipped.)

- [ ] **Step 5: Build outward roads only for routed gates**

`src/generator/model.ts`, in `buildStreets` — at the top of the method body add:

```typescript
    const routeAware = this.params.roadEntryPoints != null;
```

and wrap the road-building branch (currently `if (this.border!.gates.includes(gate)) { const dir = … }`):

```typescript
        if (this.border!.gates.includes(gate)) {
          const hasRoute = (this.border!.gateMeta.get(gate)?.routes.length ?? 0) > 0;
          if (!routeAware || hasRoute) {
            const dir = gate.norm(1000);
            let start: Point | null = null;
            let dist = Infinity;
            for (const [, pt] of this.topology.node2pt) {
              const d = Point.distance(pt, dir);
              if (d < dist) {
                dist = d;
                start = pt;
              }
            }

            if (start) {
              const road = this.topology.buildPath(start, gate, this.topology.inner);
              if (road !== null) {
                this.roads.push(new Polygon(road));
              }
            }
          }
        }
```

(The street from gate to plaza/centre is still built for every gate — internal connectivity is untouched; only the outward stub is gated on a matched route.)

- [ ] **Step 6: Run the new test to verify it passes**

Run: `nix develop --command bash -c "npx vitest run tests/route-fidelity.test.ts"`
Expected: PASS (5 tests). If the 3-route test yields 2 roads, the cause is `topology.buildPath` returning null for one gate (pathfinding, not fidelity logic) — nudge the fixture bearings (e.g. `[10, 130, 250]`) rather than weakening the assertion, and note which seed/bearing pair failed in the commit message.

- [ ] **Step 7: Run the full suite**

Run: `nix develop --command bash -c "npx vitest run"`
Expected: green. `tests/route-entry-points.test.ts` and `tests/entrance-output.test.ts` exercise supplied-bearing burgs whose gates all carry routes, so their roads are unchanged; investigate any failure there as a real regression, not an expectation to update.

- [ ] **Step 8: Commit**

```bash
git add src/input/azgaar-input.ts src/generator/curtain-wall.ts src/generator/model.ts tests/route-fidelity.test.ts
git commit -m "External roads match supplied routes exactly; empty route list means none"
```

---

### Task 4: Toprak regression fixture

Pin all three fixes with one fixture modelled on the real failing burg: Toprak (snoopia world), pop 13, coastal with open sea east, one trail from the west. Each assertion maps to one bug in the 2026-08-04 screenshots.

**Files:**
- Create: `tests/fixtures/toprak.ts`
- Test: `tests/toprak-regression.test.ts` (create)

**Interfaces:**
- Consumes: `generateFromBurg` (src/index.ts), `buildingBudget` (src/generator/model.ts, Task 2), the SVG markers `clip-path="url(#frame-clip)"` / `fill-rule="evenodd"` (Task 1), routed-gates-only roads (Task 3).
- Produces: `export const toprak: AzgaarBurgInput` — the canonical fidelity fixture; later plans (scene schema, web app) reuse it.

- [ ] **Step 1: Write the fixture**

Create `tests/fixtures/toprak.ts`:

```typescript
import type { AzgaarBurgInput } from '../../src/index.js';

/**
 * Regression fixture modelled on burg "Toprak" (snoopia world, 2026-08-04
 * screenshots): a pop-13 coastal hamlet with open sea to the east and a
 * single trail approaching from the west. The original render showed a
 * closed pond, ~25 buildings, and multiple roads — each assertion in
 * toprak-regression.test.ts pins one of those defects.
 * Spec: docs/superpowers/specs/2026-08-04-netlify-pivot-design.md,
 * "Fidelity requirements (v1 acceptance criteria)".
 */
export const toprak: AzgaarBurgInput = {
  name: 'Toprak',
  population: 13,
  port: false,
  citadel: false,
  walls: false,
  plaza: false,
  temple: false,
  shanty: false,
  capital: false,
  roadBearings: [{ bearing_deg: 270, kind: 'foot', route_id: 'trail-toprak' }],
  // Open sea east: shoreline at x=40, ring far beyond the frame on the
  // other three sides so the clipped water bleeds off the map edge.
  coastlineGeometry: [[
    { x: 40, y: -1500 },
    { x: 1500, y: -1500 },
    { x: 1500, y: 1500 },
    { x: 40, y: 1500 },
  ]],
};
```

- [ ] **Step 2: Write the regression test**

Create `tests/toprak-regression.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { generateFromBurg, WardType, type Model } from '../src/index.js';
import { buildingBudget } from '../src/generator/model.js';
import { toprak } from './fixtures/toprak.js';

const BUDGET_EXEMPT = new Set<WardType>([
  WardType.Castle, WardType.Cathedral, WardType.Market, WardType.Harbour, WardType.Park,
]);

function countOrdinaryBuildings(model: Model): number {
  let n = 0;
  for (const patch of model.patches) {
    if (!patch.ward || BUDGET_EXEMPT.has(patch.ward.type)) continue;
    n += patch.ward.geometry.length;
  }
  return n;
}

describe('Toprak fidelity regression (spec acceptance criteria)', () => {
  const result = generateFromBurg(toprak);

  it('water is world geometry clipped to the frame, not a closed pond', () => {
    expect(result.svg).toContain('clip-path="url(#frame-clip)"');
    expect(result.svg).toContain('fill-rule="evenodd"');
    const m = result.svg.match(/viewBox="(-?[\d.]+) (-?[\d.]+) ([\d.]+) ([\d.]+)"/)!;
    const maxX = parseFloat(m[1]) + parseFloat(m[3]);
    expect(40).toBeLessThan(maxX);      // shoreline inside the frame
    expect(1500).toBeGreaterThan(maxX); // sea continues past the frame edge
  });

  it('pop 13 yields a handful of buildings', () => {
    const n = countOrdinaryBuildings(result.model);
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(buildingBudget(13)); // 3
  });

  it('exactly one external road, echoing the supplied trail', () => {
    expect(result.model.roads.length).toBe(1);
    const routed = [...result.model.border!.gateMeta.values()].flatMap(meta => meta.routes);
    expect(routed.map(r => r.routeId)).toContain('trail-toprak');
  });

  it('deterministic: same input → byte-identical SVG', () => {
    expect(generateFromBurg(toprak).svg).toBe(result.svg);
  });
});
```

- [ ] **Step 3: Run the regression test**

Run: `nix develop --command bash -c "npx vitest run tests/toprak-regression.test.ts"`
Expected: PASS (4 tests). These must pass without touching `src/` — if one fails, the corresponding earlier task is incomplete; fix it there, not here.

- [ ] **Step 4: Commit**

```bash
git add tests/fixtures/toprak.ts tests/toprak-regression.test.ts
git commit -m "Add Toprak regression fixture pinning the fidelity acceptance criteria"
```

---

### Task 5: Full verification

**Files:**
- No source changes expected. Read-only verification plus any final test reconciliation.

**Interfaces:**
- Consumes: everything above.
- Produces: a green suite and a visually-inspectable SVG pair proving the fixes.

- [ ] **Step 1: Full test suite**

Run: `nix develop --command bash -c "npx vitest run"`
Expected: all files green (287 pre-existing + the 4 new files). Any failure at this point is a regression from this plan — fix before proceeding.

- [ ] **Step 2: Type-check the library build**

Run: `nix develop --command bash -c "npm run build"`
Expected: `tsc` exits 0.

- [ ] **Step 3: End-to-end smoke**

Run: `nix develop --command bash -c "npx tsx smoke-test.ts"`
Expected: completes without error (smoke-test drives `generateFromBurg` end-to-end).

- [ ] **Step 4: Visual check artifact**

Write `/tmp/claude-1000/-home-barrulus-dev-settlemaker/fa8029b0-6b4d-4ee0-982e-81ff20a69ab3/scratchpad/toprak-check.ts`:

```typescript
import { writeFileSync } from 'node:fs';
import { generateFromBurg } from './src/index.js';
import { toprak } from './tests/fixtures/toprak.js';

const { svg, model } = generateFromBurg(toprak);
writeFileSync('/tmp/claude-1000/-home-barrulus-dev-settlemaker/fa8029b0-6b4d-4ee0-982e-81ff20a69ab3/scratchpad/toprak.svg', svg);
console.log('roads:', model.roads.length, 'patches:', model.patches.length);
```

Run: `nix develop --command bash -c "npx tsx /tmp/claude-1000/-home-barrulus-dev-settlemaker/fa8029b0-6b4d-4ee0-982e-81ff20a69ab3/scratchpad/toprak-check.ts"` (tsx resolves the repo-relative imports because the script is executed from the repo cwd — if imports fail, copy the script into the repo root temporarily and delete it after).

Open `toprak.svg` (Read tool renders it) and confirm by eye: sea fills the east side to the frame edge, ≤ 3 ordinary buildings, one road leaving west. Show it to the user in the final report.

- [ ] **Step 5: Final commit (only if reconciliation touched anything)**

```bash
git status --short
# if clean: nothing to do
# else:
git add <touched test files>
git commit -m "Reconcile remaining tests with fidelity-core behavior"
```

---

## Deferred to later plans (do NOT implement here)

- Scene schema / GeoJSON semantic tags, asset sets, `<style>`-block group contract → Plan B.
- URL codec (`i=`, `style=`), `web/` Vite app, `netlify.toml`, `docs/url-api.md` → Plan C.
- GeoJSON water features still emit patch-derived shapes in this plan; the geometry-faithful scene water feature is Plan B work.
- `kind: 'sea'` bearings informing pier orientation — spec note, Plan B.
