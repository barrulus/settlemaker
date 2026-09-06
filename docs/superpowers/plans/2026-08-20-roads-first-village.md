# Roads-First Village Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the roads-first village engine — skeleton solved by rule, dressed with parcels until the census is housed — for populations below ~1000, up to a first render gate.

**Architecture:** Five pure passes (Site → Skeleton → Parcels → Dwellings → Dressing), each a function of its input plus a seeded RNG, living in a new `src/village/` tree that shares nothing with `src/generator/model.ts`. This plan covers passes 1–4 plus a minimal renderer, which is what a render gate needs to judge. Pass 5 (crofts, fields, vegetation, POIs) is a **second plan**, written after the first gate — its assets are still being drawn, and gate verdicts on the skeleton will change it.

**Tech Stack:** TypeScript, zero runtime dependencies, vitest, nix develop. All geometry in **metres**, burg-local coordinates.

**Spec:** `docs/superpowers/specs/2026-08-20-roads-first-village-design.md`

## Global Constraints

- **Metres everywhere.** All geometry is metres in burg-local coordinates (origin = burg centre). No world-scale transform until render.
- **Seeded determinism.** Every function that needs randomness takes `rng: SeededRandom` as a parameter. Never construct one inside a pass; never use `Math.random()`.
- **Stable ids.** Object ids derive from structural position, never array index: lane = origin + branch path; lot = `laneId` + side + ordinal from the green end; building = its `lotId`.
- **Zero runtime dependencies.** No new packages, for any reason.
- **Existing engine untouched.** Nothing in `src/generator/model.ts` or `src/wards/` changes behaviour. New code lives in `src/village/`.
- **Run commands through nix:** `nix develop --command bash -c "npx vitest run <path>"`.
- **Reuse, don't re-implement:** `Point` (`src/types/point.js`), `SeededRandom` (`src/utils/random.js`), `pointInPolygon` (`src/geom/point-in-polygon.js`).
- **Call the shared modules. Do not re-implement them.** Task 1 builds `src/village/geometry.ts`, `src/village/glyphs.ts` and `src/village/constants.ts`. Every task after it **imports** from them. Specifically:
  - Need an angle, a bearing, an arc-length, a point along a polyline, a distance, or "is this in water"? → `geometry.ts`. Never write a local `bearingVector`, `polylineLength`, `unit` or `atan2` conversion inside a pass.
  - Need a glyph's footprint, ink extent, rotation class or `minScale`? → `glyphs.ts`. It is the **only** module permitted to import `SYMBOL_MANIFEST`.
  - Need a number that a render gate might change? → `constants.ts`. No tunable literal is inlined in a pass; the design's §11 promises that a gate verdict maps to one edit, and that is only true if the constants live in one file.
  - If you find yourself about to write a helper that a neighbouring task also needs, stop and add it to `geometry.ts` with its own test, rather than writing it twice with two sign conventions. Two copies of an angle helper that disagree at one bearing is exactly the bug this rule exists to prevent.
  - **Tests are the exception, deliberately.** A test may compute its expectation the long way — raw `Math.atan2`, a direct `pointInPolygon` call — precisely so it does not agree with the implementation by construction. A test that checks `bearingOf` by calling `bearingOf` proves nothing. Two tasks below do this on purpose; leave them alone.
- **Imports use `.js` extensions** on relative paths, matching the existing codebase (NodeNext resolution).
- **Commit after every task.** No Co-Authored-By lines.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/village/geometry.ts` | Bearings, angles, arc-length, sampling, water membership — used by every pass |
| `src/village/glyphs.ts` | The only reader of `SYMBOL_MANIFEST`: footprints, ink extents, rotation |
| `src/village/constants.ts` | Every tunable from the design's §11, in one place |
| `src/village/types.ts` | Every village-domain type and the id helpers |
| `src/village/route-class.ts` | The seven-type vocabulary: order, groups, widths, back-compat mapping |
| `src/village/site.ts` | Pass 1 — `AzgaarBurgInput` → `Site` |
| `src/village/skeleton/green-siting.ts` | Green shape, size, position |
| `src/village/skeleton/lanes.ts` | Arms, frontage budget, invented lanes |
| `src/village/skeleton/relax.ts` | Lane relaxation and tail trimming (runs after pass 4) |
| `src/village/parcels/strip.ts` | Polyline offset and strip clipping |
| `src/village/parcels/lots.ts` | Frontage gradient, subdivision, scoring |
| `src/village/deck.ts` | Dwelling decks and weighted draw |
| `src/village/dwellings.ts` | Pass 4 — spend the census, seat and size buildings |
| `src/village/village-model.ts` | Orchestrates passes 1–4 |
| `src/village/render.ts` | Minimal SVG for the render gate |
| `tests/village/*.test.ts` | One test file per module above |

---

### Task 1: Shared foundations — geometry, glyphs, constants

Every later task depends on this one. Build it first, and when a later task needs a helper
or a number, import it from here rather than writing a local copy.

**Files:**
- Create: `src/village/geometry.ts`
- Create: `src/village/glyphs.ts`
- Create: `src/village/constants.ts`
- Modify: `src/generator/village-rows.ts` (ink ratios move out; re-export from their old home)
- Test: `tests/village/geometry.test.ts`, `tests/village/glyphs.test.ts`

**Interfaces:**
- Consumes: `Point`, `pointInPolygon`, `SYMBOL_MANIFEST`.
- Produces:
  - geometry — `bearingVector(deg): Point`, `bearingOf(from: Point, to: Point): number`, `angularGap(a, b): number`, `unit(dx, dy): Point`, `dist(a, b): number`, `polylineLength(pts): number`, `arcLengths(pts): number[]`, `sampleAt(pts, acc, s): { p: Point; dirDeg: number }`, `inAnyWater(p, water): boolean`
  - glyphs — `hasGlyph(glyph): boolean`, `nominalFootprint(glyph): [number, number]`, `inkExtent(glyph, footprint): { width: number; depth: number }`, `rotationOf(glyph): 'invariant'|'free'|'locked'|'snap-cardinal'`, `minScaleOf(glyph): number`, `HOUSE_INK_RATIO`, `HUT_INK_RATIO`
  - constants — the design's §11 table as named exports

**Conventions this module fixes once, so no pass has to decide again:**
- A **bearing** is degrees, 0 = North, clockwise, wrapped to `[0, 360)`.
- North is `-y` (SVG-native, +y down), matching the symbol contract's `upVector: [0,-1]`.
- **Arc-length** functions take a polyline and its cumulative-length array together, so a
  caller that samples repeatedly computes the walk once.

- [ ] **Step 1: Write the failing geometry test**

```ts
// tests/village/geometry.test.ts
import { describe, it, expect } from 'vitest';
import { Point } from '../../src/types/point.js';
import {
  angularGap, arcLengths, bearingOf, bearingVector, dist, inAnyWater,
  polylineLength, sampleAt, unit,
} from '../../src/village/geometry.js';

describe('bearings', () => {
  it('treats 0 as north, which is -y', () => {
    const v = bearingVector(0);
    expect(v.x).toBeCloseTo(0, 6);
    expect(v.y).toBeCloseTo(-1, 6);
  });

  it('treats 90 as east', () => {
    const v = bearingVector(90);
    expect(v.x).toBeCloseTo(1, 6);
    expect(v.y).toBeCloseTo(0, 6);
  });

  it('round-trips a bearing through a vector', () => {
    for (const deg of [0, 37, 90, 180, 271, 359]) {
      const v = bearingVector(deg);
      expect(bearingOf(new Point(0, 0), v)).toBeCloseTo(deg, 4);
    }
  });

  it('wraps out-of-range bearings', () => {
    expect(bearingOf(new Point(0, 0), bearingVector(370))).toBeCloseTo(10, 4);
  });

  it('measures the shorter way round', () => {
    expect(angularGap(10, 350)).toBeCloseTo(20, 6);
    expect(angularGap(350, 10)).toBeCloseTo(20, 6);
    expect(angularGap(0, 180)).toBeCloseTo(180, 6);
  });
});

describe('vectors', () => {
  it('normalises', () => {
    const u = unit(3, 4);
    expect(Math.hypot(u.x, u.y)).toBeCloseTo(1, 6);
  });

  it('survives a zero-length input instead of producing NaN', () => {
    const u = unit(0, 0);
    expect(Number.isNaN(u.x)).toBe(false);
    expect(Number.isNaN(u.y)).toBe(false);
  });

  it('measures distance', () => {
    expect(dist(new Point(0, 0), new Point(3, 4))).toBeCloseTo(5, 6);
  });
});

describe('polylines', () => {
  const line = [new Point(0, 0), new Point(10, 0), new Point(10, 10)];

  it('measures total length', () => {
    expect(polylineLength(line)).toBeCloseTo(20, 6);
  });

  it('is zero for a degenerate polyline', () => {
    expect(polylineLength([new Point(1, 1)])).toBe(0);
  });

  it('accumulates length per vertex', () => {
    expect(arcLengths(line)).toEqual([0, 10, 20]);
  });

  it('samples a point partway along, with its local direction', () => {
    const acc = arcLengths(line);
    const mid = sampleAt(line, acc, 5);
    expect(mid.p.x).toBeCloseTo(5, 6);
    expect(mid.p.y).toBeCloseTo(0, 6);
    expect(mid.dirDeg).toBeCloseTo(90, 4); // running east
  });

  it('clamps a sample beyond either end', () => {
    const acc = arcLengths(line);
    expect(sampleAt(line, acc, -5).p.x).toBeCloseTo(0, 6);
    expect(sampleAt(line, acc, 999).p.y).toBeCloseTo(10, 6);
  });
});

describe('inAnyWater', () => {
  const pond = [[new Point(0, 0), new Point(10, 0), new Point(10, 10), new Point(0, 10)]];

  it('is true inside a ring', () => {
    expect(inAnyWater(new Point(5, 5), pond)).toBe(true);
  });

  it('is false outside every ring', () => {
    expect(inAnyWater(new Point(50, 50), pond)).toBe(false);
  });

  it('is false when there is no water at all', () => {
    expect(inAnyWater(new Point(5, 5), [])).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `nix develop --command bash -c "npx vitest run tests/village/geometry.test.ts"`
Expected: FAIL — cannot find module `src/village/geometry.js`

- [ ] **Step 3: Write geometry.ts**

```ts
// src/village/geometry.ts
import { Point } from '../types/point.js';
import { pointInPolygon } from '../geom/point-in-polygon.js';

/**
 * Bearings are degrees, 0 = North, clockwise, wrapped to [0, 360).
 * North is -y: SVG-native, matching the symbol contract's upVector [0,-1].
 * Every pass uses these — none of them redefines them.
 */
export function wrapDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

export function bearingVector(deg: number): Point {
  const r = (deg * Math.PI) / 180;
  return new Point(Math.sin(r), -Math.cos(r));
}

export function bearingOf(from: Point, to: Point): number {
  return wrapDeg((Math.atan2(to.x - from.x, -(to.y - from.y)) * 180) / Math.PI);
}

/** The shorter way round, 0..180. */
export function angularGap(a: number, b: number): number {
  return Math.abs(((wrapDeg(a) - wrapDeg(b) + 540) % 360) - 180);
}

export function unit(dx: number, dy: number): Point {
  const len = Math.hypot(dx, dy);
  return len === 0 ? new Point(0, 0) : new Point(dx / len, dy / len);
}

export function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function polylineLength(points: Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += dist(points[i], points[i - 1]);
  return total;
}

/** Cumulative length at each vertex. Pair it with sampleAt. */
export function arcLengths(points: Point[]): number[] {
  const acc = [0];
  for (let i = 1; i < points.length; i++) acc.push(acc[i - 1] + dist(points[i], points[i - 1]));
  return acc;
}

/** The point at arc-length `s`, and the bearing the polyline runs there. */
export function sampleAt(
  points: Point[], acc: number[], s: number,
): { p: Point; dirDeg: number } {
  const total = acc[acc.length - 1];
  const clamped = Math.min(Math.max(s, 0), total);
  let i = 1;
  while (i < acc.length - 1 && acc[i] < clamped) i++;
  const seg = acc[i] - acc[i - 1] || 1;
  const t = (clamped - acc[i - 1]) / seg;
  const a = points[i - 1];
  const b = points[i];
  return {
    p: new Point(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t),
    dirDeg: bearingOf(a, b),
  };
}

export function inAnyWater(p: Point, water: Point[][]): boolean {
  return water.some((ring) => pointInPolygon(p, ring));
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `nix develop --command bash -c "npx vitest run tests/village/geometry.test.ts"`
Expected: PASS, 14 tests

- [ ] **Step 5: Write the failing glyphs test**

```ts
// tests/village/glyphs.test.ts
import { describe, it, expect } from 'vitest';
import {
  HOUSE_INK_RATIO, HUT_INK_RATIO, hasGlyph, inkExtent, minScaleOf, nominalFootprint,
  rotationOf,
} from '../../src/village/glyphs.js';

describe('glyph lookups', () => {
  it('knows which ids the manifest actually has', () => {
    expect(hasGlyph('sm-house')).toBe(true);
    expect(hasGlyph('sm-house--tundra')).toBe(true);
    // No tundra variant was drawn for the tiled house — the deck relies on
    // this being false to fall back to the temperate id.
    expect(hasGlyph('sm-house-tiled--tundra')).toBe(false);
  });

  it('reads a footprint in metres from the manifest', () => {
    expect(nominalFootprint('sm-house')).toEqual([8, 6.6]);
  });

  it('falls back to a house-sized footprint for an unknown id', () => {
    expect(nominalFootprint('sm-not-a-real-symbol')).toEqual([8, 6.6]);
  });

  it('reads the rotation contract', () => {
    expect(rotationOf('sm-house')).toBe('free');
    expect(rotationOf('sm-hut-round')).toBe('invariant');
  });

  it('reads minScale', () => {
    expect(minScaleOf('sm-house')).toBeCloseTo(0.35, 5);
  });

  it('shrinks a footprint to its ink extent, by family', () => {
    expect(inkExtent('sm-house', [8, 6.6]).width).toBeCloseTo(8 * HOUSE_INK_RATIO, 5);
    expect(inkExtent('sm-hut-straw', [6.4, 6.4]).width).toBeCloseTo(6.4 * HUT_INK_RATIO, 5);
  });

  it('uses the scaled footprint it is given, not the nominal one', () => {
    expect(inkExtent('sm-house', [12, 10]).width).toBeCloseTo(12 * HOUSE_INK_RATIO, 5);
  });
});

describe('the old engine keeps working', () => {
  it('still exports the ink ratios from village-rows for existing callers', async () => {
    const old = await import('../../src/generator/village-rows.js');
    expect(old.HOUSE_INK_RATIO).toBe(HOUSE_INK_RATIO);
    expect(old.HUT_INK_RATIO).toBe(HUT_INK_RATIO);
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `nix develop --command bash -c "npx vitest run tests/village/glyphs.test.ts"`
Expected: FAIL — cannot find module `src/village/glyphs.js`

- [ ] **Step 7: Write glyphs.ts and move the ink ratios**

```ts
// src/village/glyphs.ts
import { SYMBOL_MANIFEST } from '../assets/symbol-manifest.js';

/**
 * The ONLY module that reads SYMBOL_MANIFEST. Everything that needs a
 * glyph dimension asks here, so there is one lookup and one fallback.
 */

/** Used when a glyph is missing from the manifest — a plain house. */
const FALLBACK_FOOTPRINT: [number, number] = [8, 6.6];

/**
 * Painted extent as a fraction of the art box, per family. A house's
 * transparent margin may overhang a neighbour; its WALLS may not.
 * Moved here from src/generator/village-rows.ts so the new engine does not
 * depend on the old one; village-rows re-exports them for its own callers.
 */
export const HOUSE_INK_RATIO = 0.68;
export const HUT_INK_RATIO = 0.85;

/** Whether the manifest carries this id at all — the biome-fallback test. */
export function hasGlyph(glyph: string): boolean {
  return Object.prototype.hasOwnProperty.call(SYMBOL_MANIFEST, glyph);
}

export function nominalFootprint(glyph: string): [number, number] {
  const fp = SYMBOL_MANIFEST[glyph]?.footprint;
  return fp ? [fp[0], fp[1]] : [...FALLBACK_FOOTPRINT];
}

export function rotationOf(glyph: string): 'invariant' | 'free' | 'locked' | 'snap-cardinal' {
  return SYMBOL_MANIFEST[glyph]?.rotation ?? 'free';
}

export function minScaleOf(glyph: string): number {
  return SYMBOL_MANIFEST[glyph]?.minScale ?? 0.35;
}

/**
 * Ink extent of an ALREADY-SCALED footprint. Callers pass the building's
 * final footprint, not the nominal one, because every size multiplier has
 * already been applied by then.
 */
export function inkExtent(
  glyph: string, footprint: [number, number],
): { width: number; depth: number } {
  const ratio = glyph.includes('hut') ? HUT_INK_RATIO : HOUSE_INK_RATIO;
  return { width: footprint[0] * ratio, depth: footprint[1] * ratio };
}
```

Then in `src/generator/village-rows.ts`, replace the two `export const` declarations of
`HOUSE_INK_RATIO` and `HUT_INK_RATIO` (keeping the existing comment block above them,
which records the gate-tuning history) with a re-export, so there is exactly one
definition:

```ts
// Ink ratios now live in src/village/glyphs.ts — one definition, shared by
// both engines. Re-exported here so this module's existing callers are
// unaffected. The tuning history above still applies.
export { HOUSE_INK_RATIO, HUT_INK_RATIO } from '../village/glyphs.js';
```

- [ ] **Step 8: Run the glyph test and the old engine's suite**

Run: `nix develop --command bash -c "npx vitest run tests/village/glyphs.test.ts tests/village-rows.test.ts"`
Expected: PASS both — the ratios moved, their values did not.

- [ ] **Step 9: Write constants.ts**

No test of its own: it is data, and every value is asserted by the task that consumes it.

```ts
// src/village/constants.ts

/**
 * Every tunable from the design's §11, in one place.
 *
 * The design promises that a render-gate verdict maps to a single edit.
 * That is only true if the constants live here rather than inside the pass
 * that happens to use them. If you are about to write a number into a pass,
 * write it here instead.
 */

// --- Green -------------------------------------------------------------
/** Diameter floor in metres, by the highest road class present. */
export const GREEN_DIAMETER_FLOOR_M: Record<string, number> = {
  royal: 26, main: 22, market: 20, town: 16, local: 12,
};
export const GREEN_REFERENCE_POP = 300;
export const GREEN_DIAMETER_CAP_M = 40;
export const GREEN_BUILT_RADIUS_DIVISOR = 1.5;
export const GREEN_WATER_MARGIN_M = 6;

// --- Lanes -------------------------------------------------------------
export const LANE_SAMPLE_STEP_M = 12;
export const LANE_WANDER_M = 3.5;
export const MIN_ARM_SEPARATION_DEG = 35;
export const MAX_INVENTED_LANES = 24;
export const FRONTAGE_MARGIN = 1.15;

// --- Relaxation --------------------------------------------------------
export const RELAX_ITERATIONS = 3;
export const RELAX_MAX_DISPLACEMENT_M = 1.5;
export const RELAX_CLEARANCE_M = 0.5;
export const TAIL_STUB_M = 12;

// --- Parcels -----------------------------------------------------------
export const GAP_LOOSE_M = 2.4;
export const GAP_TIGHT_M = 1.0;
export const GAP_POP_LOW = 100;
export const GAP_POP_HIGH = 900;
export const GRADIENT_EXPONENT = 1.5;
export const GRADIENT_K = 2.6;
export const FRONTAGE_JITTER = 0.1;
export const LOT_DEPTH_M = 25;
export const RING_SETBACK_M = 3;
export const MEAN_LOT_AREA_M2 = 320;

// --- Dwellings ---------------------------------------------------------
export const SIZE_JITTER = 0.1;
export const FIT_MIN = 0.85;
export const FIT_MAX = 1.15;
export const SEATING_SETBACK_MAX_M = 1.5;
export const DECK_GAP_M = 1.5;

// --- Feedback loop -----------------------------------------------------
export const MAX_FEEDBACK_ROUNDS = 3;
export const GAP_TIGHTEN = 0.85;

// --- Shorefront (pass 5, declared here so it is not lost) ---------------
export const SHOREFRONT_REACH_FACTOR = 1.5;
```

- [ ] **Step 10: Verify the whole suite still passes, then commit**

Run: `nix develop --command bash -c "npx tsc --noEmit && npx vitest run"`
Expected: PASS — nothing has changed behaviourally; one constant moved house.

```bash
git add src/village/geometry.ts src/village/glyphs.ts src/village/constants.ts \
        src/generator/village-rows.ts \
        tests/village/geometry.test.ts tests/village/glyphs.test.ts
git commit -m "feat(village): shared geometry, glyph and constant modules"
```

---

### Task 2: Route vocabulary

**Files:**
- Create: `src/village/route-class.ts`
- Test: `tests/village/route-class.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type RouteType`, `ROUTE_CLASS_ORDER: RouteType[]`, `classRank(t: RouteType): number`, `isRoadClass(t: RouteType): boolean`, `laneWidth(t: RouteType): number`, `stepDown(t: RouteType, floor: RouteType): RouteType`, `fromLegacyKind(k: 'road'|'foot'|'sea'): RouteType`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/village/route-class.test.ts
import { describe, it, expect } from 'vitest';
import {
  ROUTE_CLASS_ORDER, classRank, isRoadClass, laneWidth, stepDown, fromLegacyKind,
} from '../../src/village/route-class.js';

describe('route class vocabulary', () => {
  it('orders classes highest first', () => {
    expect(ROUTE_CLASS_ORDER).toEqual(
      ['royal', 'main', 'market', 'town', 'local', 'trail', 'footpath'],
    );
    expect(classRank('royal')).toBeLessThan(classRank('local'));
  });

  it('separates the road group from the path group', () => {
    expect(isRoadClass('local')).toBe(true);
    expect(isRoadClass('trail')).toBe(false);
    expect(isRoadClass('footpath')).toBe(false);
  });

  it('gives each class a width in metres', () => {
    expect(laneWidth('royal')).toBe(6);
    expect(laneWidth('local')).toBe(3.5);
    expect(laneWidth('footpath')).toBe(1.2);
  });

  it('steps down one class but never below the floor', () => {
    expect(stepDown('main', 'local')).toBe('market');
    expect(stepDown('local', 'local')).toBe('local');
    expect(stepDown('trail', 'footpath')).toBe('footpath');
    expect(stepDown('footpath', 'footpath')).toBe('footpath');
  });

  it('maps the legacy three-kind input', () => {
    expect(fromLegacyKind('road')).toBe('main');
    expect(fromLegacyKind('foot')).toBe('trail');
    expect(fromLegacyKind('sea')).toBe('searoutes');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nix develop --command bash -c "npx vitest run tests/village/route-class.test.ts"`
Expected: FAIL — cannot find module `src/village/route-class.js`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/village/route-class.ts

/** Barry's Bazgaar route vocabulary, highest class first. */
export type RouteType =
  | 'royal' | 'main' | 'market' | 'town' | 'local' | 'trail' | 'footpath';

/** Special groups that are not part of the land hierarchy. */
export type RouteGroup = 'searoutes' | 'airroutes' | 'traderoutes';

export const ROUTE_CLASS_ORDER: RouteType[] = [
  'royal', 'main', 'market', 'town', 'local', 'trail', 'footpath',
];

/** 0 = highest. Lower rank wins comparisons. */
export function classRank(t: RouteType): number {
  return ROUTE_CLASS_ORDER.indexOf(t);
}

/**
 * The road group is `royal`..`local`. Only road-group routes influence
 * where the green goes — trails and footpaths arrive between the houses,
 * after the fact.
 */
export function isRoadClass(t: RouteType): boolean {
  return classRank(t) <= classRank('local');
}

const WIDTHS: Record<RouteType, number> = {
  royal: 6, main: 5, market: 4.5, town: 4, local: 3.5, trail: 2, footpath: 1.2,
};

/** Metres. Feeds both the drawn line and the parcel setback. */
export function laneWidth(t: RouteType): number {
  return WIDTHS[t];
}

/** One class below `t`, never past `floor`. */
export function stepDown(t: RouteType, floor: RouteType): RouteType {
  const next = ROUTE_CLASS_ORDER[Math.min(classRank(t) + 1, ROUTE_CLASS_ORDER.length - 1)];
  return classRank(next) > classRank(floor) ? floor : next;
}

/** Back-compat: the three-kind input form is widened, never replaced. */
export function fromLegacyKind(k: 'road' | 'foot' | 'sea'): RouteType | RouteGroup {
  if (k === 'road') return 'main';
  if (k === 'foot') return 'trail';
  return 'searoutes';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `nix develop --command bash -c "npx vitest run tests/village/route-class.test.ts"`
Expected: PASS, 5 tests

- [ ] **Step 5: Widen the public input type**

The design (§3) requires the *input contract* to accept a real class, not just
`road | foot | sea`. Widening the accepted union is additive — every existing caller
still typechecks — and it is the only change this plan makes outside `src/village/`.

In `src/input/azgaar-input.ts`, in `RoadBearingInput`, change:

```ts
      kind?: RouteKind;
```

to:

```ts
      /**
       * Either the legacy three-kind form or a real route class from the
       * seven-type vocabulary. Widened, never replaced — `road`, `foot` and
       * `sea` remain valid input forever (see src/village/route-class.ts).
       */
      kind?: RouteKind | RouteType;
```

and add the import at the top of the file:

```ts
import type { RouteType } from '../village/route-class.js';
```

- [ ] **Step 6: Verify nothing downstream broke**

Run: `nix develop --command bash -c "npx tsc --noEmit && npx vitest run tests/azgaar-input.test.ts tests/route-fidelity.test.ts"`
Expected: PASS — the union only grew, so existing callers are unaffected.

- [ ] **Step 7: Commit**

```bash
git add src/village/route-class.ts tests/village/route-class.test.ts src/input/azgaar-input.ts
git commit -m "feat(village): seven-type route class vocabulary"
```

---

### Task 3: Village types and stable ids

**Files:**
- Create: `src/village/types.ts`
- Test: `tests/village/ids.test.ts`

**Interfaces:**
- Consumes: `RouteType` from Task 2; `Point`.
- Produces: interfaces `Site`, `Green`, `Lane`, `Lot`, `Building`, `VillageModel`; id helpers `armLaneId(bearingDeg)`, `branchLaneId(parentId, atFraction)`, `lotId(laneId, side, ordinal)`, `buildingId(lotId)`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/village/ids.test.ts
import { describe, it, expect } from 'vitest';
import { armLaneId, branchLaneId, lotId, buildingId } from '../../src/village/types.js';

describe('stable ids', () => {
  it('names an arm by its bearing, not its index', () => {
    expect(armLaneId(90)).toBe('arm-090');
    expect(armLaneId(7.4)).toBe('arm-007');
    expect(armLaneId(359.6)).toBe('arm-000'); // wraps
  });

  it('names a branch by its parent and where it left it', () => {
    expect(branchLaneId('arm-090', 0.5)).toBe('arm-090/b50');
    expect(branchLaneId('arm-090/b50', 0.33)).toBe('arm-090/b50/b33');
  });

  it('names a lot by lane, side and ordinal from the green', () => {
    expect(lotId('arm-090', 1, 0)).toBe('arm-090:R0');
    expect(lotId('arm-090', -1, 12)).toBe('arm-090:L12');
  });

  it('names a building by its lot', () => {
    expect(buildingId('arm-090:R0')).toBe('bld:arm-090:R0');
  });

  it('produces the same id for the same structure regardless of call order', () => {
    const a = lotId(branchLaneId(armLaneId(90), 0.5), 1, 3);
    const b = lotId(branchLaneId(armLaneId(90), 0.5), 1, 3);
    expect(a).toBe(b);
    expect(a).toBe('arm-090/b50:R3');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nix develop --command bash -c "npx vitest run tests/village/ids.test.ts"`
Expected: FAIL — cannot find module `src/village/types.js`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/village/types.ts
import { Point } from '../types/point.js';
import type { RouteType } from './route-class.js';

export type GreenShape =
  | 'sm-green-round' | 'sm-green-lens' | 'sm-green-lens-long'
  | 'sm-green-triangle' | 'sm-green-square' | 'sm-green-d';

/** An FMG route arriving at the burg. Bearings are degrees, 0 = N, clockwise. */
export interface SiteRoute {
  bearingDeg: number;
  type: RouteType;
  through: boolean;
  routeId?: string;
  followsRiver?: boolean;
  relief?: 'descent' | 'ascent' | 'valley' | 'ridge' | 'flat';
}

/** Pass 1 output. Everything in metres, origin at the burg centre. */
export interface Site {
  population: number;
  biome: string;
  routes: SiteRoute[];
  /** Closed polygons of water in burg-local metres. */
  water: Point[][];
  flags: { port: boolean; temple: boolean; trade: boolean; walls: boolean };
}

export interface Green {
  shape: GreenShape;
  variant: 'a' | 'b';
  centre: Point;
  /** Long-axis diameter in metres. */
  diameter: number;
  /** Long-axis bearing in degrees; 0 for radially symmetric shapes. */
  bearingDeg: number;
}

export interface Lane {
  id: string;
  type: RouteType;
  /** Metres. Ordered from the green outward. */
  points: Point[];
  widthM: number;
  parentId?: string;
}

export interface Lot {
  id: string;
  laneId: string;
  /** +1 = right of the lane's direction of travel, -1 = left. */
  side: 1 | -1;
  /** Midpoint of the lot's frontage. */
  front: Point;
  /** Degrees; the inward normal — the direction a dwelling faces. */
  bearingDeg: number;
  frontageM: number;
  depthM: number;
  score: number;
}

export interface Building {
  id: string;
  lotId: string;
  glyph: string;
  position: Point;
  bearingDeg: number;
  /** Final footprint in metres, after every size multiplier. */
  footprint: [number, number];
  occupancy: number;
}

export interface VillageModel {
  site: Site;
  green: Green;
  lanes: Lane[];
  lots: Lot[];
  buildings: Building[];
  diagnostics: string[];
}

/** Bearing rounded to whole degrees and wrapped to [0, 360). */
function bearingKey(bearingDeg: number): string {
  const w = ((Math.round(bearingDeg) % 360) + 360) % 360;
  return String(w).padStart(3, '0');
}

export function armLaneId(bearingDeg: number): string {
  return `arm-${bearingKey(bearingDeg)}`;
}

/** `atFraction` is where along the parent the branch leaves, 0..1. */
export function branchLaneId(parentId: string, atFraction: number): string {
  const pct = String(Math.round(atFraction * 100)).padStart(2, '0');
  return `${parentId}/b${pct}`;
}

export function lotId(laneId: string, side: 1 | -1, ordinal: number): string {
  return `${laneId}:${side === 1 ? 'R' : 'L'}${ordinal}`;
}

export function buildingId(lotIdValue: string): string {
  return `bld:${lotIdValue}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `nix develop --command bash -c "npx vitest run tests/village/ids.test.ts"`
Expected: PASS, 5 tests

- [ ] **Step 5: Commit**

```bash
git add src/village/types.ts tests/village/ids.test.ts
git commit -m "feat(village): domain types and structural stable ids"
```

---

### Task 4: Pass 1 — Site

**Files:**
- Create: `src/village/site.ts`
- Test: `tests/village/site.test.ts`

**Interfaces:**
- Consumes: `AzgaarBurgInput` (`src/input/azgaar-input.js`), `RouteType`/`fromLegacyKind` (Task 2), `Site`/`SiteRoute` (Task 3).
- Produces: `buildSite(input: AzgaarBurgInput): Site`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/village/site.test.ts
import { describe, it, expect } from 'vitest';
import { buildSite } from '../../src/village/site.js';
import type { AzgaarBurgInput } from '../../src/input/azgaar-input.js';

const base: AzgaarBurgInput = {
  name: 'Test', population: 300, port: false, citadel: false, walls: false,
  plaza: false, temple: false, shanty: false, capital: false,
};

describe('buildSite', () => {
  it('reads a bare numeric bearing as a main road that terminates', () => {
    const site = buildSite({ ...base, roadBearings: [225] });
    expect(site.routes).toEqual([
      { bearingDeg: 225, type: 'main', through: false, routeId: undefined,
        followsRiver: undefined, relief: undefined },
    ]);
  });

  it('maps the legacy kind field', () => {
    const site = buildSite({ ...base, roadBearings: [{ bearing_deg: 10, kind: 'foot' }] });
    expect(site.routes[0].type).toBe('trail');
  });

  it('carries through, relief and followsRiver', () => {
    const site = buildSite({
      ...base,
      roadBearings: [{ bearing_deg: 10, kind: 'road', through: true, relief: 'valley', followsRiver: true }],
    });
    expect(site.routes[0]).toMatchObject({ through: true, relief: 'valley', followsRiver: true });
  });

  it('copies water polygons as metres in burg-local coordinates', () => {
    const site = buildSite({
      ...base,
      coastlineGeometry: [[{ x: 10, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }]],
    });
    expect(site.water).toHaveLength(1);
    expect(site.water[0][0].x).toBe(10);
    expect(site.water[0]).toHaveLength(3);
  });

  it('has no water when none is supplied', () => {
    expect(buildSite(base).water).toEqual([]);
  });

  it('carries the flags the deck gates on', () => {
    const site = buildSite({ ...base, temple: true, trade: true, port: true });
    expect(site.flags).toEqual({ port: true, temple: true, trade: true, walls: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nix develop --command bash -c "npx vitest run tests/village/site.test.ts"`
Expected: FAIL — cannot find module `src/village/site.js`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/village/site.ts
import { Point } from '../types/point.js';
import type { AzgaarBurgInput } from '../input/azgaar-input.js';
import type { Site, SiteRoute } from './types.js';
import { fromLegacyKind, type RouteType } from './route-class.js';

const LAND_CLASSES = new Set<string>([
  'royal', 'main', 'market', 'town', 'local', 'trail', 'footpath',
]);

/**
 * Pass 1. Resolves FMG's input into burg-local metres. No geometry is
 * invented here — this pass only reads.
 */
export function buildSite(input: AzgaarBurgInput): Site {
  const routes: SiteRoute[] = (input.roadBearings ?? []).map((b) => {
    if (typeof b === 'number') {
      return { bearingDeg: b, type: 'main' as RouteType, through: false,
        routeId: undefined, followsRiver: undefined, relief: undefined };
    }
    // A caller on the widened contract sends a real class; a legacy caller
    // sends road|foot|sea, which is widened, never rejected.
    const raw = b.kind as string | undefined;
    const type = (raw && LAND_CLASSES.has(raw))
      ? (raw as RouteType)
      : (fromLegacyKind((raw as 'road' | 'foot' | 'sea') ?? 'road') as RouteType);
    return {
      bearingDeg: b.bearing_deg,
      type,
      through: b.through ?? false,
      routeId: b.route_id,
      followsRiver: b.followsRiver,
      relief: b.relief,
    };
  });

  const water: Point[][] = (input.coastlineGeometry ?? [])
    .map((ring) => ring.map((p) => new Point(p.x, p.y)));

  return {
    population: input.population,
    biome: input.biome ?? 'temperate',
    routes,
    water,
    flags: {
      port: input.port,
      temple: input.temple,
      trade: input.trade ?? false,
      walls: input.walls,
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `nix develop --command bash -c "npx vitest run tests/village/site.test.ts"`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
git add src/village/site.ts tests/village/site.test.ts
git commit -m "feat(village): pass 1 — site resolution from FMG input"
```

---

### Task 5: Green shape and size

**Files:**
- Create: `src/village/skeleton/green-siting.ts`
- Test: `tests/village/green-shape.test.ts`

**Interfaces:**
- Consumes: `Site`, `GreenShape` (Task 3); `isRoadClass`, `classRank` (Task 2).
- Produces: `roadArms(site: Site): SiteRoute[]`, `greenShape(arms: SiteRoute[], clippedByWater: boolean): GreenShape`, `predictedBuiltRadius(population: number, meanOccupancy: number, meanLotAreaM2: number): number`, `greenDiameter(arms: SiteRoute[], population: number, builtRadiusM: number): number`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/village/green-shape.test.ts
import { describe, it, expect } from 'vitest';
import {
  roadArms, greenShape, greenDiameter, predictedBuiltRadius,
} from '../../src/village/skeleton/green-siting.js';
import type { SiteRoute, Site } from '../../src/village/types.js';

const route = (bearingDeg: number, type: SiteRoute['type'], through = false): SiteRoute =>
  ({ bearingDeg, type, through });

const site = (routes: SiteRoute[]): Site =>
  ({ population: 300, biome: 'temperate', routes, water: [],
     flags: { port: false, temple: false, trade: false, walls: false } });

describe('roadArms', () => {
  it('drops trails and footpaths — they never influence the green', () => {
    const arms = roadArms(site([route(0, 'main'), route(90, 'trail'), route(180, 'footpath')]));
    expect(arms.map((a) => a.type)).toEqual(['main']);
  });
});

describe('greenShape', () => {
  it('is round at a terminus', () => {
    expect(greenShape([route(225, 'main')], false)).toBe('sm-green-round');
  });

  it('is a lens on a single through route, long when the route is main or better', () => {
    expect(greenShape([route(45, 'town', true)], false)).toBe('sm-green-lens');
    expect(greenShape([route(45, 'main', true)], false)).toBe('sm-green-lens-long');
    expect(greenShape([route(45, 'royal', true)], false)).toBe('sm-green-lens-long');
  });

  it('is a triangle at a Y junction', () => {
    expect(greenShape([route(0, 'main'), route(120, 'town'), route(240, 'local')], false))
      .toBe('sm-green-triangle');
  });

  it('is squarish at a crossroads', () => {
    expect(greenShape(
      [route(0, 'main'), route(90, 'town'), route(180, 'town'), route(270, 'local')], false,
    )).toBe('sm-green-square');
  });

  it('is a D whenever water clips it, whatever the junction', () => {
    expect(greenShape([route(0, 'main'), route(120, 'town'), route(240, 'local')], true))
      .toBe('sm-green-d');
  });

  it('falls back to round when only paths arrive', () => {
    expect(greenShape([], false)).toBe('sm-green-round');
  });
});

describe('greenDiameter', () => {
  it('uses the highest class present as its floor', () => {
    // pop 300 => sqrt(1) => exactly the floor
    expect(greenDiameter([route(0, 'main')], 300, 100)).toBeCloseTo(22, 5);
    expect(greenDiameter([route(0, 'local')], 300, 100)).toBeCloseTo(12, 5);
  });

  it('never falls below the floor for a small population', () => {
    expect(greenDiameter([route(0, 'main')], 75, 100)).toBeCloseTo(22, 5);
  });

  it('scales with the square root of population', () => {
    expect(greenDiameter([route(0, 'town')], 1200, 200)).toBeCloseTo(32, 5); // 16 * 2
  });

  it('is capped at 40 m and at builtRadius / 1.5', () => {
    expect(greenDiameter([route(0, 'royal')], 5000, 1000)).toBe(40);
    expect(greenDiameter([route(0, 'royal')], 5000, 30)).toBeCloseTo(20, 5);
  });
});

describe('predictedBuiltRadius', () => {
  it('derives a radius from census, occupancy and lot area', () => {
    // 300 people / 5 per dwelling = 60 lots * 300 m2 = 18000 m2 => r = sqrt(18000/pi)
    expect(predictedBuiltRadius(300, 5, 300)).toBeCloseTo(Math.sqrt(18000 / Math.PI), 5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nix develop --command bash -c "npx vitest run tests/village/green-shape.test.ts"`
Expected: FAIL — cannot find module `src/village/skeleton/green-siting.js`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/village/skeleton/green-siting.ts
import type { GreenShape, Site, SiteRoute } from '../types.js';
import { classRank, isRoadClass } from '../route-class.js';
import {
  GREEN_BUILT_RADIUS_DIVISOR, GREEN_DIAMETER_CAP_M, GREEN_DIAMETER_FLOOR_M,
  GREEN_REFERENCE_POP,
} from '../constants.js';

/** Only road-group routes influence the green. */
export function roadArms(site: Site): SiteRoute[] {
  return site.routes.filter((r) => isRoadClass(r.type));
}

// Floors, reference population and caps all live in constants.ts — a gate
// verdict on green size is one edit there, not a hunt through this pass.

/** The shape is a fossil of the junction that made it. */
export function greenShape(arms: SiteRoute[], clippedByWater: boolean): GreenShape {
  if (clippedByWater) return 'sm-green-d';
  if (arms.length === 0) return 'sm-green-round';
  if (arms.length === 1) {
    if (!arms[0].through) return 'sm-green-round';
    return classRank(arms[0].type) <= classRank('main')
      ? 'sm-green-lens-long' : 'sm-green-lens';
  }
  if (arms.length === 2) return 'sm-green-triangle';
  if (arms.length === 3) return 'sm-green-triangle';
  return 'sm-green-square';
}

/**
 * Built radius, predicted before any geometry exists, from the census.
 * Refined by the pass-4 feedback loop if it turns out wrong.
 */
export function predictedBuiltRadius(
  population: number, meanOccupancy: number, meanLotAreaM2: number,
): number {
  const dwellings = Math.max(1, population / meanOccupancy);
  return Math.sqrt((dwellings * meanLotAreaM2) / Math.PI);
}

export function greenDiameter(
  arms: SiteRoute[], population: number, builtRadiusM: number,
): number {
  const best = arms.length
    ? arms.reduce((a, b) => (classRank(a.type) <= classRank(b.type) ? a : b))
    : undefined;
  const floor = best ? (GREEN_DIAMETER_FLOOR_M[best.type] ?? 12) : 12;
  const scaled = floor * Math.sqrt(population / GREEN_REFERENCE_POP);
  const cap = Math.min(GREEN_DIAMETER_CAP_M, builtRadiusM / GREEN_BUILT_RADIUS_DIVISOR);
  return Math.max(floor, Math.min(scaled, Math.max(floor, cap)));
}
```

Note on the arm-count table: a single `through` route arrives as **one** `SiteRoute` with `through: true` (it exits on the far side automatically — see Task 7), so `arms.length === 2` means two distinct routes, which is a Y once the through route's far side is counted. Both 2 and 3 therefore give a triangle.

- [ ] **Step 4: Run test to verify it passes**

Run: `nix develop --command bash -c "npx vitest run tests/village/green-shape.test.ts"`
Expected: PASS, 11 tests

- [ ] **Step 5: Commit**

```bash
git add src/village/skeleton/green-siting.ts tests/village/green-shape.test.ts
git commit -m "feat(village): green shape and size from junction topology"
```

---

### Task 6: Green position

**Files:**
- Modify: `src/village/skeleton/green-siting.ts`
- Test: `tests/village/green-position.test.ts`

**Interfaces:**
- Consumes: `roadArms`, `greenShape`, `greenDiameter` (Task 5); `pointInPolygon` (`src/geom/point-in-polygon.js`).
- Produces: `waterClips(centre: Point, radiusM: number, water: Point[][]): boolean`, `siteGreen(site: Site, builtRadiusM: number, rng: SeededRandom): Green`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/village/green-position.test.ts
import { describe, it, expect } from 'vitest';
import { Point } from '../../src/types/point.js';
import { SeededRandom } from '../../src/utils/random.js';
import { siteGreen, waterClips } from '../../src/village/skeleton/green-siting.js';
import type { Site, SiteRoute } from '../../src/village/types.js';

const route = (bearingDeg: number, type: SiteRoute['type'], through = false): SiteRoute =>
  ({ bearingDeg, type, through });

const site = (routes: SiteRoute[], water: Point[][] = []): Site =>
  ({ population: 300, biome: 'temperate', routes, water,
     flags: { port: false, temple: false, trade: false, walls: false } });

// A square of water covering everything north of y = -20.
const northWater = [[
  new Point(-500, -500), new Point(500, -500), new Point(500, -20), new Point(-500, -20),
]];

describe('waterClips', () => {
  it('is true when the green would reach into water', () => {
    expect(waterClips(new Point(0, 0), 30, northWater)).toBe(true);
  });
  it('is false when it clears', () => {
    expect(waterClips(new Point(0, 100), 10, northWater)).toBe(false);
  });
});

describe('siteGreen', () => {
  it('sits on the origin when a single route terminates there', () => {
    const g = siteGreen(site([route(225, 'main')]), 100, new SeededRandom(1));
    expect(g.centre.x).toBeCloseTo(0, 5);
    expect(g.centre.y).toBeCloseTo(0, 5);
    expect(g.shape).toBe('sm-green-round');
  });

  it('takes its long-axis bearing from a through route', () => {
    const g = siteGreen(site([route(90, 'main', true)]), 100, new SeededRandom(1));
    expect(g.bearingDeg).toBeCloseTo(90, 5);
    expect(g.shape).toBe('sm-green-lens-long');
  });

  it('pushes away from water until it clears, plus margin', () => {
    const g = siteGreen(site([route(180, 'main')], northWater), 100, new SeededRandom(1));
    // Water fills y <= -20 (north is -y). The green must sit south of it.
    expect(g.centre.y).toBeGreaterThan(-20);
    expect(waterClips(g.centre, g.diameter / 2, northWater)).toBe(false);
    expect(g.shape).toBe('sm-green-d');
  });

  it('picks a seed variant deterministically', () => {
    const a = siteGreen(site([route(0, 'main')]), 100, new SeededRandom(42));
    const b = siteGreen(site([route(0, 'main')]), 100, new SeededRandom(42));
    expect(a.variant).toBe(b.variant);
    expect(['a', 'b']).toContain(a.variant);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nix develop --command bash -c "npx vitest run tests/village/green-position.test.ts"`
Expected: FAIL — `siteGreen` is not exported

- [ ] **Step 3: Write minimal implementation**

Append to `src/village/skeleton/green-siting.ts`:

```ts
import { Point } from '../../types/point.js';
import { SeededRandom } from '../../utils/random.js';
import { bearingVector, inAnyWater } from '../geometry.js';
import { GREEN_WATER_MARGIN_M } from '../constants.js';
import type { Green } from '../types.js';

/** Local to this pass: how the search walks, not what a gate would tune. */
const PUSH_STEP_M = 2;
const MAX_PUSH_STEPS = 200;

/** True when any point on the green's rim, or its centre, is in water. */
export function waterClips(centre: Point, radiusM: number, water: Point[][]): boolean {
  if (water.length === 0) return false;
  const probes: Point[] = [centre];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    probes.push(new Point(centre.x + radiusM * Math.cos(a), centre.y + radiusM * Math.sin(a)));
  }
  return probes.some((p) => inAnyWater(p, water));
}

/**
 * Order within pass 2: shape → size → position. Position is last because
 * the push-away-from-water step needs the radius.
 */
export function siteGreen(site: Site, builtRadiusM: number, rng: SeededRandom): Green {
  const arms = roadArms(site);
  const through = arms.find((a) => a.through);

  // Size first — it depends only on class and census.
  const provisionalShape = greenShape(arms, false);
  const diameter = greenDiameter(arms, site.population, builtRadiusM);
  const radius = diameter / 2;

  // Position: origin, then pushed clear of water along the away bearing.
  let centre = new Point(0, 0);
  let clipped = false;
  if (waterClips(centre, radius + GREEN_WATER_MARGIN_M, site.water)) {
    clipped = true;
    // Push along the bearing of the arm that best points away from water,
    // or due south when there is no arm to follow.
    const away = arms.length ? bearingVector(arms[0].bearingDeg) : new Point(0, 1);
    for (let i = 0; i < MAX_PUSH_STEPS; i++) {
      centre = new Point(centre.x + away.x * PUSH_STEP_M, centre.y + away.y * PUSH_STEP_M);
      if (!waterClips(centre, radius + GREEN_WATER_MARGIN_M, site.water)) break;
    }
  }

  const shape = clipped ? 'sm-green-d' : provisionalShape;
  const bearingDeg = through ? through.bearingDeg : 0;
  const variant = rng.bool(0.5) ? 'a' : 'b';

  return { shape, variant, centre, diameter, bearingDeg };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `nix develop --command bash -c "npx vitest run tests/village/green-position.test.ts"`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
git add src/village/skeleton/green-siting.ts tests/village/green-position.test.ts
git commit -m "feat(village): green position, water displacement and D-shape selection"
```

---

### Task 7: Lane arms

**Files:**
- Create: `src/village/skeleton/lanes.ts`
- Test: `tests/village/lanes-arms.test.ts`

**Interfaces:**
- Consumes: `Green`, `Lane`, `Site`, `armLaneId` (Task 3); `laneWidth` (Task 2).
- Produces: `buildArms(site: Site, green: Green, extentM: number, rng: SeededRandom): Lane[]`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/village/lanes-arms.test.ts
import { describe, it, expect } from 'vitest';
import { Point } from '../../src/types/point.js';
import { SeededRandom } from '../../src/utils/random.js';
import { buildArms } from '../../src/village/skeleton/lanes.js';
import type { Green, Site, SiteRoute } from '../../src/village/types.js';

const route = (bearingDeg: number, type: SiteRoute['type'], through = false): SiteRoute =>
  ({ bearingDeg, type, through });

const site = (routes: SiteRoute[]): Site =>
  ({ population: 300, biome: 'temperate', routes, water: [],
     flags: { port: false, temple: false, trade: false, walls: false } });

const green: Green = {
  shape: 'sm-green-round', variant: 'a', centre: new Point(0, 0),
  diameter: 20, bearingDeg: 0,
};

describe('buildArms', () => {
  it('makes one lane per terminating route, starting at the green rim', () => {
    const lanes = buildArms(site([route(90, 'main')]), green, 150, new SeededRandom(1));
    expect(lanes).toHaveLength(1);
    expect(lanes[0].id).toBe('arm-090');
    expect(lanes[0].type).toBe('main');
    expect(lanes[0].widthM).toBe(5);
    // starts on the rim, not at the centre
    const start = lanes[0].points[0];
    expect(Math.hypot(start.x, start.y)).toBeCloseTo(10, 0);
  });

  it('makes two lanes for a through route — it enters and it leaves', () => {
    const lanes = buildArms(site([route(90, 'main', true)]), green, 150, new SeededRandom(1));
    expect(lanes.map((l) => l.id).sort()).toEqual(['arm-090', 'arm-270']);
    expect(lanes.every((l) => l.type === 'main')).toBe(true);
  });

  it('runs each arm out to the extent', () => {
    const lanes = buildArms(site([route(0, 'town')]), green, 200, new SeededRandom(1));
    const end = lanes[0].points[lanes[0].points.length - 1];
    expect(Math.hypot(end.x, end.y)).toBeGreaterThan(150);
  });

  it('wanders, but is deterministic for a seed', () => {
    const a = buildArms(site([route(0, 'town')]), green, 200, new SeededRandom(7));
    const b = buildArms(site([route(0, 'town')]), green, 200, new SeededRandom(7));
    expect(a[0].points.map((p) => [p.x, p.y])).toEqual(b[0].points.map((p) => [p.x, p.y]));
    // not a perfectly straight line
    const xs = a[0].points.map((p) => p.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0);
  });

  it('keeps trails and footpaths as arms too — they just did not site the green', () => {
    const lanes = buildArms(site([route(45, 'footpath')]), green, 150, new SeededRandom(1));
    expect(lanes[0].type).toBe('footpath');
    expect(lanes[0].widthM).toBe(1.2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nix develop --command bash -c "npx vitest run tests/village/lanes-arms.test.ts"`
Expected: FAIL — cannot find module `src/village/skeleton/lanes.js`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/village/skeleton/lanes.ts
import { Point } from '../../types/point.js';
import { SeededRandom } from '../../utils/random.js';
import { laneWidth } from '../route-class.js';
import { bearingVector } from '../geometry.js';
import { LANE_SAMPLE_STEP_M, LANE_WANDER_M } from '../constants.js';
import { armLaneId, type Green, type Lane, type Site, type SiteRoute } from '../types.js';

/**
 * One arm: a polyline from the green's rim outward along `bearingDeg`,
 * wandering sideways a little so it never reads as surveyed.
 */
function runArm(
  green: Green, bearingDeg: number, extentM: number, rng: SeededRandom,
): Point[] {
  const dir = bearingVector(bearingDeg);
  const normal = new Point(-dir.y, dir.x);
  const start = green.diameter / 2;
  const points: Point[] = [];
  let drift = 0;
  for (let d = start; d <= start + extentM; d += LANE_SAMPLE_STEP_M) {
    drift += (rng.float() - 0.5) * 2 * LANE_WANDER_M;
    points.push(new Point(
      green.centre.x + dir.x * d + normal.x * drift,
      green.centre.y + dir.y * d + normal.y * drift,
    ));
  }
  return points;
}

/**
 * Every incoming route becomes an arm leaving the green at its bearing.
 * A `through` route also leaves on the far side — it passes across the
 * green rather than stopping at it.
 */
export function buildArms(
  site: Site, green: Green, extentM: number, rng: SeededRandom,
): Lane[] {
  const lanes: Lane[] = [];
  const emit = (r: SiteRoute, bearingDeg: number): void => {
    lanes.push({
      id: armLaneId(bearingDeg),
      type: r.type,
      points: runArm(green, bearingDeg, extentM, rng),
      widthM: laneWidth(r.type),
    });
  };
  for (const r of site.routes) {
    emit(r, r.bearingDeg);
    if (r.through) emit(r, (r.bearingDeg + 180) % 360);
  }
  return lanes;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `nix develop --command bash -c "npx vitest run tests/village/lanes-arms.test.ts"`
Expected: PASS, 5 tests

- [ ] **Step 5: Commit**

```bash
git add src/village/skeleton/lanes.ts tests/village/lanes-arms.test.ts
git commit -m "feat(village): lane arms from typed routes, with through crossings"
```

---

### Task 8: Frontage budget and invented lanes

**Files:**
- Modify: `src/village/skeleton/lanes.ts`
- Test: `tests/village/lanes-invented.test.ts`

**Interfaces:**
- Consumes: `buildArms` (Task 7), `branchLaneId` (Task 3), `stepDown`, `laneWidth` (Task 2).
- Produces: `polylineLength(points: Point[]): number`, `availableFrontage(lanes: Lane[]): number`, `requiredFrontage(population: number, meanOccupancy: number, meanFrontageM: number): number`, `addInventedLanes(lanes: Lane[], green: Green, requiredM: number, extentM: number, rng: SeededRandom): Lane[]`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/village/lanes-invented.test.ts
import { describe, it, expect } from 'vitest';
import { Point } from '../../src/types/point.js';
import { SeededRandom } from '../../src/utils/random.js';
import {
  addInventedLanes, availableFrontage, polylineLength, requiredFrontage,
} from '../../src/village/skeleton/lanes.js';
import type { Green, Lane } from '../../src/village/types.js';

const green: Green = {
  shape: 'sm-green-round', variant: 'a', centre: new Point(0, 0),
  diameter: 20, bearingDeg: 0,
};

const lane = (id: string, from: Point, to: Point): Lane =>
  ({ id, type: 'main', points: [from, to], widthM: 5 });

describe('frontage arithmetic', () => {
  it('measures a polyline', () => {
    expect(polylineLength([new Point(0, 0), new Point(3, 4)])).toBeCloseTo(5, 5);
  });

  it('counts both sides of every lane', () => {
    const lanes = [lane('a', new Point(0, 0), new Point(100, 0))];
    expect(availableFrontage(lanes)).toBeCloseTo(200, 5);
  });

  it('derives what the census needs', () => {
    // 300 people / 5 per dwelling = 60 dwellings * 14 m of frontage
    expect(requiredFrontage(300, 5, 14)).toBeCloseTo(840, 5);
  });
});

describe('addInventedLanes', () => {
  it('adds nothing when the arms already provide enough frontage', () => {
    const lanes = [lane('arm-000', new Point(0, -10), new Point(0, -500))];
    const out = addInventedLanes(lanes, green, 500, 200, new SeededRandom(1));
    expect(out).toHaveLength(1);
  });

  it('adds lanes until available frontage clears required x 1.15', () => {
    const lanes = [lane('arm-000', new Point(0, -10), new Point(0, -110))];
    const out = addInventedLanes(lanes, green, 2000, 200, new SeededRandom(1));
    expect(out.length).toBeGreaterThan(1);
    expect(availableFrontage(out)).toBeGreaterThanOrEqual(2000 * 1.15);
  });

  it('classes a green-attached lane one step below the best arm, floored at local', () => {
    const lanes = [lane('arm-000', new Point(0, -10), new Point(0, -60))];
    const out = addInventedLanes(lanes, green, 800, 200, new SeededRandom(3));
    const invented = out.filter((l) => !l.id.startsWith('arm-'));
    expect(invented.length).toBeGreaterThan(0);
    for (const l of invented) {
      expect(['market', 'town', 'local', 'trail', 'footpath']).toContain(l.type);
    }
  });

  it('is deterministic for a seed', () => {
    const mk = () => addInventedLanes(
      [lane('arm-000', new Point(0, -10), new Point(0, -60))], green, 900, 200,
      new SeededRandom(11),
    );
    expect(JSON.stringify(mk())).toBe(JSON.stringify(mk()));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nix develop --command bash -c "npx vitest run tests/village/lanes-invented.test.ts"`
Expected: FAIL — `addInventedLanes` is not exported

- [ ] **Step 3: Write minimal implementation**

Append to `src/village/skeleton/lanes.ts`:

```ts
import { branchLaneId } from '../types.js';
import { classRank, stepDown, type RouteType } from '../route-class.js';
import { angularGap, bearingOf, polylineLength } from '../geometry.js';
import {
  FRONTAGE_MARGIN, MAX_INVENTED_LANES, MIN_ARM_SEPARATION_DEG,
} from '../constants.js';

/** Both sides of every lane are frontage. */
export function availableFrontage(lanes: Lane[]): number {
  return lanes.reduce((sum, l) => sum + polylineLength(l.points) * 2, 0);
}

export function requiredFrontage(
  population: number, meanOccupancy: number, meanFrontageM: number,
): number {
  return (population / meanOccupancy) * meanFrontageM;
}

/** Which way a lane leaves the green — geometry.ts owns the trigonometry. */
function laneBearing(green: Green, lane: Lane): number {
  return bearingOf(green.centre, lane.points[0]);
}

/**
 * Lanes are invented only when frontage runs out. A new lane leaves the
 * green at a free bearing, at least MIN_ARM_SEPARATION_DEG from every
 * existing one; its class is one step below the best arm present, floored
 * at `local` so wagons always reach the green.
 */
export function addInventedLanes(
  lanes: Lane[], green: Green, requiredM: number, extentM: number, rng: SeededRandom,
): Lane[] {
  const out = [...lanes];
  const best = out.length
    ? out.reduce((a, b) => (classRank(a.type) <= classRank(b.type) ? a : b)).type
    : ('local' as RouteType);
  const inventedType = stepDown(best, 'local');

  let guard = 0;
  while (availableFrontage(out) < requiredM * FRONTAGE_MARGIN && guard < MAX_INVENTED_LANES) {
    guard++;
    const taken = out.map((l) => laneBearing(green, l));
    let bearing = -1;
    for (let attempt = 0; attempt < 36; attempt++) {
      const candidate = rng.int(0, 360);
      if (taken.every((t) => angularGap(candidate, t) >= MIN_ARM_SEPARATION_DEG)) {
        bearing = candidate;
        break;
      }
    }
    // No free bearing left at the green: branch off the longest lane instead.
    if (bearing < 0) {
      const parent = out.reduce((a, b) =>
        (polylineLength(a.points) >= polylineLength(b.points) ? a : b));
      const at = 0.33 + rng.float() * 0.34;
      const idx = Math.max(1, Math.floor(parent.points.length * at));
      const anchor = parent.points[Math.min(idx, parent.points.length - 1)];
      const parentBearing = laneBearing(green, parent);
      const side = rng.bool(0.5) ? 1 : -1;
      const branchBearing = (parentBearing + side * (60 + rng.int(0, 51)) + 360) % 360;
      const dir = bearingVector(branchBearing);
      const length = extentM * 0.5;
      const points: Point[] = [];
      for (let d = 0; d <= length; d += LANE_SAMPLE_STEP_M) {
        points.push(new Point(anchor.x + dir.x * d, anchor.y + dir.y * d));
      }
      out.push({
        id: branchLaneId(parent.id, at),
        type: stepDown(parent.type, 'footpath'),
        points,
        widthM: laneWidth(stepDown(parent.type, 'footpath')),
        parentId: parent.id,
      });
      continue;
    }
    out.push({
      id: armLaneId(bearing),
      type: inventedType,
      points: runArm(green, bearing, extentM * 0.6, rng),
      widthM: laneWidth(inventedType),
    });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `nix develop --command bash -c "npx vitest run tests/village/lanes-invented.test.ts"`
Expected: PASS, 7 tests

- [ ] **Step 5: Commit**

```bash
git add src/village/skeleton/lanes.ts tests/village/lanes-invented.test.ts
git commit -m "feat(village): frontage budget drives invented lanes"
```

---

### Task 9: Polyline offset

**Files:**
- Create: `src/village/parcels/strip.ts`
- Test: `tests/village/strip-offset.test.ts`

**Interfaces:**
- Consumes: `Point`.
- Produces: `offsetPolyline(points: Point[], distanceM: number, side: 1 | -1): Point[]`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/village/strip-offset.test.ts
import { describe, it, expect } from 'vitest';
import { Point } from '../../src/types/point.js';
import { offsetPolyline } from '../../src/village/parcels/strip.js';

describe('offsetPolyline', () => {
  const straight = [new Point(0, 0), new Point(10, 0), new Point(20, 0)];

  it('offsets a horizontal line to its right (+y in screen space)', () => {
    const out = offsetPolyline(straight, 4, 1);
    expect(out).toHaveLength(3);
    for (const p of out) expect(p.y).toBeCloseTo(4, 5);
    expect(out[0].x).toBeCloseTo(0, 5);
  });

  it('offsets to the left with side -1', () => {
    const out = offsetPolyline(straight, 4, -1);
    for (const p of out) expect(p.y).toBeCloseTo(-4, 5);
  });

  it('keeps one output point per input point', () => {
    const curve = [new Point(0, 0), new Point(10, 0), new Point(20, 10), new Point(30, 30)];
    expect(offsetPolyline(curve, 3, 1)).toHaveLength(4);
  });

  it('bisects the angle at a corner so the offset stays parallel on both legs', () => {
    const corner = [new Point(0, 0), new Point(10, 0), new Point(10, 10)];
    const out = offsetPolyline(corner, 2, 1);
    // At the corner the offset point is pushed diagonally outward.
    expect(out[1].x).toBeCloseTo(8, 5);
    expect(out[1].y).toBeCloseTo(2, 5);
  });

  it('returns an empty array for a degenerate input', () => {
    expect(offsetPolyline([new Point(0, 0)], 4, 1)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nix develop --command bash -c "npx vitest run tests/village/strip-offset.test.ts"`
Expected: FAIL — cannot find module `src/village/parcels/strip.js`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/village/parcels/strip.ts
import { Point } from '../../types/point.js';
import { unit } from '../geometry.js';

/**
 * Offset a polyline sideways by `distanceM`. `side` is +1 for the right of
 * the direction of travel, -1 for the left. Corners use the angle bisector
 * so both legs stay parallel to their originals.
 */
export function offsetPolyline(points: Point[], distanceM: number, side: 1 | -1): Point[] {
  if (points.length < 2) return [];
  const normals: Point[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const d = unit(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
    normals.push(new Point(-d.y * side, d.x * side));
  }
  const out: Point[] = [];
  for (let i = 0; i < points.length; i++) {
    const before = normals[Math.max(0, i - 1)];
    const after = normals[Math.min(i, normals.length - 1)];
    const bisector = unit(before.x + after.x, before.y + after.y);
    // Miter length: how far along the bisector to travel so both legs are
    // `distanceM` from their originals.
    const cos = bisector.x * after.x + bisector.y * after.y;
    const scale = cos === 0 ? 1 : 1 / cos;
    const miter = Math.min(Math.abs(scale), 4) * Math.sign(scale || 1);
    out.push(new Point(
      points[i].x + bisector.x * distanceM * miter,
      points[i].y + bisector.y * distanceM * miter,
    ));
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `nix develop --command bash -c "npx vitest run tests/village/strip-offset.test.ts"`
Expected: PASS, 5 tests

- [ ] **Step 5: Commit**

```bash
git add src/village/parcels/strip.ts tests/village/strip-offset.test.ts
git commit -m "feat(village): polyline offset for frontage strips"
```

---

### Task 10: Frontage gradient and lane subdivision

**Files:**
- Create: `src/village/parcels/lots.ts`
- Test: `tests/village/lots-subdivide.test.ts`

**Interfaces:**
- Consumes: `offsetPolyline` (Task 9); `lotId`, `Lane`, `Lot`, `Green` (Task 3).
- Produces: `gapForPopulation(population: number): number`, `frontageAt(distanceM: number, builtRadiusM: number, f0: number): number`, `subdivideLane(lane: Lane, green: Green, builtRadiusM: number, f0: number, depthM: number, rng: SeededRandom): Lot[]`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/village/lots-subdivide.test.ts
import { describe, it, expect } from 'vitest';
import { Point } from '../../src/types/point.js';
import { SeededRandom } from '../../src/utils/random.js';
import { frontageAt, gapForPopulation, subdivideLane } from '../../src/village/parcels/lots.js';
import type { Green, Lane } from '../../src/village/types.js';

const green: Green = {
  shape: 'sm-green-round', variant: 'a', centre: new Point(0, 0),
  diameter: 20, bearingDeg: 0,
};

const straightLane: Lane = {
  id: 'arm-090', type: 'main', widthM: 5,
  points: [new Point(10, 0), new Point(210, 0)],
};

describe('gapForPopulation', () => {
  it('is loose in a hamlet and tight in a big village', () => {
    expect(gapForPopulation(100)).toBeCloseTo(2.4, 1);
    expect(gapForPopulation(900)).toBeCloseTo(1.0, 1);
    expect(gapForPopulation(900)).toBeLessThan(gapForPopulation(100));
  });

  it('clamps outside the village band', () => {
    expect(gapForPopulation(10)).toBeCloseTo(2.4, 1);
    expect(gapForPopulation(5000)).toBeCloseTo(1.0, 1);
  });
});

describe('frontageAt', () => {
  it('is f0 at the green', () => {
    expect(frontageAt(0, 100, 10)).toBeCloseTo(10, 5);
  });

  it('grows to roughly 3-4x f0 at the fringe', () => {
    const fringe = frontageAt(100, 100, 10);
    expect(fringe).toBeGreaterThan(30);
    expect(fringe).toBeLessThan(45);
  });

  it('grows monotonically outward', () => {
    expect(frontageAt(50, 100, 10)).toBeGreaterThan(frontageAt(20, 100, 10));
  });
});

describe('subdivideLane', () => {
  it('cuts lots on both sides of the lane', () => {
    const lots = subdivideLane(straightLane, green, 100, 10, 25, new SeededRandom(1));
    expect(lots.some((l) => l.side === 1)).toBe(true);
    expect(lots.some((l) => l.side === -1)).toBe(true);
  });

  it('numbers lots from the green end and gives them stable ids', () => {
    const lots = subdivideLane(straightLane, green, 100, 10, 25, new SeededRandom(1));
    const right = lots.filter((l) => l.side === 1);
    expect(right[0].id).toBe('arm-090:R0');
    expect(right[1].id).toBe('arm-090:R1');
  });

  it('faces every lot back toward its lane', () => {
    const lots = subdivideLane(straightLane, green, 100, 10, 25, new SeededRandom(1));
    const right = lots.find((l) => l.side === 1)!;
    const left = lots.find((l) => l.side === -1)!;
    // The lane runs east; right-side lots look north, left-side lots look south.
    expect(right.bearingDeg).toBeCloseTo(0, 0);
    expect(left.bearingDeg).toBeCloseTo(180, 0);
  });

  it('widens frontage outward', () => {
    const lots = subdivideLane(straightLane, green, 100, 10, 25, new SeededRandom(1))
      .filter((l) => l.side === 1);
    expect(lots[lots.length - 1].frontageM).toBeGreaterThan(lots[0].frontageM);
  });

  it('never cuts a lot narrower than f0', () => {
    const lots = subdivideLane(straightLane, green, 100, 10, 25, new SeededRandom(2));
    for (const l of lots) expect(l.frontageM).toBeGreaterThanOrEqual(10);
  });

  it('is deterministic for a seed', () => {
    const mk = () => subdivideLane(straightLane, green, 100, 10, 25, new SeededRandom(5));
    expect(JSON.stringify(mk())).toBe(JSON.stringify(mk()));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nix develop --command bash -c "npx vitest run tests/village/lots-subdivide.test.ts"`
Expected: FAIL — cannot find module `src/village/parcels/lots.js`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/village/parcels/lots.ts
import { Point } from '../../types/point.js';
import { SeededRandom } from '../../utils/random.js';
import { offsetPolyline } from './strip.js';
import { arcLengths, bearingOf, dist, sampleAt } from '../geometry.js';
import {
  FRONTAGE_JITTER, GAP_LOOSE_M, GAP_POP_HIGH, GAP_POP_LOW, GAP_TIGHT_M,
  GRADIENT_EXPONENT, GRADIENT_K,
} from '../constants.js';
import { lotId, type Green, type Lane, type Lot } from '../types.js';

export function gapForPopulation(population: number): number {
  const t = Math.min(1, Math.max(0, (population - GAP_POP_LOW) / (GAP_POP_HIGH - GAP_POP_LOW)));
  return GAP_LOOSE_M + (GAP_TIGHT_M - GAP_LOOSE_M) * t;
}

/** frontage(d) = f0 x (1 + k(d/R)^1.5). The whole density gradient. */
export function frontageAt(distanceM: number, builtRadiusM: number, f0: number): number {
  const ratio = builtRadiusM <= 0 ? 0 : Math.min(1.2, distanceM / builtRadiusM);
  return f0 * (1 + GRADIENT_K * Math.pow(ratio, GRADIENT_EXPONENT));
}

// Arc-length walking and sampling come from geometry.ts. This pass samples
// the same edge repeatedly, so it computes the cumulative walk once with
// arcLengths() and passes it to every sampleAt() call.

/**
 * Cut one lane's two frontage strips into lots. Ordinals count from the
 * green end, which is what makes a lot id survive a change further out.
 */
export function subdivideLane(
  lane: Lane, green: Green, builtRadiusM: number, f0: number, depthM: number,
  rng: SeededRandom,
): Lot[] {
  const lots: Lot[] = [];
  const setback = lane.widthM / 2 + 2;

  for (const side of [1, -1] as const) {
    const edge = offsetPolyline(lane.points, setback, side);
    if (edge.length < 2) continue;
    const edgeAcc = arcLengths(edge);
    const edgeTotal = edgeAcc[edgeAcc.length - 1];

    let s = 0;
    let ordinal = 0;
    while (s < edgeTotal) {
      const { p } = sampleAt(edge, edgeAcc, s);
      const d = dist(p, green.centre);
      const jitter = 1 + (rng.float() - 0.5) * 2 * FRONTAGE_JITTER;
      const frontage = Math.max(f0, frontageAt(d, builtRadiusM, f0) * jitter);
      if (s + frontage > edgeTotal) break;
      const mid = sampleAt(edge, edgeAcc, s + frontage / 2);
      // Inward normal: the lot faces back across the strip to its lane.
      const bearingDeg = (mid.dirDeg + (side === 1 ? -90 : 90) + 360) % 360;
      lots.push({
        id: lotId(lane.id, side, ordinal),
        laneId: lane.id,
        side,
        front: mid.p,
        bearingDeg,
        frontageM: frontage,
        depthM,
        score: 0,
      });
      s += frontage;
      ordinal++;
    }
  }
  return lots;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `nix develop --command bash -c "npx vitest run tests/village/lots-subdivide.test.ts"`
Expected: PASS, 10 tests

- [ ] **Step 5: Commit**

```bash
git add src/village/parcels/lots.ts tests/village/lots-subdivide.test.ts
git commit -m "feat(village): frontage gradient and lane subdivision into lots"
```

---

### Task 11: Green perimeter lots

**Files:**
- Modify: `src/village/parcels/lots.ts`
- Test: `tests/village/lots-green-ring.test.ts`

**Interfaces:**
- Consumes: `subdivideLane`, `gapForPopulation` (Task 10).
- Produces: `subdivideGreen(green: Green, f0: number, depthM: number, rng: SeededRandom): Lot[]`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/village/lots-green-ring.test.ts
import { describe, it, expect } from 'vitest';
import { Point } from '../../src/types/point.js';
import { SeededRandom } from '../../src/utils/random.js';
import { subdivideGreen } from '../../src/village/parcels/lots.js';
import type { Green } from '../../src/village/types.js';

const green: Green = {
  shape: 'sm-green-round', variant: 'a', centre: new Point(0, 0),
  diameter: 30, bearingDeg: 0,
};

describe('subdivideGreen', () => {
  it('rings the green with lots at the tightest frontage in the settlement', () => {
    const lots = subdivideGreen(green, 10, 22, new SeededRandom(1));
    expect(lots.length).toBeGreaterThan(3);
    for (const l of lots) expect(l.frontageM).toBeCloseTo(10, 0);
  });

  it('faces every ring lot inward at the green', () => {
    const lots = subdivideGreen(green, 10, 22, new SeededRandom(1));
    for (const l of lots) {
      // Bearing points from the lot back toward the centre.
      const toCentre = (Math.atan2(-l.front.x, l.front.y) * 180) / Math.PI;
      const want = (toCentre + 360) % 360;
      const diff = Math.abs(((l.bearingDeg - want + 540) % 360) - 180);
      expect(diff).toBeLessThan(15);
    }
  });

  it('places lots on the rim plus a setback, not inside the green', () => {
    const lots = subdivideGreen(green, 10, 22, new SeededRandom(1));
    for (const l of lots) {
      expect(Math.hypot(l.front.x, l.front.y)).toBeGreaterThan(green.diameter / 2);
    }
  });

  it('gives ring lots their own stable ids', () => {
    const lots = subdivideGreen(green, 10, 22, new SeededRandom(1));
    expect(lots[0].id).toBe('green:R0');
    expect(lots[1].id).toBe('green:R1');
    expect(new Set(lots.map((l) => l.id)).size).toBe(lots.length);
  });

  it('is deterministic for a seed', () => {
    const mk = () => subdivideGreen(green, 10, 22, new SeededRandom(9));
    expect(JSON.stringify(mk())).toBe(JSON.stringify(mk()));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nix develop --command bash -c "npx vitest run tests/village/lots-green-ring.test.ts"`
Expected: FAIL — `subdivideGreen` is not exported

- [ ] **Step 3: Write minimal implementation**

Add `RING_SETBACK_M` to the `../constants.js` import at the top of the file, then append
to `src/village/parcels/lots.ts`:

```ts
/**
 * The green's perimeter is frontage too — the most valuable in the
 * settlement, so it takes the tightest frontages. The ring of buildings
 * around the green is this subdivision, not a placement rule.
 */
export function subdivideGreen(
  green: Green, f0: number, depthM: number, rng: SeededRandom,
): Lot[] {
  const radius = green.diameter / 2 + RING_SETBACK_M;
  const circumference = 2 * Math.PI * radius;
  const count = Math.max(4, Math.floor(circumference / f0));
  const step = (Math.PI * 2) / count;
  // Rotate the ring by a seeded offset so two villages do not share a seam.
  const phase = rng.float() * step;

  const lots: Lot[] = [];
  for (let i = 0; i < count; i++) {
    const a = phase + i * step;
    const front = new Point(radius * Math.sin(a), -radius * Math.cos(a));
    // Face back at the centre.
      const bearingDeg = bearingOf(front, green.centre);
    lots.push({
      id: `green:R${i}`,
      laneId: 'green',
      side: 1,
      front,
      bearingDeg,
      frontageM: circumference / count,
      depthM,
      score: 0,
    });
  }
  return lots;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `nix develop --command bash -c "npx vitest run tests/village/lots-green-ring.test.ts"`
Expected: PASS, 5 tests

- [ ] **Step 5: Commit**

```bash
git add src/village/parcels/lots.ts tests/village/lots-green-ring.test.ts
git commit -m "feat(village): green perimeter subdivided into ring lots"
```

---

### Task 12: Clipping and lot scoring

**Files:**
- Modify: `src/village/parcels/lots.ts`
- Test: `tests/village/lots-clip-score.test.ts`

**Interfaces:**
- Consumes: `Lot`, `Green` (Task 3); `pointInPolygon`; `classRank` (Task 2).
- Produces: `clipLots(lots: Lot[], green: Green, water: Point[][]): Lot[]`, `scoreLots(lots: Lot[], green: Green, laneTypeById: Map<string, RouteType>): Lot[]`, `orderLots(lots: Lot[]): Lot[]`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/village/lots-clip-score.test.ts
import { describe, it, expect } from 'vitest';
import { Point } from '../../src/types/point.js';
import { clipLots, orderLots, scoreLots } from '../../src/village/parcels/lots.js';
import type { Green, Lot } from '../../src/village/types.js';
import type { RouteType } from '../../src/village/route-class.js';

const green: Green = {
  shape: 'sm-green-round', variant: 'a', centre: new Point(0, 0),
  diameter: 20, bearingDeg: 0,
};

const lot = (id: string, x: number, y: number, laneId = 'arm-090'): Lot => ({
  id, laneId, side: 1, front: new Point(x, y), bearingDeg: 0,
  frontageM: 10, depthM: 25, score: 0,
});

const pond = [[
  new Point(40, -10), new Point(60, -10), new Point(60, 10), new Point(40, 10),
]];

describe('clipLots', () => {
  it('drops a lot whose frontage is in water', () => {
    const out = clipLots([lot('a', 50, 0), lot('b', 100, 0)], green, pond);
    expect(out.map((l) => l.id)).toEqual(['b']);
  });

  it('drops a lot inside the green', () => {
    const out = clipLots([lot('a', 2, 0), lot('b', 100, 0)], green, []);
    expect(out.map((l) => l.id)).toEqual(['b']);
  });

  it('keeps everything else', () => {
    expect(clipLots([lot('a', 100, 0)], green, [])).toHaveLength(1);
  });
});

describe('scoreLots', () => {
  const types = new Map<string, RouteType>([['arm-090', 'main'], ['arm-180', 'footpath']]);

  it('scores lots near the green above lots at the fringe', () => {
    const [near, far] = scoreLots([lot('near', 20, 0), lot('far', 200, 0)], green, types);
    expect(near.score).toBeGreaterThan(far.score);
  });

  it('scores a lot on a main road above the same lot on a footpath', () => {
    const [onMain, onPath] = scoreLots(
      [lot('m', 60, 0, 'arm-090'), lot('p', 60, 0, 'arm-180')], green, types,
    );
    expect(onMain.score).toBeGreaterThan(onPath.score);
  });

  it('scores green ring lots highest of all', () => {
    const [ring, road] = scoreLots(
      [lot('g', 14, 0, 'green'), lot('r', 30, 0, 'arm-090')], green, types,
    );
    expect(ring.score).toBeGreaterThan(road.score);
  });
});

describe('orderLots', () => {
  it('sorts by score descending, breaking ties by id', () => {
    const a = { ...lot('b-id', 0, 0), score: 5 };
    const b = { ...lot('a-id', 0, 0), score: 5 };
    const c = { ...lot('c-id', 0, 0), score: 9 };
    expect(orderLots([a, b, c]).map((l) => l.id)).toEqual(['c-id', 'a-id', 'b-id']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nix develop --command bash -c "npx vitest run tests/village/lots-clip-score.test.ts"`
Expected: FAIL — `clipLots` is not exported

- [ ] **Step 3: Write minimal implementation**

Add `inAnyWater` to the `../geometry.js` import at the top of the file, then append to
`src/village/parcels/lots.ts`:

```ts
import { classRank, type RouteType } from '../route-class.js';

/** Water first, then the green. Anything left too narrow was never cut. */
export function clipLots(lots: Lot[], green: Green, water: Point[][]): Lot[] {
  const greenRadius = green.diameter / 2;
  return lots.filter((l) => {
    if (inAnyWater(l.front, water)) return false;
    const d = dist(l.front, green.centre);
    if (l.laneId !== 'green' && d < greenRadius) return false;
    return true;
  });
}

const SCORE_RING_BONUS = 40;

/**
 * Nearer the green is better; a higher lane class is better; the green's
 * own ring beats everything. Pass 4 fills the best first, so an
 * under-populated village fills inward-out and the fringe stays empty.
 */
export function scoreLots(
  lots: Lot[], green: Green, laneTypeById: Map<string, RouteType>,
): Lot[] {
  return lots.map((l) => {
    const d = dist(l.front, green.centre);
    const type = laneTypeById.get(l.laneId);
    const classBonus = type ? (7 - classRank(type)) * 3 : 0;
    const ring = l.laneId === 'green' ? SCORE_RING_BONUS : 0;
    return { ...l, score: 100 - d * 0.5 + classBonus + ring };
  });
}

/** Deterministic fill order: score descending, ties broken by id. */
export function orderLots(lots: Lot[]): Lot[] {
  return [...lots].sort((a, b) => (b.score - a.score) || a.id.localeCompare(b.id));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `nix develop --command bash -c "npx vitest run tests/village/lots-clip-score.test.ts"`
Expected: PASS, 7 tests

- [ ] **Step 5: Commit**

```bash
git add src/village/parcels/lots.ts tests/village/lots-clip-score.test.ts
git commit -m "feat(village): lot clipping, scoring and deterministic fill order"
```

---

### Task 13: The dwelling deck

**Files:**
- Create: `src/village/deck.ts`
- Test: `tests/village/deck.test.ts`

**Interfaces:**
- Consumes: `Site` (Task 3); `SYMBOL_MANIFEST` (`src/assets/symbol-manifest.js`).
- Produces: `interface DeckEntry`, `TEMPERATE_VILLAGE_DECK: DeckEntry[]`, `deckFor(biome: string): DeckEntry[]`, `meanOccupancy(deck: DeckEntry[]): number`, `eligible(entry: DeckEntry, site: Site, frontageM: number): boolean`, `drawEntry(deck: DeckEntry[], site: Site, frontageM: number, placed: Set<string>, rng: SeededRandom): DeckEntry | undefined`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/village/deck.test.ts
import { describe, it, expect } from 'vitest';
import { SeededRandom } from '../../src/utils/random.js';
import {
  TEMPERATE_VILLAGE_DECK, deckFor, drawEntry, eligible, meanOccupancy,
} from '../../src/village/deck.js';
import type { Site } from '../../src/village/types.js';

const site = (over: Partial<Site> = {}): Site => ({
  population: 300, biome: 'temperate', routes: [], water: [],
  flags: { port: false, temple: false, trade: false, walls: false },
  ...over,
});

describe('deck contents', () => {
  it('has a house as its commonest entry', () => {
    const top = [...TEMPERATE_VILLAGE_DECK].sort((a, b) => b.weight - a.weight)[0];
    expect(top.glyph).toBe('sm-house');
  });

  it('carries occupancy on every entry', () => {
    for (const e of TEMPERATE_VILLAGE_DECK) expect(e.occupancy).toBeGreaterThanOrEqual(0);
  });

  it('resolves biome suffixes with a temperate fallback', () => {
    expect(deckFor('tundra').some((e) => e.glyph === 'sm-house--tundra')).toBe(true);
    // sm-house-tiled has no tundra variant, so the temperate id survives.
    expect(deckFor('tundra').some((e) => e.glyph === 'sm-house-tiled')).toBe(true);
  });

  it('averages occupancy for the built-radius prediction', () => {
    expect(meanOccupancy(TEMPERATE_VILLAGE_DECK)).toBeGreaterThan(3);
    expect(meanOccupancy(TEMPERATE_VILLAGE_DECK)).toBeLessThan(8);
  });
});

describe('eligible', () => {
  const inn = TEMPERATE_VILLAGE_DECK.find((e) => e.glyph === 'sm-inn')!;

  it('gates the inn on population', () => {
    expect(eligible(inn, site({ population: 100 }), 30)).toBe(false);
    expect(eligible(inn, site({ population: 400 }), 30)).toBe(true);
  });

  it('rejects an entry that will not fit the frontage', () => {
    const longhouse = TEMPERATE_VILLAGE_DECK.find((e) => e.glyph === 'sm-longhouse')!;
    expect(eligible(longhouse, site(), 6)).toBe(false);
    expect(eligible(longhouse, site(), 30)).toBe(true);
  });
});

describe('drawEntry', () => {
  it('never draws a capped entry twice', () => {
    const placed = new Set<string>(['sm-inn']);
    for (let i = 0; i < 50; i++) {
      const e = drawEntry(TEMPERATE_VILLAGE_DECK, site({ population: 400 }), 40, placed,
        new SeededRandom(i + 1));
      expect(e?.glyph).not.toBe('sm-inn');
    }
  });

  it('returns undefined when nothing fits the lot', () => {
    expect(drawEntry(TEMPERATE_VILLAGE_DECK, site(), 1, new Set(), new SeededRandom(1)))
      .toBeUndefined();
  });

  it('is deterministic for a seed', () => {
    const a = drawEntry(TEMPERATE_VILLAGE_DECK, site(), 20, new Set(), new SeededRandom(3));
    const b = drawEntry(TEMPERATE_VILLAGE_DECK, site(), 20, new Set(), new SeededRandom(3));
    expect(a?.glyph).toBe(b?.glyph);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nix develop --command bash -c "npx vitest run tests/village/deck.test.ts"`
Expected: FAIL — cannot find module `src/village/deck.js`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/village/deck.ts
import { SeededRandom } from '../utils/random.js';
import { hasGlyph, nominalFootprint } from './glyphs.js';
import { DECK_GAP_M } from './constants.js';
import type { Site } from './types.js';

export interface DeckEntry {
  glyph: string;
  /** People per dwelling. 0 for non-residential landmarks. */
  occupancy: number;
  /** Relative frequency among uncapped entries. */
  weight: number;
  /** Semantic size multiplier — scales footprint AND occupancy. */
  sizeFactor: number;
  /** Metres. Defaults to the glyph's footprint width plus a gap. */
  minFrontage: number;
  /** Capped entries are placed once, before the ordinary draw. */
  cap?: 'one';
  requires?: { minPop?: number; flag?: 'temple' | 'trade' | 'port' };
}

// Footprints come from glyphs.ts — this module never touches the manifest.

function entry(
  glyph: string, occupancy: number, weight: number,
  extra: Partial<DeckEntry> = {},
): DeckEntry {
  return {
    glyph,
    occupancy,
    weight,
    sizeFactor: extra.sizeFactor ?? 1,
    minFrontage: extra.minFrontage
      ?? nominalFootprint(glyph)[0] * (extra.sizeFactor ?? 1) + DECK_GAP_M,
    cap: extra.cap,
    requires: extra.requires,
  };
}

export const TEMPERATE_VILLAGE_DECK: DeckEntry[] = [
  entry('sm-house', 5, 60),
  entry('sm-hut-straw', 3, 20),
  entry('sm-house-tiled', 5, 12),
  entry('sm-longhouse', 12, 6),
  entry('sm-house-large-tiled', 6, 0, { cap: 'one', requires: { minPop: 250 } }),
  entry('sm-inn', 6, 0, { cap: 'one', sizeFactor: 1.5, requires: { minPop: 180 } }),
  entry('sm-chapel', 0, 0, { cap: 'one', requires: { minPop: 300 } }),
];

const BIOME_SUFFIX: Record<string, string> = {
  temperate: '', desert: '--desert', tundra: '--tundra',
  tropical: '--tropical', coastal: '--coastal',
};

// Whether a suffixed id exists is a manifest question, so glyphs.ts answers
// it. Biome sets are deliberately partial; the temperate id survives when
// the variant was never drawn.

/**
 * A deck is per biome, which is what stops a settlement mixing biome sets:
 * the ids are resolved once, here, with the manifest's temperate fallback.
 */
export function deckFor(biome: string): DeckEntry[] {
  const suffix = BIOME_SUFFIX[biome] ?? '';
  if (suffix === '') return TEMPERATE_VILLAGE_DECK;
  return TEMPERATE_VILLAGE_DECK.map((e) => {
    const suffixed = `${e.glyph}${suffix}`;
    return hasGlyph(suffixed) ? { ...e, glyph: suffixed } : e;
  });
}

/** Weighted mean occupancy over the uncapped entries. */
export function meanOccupancy(deck: DeckEntry[]): number {
  const pool = deck.filter((e) => !e.cap);
  const total = pool.reduce((s, e) => s + e.weight, 0);
  if (total === 0) return 5;
  return pool.reduce((s, e) => s + e.occupancy * e.weight, 0) / total;
}

export function eligible(entryValue: DeckEntry, site: Site, frontageM: number): boolean {
  if (frontageM < entryValue.minFrontage) return false;
  const req = entryValue.requires;
  if (!req) return true;
  if (req.minPop !== undefined && site.population < req.minPop) return false;
  if (req.flag !== undefined && !site.flags[req.flag]) return false;
  return true;
}

/**
 * Draw one ordinary entry. A capped entry leaves the pool once placed, and
 * an entry whose `requires` is unmet never enters it.
 */
export function drawEntry(
  deck: DeckEntry[], site: Site, frontageM: number,
  placed: Set<string>, rng: SeededRandom,
): DeckEntry | undefined {
  const pool = deck.filter((e) =>
    !e.cap && e.weight > 0 && !placed.has(e.glyph) && eligible(e, site, frontageM));
  const total = pool.reduce((s, e) => s + e.weight, 0);
  if (total === 0) return undefined;
  let roll = rng.float() * total;
  for (const e of pool) {
    roll -= e.weight;
    if (roll <= 0) return e;
  }
  return pool[pool.length - 1];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `nix develop --command bash -c "npx vitest run tests/village/deck.test.ts"`
Expected: PASS, 9 tests

- [ ] **Step 5: Commit**

```bash
git add src/village/deck.ts tests/village/deck.test.ts
git commit -m "feat(village): dwelling deck with occupancy, caps and biome resolution"
```

---

### Task 14: Seating and sizing a dwelling

**Files:**
- Create: `src/village/dwellings.ts`
- Test: `tests/village/seating.test.ts`

**Interfaces:**
- Consumes: `DeckEntry` (Task 13); `Lot`, `Building`, `buildingId` (Task 3); `SYMBOL_MANIFEST`; `inkFootprint` (`src/generator/village-rows.js`).
- Produces: `SIZE_JITTER`, `FIT_MIN`, `FIT_MAX`, `sizeFor(entry: DeckEntry, lot: Lot, rng: SeededRandom): [number, number]`, `seat(entry: DeckEntry, lot: Lot, rng: SeededRandom): Building`, `inkExtentOf(glyph: string, footprint: [number, number]): { width: number; depth: number }`, `overlaps(a: Building, b: Building): boolean`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/village/seating.test.ts
import { describe, it, expect } from 'vitest';
import { Point } from '../../src/types/point.js';
import { SeededRandom } from '../../src/utils/random.js';
import { overlaps, seat, sizeFor } from '../../src/village/dwellings.js';
import { FIT_MAX, FIT_MIN } from '../../src/village/constants.js';
import { TEMPERATE_VILLAGE_DECK } from '../../src/village/deck.js';
import type { Lot } from '../../src/village/types.js';

const house = TEMPERATE_VILLAGE_DECK.find((e) => e.glyph === 'sm-house')!;
const inn = TEMPERATE_VILLAGE_DECK.find((e) => e.glyph === 'sm-inn')!;

const lot = (frontageM: number, x = 0, y = 0, bearingDeg = 0): Lot => ({
  id: `arm-090:R0`, laneId: 'arm-090', side: 1, front: new Point(x, y),
  bearingDeg, frontageM, depthM: 25, score: 0,
});

describe('sizeFor', () => {
  it('keeps a house near its nominal footprint on a normal lot', () => {
    const [w] = sizeFor(house, lot(12), new SeededRandom(1));
    expect(w).toBeGreaterThan(8 * 0.85);
    expect(w).toBeLessThan(8 * 1.25);
  });

  it('makes the inn semantically bigger via sizeFactor', () => {
    const [innW] = sizeFor(inn, lot(30), new SeededRandom(1));
    const [houseW] = sizeFor(house, lot(30), new SeededRandom(1));
    expect(innW).toBeGreaterThan(houseW);
  });

  it('never leaves the total bound of 0.85-1.65x nominal', () => {
    for (let s = 1; s < 40; s++) {
      const [w] = sizeFor(house, lot(40), new SeededRandom(s));
      expect(w).toBeGreaterThanOrEqual(8 * FIT_MIN * 0.9 - 1e-9);
      expect(w).toBeLessThanOrEqual(8 * 1.65 + 1e-9);
    }
  });

  it('grows into a generous fringe lot and shrinks into a tight one', () => {
    const wide = sizeFor(house, lot(40), new SeededRandom(4))[0];
    const tight = sizeFor(house, lot(9), new SeededRandom(4))[0];
    expect(wide).toBeGreaterThan(tight);
    expect(FIT_MAX).toBe(1.15);
  });
});

describe('seat', () => {
  it('faces the dwelling the way its lot faces', () => {
    const b = seat(house, lot(12, 10, 0, 270), new SeededRandom(1));
    expect(b.bearingDeg).toBeCloseTo(270, 5);
  });

  it('derives the building id from the lot id', () => {
    expect(seat(house, lot(12), new SeededRandom(1)).id).toBe('bld:arm-090:R0');
  });

  it('carries occupancy scaled by sizeFactor', () => {
    expect(seat(inn, lot(30), new SeededRandom(1)).occupancy).toBe(Math.round(6 * 1.5));
  });

  it('is deterministic for a seed', () => {
    const mk = () => seat(house, lot(12), new SeededRandom(8));
    expect(JSON.stringify(mk())).toBe(JSON.stringify(mk()));
  });
});

describe('overlaps', () => {
  it('uses ink extents, so glyphs may share their transparent margins', () => {
    const a = seat(house, lot(12, 0, 0), new SeededRandom(1));
    const b = seat(house, lot(12, 6.5, 0), new SeededRandom(1));
    // 6.5 m apart: art boxes (8 m) overlap, ink extents (8 x 0.68 = 5.44) do not.
    expect(overlaps(a, b)).toBe(false);
  });

  it('rejects a genuine collision', () => {
    const a = seat(house, lot(12, 0, 0), new SeededRandom(1));
    const b = seat(house, lot(12, 1, 0), new SeededRandom(1));
    expect(overlaps(a, b)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nix develop --command bash -c "npx vitest run tests/village/seating.test.ts"`
Expected: FAIL — cannot find module `src/village/dwellings.js`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/village/dwellings.ts
import { Point } from '../types/point.js';
import { SeededRandom } from '../utils/random.js';
import { dist } from './geometry.js';
import { inkExtent, nominalFootprint } from './glyphs.js';
import {
  FIT_MAX, FIT_MIN, SEATING_SETBACK_MAX_M, SIZE_JITTER,
} from './constants.js';
import { buildingId, type Building, type Lot } from './types.js';
import type { DeckEntry } from './deck.js';

/**
 * Three multipliers, deliberately separate: sizeFactor is semantic (an inn
 * is bigger because an inn is bigger), jitter is aesthetic, fit is
 * practical. Total bound 0.85-1.65x nominal. `minScale` in the manifest is
 * a legibility floor and is NOT one of these.
 */
export function sizeFor(
  entry: DeckEntry, lot: Lot, rng: SeededRandom,
): [number, number] {
  const [w, d] = nominalFootprint(entry.glyph);
  const semantic = entry.sizeFactor;
  const jitter = 1 + (rng.float() - 0.5) * 2 * SIZE_JITTER;
  // How much of the lot's frontage the nominal building leaves spare.
  const room = lot.frontageM / (w * semantic);
  const fit = Math.min(FIT_MAX, Math.max(FIT_MIN, room > 1.6 ? FIT_MAX : Math.min(1, room)));
  const k = semantic * jitter * fit;
  return [w * k, d * k];
}

/** Seat a dwelling at the front of its lot, facing the way the lot faces. */
export function seat(entry: DeckEntry, lot: Lot, rng: SeededRandom): Building {
  const footprint = sizeFor(entry, lot, rng);
  // Set back 0-1.5 m from the frontage, along the lot's facing direction.
  const setback = rng.float() * SEATING_SETBACK_MAX_M;
  const r = (lot.bearingDeg * Math.PI) / 180;
  const inward = new Point(-Math.sin(r), Math.cos(r));
  return {
    id: buildingId(lot.id),
    lotId: lot.id,
    glyph: entry.glyph,
    position: new Point(
      lot.front.x + inward.x * (setback + footprint[1] / 2),
      lot.front.y + inward.y * (setback + footprint[1] / 2),
    ),
    bearingDeg: lot.bearingDeg,
    footprint,
    occupancy: Math.round(entry.occupancy * entry.sizeFactor),
  };
}

/**
 * Ink extents, not art boxes. Several glyphs deliberately overhang their
 * footprint, and integration.md forbids clipping to it.
 */
export function overlaps(a: Building, b: Building): boolean {
  const ea = inkExtent(a.glyph, a.footprint);
  const eb = inkExtent(b.glyph, b.footprint);
  const ra = Math.max(ea.width, ea.depth) / 2;
  const rb = Math.max(eb.width, eb.depth) / 2;
  return dist(a.position, b.position) < ra + rb;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `nix develop --command bash -c "npx vitest run tests/village/seating.test.ts"`
Expected: PASS, 10 tests

- [ ] **Step 5: Commit**

```bash
git add src/village/dwellings.ts tests/village/seating.test.ts
git commit -m "feat(village): dwelling seating with semantic, jitter and fit sizing"
```

---

### Task 15: Spending the census

**Files:**
- Modify: `src/village/dwellings.ts`
- Test: `tests/village/spend-census.test.ts`

**Interfaces:**
- Consumes: `seat`, `overlaps` (Task 14); `drawEntry`, `eligible`, `DeckEntry` (Task 13); `orderLots` (Task 12).
- Produces: `spendCensus(lots: Lot[], deck: DeckEntry[], site: Site, rng: SeededRandom): { buildings: Building[]; housed: number; unhoused: number }`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/village/spend-census.test.ts
import { describe, it, expect } from 'vitest';
import { Point } from '../../src/types/point.js';
import { SeededRandom } from '../../src/utils/random.js';
import { spendCensus } from '../../src/village/dwellings.js';
import { TEMPERATE_VILLAGE_DECK } from '../../src/village/deck.js';
import type { Lot, Site } from '../../src/village/types.js';

const site = (population: number): Site => ({
  population, biome: 'temperate', routes: [], water: [],
  flags: { port: false, temple: false, trade: false, walls: false },
});

// A line of well-separated lots, best-scoring first.
const lots = (n: number): Lot[] => Array.from({ length: n }, (_, i) => ({
  id: `arm-090:R${i}`, laneId: i === 0 ? 'green' : 'arm-090', side: 1 as const,
  front: new Point(i * 20, 0), bearingDeg: 0, frontageM: 18, depthM: 25,
  score: 100 - i,
}));

describe('spendCensus', () => {
  it('houses the census and then stops', () => {
    const out = spendCensus(lots(60), TEMPERATE_VILLAGE_DECK, site(100), new SeededRandom(1));
    expect(out.housed).toBeGreaterThanOrEqual(100);
    expect(out.unhoused).toBe(0);
    expect(out.buildings.length).toBeLessThan(60);
  });

  it('leaves the worst-scoring lots empty — that is the straggle', () => {
    const out = spendCensus(lots(60), TEMPERATE_VILLAGE_DECK, site(60), new SeededRandom(1));
    const used = new Set(out.buildings.map((b) => b.lotId));
    expect(used.has('arm-090:R0')).toBe(true);
    expect(used.has('arm-090:R59')).toBe(false);
  });

  it('places capped landmarks first, on the best lots', () => {
    const out = spendCensus(lots(60), TEMPERATE_VILLAGE_DECK, site(400), new SeededRandom(1));
    const inn = out.buildings.find((b) => b.glyph === 'sm-inn');
    expect(inn).toBeDefined();
    expect(inn!.lotId).toBe('arm-090:R0');
    expect(out.buildings.filter((b) => b.glyph === 'sm-inn')).toHaveLength(1);
  });

  it('reports what it could not house when it runs out of lots', () => {
    const out = spendCensus(lots(3), TEMPERATE_VILLAGE_DECK, site(900), new SeededRandom(1));
    expect(out.unhoused).toBeGreaterThan(0);
  });

  it('never places two buildings that overlap', () => {
    const out = spendCensus(lots(40), TEMPERATE_VILLAGE_DECK, site(200), new SeededRandom(2));
    for (let i = 0; i < out.buildings.length; i++) {
      for (let j = i + 1; j < out.buildings.length; j++) {
        const a = out.buildings[i];
        const b = out.buildings[j];
        const d = Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y);
        expect(d).toBeGreaterThan(0);
      }
    }
  });

  it('is deterministic for a seed', () => {
    const mk = () => spendCensus(lots(40), TEMPERATE_VILLAGE_DECK, site(200), new SeededRandom(6));
    expect(JSON.stringify(mk())).toBe(JSON.stringify(mk()));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nix develop --command bash -c "npx vitest run tests/village/spend-census.test.ts"`
Expected: FAIL — `spendCensus` is not exported

- [ ] **Step 3: Write minimal implementation**

Append to `src/village/dwellings.ts`:

```ts
import { orderLots } from './parcels/lots.js';
import { drawEntry, eligible, type DeckEntry } from './deck.js';
import type { Site } from './types.js';

export interface SpendResult {
  buildings: Building[];
  housed: number;
  unhoused: number;
}

/**
 * Capped landmarks first, onto the best lots they are eligible for; then
 * ordinary entries down the score order until the census is housed.
 * Remaining lots stay empty — that absence is the straggle.
 */
export function spendCensus(
  lots: Lot[], deck: DeckEntry[], site: Site, rng: SeededRandom,
): SpendResult {
  const ordered = orderLots(lots);
  const taken = new Set<string>();
  const placedGlyphs = new Set<string>();
  const buildings: Building[] = [];
  let housed = 0;

  for (const capped of deck.filter((e) => e.cap === 'one')) {
    const lot = ordered.find((l) => !taken.has(l.id) && eligible(capped, site, l.frontageM));
    if (!lot) continue;
    const b = seat(capped, lot, rng);
    if (buildings.some((other) => overlaps(b, other))) continue;
    buildings.push(b);
    taken.add(lot.id);
    placedGlyphs.add(capped.glyph);
    housed += b.occupancy;
  }

  for (const lot of ordered) {
    if (housed >= site.population) break;
    if (taken.has(lot.id)) continue;
    const entry = drawEntry(deck, site, lot.frontageM, placedGlyphs, rng);
    if (!entry) continue;
    const b = seat(entry, lot, rng);
    if (buildings.some((other) => overlaps(b, other))) continue;
    buildings.push(b);
    taken.add(lot.id);
    housed += b.occupancy;
  }

  return { buildings, housed, unhoused: Math.max(0, site.population - housed) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `nix develop --command bash -c "npx vitest run tests/village/spend-census.test.ts"`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
git add src/village/dwellings.ts tests/village/spend-census.test.ts
git commit -m "feat(village): spend the census across scored lots"
```

---

### Task 16: Lane relaxation and tail trimming

**Files:**
- Create: `src/village/skeleton/relax.ts`
- Test: `tests/village/relax.test.ts`

**Interfaces:**
- Consumes: `Lane`, `Building` (Task 3); `inkExtentOf` (Task 14).
- Produces: `relaxLanes(lanes: Lane[], buildings: Building[]): Lane[]`, `trimTails(lanes: Lane[], buildings: Building[]): Lane[]`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/village/relax.test.ts
import { describe, it, expect } from 'vitest';
import { Point } from '../../src/types/point.js';
import { relaxLanes, trimTails } from '../../src/village/skeleton/relax.js';
import type { Building, Lane } from '../../src/village/types.js';

const lane = (): Lane => ({
  id: 'arm-090', type: 'main', widthM: 5,
  points: [new Point(0, 0), new Point(20, 0), new Point(40, 0), new Point(60, 0)],
});

const building = (x: number, y: number, id = 'bld:a'): Building => ({
  id, lotId: 'arm-090:R0', glyph: 'sm-house', position: new Point(x, y),
  bearingDeg: 0, footprint: [8, 6.6], occupancy: 5,
});

describe('relaxLanes', () => {
  it('pushes the lane off a building that sits on it', () => {
    const out = relaxLanes([lane()], [building(20, 0.5)]);
    const moved = out[0].points[1];
    expect(Math.abs(moved.y)).toBeGreaterThan(0.5);
  });

  it('leaves a clear lane alone', () => {
    const before = lane();
    const out = relaxLanes([before], [building(20, 40)]);
    expect(out[0].points.map((p) => [p.x, p.y]))
      .toEqual(before.points.map((p) => [p.x, p.y]));
  });

  it('never moves a point more than 1.5 m', () => {
    const before = lane();
    const out = relaxLanes([before], [building(20, 0.1)]);
    const d = Math.hypot(
      out[0].points[1].x - before.points[1].x,
      out[0].points[1].y - before.points[1].y,
    );
    expect(d).toBeLessThanOrEqual(1.5 + 1e-9);
  });

  it('is a pure function of its inputs', () => {
    const input = [lane()];
    const a = relaxLanes(input, [building(20, 0.5)]);
    const b = relaxLanes(input, [building(20, 0.5)]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('trimTails', () => {
  it('cuts a lane back to its last building plus a stub', () => {
    const out = trimTails([lane()], [building(20, 6)]);
    const end = out[0].points[out[0].points.length - 1];
    expect(end.x).toBeLessThan(50);
    expect(end.x).toBeGreaterThanOrEqual(20);
  });

  it('leaves a fully built lane alone', () => {
    const before = lane();
    const out = trimTails([before], [building(58, 6)]);
    expect(out[0].points).toHaveLength(before.points.length);
  });

  it('keeps at least two points, so a lane never degenerates', () => {
    const out = trimTails([lane()], []);
    expect(out[0].points.length).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nix develop --command bash -c "npx vitest run tests/village/relax.test.ts"`
Expected: FAIL — cannot find module `src/village/skeleton/relax.js`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/village/skeleton/relax.ts
import { Point } from '../../types/point.js';
import { dist } from '../geometry.js';
import { inkExtent } from '../glyphs.js';
import {
  RELAX_CLEARANCE_M, RELAX_ITERATIONS, RELAX_MAX_DISPLACEMENT_M, TAIL_STUB_M,
} from '../constants.js';
import type { Building, Lane } from '../types.js';

/**
 * Lanes bend around the houses they acquired. Bounded at three iterations
 * and 1.5 m so determinism holds and nothing wanders.
 */
export function relaxLanes(lanes: Lane[], buildings: Building[]): Lane[] {
  return lanes.map((lane) => {
    const points = lane.points.map((p) => new Point(p.x, p.y));
    const origin = lane.points.map((p) => new Point(p.x, p.y));
    for (let iter = 0; iter < RELAX_ITERATIONS; iter++) {
      for (let i = 0; i < points.length; i++) {
        for (const b of buildings) {
          const ink = inkExtent(b.glyph, b.footprint);
          const keepOut =
            lane.widthM / 2 + RELAX_CLEARANCE_M + Math.max(ink.width, ink.depth) / 2;
          const dx = points[i].x - b.position.x;
          const dy = points[i].y - b.position.y;
          const d = Math.hypot(dx, dy);
          if (d >= keepOut || d === 0) continue;
          const push = (keepOut - d) / RELAX_ITERATIONS;
          points[i] = new Point(points[i].x + (dx / d) * push, points[i].y + (dy / d) * push);
        }
      }
    }
    // Clamp total displacement.
    for (let i = 0; i < points.length; i++) {
      const dx = points[i].x - origin[i].x;
      const dy = points[i].y - origin[i].y;
      const d = Math.hypot(dx, dy);
      if (d > RELAX_MAX_DISPLACEMENT_M) {
        points[i] = new Point(
          origin[i].x + (dx / d) * RELAX_MAX_DISPLACEMENT_M,
          origin[i].y + (dy / d) * RELAX_MAX_DISPLACEMENT_M,
        );
      }
    }
    return { ...lane, points };
  });
}

/**
 * A lane tail that acquired no dwelling is cut back to the last building
 * plus a stub. That trimming is the straggle at the edge of the fabric.
 */
export function trimTails(lanes: Lane[], buildings: Building[]): Lane[] {
  return lanes.map((lane) => {
    const mine = buildings.filter((b) => b.lotId.startsWith(`${lane.id}:`));
    if (mine.length === 0) return lane;
    const furthest = mine.reduce((best, b) => {
      const d = dist(b.position, lane.points[0]);
      return d > best ? d : best;
    }, 0);
    const keep: Point[] = [];
    for (const p of lane.points) {
      keep.push(p);
      const d = dist(p, lane.points[0]);
      if (d > furthest + TAIL_STUB_M) break;
    }
    while (keep.length < 2 && lane.points.length >= 2) keep.push(lane.points[keep.length]);
    return { ...lane, points: keep };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `nix develop --command bash -c "npx vitest run tests/village/relax.test.ts"`
Expected: PASS, 7 tests

- [ ] **Step 5: Commit**

```bash
git add src/village/skeleton/relax.ts tests/village/relax.test.ts
git commit -m "feat(village): lane relaxation around buildings and tail trimming"
```

---

### Task 17: Orchestrator with the frontage feedback loop

**Files:**
- Create: `src/village/village-model.ts`
- Test: `tests/village/village-model.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 4–16.
- Produces: `generateVillage(input: AzgaarBurgInput, seed: number): VillageModel`, `VILLAGE_POP_CEILING`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/village/village-model.test.ts
import { describe, it, expect } from 'vitest';
import { generateVillage, VILLAGE_POP_CEILING } from '../../src/village/village-model.js';
import type { AzgaarBurgInput } from '../../src/input/azgaar-input.js';

const base: AzgaarBurgInput = {
  name: 'Wick', population: 300, port: false, citadel: false, walls: false,
  plaza: false, temple: false, shanty: false, capital: false,
  roadBearings: [{ bearing_deg: 225, kind: 'road' }],
};

describe('generateVillage', () => {
  it('produces a green, lanes, lots and buildings', () => {
    const m = generateVillage(base, 1);
    expect(m.green.shape).toBe('sm-green-round');
    expect(m.lanes.length).toBeGreaterThan(0);
    expect(m.lots.length).toBeGreaterThan(0);
    expect(m.buildings.length).toBeGreaterThan(0);
  });

  it('houses the census', () => {
    const m = generateVillage(base, 1);
    const housed = m.buildings.reduce((s, b) => s + b.occupancy, 0);
    expect(housed).toBeGreaterThanOrEqual(base.population * 0.9);
  });

  it('is deterministic: same seed, identical model', () => {
    expect(JSON.stringify(generateVillage(base, 7)))
      .toBe(JSON.stringify(generateVillage(base, 7)));
  });

  it('differs between seeds', () => {
    expect(JSON.stringify(generateVillage(base, 7)))
      .not.toBe(JSON.stringify(generateVillage(base, 8)));
  });

  it('gives a bigger village more buildings than a hamlet', () => {
    const hamlet = generateVillage({ ...base, population: 60 }, 3);
    const village = generateVillage({ ...base, population: 600 }, 3);
    expect(village.buildings.length).toBeGreaterThan(hamlet.buildings.length);
  });

  it('records a diagnostic rather than throwing when the census cannot be housed', () => {
    const m = generateVillage({ ...base, population: 999 }, 4);
    expect(Array.isArray(m.diagnostics)).toBe(true);
  });

  it('never places a building inside the green', () => {
    const m = generateVillage(base, 5);
    for (const b of m.buildings) {
      const d = Math.hypot(b.position.x - m.green.centre.x, b.position.y - m.green.centre.y);
      expect(d).toBeGreaterThan(m.green.diameter / 2);
    }
  });

  it('declares the population band it serves', () => {
    expect(VILLAGE_POP_CEILING).toBe(1000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nix develop --command bash -c "npx vitest run tests/village/village-model.test.ts"`
Expected: FAIL — cannot find module `src/village/village-model.js`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/village/village-model.ts
import { SeededRandom } from '../utils/random.js';
import type { AzgaarBurgInput } from '../input/azgaar-input.js';
import { buildSite } from './site.js';
import { predictedBuiltRadius, siteGreen } from './skeleton/green-siting.js';
import {
  addInventedLanes, availableFrontage, buildArms, requiredFrontage,
} from './skeleton/lanes.js';
import { relaxLanes, trimTails } from './skeleton/relax.js';
import {
  clipLots, gapForPopulation, orderLots, scoreLots, subdivideGreen, subdivideLane,
} from './parcels/lots.js';
import { deckFor, meanOccupancy } from './deck.js';
import { spendCensus, type SpendResult } from './dwellings.js';
import {
  GAP_TIGHTEN, LOT_DEPTH_M, MAX_FEEDBACK_ROUNDS, MEAN_LOT_AREA_M2,
} from './constants.js';
import type { Lot, VillageModel } from './types.js';
import type { RouteType } from './route-class.js';

/** The band this engine serves. Above it, the existing engine runs. */
export const VILLAGE_POP_CEILING = 1000;

// Every tunable below comes from constants.ts. VILLAGE_POP_CEILING lives
// here because it is a routing decision, not a value a gate would tune.

export function generateVillage(input: AzgaarBurgInput, seed: number): VillageModel {
  const rng = new SeededRandom(seed);
  const site = buildSite(input);
  const diagnostics: string[] = [];

  const deck = deckFor(site.biome);
  const occupancy = meanOccupancy(deck);
  const builtRadius = predictedBuiltRadius(site.population, occupancy, MEAN_LOT_AREA_M2);
  const green = siteGreen(site, builtRadius, rng);

  let f0 = 8 + gapForPopulation(site.population);
  let lanes = buildArms(site, green, builtRadius * 2, rng);
  let lots: Lot[] = [];
  // Annotated, not inferred: an empty literal would infer `never[]`.
  let spend: SpendResult = { buildings: [], housed: 0, unhoused: site.population };

  for (let round = 0; round <= MAX_FEEDBACK_ROUNDS; round++) {
    const required = requiredFrontage(site.population, occupancy, f0 * 1.8);
    lanes = addInventedLanes(lanes, green, required, builtRadius * 2, rng);

    const laneTypes = new Map<string, RouteType>(lanes.map((l) => [l.id, l.type]));
    laneTypes.set('green', 'main');

    lots = [
      ...subdivideGreen(green, f0, LOT_DEPTH_M, rng),
      ...lanes.flatMap((l) => subdivideLane(l, green, builtRadius, f0, LOT_DEPTH_M, rng)),
    ];
    lots = orderLots(scoreLots(clipLots(lots, green, site.water), green, laneTypes));

    spend = spendCensus(lots, deck, site, rng);
    if (spend.unhoused === 0) break;

    if (round === MAX_FEEDBACK_ROUNDS) {
      diagnostics.push(
        `overflow: ${spend.unhoused} of ${site.population} unhoused after ` +
        `${MAX_FEEDBACK_ROUNDS} rounds (available frontage ` +
        `${Math.round(availableFrontage(lanes))} m)`,
      );
      break;
    }
    // Not enough room: tighten the gap and re-cut.
    f0 = 8 + gapForPopulation(site.population) * GAP_TIGHTEN;
  }

  const relaxed = trimTails(relaxLanes(lanes, spend.buildings), spend.buildings);

  return { site, green, lanes: relaxed, lots, buildings: spend.buildings, diagnostics };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `nix develop --command bash -c "npx vitest run tests/village/village-model.test.ts"`
Expected: PASS, 8 tests

- [ ] **Step 5: Commit**

```bash
git add src/village/village-model.ts tests/village/village-model.test.ts
git commit -m "feat(village): orchestrate passes 1-4 with the frontage feedback loop"
```

---

### Task 18: Property invariants across seeds

**Files:**
- Test: `tests/village/invariants.test.ts`

**Interfaces:**
- Consumes: `generateVillage` (Task 17).
- Produces: nothing — this task is pure regression cover for the design's §5.7.

- [ ] **Step 1: Write the failing test**

```ts
// tests/village/invariants.test.ts
import { describe, it, expect } from 'vitest';
import { generateVillage } from '../../src/village/village-model.js';
import { overlaps } from '../../src/village/dwellings.js';
import { pointInPolygon } from '../../src/geom/point-in-polygon.js';
import { Point } from '../../src/types/point.js';
import type { AzgaarBurgInput } from '../../src/input/azgaar-input.js';

const water = [[{ x: 60, y: -200 }, { x: 400, y: -200 }, { x: 400, y: 400 }, { x: 60, y: 400 }]];

const inputs: AzgaarBurgInput[] = [
  { name: 'A', population: 80, port: false, citadel: false, walls: false, plaza: false,
    temple: false, shanty: false, capital: false, roadBearings: [225] },
  { name: 'B', population: 450, port: false, citadel: false, walls: false, plaza: false,
    temple: false, shanty: false, capital: false,
    roadBearings: [{ bearing_deg: 90, kind: 'road', through: true }] },
  { name: 'C', population: 900, port: true, citadel: false, walls: false, plaza: false,
    temple: true, shanty: false, capital: false,
    roadBearings: [{ bearing_deg: 0, kind: 'road' }, { bearing_deg: 140, kind: 'foot' }],
    coastlineGeometry: water },
];

describe('village invariants (design §5.7)', () => {
  const seeds = [1, 2, 3, 4, 5, 6, 7, 8];

  it('never puts a lot in water', () => {
    for (const input of inputs) {
      for (const seed of seeds) {
        const m = generateVillage(input, seed);
        for (const lot of m.lots) {
          for (const ring of m.site.water) {
            expect(pointInPolygon(lot.front, ring)).toBe(false);
          }
        }
      }
    }
  });

  it('never overlaps two buildings', () => {
    for (const input of inputs) {
      for (const seed of seeds) {
        const bs = generateVillage(input, seed).buildings;
        for (let i = 0; i < bs.length; i++) {
          for (let j = i + 1; j < bs.length; j++) {
            expect(overlaps(bs[i], bs[j])).toBe(false);
          }
        }
      }
    }
  });

  it('gives every lot a unique stable id', () => {
    for (const input of inputs) {
      for (const seed of seeds) {
        const m = generateVillage(input, seed);
        expect(new Set(m.lots.map((l) => l.id)).size).toBe(m.lots.length);
      }
    }
  });

  it('anchors every building to a lot that exists', () => {
    for (const input of inputs) {
      for (const seed of seeds) {
        const m = generateVillage(input, seed);
        const ids = new Set(m.lots.map((l) => l.id));
        for (const b of m.buildings) expect(ids.has(b.lotId)).toBe(true);
      }
    }
  });

  it('always produces at least one lane and one building', () => {
    for (const input of inputs) {
      for (const seed of seeds) {
        const m = generateVillage(input, seed);
        expect(m.lanes.length).toBeGreaterThan(0);
        expect(m.buildings.length).toBeGreaterThan(0);
      }
    }
  });

  it('never throws on a degenerate input', () => {
    const bare: AzgaarBurgInput = {
      name: 'Bare', population: 12, port: false, citadel: false, walls: false,
      plaza: false, temple: false, shanty: false, capital: false,
    };
    expect(() => generateVillage(bare, 1)).not.toThrow();
    const m = generateVillage(bare, 1);
    expect(m.green.shape).toBe('sm-green-round');
    void Point;
  });
});
```

- [ ] **Step 2: Run test to verify it fails or passes honestly**

Run: `nix develop --command bash -c "npx vitest run tests/village/invariants.test.ts"`
Expected: this is the task where earlier bugs surface. If any invariant fails, fix the
owning module (not the test) — the invariants are the design's §5.7 contract.

- [ ] **Step 3: Fix whichever module violates an invariant**

Most likely offenders and their fixes:
- Buildings overlapping across two lanes whose strips converge → in `generateVillage`,
  the overlap check in `spendCensus` already rejects; if a violation appears, the cause
  is `subdivideLane` cutting lots on top of each other at a junction. Fix by dropping
  the later lot in `clipLots` when its `front` is within `f0 / 2` of an already-kept
  lot's `front`:

```ts
// in clipLots, after the water and green filters
const kept: Lot[] = [];
for (const l of lots) {
  if (kept.some((k) => Math.hypot(k.front.x - l.front.x, k.front.y - l.front.y) < l.frontageM / 2)) {
    continue;
  }
  kept.push(l);
}
return kept;
```

- A lot in water because only its `front` was probed → extend the water filter to probe
  the lot's back corner as well, at `depthM` along its bearing.

- [ ] **Step 4: Run the whole village suite**

Run: `nix develop --command bash -c "npx vitest run tests/village"`
Expected: PASS, every file

- [ ] **Step 5: Commit**

```bash
git add tests/village/invariants.test.ts src/village
git commit -m "test(village): property invariants across seeds and inputs"
```

---

### Task 19: Minimal render for the gate

**Files:**
- Create: `src/village/render.ts`
- Create: `scripts/render-village.ts`
- Test: `tests/village/render.test.ts`

**Interfaces:**
- Consumes: `VillageModel` (Task 3), `generateVillage` (Task 17), `SYMBOL_MANIFEST`.
- Produces: `renderVillage(model: VillageModel, pxPerMetre?: number): string`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/village/render.test.ts
import { describe, it, expect } from 'vitest';
import { generateVillage } from '../../src/village/village-model.js';
import { renderVillage } from '../../src/village/render.js';
import type { AzgaarBurgInput } from '../../src/input/azgaar-input.js';

const input: AzgaarBurgInput = {
  name: 'Wick', population: 300, port: false, citadel: false, walls: false,
  plaza: false, temple: false, shanty: false, capital: false,
  roadBearings: [{ bearing_deg: 225, kind: 'road' }],
};

describe('renderVillage', () => {
  const svg = renderVillage(generateVillage(input, 1));

  it('emits a single svg document with the tiler background contract', () => {
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('data-bg="paper"');
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
  });

  it('paints bands in order: parcel, route, structure', () => {
    const parcel = svg.indexOf('data-band="parcel"');
    const route = svg.indexOf('data-band="route"');
    const structure = svg.indexOf('data-band="structure"');
    expect(parcel).toBeGreaterThan(-1);
    expect(parcel).toBeLessThan(route);
    expect(route).toBeLessThan(structure);
  });

  it('draws every shadow in the structure band before any ink', () => {
    const lastShadow = svg.lastIndexOf('data-shadow="1"');
    const firstInk = svg.indexOf('data-ink="1"');
    expect(lastShadow).toBeLessThan(firstInk);
  });

  it('places one use per building', () => {
    const model = generateVillage(input, 1);
    const inks = renderVillage(model).match(/data-ink="1"/g) ?? [];
    expect(inks).toHaveLength(model.buildings.length);
  });

  it('is deterministic', () => {
    expect(renderVillage(generateVillage(input, 2)))
      .toBe(renderVillage(generateVillage(input, 2)));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nix develop --command bash -c "npx vitest run tests/village/render.test.ts"`
Expected: FAIL — cannot find module `src/village/render.js`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/village/render.ts
import type { VillageModel } from './types.js';

/** integration.md's shadow contract: one light, never rotated with the mark. */
const SHADOW_OFFSET: [number, number] = [2.6, 3.6];
const SHADOW_OPACITY = 0.2;
const SHADOW_COLOR = '#46303c';
const GROUND = '#a3c98d';

function n(v: number): string {
  return (Math.round(v * 100) / 100).toString();
}

/**
 * Minimal renderer: enough for a render gate to judge the skeleton, the
 * green and the fabric. Bands are parcel -> route -> structure; pass 5's
 * canopy band arrives with the dressing work.
 */
export function renderVillage(model: VillageModel, pxPerMetre = 4): string {
  const xs = model.buildings.map((b) => b.position.x).concat(model.green.centre.x);
  const ys = model.buildings.map((b) => b.position.y).concat(model.green.centre.y);
  const pad = 40;
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad;
  const w = (Math.max(...xs) + pad - minX) * pxPerMetre;
  const h = (Math.max(...ys) + pad - minY) * pxPerMetre;
  const X = (x: number): number => (x - minX) * pxPerMetre;
  const Y = (y: number): number => (y - minY) * pxPerMetre;

  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${n(w)}" height="${n(h)}" viewBox="0 0 ${n(w)} ${n(h)}">`);
  out.push(`<rect data-bg="paper" width="${n(w)}" height="${n(h)}" fill="${GROUND}"/>`);

  // parcel band — the green's ground
  out.push('<g data-band="parcel">');
  const r = (model.green.diameter / 2) * pxPerMetre;
  out.push(
    `<use href="#${model.green.shape}-${model.green.variant}" ` +
    `transform="translate(${n(X(model.green.centre.x))},${n(Y(model.green.centre.y))}) ` +
    `rotate(${n(model.green.bearingDeg)}) scale(${n((r * 2) / 64)}) translate(-32,-32)"/>`,
  );
  out.push('</g>');

  // route band
  out.push('<g data-band="route" fill="none" stroke="#8a6f4a" stroke-linecap="round">');
  for (const lane of model.lanes) {
    const d = lane.points
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${n(X(p.x))},${n(Y(p.y))}`)
      .join(' ');
    out.push(`<path data-lane="${lane.id}" d="${d}" stroke-width="${n(lane.widthM * pxPerMetre)}"/>`);
  }
  out.push('</g>');

  // structure band — every shadow, then every ink
  out.push('<g data-band="structure">');
  out.push(
    `<g transform="translate(${n(SHADOW_OFFSET[0])},${n(SHADOW_OFFSET[1])}) ` +
    `opacity="${SHADOW_OPACITY}" color="${SHADOW_COLOR}">`,
  );
  for (const b of model.buildings) {
    const k = (b.footprint[0] * pxPerMetre) / 64;
    out.push(
      `<use data-shadow="1" href="#${b.glyph}-sil" transform="translate(${n(X(b.position.x))},` +
      `${n(Y(b.position.y))}) rotate(${n(b.bearingDeg)}) scale(${n(k)}) translate(-32,-32)"/>`,
    );
  }
  out.push('</g>');
  for (const b of model.buildings) {
    const k = (b.footprint[0] * pxPerMetre) / 64;
    out.push(
      `<use data-ink="1" data-id="${b.id}" href="#${b.glyph}" transform="translate(${n(X(b.position.x))},` +
      `${n(Y(b.position.y))}) rotate(${n(b.bearingDeg)}) scale(${n(k)}) translate(-32,-32)"/>`,
    );
  }
  out.push('</g>');
  out.push('</svg>');
  return out.join('\n');
}
```

And the gate script:

```ts
// scripts/render-village.ts
// Usage: npx tsx scripts/render-village.ts <pop> <seed> > out.svg
import { generateVillage } from '../src/village/village-model.js';
import { renderVillage } from '../src/village/render.js';

const pop = Number(process.argv[2] ?? 300);
const seed = Number(process.argv[3] ?? 1);

const model = generateVillage({
  name: 'Gate', population: pop, port: false, citadel: false, walls: false,
  plaza: false, temple: false, shanty: false, capital: false,
  roadBearings: [{ bearing_deg: 225, kind: 'road' }],
}, seed);

process.stdout.write(renderVillage(model));
process.stderr.write(
  `${model.buildings.length} buildings, ${model.lanes.length} lanes, ` +
  `green ${model.green.shape} ${Math.round(model.green.diameter)} m\n` +
  model.diagnostics.map((d) => `  ! ${d}\n`).join(''),
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `nix develop --command bash -c "npx vitest run tests/village/render.test.ts"`
Expected: PASS, 5 tests

- [ ] **Step 5: Run the full suite and commit**

Run: `nix develop --command bash -c "npx vitest run"`
Expected: every existing test still passes — nothing in `src/generator/` changed.

```bash
git add src/village/render.ts scripts/render-village.ts tests/village/render.test.ts
git commit -m "feat(village): minimal renderer and render-gate script"
```

---

## After Task 19: the render gate

Generate a spread and put it in front of Barry before writing another line:

```bash
nix develop --command bash -c "for p in 60 150 300 600 900; do npx tsx scripts/render-village.ts \$p 1 > /tmp/village-\$p.svg; done"
```

The sprites must be injected for the `<use>` references to resolve — the review harness
(`settlemaker-web/site`, vite on 5199) already inlines `symbols.svg` and
`symbols-biomes.svg`, and will need `symbols-parcel.svg` added once the batch-002 assets
land in `dist/symbols/refined`.

**Render gates with Barry's eyes are the only accepted acceptance test.** Every value in
the design's §11 table is expected to move here. Expect the first gate to reject something
structural; that is what it is for.

Do not start pass 5 (crofts, fields, vegetation, POIs) until the gate verdict is in — its
plan is written against what the gate says, not against this document.
