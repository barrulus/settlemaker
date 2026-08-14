# Village Rows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Villages (`population ≤ 600`) render dwellings as rows of house glyphs stamped along road frontages — census-true, farm structures preserved — while towns and cities stay byte-identical.

**Architecture:** Pure slot/filter/variety modules land first (Tasks 1-3, unwired); one atomic task (4) flips the village regime (CommonWard dwelling skip + refineDensity skip + `stampVillageRows` after `applyBuildingBudget`), so there is no window where village tests fail. Stamped houses are real ward-geometry rectangles paired with `PlacedSymbol` glyph instances; Task 5 teaches the scene/assembler not to double-render them. Spec: `docs/superpowers/specs/2026-08-14-village-rows-design.md`.

**Tech Stack:** TypeScript (Node 22 via nix), vitest, zero runtime deps.

## Global Constraints

- All node commands via `nix develop --command bash -c "..."`.
- Commit messages imperative; NEVER mention Claude anywhere (no trailers, no footers, no comments). Never push until the render-gate task says so.
- TDD per task: RED before implement; verification = focused vitest + full suite + `npx tsc --noEmit` clean (vitest does not typecheck).
- Village regime = `!rowHousing(population)` i.e. `population ≤ 600` (`ROW_HOUSING_MIN_POPULATION`, src/generator/generation-params.ts:50).
- BOTH fidelity-round4 sha256 canaries (pop 800, pop 1400) are town-regime: they must remain byte-identical through EVERY task. A canary failure is always a defect in the change, never a pin to move.
- Only version-string pins move, in Task 6 (1.1.0 → 1.2.0: package.json, SETTLEMAKER_VERSION, and the three tests updated at the 1.1.0 bump: degraded-generation, geojson-schema-v4, origin-shift).
- House glyph footprints from `SYMBOL_MANIFEST` (src/assets/symbol-manifest.ts): sm-house 6×6, sm-house-tiled 6×6, sm-house-large-tiled 8×8, sm-hut-* 4.5×4.5, sm-longhouse 10×5. Sizing used as-is; a single scale factor is the render-gate fallback.
- Road nominal widths from ward.ts constants: arteries and approach `roads` use `MAIN_STREET` (2.0), `streets` use `REGULAR_STREET` (1.0).
- Canonical test-model helper (repeat per new test file):

```ts
import { Model, mapToGenerationParams, type AzgaarBurgInput } from '../src/index.js';
function mk(population: number, seed: number, overrides: Partial<AzgaarBurgInput> = {}): Model {
  return new Model(mapToGenerationParams({
    name: 'Test', population, port: false, citadel: false, walls: false,
    plaza: false, temple: false, shanty: false, capital: false, ...overrides,
  }, seed)).generate();
}
```

## File Structure

| Path | Role |
|---|---|
| `src/generator/village-rows.ts` | NEW. Slot generation, acceptance filters, variety picker, `stampVillageRows`. |
| `src/generator/model.ts` | buildGeometry tail hook; refineDensity village skip; `glyphBackedBuildings: Set<Polygon>`. |
| `src/wards/common-ward.ts` | Village dwelling skip in `createGeometry`. |
| `src/scene/scene.ts` + `src/scene/build-scene.ts` | Additive `BuildingFeature.glyphBacked?: true`. |
| `src/output/assemble-svg.ts` | Suppression of path+shadow for glyph-backed features; symbols-off disarm. |
| `tests/village-rows.test.ts` | NEW. All placement tests. |
| `tests/assemble-symbols.test.ts` | Extended: glyphBacked rendering tests. |

---

### Task 1: Slot generation along a polyline (pure geometry)

**Files:**
- Create: `src/generator/village-rows.ts`
- Test: `tests/village-rows.test.ts`

**Interfaces:**
- Produces (later tasks consume exactly these):

```ts
export interface FrontageSlot {
  center: Point;        // slot footprint centre in model coords
  rotationDeg: number;  // road tangent bearing + jitter, degrees
  width: number;        // along-road footprint extent
  depth: number;        // perpendicular extent
}
export function slotsAlongPolyline(
  vertices: ReadonlyArray<Point>,   // open polyline (a Street's vertices)
  side: 1 | -1,                     // which frontage
  roadHalfWidth: number,            // MAIN_STREET/2 or REGULAR_STREET/2
  house: { width: number; depth: number },
  rng: SeededRandom,                // gap/setback/rotation jitter draws
  rowOffset?: number,               // extra perpendicular depth (back rows); default 0
  phase?: number,                   // arclength start offset (stagger); default 0
): FrontageSlot[];
```

Behaviour: walk arclength from `phase`; each slot consumes `house.width + gap` where `gap = 0.8 + rng.float() * 0.4`; slot centre sits at the walk midpoint offset perpendicular (left/right by `side`) by `roadHalfWidth + house.depth / 2 + rowOffset + (rng.float() - 0.5) * 0.6` (setback jitter ±0.3); `rotationDeg = atan2(tangent) * 180/π + (rng.float() - 0.5) * 8` (±4°). Segment-spanning slots interpolate the tangent of the segment containing the walk midpoint. Draw ORDER per slot is fixed: gap, setback, rotation — three draws per slot, unconditional.

- [ ] **Step 1: Write the failing test**

```ts
// tests/village-rows.test.ts
import { describe, it, expect } from 'vitest';
import { Point } from '../src/types/point.js';
import { SeededRandom } from '../src/utils/random.js';
import { slotsAlongPolyline } from '../src/generator/village-rows.js';

const HOUSE = { width: 6, depth: 6 };
const straight = [new Point(0, 0), new Point(100, 0)];

describe('slotsAlongPolyline', () => {
  it('spaces slots at width+gap with gap in [0.8, 1.2]', () => {
    const slots = slotsAlongPolyline(straight, 1, 1.0, HOUSE, new SeededRandom(1));
    expect(slots.length).toBeGreaterThan(10);
    for (let i = 1; i < slots.length; i++) {
      const d = slots[i].center.x - slots[i - 1].center.x;
      expect(d).toBeGreaterThanOrEqual(HOUSE.width + 0.8 - 1e-9);
      expect(d).toBeLessThanOrEqual(HOUSE.width + 1.2 + 1e-9);
    }
  });

  it('offsets perpendicular by roadHalfWidth + depth/2 ± 0.3, per side', () => {
    for (const side of [1, -1] as const) {
      const slots = slotsAlongPolyline(straight, side, 1.0, HOUSE, new SeededRandom(2));
      for (const s of slots) {
        const off = s.center.y * side;
        expect(off).toBeGreaterThanOrEqual(1.0 + 3 - 0.3 - 1e-9);
        expect(off).toBeLessThanOrEqual(1.0 + 3 + 0.3 + 1e-9);
      }
    }
  });

  it('rotation tracks the tangent within ±4°', () => {
    const bent = [new Point(0, 0), new Point(50, 0), new Point(50, 50)];
    const slots = slotsAlongPolyline(bent, 1, 1.0, HOUSE, new SeededRandom(3));
    for (const s of slots) {
      const t = s.center.x < 50 - HOUSE.width ? 0 : 90; // tangent of containing segment
      const diff = Math.abs(((s.rotationDeg - t + 180) % 360) - 180);
      if (s.center.x < 44 || s.center.y > 6) expect(diff).toBeLessThanOrEqual(4 + 1e-9);
    }
  });

  it('rowOffset pushes the whole row deeper; phase shifts starts', () => {
    const front = slotsAlongPolyline(straight, 1, 1.0, HOUSE, new SeededRandom(4));
    const back = slotsAlongPolyline(straight, 1, 1.0, HOUSE, new SeededRandom(4), HOUSE.depth, HOUSE.width / 2);
    expect(back[0].center.y).toBeGreaterThan(front[0].center.y + HOUSE.depth - 0.7);
    expect(back[0].center.x).toBeGreaterThan(front[0].center.x + 1);
  });

  it('deterministic per seed', () => {
    const a = slotsAlongPolyline(straight, 1, 1.0, HOUSE, new SeededRandom(9));
    const b = slotsAlongPolyline(straight, 1, 1.0, HOUSE, new SeededRandom(9));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `nix develop --command bash -c "npx vitest run tests/village-rows.test.ts 2>&1 | tail -6"`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/generator/village-rows.ts
/**
 * Village rows: dwelling glyphs stamped along road frontages for the
 * !rowHousing regime. Pure helpers here; stampVillageRows orchestrates.
 * Spec: docs/superpowers/specs/2026-08-14-village-rows-design.md
 */
import { Point } from '../types/point.js';
import type { SeededRandom } from '../utils/random.js';

export interface FrontageSlot {
  center: Point;
  rotationDeg: number;
  width: number;
  depth: number;
}

export function slotsAlongPolyline(
  vertices: ReadonlyArray<Point>,
  side: 1 | -1,
  roadHalfWidth: number,
  house: { width: number; depth: number },
  rng: SeededRandom,
  rowOffset = 0,
  phase = 0,
): FrontageSlot[] {
  const slots: FrontageSlot[] = [];
  if (vertices.length < 2) return slots;

  // Cumulative arclength table.
  const cum: number[] = [0];
  for (let i = 1; i < vertices.length; i++) {
    cum.push(cum[i - 1] + Point.distance(vertices[i - 1], vertices[i]));
  }
  const total = cum[cum.length - 1];

  // Point + unit tangent at arclength s.
  const at = (s: number): { p: Point; tx: number; ty: number } => {
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    const segLen = cum[i] - cum[i - 1] || 1;
    const t = (s - cum[i - 1]) / segLen;
    const a = vertices[i - 1], b = vertices[i];
    const tx = (b.x - a.x) / segLen, ty = (b.y - a.y) / segLen;
    return { p: new Point(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t), tx, ty };
  };

  let s = phase;
  while (s + house.width <= total) {
    // Fixed draw order per slot: gap, setback, rotation.
    const gap = 0.8 + rng.float() * 0.4;
    const setback = (rng.float() - 0.5) * 0.6;
    const rotJitter = (rng.float() - 0.5) * 8;

    const mid = at(s + house.width / 2);
    const off = roadHalfWidth + house.depth / 2 + rowOffset + setback;
    // Perpendicular: rotate tangent 90° toward `side`.
    const px = -mid.ty * side, py = mid.tx * side;
    slots.push({
      center: new Point(mid.p.x + px * off, mid.p.y + py * off),
      rotationDeg: Math.atan2(mid.ty, mid.tx) * 180 / Math.PI + rotJitter,
      width: house.width,
      depth: house.depth,
    });
    s += house.width + gap;
  }
  return slots;
}
```

- [ ] **Step 4: Run tests** — same command, expect PASS; then `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add src/generator/village-rows.ts tests/village-rows.test.ts
git commit -m "Village rows: frontage slot generation along road polylines"
```

---

### Task 2: Slot acceptance + footprint rect construction

**Files:**
- Modify: `src/generator/village-rows.ts`
- Test: `tests/village-rows.test.ts` (extend)

**Interfaces:**
- Consumes: `FrontageSlot` (Task 1); `intersectsSite` from `src/generator/symbols.js`; `pointInPolygon` from `src/geom/point-in-polygon.js`; `Model` fields `patches`, `waterbody`, `isWaterAt(p)`, `claimedSites`; `Farm` (`subPlots`), `WardType`.
- Produces:

```ts
/** Oriented footprint rectangle for a slot (4 CCW corners). */
export function slotRect(slot: FrontageSlot): Polygon;
/** Ward types whose patches accept dwelling rows. */
export const ROW_WARDS: ReadonlySet<WardType>; // Craftsmen, Merchant, Patriciate, Slum, GateWard, Farm
/**
 * True when the slot's rect lies fully on ROW_WARDS patches, off water,
 * off farm subplots and park groves, clear of claimedSites, and clear of
 * every already-accepted rect (claims registered by the caller).
 * Returns the containing patch of the rect CENTRE (for ward attribution),
 * or null when rejected.
 */
export function acceptSlot(model: Model, slot: FrontageSlot): Patch | null;
```

- [ ] **Step 1: Write the failing test** (append)

```ts
import { Model, mapToGenerationParams, type AzgaarBurgInput } from '../src/index.js';
import { slotRect, acceptSlot, ROW_WARDS } from '../src/generator/village-rows.js';
import { WardType } from '../src/types/interfaces.js';
import { pointInPolygon } from '../src/geom/point-in-polygon.js';

function mk(population: number, seed: number, overrides: Partial<AzgaarBurgInput> = {}): Model {
  return new Model(mapToGenerationParams({
    name: 'Test', population, port: false, citadel: false, walls: false,
    plaza: false, temple: false, shanty: false, capital: false, ...overrides,
  }, seed)).generate();
}

describe('slot acceptance', () => {
  it('slotRect builds an oriented rect matching width/depth and rotation', () => {
    const rect = slotRect({ center: new Point(10, 5), rotationDeg: 90, width: 6, depth: 4 });
    expect(rect.vertices).toHaveLength(4);
    // 90°: width runs along +y, depth along -x.
    const xs = rect.vertices.map(v => v.x), ys = rect.vertices.map(v => v.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(6, 5);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(4, 5);
  });

  it('rejects slots over water and over claimed sites; accepts on residential patches', () => {
    const m = mk(300, 3);
    // Find any built residential patch centroid → a slot there must be accepted.
    const patch = m.patches.find(p => p.ward && ROW_WARDS.has(p.ward.type) && !m.waterbody.includes(p))!;
    const c = patch.shape.centroid;
    const slot = { center: c, rotationDeg: 0, width: 4.5, depth: 4.5 };
    expect(acceptSlot(m, slot)).not.toBeNull();
    // Claim the site → same slot now rejected.
    m.claimedSites.push({ at: c, radius: 6 });
    expect(acceptSlot(m, slot)).toBeNull();
  });

  it('rejects slots on farm subplots (fields stay clear)', () => {
    const m = mk(300, 3);
    const farm = m.patches.find(p => p.ward?.type === WardType.Farm && (p.ward as Farm).subPlots.length > 0);
    if (!farm) return; // seed produced no farms; other seeds cover this in Task 4's integration tests
    const plot = (farm.ward as Farm).subPlots[0];
    const cx = plot.reduce((s, p) => s + p.x, 0) / plot.length;
    const cy = plot.reduce((s, p) => s + p.y, 0) / plot.length;
    expect(acceptSlot(m, { center: new Point(cx, cy), rotationDeg: 0, width: 4.5, depth: 4.5 })).toBeNull();
  });
});
```

(Also add `import { Farm } from '../src/wards/farm.js';` at the top.)

- [ ] **Step 2: Run to verify failure** — `acceptSlot` not exported.

- [ ] **Step 3: Implement** (append to village-rows.ts)

```ts
import { Polygon } from '../geom/polygon.js';
import { pointInPolygon } from '../geom/point-in-polygon.js';
import { intersectsSite } from './symbols.js';
import { WardType } from '../types/interfaces.js';
import { Farm } from '../wards/farm.js';
import type { Model } from './model.js';
import type { Patch } from './patch.js';

export const ROW_WARDS: ReadonlySet<WardType> = new Set([
  WardType.Craftsmen, WardType.Merchant, WardType.Patriciate,
  WardType.Slum, WardType.GateWard, WardType.Farm,
]);

export function slotRect(slot: FrontageSlot): Polygon {
  const a = slot.rotationDeg * Math.PI / 180;
  const ux = Math.cos(a), uy = Math.sin(a);      // along-road unit
  const vx = -uy, vy = ux;                        // perpendicular unit
  const hw = slot.width / 2, hd = slot.depth / 2;
  const c = slot.center;
  return new Polygon([
    new Point(c.x - ux * hw - vx * hd, c.y - uy * hw - vy * hd),
    new Point(c.x + ux * hw - vx * hd, c.y + uy * hw - vy * hd),
    new Point(c.x + ux * hw + vx * hd, c.y + uy * hw + vy * hd),
    new Point(c.x - ux * hw + vx * hd, c.y - uy * hw + vy * hd),
  ]);
}

export function acceptSlot(model: Model, slot: FrontageSlot): Patch | null {
  const rect = slotRect(slot);
  const probes = [...rect.vertices, slot.center];

  let centerPatch: Patch | null = null;
  for (const probe of probes) {
    if (model.isWaterAt(probe)) return null;
    const patch = model.patches.find(p =>
      p.ward !== null && !model.waterbody.includes(p) && pointInPolygon(probe, p.shape.vertices));
    if (!patch || !ROW_WARDS.has(patch.ward!.type)) return null;
    if (probe === slot.center) centerPatch = patch;
    // Fields and groves stay clear.
    if (patch.ward instanceof Farm) {
      for (const plot of patch.ward.subPlots) {
        if (pointInPolygon(probe, plot)) return null;
      }
    }
    if (patch.ward!.type === WardType.Park) return null;
  }
  if (intersectsSite(rect, model.claimedSites)) return null;
  return centerPatch;
}
```

- [ ] **Step 4: Run tests** — PASS + tsc clean. Full suite: everything green (nothing is wired yet; canaries untouched).

- [ ] **Step 5: Commit**

```bash
git add src/generator/village-rows.ts tests/village-rows.test.ts
git commit -m "Village rows: slot acceptance against wards, water, fields, and claims"
```

---

### Task 3: Variety picker with per-settlement roof bias

**Files:**
- Modify: `src/generator/village-rows.ts`
- Test: `tests/village-rows.test.ts` (extend)

**Interfaces:**
- Consumes: `SYMBOL_MANIFEST` (footprints).
- Produces:

```ts
export type RoofBias = 'thatch' | 'tile';
/** One draw; call once per settlement before stamping. */
export function drawRoofBias(rng: SeededRandom): RoofBias;
/**
 * Glyph id for a slot. Draw count: exactly one rng.float() per call.
 * wardType: the accepted patch's ward type. isRowEnd: outermost slot of a row.
 */
export function pickHouseGlyph(
  wardType: WardType, bias: RoofBias, isRowEnd: boolean, rng: SeededRandom,
): string;
/** Footprint {width, depth} for a residential glyph id, from SYMBOL_MANIFEST. */
export function houseFootprint(id: string): { width: number; depth: number };
```

Selection rules (weights within each ward type, using the single draw `r = rng.float()`):
- Slum, or `isRowEnd` on any ward: huts — r<0.34 `sm-hut-mud`, r<0.67 `sm-hut-round`, else `sm-hut-straw`.
- Farm: r<0.15 `sm-longhouse`, else huts by the same thirds over the remaining range.
- Merchant/Patriciate: r<0.35 `sm-house-large-tiled`, else bias house: thatch→`sm-house`, tile→`sm-house-tiled`.
- Craftsmen/GateWard (default): bias-skewed mix — thatch: r<0.75 `sm-house` else `sm-house-tiled`; tile: r<0.25 `sm-house` else `sm-house-tiled`.

- [ ] **Step 1: Write the failing test** (append)

```ts
import { drawRoofBias, pickHouseGlyph, houseFootprint } from '../src/generator/village-rows.js';

describe('variety picker', () => {
  it('roof bias skews the house/house-tiled mix', () => {
    const count = (bias: 'thatch' | 'tile') => {
      const rng = new SeededRandom(7);
      let tiled = 0;
      for (let i = 0; i < 200; i++) {
        if (pickHouseGlyph(WardType.Craftsmen, bias, false, rng) === 'sm-house-tiled') tiled++;
      }
      return tiled;
    };
    expect(count('tile')).toBeGreaterThan(count('thatch') + 40);
  });

  it('slums and row-ends get huts; farms get vernacular; merchants get large houses sometimes', () => {
    const rng = new SeededRandom(11);
    for (let i = 0; i < 50; i++) {
      expect(pickHouseGlyph(WardType.Slum, 'tile', false, rng)).toMatch(/^sm-hut-/);
      expect(pickHouseGlyph(WardType.Craftsmen, 'tile', true, rng)).toMatch(/^sm-hut-/);
      expect(pickHouseGlyph(WardType.Farm, 'thatch', false, rng)).toMatch(/^sm-(hut-|longhouse)/);
    }
    const picks = new Set<string>();
    for (let i = 0; i < 100; i++) picks.add(pickHouseGlyph(WardType.Merchant, 'tile', false, rng));
    expect(picks.has('sm-house-large-tiled')).toBe(true);
  });

  it('houseFootprint reads the manifest (longhouse is 10×5)', () => {
    expect(houseFootprint('sm-longhouse')).toEqual({ width: 10, depth: 5 });
    expect(houseFootprint('sm-house')).toEqual({ width: 6, depth: 6 });
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement** (append; import `SYMBOL_MANIFEST` from `../assets/symbol-manifest.js`)

```ts
export type RoofBias = 'thatch' | 'tile';

export function drawRoofBias(rng: SeededRandom): RoofBias {
  return rng.bool(0.5) ? 'thatch' : 'tile';
}

const HUTS = ['sm-hut-mud', 'sm-hut-round', 'sm-hut-straw'] as const;

export function pickHouseGlyph(
  wardType: WardType, bias: RoofBias, isRowEnd: boolean, rng: SeededRandom,
): string {
  const r = rng.float(); // exactly one draw per call
  if (wardType === WardType.Slum || isRowEnd) return HUTS[Math.min(2, Math.floor(r * 3))];
  if (wardType === WardType.Farm) {
    if (r < 0.15) return 'sm-longhouse';
    return HUTS[Math.min(2, Math.floor(((r - 0.15) / 0.85) * 3))];
  }
  if (wardType === WardType.Merchant || wardType === WardType.Patriciate) {
    if (r < 0.35) return 'sm-house-large-tiled';
    const r2 = (r - 0.35) / 0.65;
    return bias === 'thatch' ? (r2 < 0.75 ? 'sm-house' : 'sm-house-tiled')
                             : (r2 < 0.25 ? 'sm-house' : 'sm-house-tiled');
  }
  return bias === 'thatch' ? (r < 0.75 ? 'sm-house' : 'sm-house-tiled')
                           : (r < 0.25 ? 'sm-house' : 'sm-house-tiled');
}

export function houseFootprint(id: string): { width: number; depth: number } {
  const fp = SYMBOL_MANIFEST[id].footprint ?? [4.5, 4.5];
  return { width: fp[0], depth: fp[1] };
}
```

- [ ] **Step 4: Run tests** — PASS + tsc clean + full suite green.

- [ ] **Step 5: Commit**

```bash
git add src/generator/village-rows.ts tests/village-rows.test.ts
git commit -m "Village rows: seeded variety picker with per-settlement roof bias"
```

---

### Task 4: stampVillageRows + the atomic regime flip

**Files:**
- Modify: `src/generator/village-rows.ts` (orchestrator)
- Modify: `src/generator/model.ts` (buildGeometry tail at :1482-1495; refineDensity guard; `glyphBackedBuildings` field + reset)
- Modify: `src/wards/common-ward.ts` (village dwelling skip)
- Test: `tests/village-rows.test.ts` (extend)

**Interfaces:**
- Consumes: everything from Tasks 1-3; `buildingBudget` from `../generator/generation-params.js` (signature `buildingBudget(population, urbanDensity)` — verify the exact import/args at the refineDensity call site, model.ts ~1522); `MAIN_STREET`, `REGULAR_STREET` from `../wards/ward.js`; `rowHousing`.
- Produces:

```ts
/** Stamp dwelling rows for a !rowHousing settlement. No-op otherwise. */
export function stampVillageRows(model: Model): void;
// Model gains:
//   glyphBackedBuildings: Set<Polygon>   (rect identity → glyph-rendered)
```

Orchestration (exact order):
1. `if (rowHousing(model.params.population)) return;`
2. `let allowance = buildingBudget(model.params.population, model.params.urbanDensity) - model.countOrdinaryBuildingsPublic();` — expose the existing private counter via a thin public wrapper (`countOrdinaryBuildingsPublic()` delegating to the private method) rather than duplicating it. If allowance ≤ 0, still reserve the well (step 4) and return.
3. `const bias = drawRoofBias(model.rng);`
4. **Well reservation:** if `model.wellBudget > 0`, take the road point nearest `model.center` (scan all artery/street vertices), claim `{at, radius: 3.2}` on `model.claimedSites`, push `{id:'sm-well', at, scale:3.2, rotationDeg:Math.round(model.rng.float()*360), zBand:'structure', wardType:undefined}` onto `model.symbols`, `model.wellBudget--`. (Draws happen unconditionally in this order when wellBudget>0.)
5. Road list in priority order: `[...model.arteries.map(a => ({v: a.vertices, hw: MAIN_STREET/2})), ...model.streets.map(s => ({v: s.vertices, hw: REGULAR_STREET/2})), ...model.roads.map(r => ({v: r.vertices, hw: MAIN_STREET/2}))]`.
6. For `row = 0, 1, 2` (front, back, third) while allowance > 0: for each road, for each side (1 then -1): pick the ward-type-independent BASE house size `{width: 6, depth: 6}` for slot walking; generate `slotsAlongPolyline(v, side, hw, BASE, model.rng, row * 6.5, row * 3)` (back rows one depth deeper, staggered half a pitch); for each slot while allowance > 0: `const patch = acceptSlot(model, slot); if (!patch) continue;` — pick the glyph via `pickHouseGlyph(patch.ward!.type, bias, isRowEnd, model.rng)` where `isRowEnd` is true for the first and last ACCEPTED slot index of this road+side+row (track and mark after the loop — simplest: mark first accepted immediately; convert the last accepted to a hut only in bookkeeping BEFORE materialising, i.e. buffer accepted slots per road-side-row, then materialise the buffer marking its ends). Materialising a slot: `const fp = houseFootprint(id)`, rebuild the rect at the slot's centre/rotation with fp dimensions (`slotRect({...slot, width: fp.width, depth: fp.depth})`), re-check `acceptSlot` for the resized rect (longhouse is wider than BASE) and drop on failure; else push rect into `patch.ward.geometry`, add to `model.glyphBackedBuildings`, push PlacedSymbol `{id, at: rect-centre point, scale: Math.max(fp.width, fp.depth), rotationDeg: slot.rotationDeg, zBand: 'structure', wardType: patch.ward.type}`, claim `{at: centre, radius: Math.max(fp.width, fp.depth) * 0.55}`, `allowance--`.
7. Note: glyph `scale` is `max(width, depth)`; the longhouse's 10×5 footprint renders through the glyph's own art aspect inside its square box — same convention as every 1.1.0 fixed glyph.

Model changes:
- Field `glyphBackedBuildings: Set<Polygon> = new Set();` next to `symbols` (~:135); reset in `reset()` alongside the other symbol state (~:339).
- `refineDensity()` gains as FIRST line: `if (!rowHousing(this.params.population)) return; // village dwellings are stamped, not subdivided — see village-rows.ts` (import exists already in model.ts? verify; add if missing).
- `buildGeometry()` tail becomes `... this.applyBuildingBudget(); stampVillageRows(this);`
- Public wrapper: `countOrdinaryBuildingsPublic(): number { return this.countOrdinaryBuildings(); }`

CommonWard change — top of `createGeometry()`:

```ts
    // Village regime: dwellings are stamped along road frontages by
    // stampVillageRows (see village-rows.ts) — this ward contributes no
    // subdivided lots, draws nothing from the stream, and places no well
    // (the stamper reserves the village well site).
    if (!rowHousing(this.model.params.population)) {
      this.geometry = [];
      return;
    }
```

- [ ] **Step 1: Write the failing tests** (append)

```ts
import { rowHousing, buildingBudget } from '../src/generator/generation-params.js';

const RESIDENTIAL = ['sm-house', 'sm-house-tiled', 'sm-house-large-tiled', 'sm-hut-mud', 'sm-hut-round', 'sm-hut-straw', 'sm-longhouse'];

describe('stampVillageRows integration', () => {
  it('census exactness: stamped + generated survivors equals the budget (or frontage-capped below)', () => {
    for (const seed of [3, 7, 11]) {
      const m = mk(300, seed);
      const houses = m.symbols.filter(s => RESIDENTIAL.includes(s.id));
      expect(houses.length).toBeGreaterThan(0);
      const target = buildingBudget(m.params.population, m.params.urbanDensity);
      expect(houses.length).toBeLessThanOrEqual(target);
    }
  });

  it('every stamped house rect is in a ward geometry and marked glyph-backed', () => {
    const m = mk(300, 3);
    const houses = m.symbols.filter(s => RESIDENTIAL.includes(s.id));
    expect(m.glyphBackedBuildings.size).toBe(houses.length);
    for (const rect of m.glyphBackedBuildings) {
      const owned = m.patches.some(p => p.ward?.geometry.includes(rect));
      expect(owned).toBe(true);
    }
  });

  it('no stamped rect intersects water, another claim, or a farm subplot', () => {
    const m = mk(300, 3);
    for (const rect of m.glyphBackedBuildings) {
      for (const v of rect.vertices) expect(m.isWaterAt(v)).toBe(false);
      for (const p of m.patches) {
        if (p.ward instanceof Farm) {
          for (const plot of p.ward.subPlots) {
            expect(pointInPolygon(rect.centroid, plot)).toBe(false);
          }
        }
      }
    }
  });

  it('village well exists on a road-adjacent reserved site', () => {
    let found = 0;
    for (const seed of [3, 7, 11]) {
      if (mk(300, seed).symbols.some(s => s.id === 'sm-well')) found++;
    }
    expect(found).toBeGreaterThan(0);
  });

  it('towns are untouched: rowHousing model has zero glyph-backed buildings', () => {
    const m = mk(1200, 3);
    expect(m.glyphBackedBuildings.size).toBe(0);
    expect(m.symbols.filter(s => RESIDENTIAL.includes(s.id))).toHaveLength(0);
  });

  it('deterministic', () => {
    const a = mk(300, 5), b = mk(300, 5);
    expect(JSON.stringify(a.symbols)).toBe(JSON.stringify(b.symbols));
    expect(a.glyphBackedBuildings.size).toBe(b.glyphBackedBuildings.size);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `stampVillageRows` absent / zero houses.

- [ ] **Step 3: Implement** per the orchestration above (code lives in village-rows.ts; model/common-ward edits as specified).

- [ ] **Step 4: Run tests, then the FULL suite + tsc.** Expected collateral, to be verified one by one: BOTH canaries GREEN (pop 800/1400 are towns — any canary movement is a defect); village-regime tests that observed old scattered dwellings may legitimately shift (hamlet POI adoption now adopts stamped rects — poi-hamlet should still pass; the symbol-placement hamlet-wells test asserts ≤1 wells — still true). Any updated test needs a justification comment; any unexplained failure is a defect.

- [ ] **Step 5: Commit**

```bash
git add src/generator/village-rows.ts src/generator/model.ts src/wards/common-ward.ts tests/village-rows.test.ts
git commit -m "Village rows: stamp dwelling glyphs along frontages, atomic regime flip for villages"
```

---

### Task 5: glyphBacked rendering — no double paint, symbols-off fallback

**Files:**
- Modify: `src/scene/scene.ts` (`BuildingFeature.glyphBacked?: true` — additive, Scene stays v2)
- Modify: `src/scene/build-scene.ts` (set the flag from `model.glyphBackedBuildings`)
- Modify: `src/output/assemble-svg.ts` (skip path + rect shadow when glyphBacked AND symbols enabled)
- Test: `tests/assemble-symbols.test.ts` (extend)

**Interfaces:**
- Consumes: `model.glyphBackedBuildings` (Task 4), existing `showSymbols` flag in assembleSvg (Task 5 of the 1.1.0 plan).
- Produces: `BuildingFeature.glyphBacked?: true`; assembler behaviour: `glyphBacked && showSymbols` → no `#buildings` path, no `#shadows` rect; `symbols:false` → rects paint normally.

- [ ] **Step 1: Write the failing tests** (append to tests/assemble-symbols.test.ts — the file already has `sceneWith()` fixtures and the mk-less style; add a scene-level fixture)

```ts
describe('glyph-backed buildings', () => {
  const HOUSE_RECT = { ring: [{x:0,y:0},{x:6,y:0},{x:6,y:6},{x:0,y:6}], kind: 'craftsmen', landmark: false, glyphBacked: true as const };
  const HOUSE_SYM = { id: 'sm-house', at: { x: 3, y: 3 }, scale: 6, rotationDeg: 0, zBand: 'structure' as const };

  it('suppresses path and rect shadow when symbols render', () => {
    const scene = sceneWith([HOUSE_SYM]);
    scene.layers.buildings.push(HOUSE_RECT);
    const svg = assembleSvg(scene);
    expect(svg).toContain('href="#glyph-sm-house"');
    expect(svg).not.toMatch(/<g id="buildings">[\s\S]*M0\.00,0\.00/);
    expect(svg).not.toMatch(/<g id="shadows"[^>]*>[\s\S]*M0\.00,0\.00/);
  });

  it('symbols:false restores the footprint painting', () => {
    const scene = sceneWith([HOUSE_SYM]);
    scene.layers.buildings.push(HOUSE_RECT);
    const svg = assembleSvg(scene, { symbols: false });
    expect(svg).not.toContain('glyph-sm-house');
    expect(svg).toMatch(/<g id="buildings">[\s\S]*M0\.00,0\.00/);
  });

  it('non-glyphBacked buildings are unaffected either way', () => {
    const scene = sceneWith([]);
    scene.layers.buildings.push({ ...HOUSE_RECT, glyphBacked: undefined });
    const svg = assembleSvg(scene);
    expect(svg).toMatch(/<g id="buildings">[\s\S]*M0\.00,0\.00/);
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement.** scene.ts: add `glyphBacked?: true;` to `BuildingFeature`. build-scene.ts building push gains `...(model.glyphBackedBuildings.has(poly) ? { glyphBacked: true as const } : {})`. assemble-svg.ts: compute `const hideBacked = (b: BuildingFeature) => b.glyphBacked === true && showSymbols;` then filter `shadowable`, `ordinary`, and `landmarks` through `!hideBacked(b)` (landmarks can't be glyph-backed today, but the uniform filter is cheaper than the argument).

- [ ] **Step 4: Run tests + full suite + tsc.** Canaries green (towns have no glyphBacked features; village scenes changed already in Task 4 — no pinned test renders a ≤600 village to bytes; verify and treat any such failure as a defect to examine).

- [ ] **Step 5: Commit**

```bash
git add src/scene/scene.ts src/scene/build-scene.ts src/output/assemble-svg.ts tests/assemble-symbols.test.ts
git commit -m "Scene: glyph-backed buildings render as their glyphs, footprints return when symbols are off"
```

---

### Task 6: Version 1.2.0 + docs

**Files:**
- Modify: `package.json`, `SETTLEMAKER_VERSION` (src/output/geojson-builder.ts:~420)
- Modify: `tests/degraded-generation.test.ts`, `tests/geojson-schema-v4.test.ts`, `tests/origin-shift.test.ts` (1.1.0 → 1.2.0 string pins, mechanical)
- Modify: `docs/scene-schema.md` (BuildingFeature.glyphBacked, village-rows behaviour note), `docs/url-api.md` (symbols-off now also restores village footprints)

- [ ] **Step 1:** Bump both version sites to `1.2.0`; update the three version-string tests (values and any title strings, mechanical only).
- [ ] **Step 2:** Docs: scene-schema.md documents `glyphBacked` (additive, v2) and that village dwellings arrive as `symbols` + backed building rects; url-api.md updates the off-switch paragraph.
- [ ] **Step 3:** Full suite green (all of it — no expected failures anywhere), tsc clean, `npx tsx smoke-test.ts` OK.
- [ ] **Step 4: Commit**

```bash
git add package.json src/output/geojson-builder.ts tests docs/scene-schema.md docs/url-api.md
git commit -m "Release prep 1.2.0: village rows documented; version pins updated"
```

(Commit body: note questables' cache key rolls via SETTLEMAKER_VERSION; the rucio tile disk cache manual wipe applies — and the 1.1.0 wipe may still be outstanding.)

---

### Task 7: Render gate — village contact sheet + preview (STOPS for owner)

- [ ] **Step 1:** Contact sheet across the village spectrum — pop 60, 150, 300, 600, a farm-heavy seed, a coastal village — parchment/blueprint/night × symbols on/off. Every cell an isolated data-URI `<img>`; the controller headless-chromium screenshots the sheet and inspects it BEFORE the owner sees it (standing practice).
- [ ] **Step 2:** Push `village-rows`; in `/home/barrulus/dev/settlemaker-web` create `preview/village-rows` bumping the submodule; open a draft PR (no tool attribution anywhere).
- [ ] **Step 3:** STOP. Owner judges: house chunkiness (single scale factor is the fallback), spacing/jitter feel, roof-bias coherence, hut/house mix, back-row legibility. Do not merge either repo.

---

## Self-Review Notes (applied)

- Spec coverage: regime flip (T4), stamping+farm preservation (T2/T4), variety+roof bias (T3), wells relocation (T4 step 4), glyphBacked+off-switch (T5), contracts/version/docs (T6), gate (T7). Canary-stability correction from the spec amendment is a Global Constraint.
- Draw-count discipline: three draws per slot (T1), one per glyph pick (T3), fixed well-reservation order (T4) — all stated where implemented.
- Type consistency: `FrontageSlot`/`slotRect`/`acceptSlot`/`pickHouseGlyph`/`houseFootprint`/`stampVillageRows` names match across tasks; `glyphBackedBuildings: Set<Polygon>` consistent in T4/T5.
