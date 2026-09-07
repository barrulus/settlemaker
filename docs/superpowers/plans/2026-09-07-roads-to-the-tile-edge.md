# Roads to the Tile Edge — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every road entering a village runs all the way to the edge of the drawn tile and is cut off there, instead of stopping dead on the contract circle ~150 m short of it.

**Architecture:** Each contract entry gains an *apron* lane — a continuation appended beyond the entry vertex, created inside `synthesizeTrunks` after pattern application and before crossing resolution, so lot cutting, the census, growth, dressing and `resolveCrossings` all see the real roads. Aprons are drawn deliberately too long, and the model — not the renderer — computes the picture frame and clips them to it. That inversion is the whole trick: the renderer's `pad = 40` used to run ahead of every extension because lanes drove the bounds, and now the one thing being clipped is the one thing excluded from the box.

**Tech Stack:** TypeScript (ES modules, `.js` import specifiers), vitest, zero runtime dependencies. All commands run through the nix dev shell.

**Spec:** `docs/superpowers/specs/2026-09-07-roads-to-the-tile-edge-design.md` — read it before Task 1. This plan argues from it; where they disagree, the spec wins.

## Global Constraints

- **Run everything through nix:** `nix develop --command bash -c "npx vitest run"`. Never call `npx` directly.
- **The apron consumes NO randomness** (spec §8). No `SeededRandom` parameter reaches any function added by this plan. This is what keeps every existing village's fabric from re-rolling, and it is a review bar, not a preference.
- **Append, never overwrite** (spec §5.1, attempt 3's grave). The trunk's final vertex sits exactly on the contract circle and must still be there when the work is done; `trunks-structural.test.ts` (b) allows 8 m and a previous attempt measured 10.4 m.
- **Identity is an id predicate, never a radius** (spec §5.1, attempt 4). Nothing added here may ask "is this point further than X from the origin?" to decide what a lane is.
- **Lanes run inner-first.** `Lane.points[0]` is the green end; the last point is the outer end. `mergeTrunks` guarantees it and `rehomeOrphans` relies on it.
- **`docs/superpowers/` is gitignored** — commit plan/spec edits with `git add -f`.
- **No `Co-Authored-By` lines in commit messages.**
- **Determinism is a shipped guarantee.** Same seed → byte-identical SVG. `trunks-structural.test.ts` (e) covers it; never weaken it.
- **Never claim a suite is green without pasting the run.** The baseline is **1135 passing across 113 files**; `tsc --noEmit` clean.

---

## File Structure

**Created:**
- `src/village/skeleton/apron.ts` — apron geometry only: continuation of a trunk past its contract entry, and the coast bend. Pure functions, no RNG, no imports from `trunks.ts` except types.
- `src/village/frame.ts` — the drawn tile: computing it from the fabric, and clipping aprons to it.
- `tests/village/apron.test.ts` — unit tests for apron geometry.
- `tests/village/frame.test.ts` — unit tests for the frame and the clip.
- `tests/village/roads-reach-the-edge.test.ts` — the whole-model invariants (spec §9).

**Modified:**
- `tests/village/route-class.test.ts` — Task 0's guard on the city-visible `toLegacyKind`.
- `src/village/types.ts` — `apronLaneId`, `isApron`, `Frame`, `VillageModel.frame`.
- `src/village/constants.ts` — the `APRON_*`, `COAST_ROAD_*` and `FRAME_PAD_M` constants.
- `src/village/skeleton/trunks.ts:1305-1384` — one call to `growAprons` inside `synthesizeTrunks`.
- `src/village/village-model.ts` — apron exclusions at the lot/block/relax call sites; frame computation and clip before the return.
- `src/village/skeleton/lanes.ts:1733` and `src/village/skeleton/relax.ts` — only if the audit in Task 2 finds a site `isTrunk` does not already cover.
- `src/village/dressing/fields.ts:302` (`exitRoads`) — skip a trunk that has an apron continuation.
- `src/village/render.ts:207-240` — read `model.frame`, compute no bounds.
- `tests/village/every-class-connects.test.ts` — assert the tile edge, not the circle.
- `docs/url-api.md` — the handshake fiction (spec §11.5).

---

## Task 0: Pin the city's view of the road classes

**Why this is task zero and not a footnote.** The city pipeline reaches into the village engine through two doors, and one of them is the road-class module this roads work is most likely to want to edit:

```
src/village/glyphs.ts      <- src/generator/village-rows.ts <- src/generator/model.ts
src/village/route-class.ts <- src/input/azgaar-input.ts     <- src/generator/model.ts
```

`src/input/azgaar-input.ts:3` imports `toLegacyKind` and `RouteType`, and line 208 calls `toLegacyKind` on **every road bearing of every burg**, cities included. `ROUTE_CLASS_ORDER`, `classRank`, `laneWidth` and `stepDown` all live in that same file. A roads change that wants a new class, a width tweak or a rank adjustment lands squarely in a file city output depends on — and city SVG byte-identity is the release's only clean regression signal (spec §7, Task 7).

The sharp version of the rule, which is narrower and more useful than "don't touch it": **cities see `toLegacyKind`'s output and nothing else in this file.** `laneWidth` is village-only. `classRank` reaches cities only through `isRoadClass` inside `toLegacyKind` — and `trail` and `footpath` never get that far, because an explicit literal check catches them first:

```ts
  if (k === 'trail' || k === 'footpath') return 'foot';
  if (isRoadClass(k as RouteType)) return 'road';
```

So only `royal`, `main`, `market`, `town` and `local` ever reach `classRank`, and `isRoadClass` compares against `'local'`. The invariant is therefore:

> **`'local'` must remain the LAST of the five road classes** — `royal`, `main`, `market` and `town` must each keep a rank below it.

Verified by simulation against the real function, not by reading: moving `'local'` ahead of `'town'` makes `toLegacyKind('town')` return `undefined` instead of `'road'`, changing behaviour for every city burg with a town-class bearing, while nothing in the file looks like it moved. Moving `'trail'` and `'footpath'` anywhere at all changes nothing. Inserting a class before `'royal'`, between `'local'` and `'trail'`, or after `'footpath'` all leave every existing kind mapping as before — so **the apron work can have a new class; it just must not reorder the five road classes among themselves.**

**Files:**
- Test: `tests/village/route-class.test.ts` (extend)

- [ ] **Step 1: Write the characterisation test**

Append to `tests/village/route-class.test.ts`:

```ts
/**
 * CITY-VISIBLE BEHAVIOUR. `src/input/azgaar-input.ts` imports `toLegacyKind`
 * and calls it on every road bearing of every burg, cities included, so this
 * function's output is part of the settlement engine's input. City SVG
 * byte-identity is the clean regression signal for a village-side release
 * (two sessions certified "cities are insulated from src/village/" on
 * 2026-09-07 and both were wrong -- see the plan for the import walk).
 *
 * This pins every input the function can receive. Adding a route class is
 * fine; changing what an EXISTING one narrows to is a city regression, and
 * it should fail here rather than in someone's byte diff after a deploy.
 */
describe('toLegacyKind is city-visible and must not drift', () => {
  it.each([
    ['royal', 'road'], ['main', 'road'], ['market', 'road'],
    ['town', 'road'], ['local', 'road'],
    ['trail', 'foot'], ['footpath', 'foot'],
    ['road', 'road'], ['foot', 'foot'], ['sea', 'sea'],
    ['searoutes', 'sea'],
  ] as const)('%s -> %s', (input, expected) => {
    expect(toLegacyKind(input)).toBe(expected);
  });

  it.each(['airroutes', 'traderoutes'] as const)('%s -> undefined', (input) => {
    expect(toLegacyKind(input)).toBeUndefined();
  });

  it('maps undefined through', () => {
    expect(toLegacyKind(undefined)).toBeUndefined();
  });

  it.each(['royal', 'main', 'market', 'town'] as const)(
    'keeps %s ranked below local, the boundary isRoadClass reads', (kind) => {
      // `trail` and `footpath` are caught by a literal check BEFORE
      // isRoadClass, so their position is irrelevant here -- these four are
      // the ones that reach classRank. Move 'local' ahead of 'town' and
      // toLegacyKind('town') silently becomes undefined for every city burg.
      expect(classRank(kind)).toBeLessThan(classRank('local'));
    },
  );
});
```

Merge the imports into the file's existing import of `../../src/village/route-class.js` — it needs `toLegacyKind` and `classRank`.

- [ ] **Step 2: Run it — it must pass immediately**

```
nix develop --command bash -c "npx vitest run tests/village/route-class.test.ts"
```

Expected: PASS on the first run. This is a characterisation test of behaviour that already exists, not a TDD cycle; if any case fails, the mapping is not what this plan assumed and Task 7's city claim needs revisiting before going further.

- [ ] **Step 3: Commit**

```bash
git add tests/village/route-class.test.ts
git commit -m "Pin toLegacyKind: the city engine's view of the road classes

azgaar-input.ts calls it on every road bearing of every burg, cities
included, so this village-side function is part of the settlement engine's
input -- and city SVG byte-identity is the clean regression signal for a
village-side release. A roads change is more likely than most to want to
edit route-class.ts, so pin what cities can see before starting one."
```

**Standing constraint for every task after this one:** if you find yourself editing `src/village/route-class.ts` or `src/village/glyphs.ts`, stop and check this test still passes, then say so in the task's commit message. Prefer adding over modifying. Run the door check at the end of each task, not only at release:

```bash
git diff --name-only HEAD~1 -- src/village/route-class.ts src/village/glyphs.ts
```

---

## Task 1: Apron geometry, straight case

Pure geometry, no wiring. A trunk lane and how far to go in, a polyline out.

**Files:**
- Create: `src/village/skeleton/apron.ts`
- Modify: `src/village/types.ts` (after `branchLaneId`, ~line 300), `src/village/constants.ts` (append to the trunk-network block, after `MERGE_CAPTURE_M`)
- Test: `tests/village/apron.test.ts`

**Interfaces:**
- Consumes: `Lane`, `Point`, `dist`, `unit`, `signedTurnDeg`, `bearingOf`, `bearingVector` (all existing).
- Produces:
  - `apronLaneId(trunkLaneId: string): string` → `` `${trunkLaneId}/a` ``
  - `isApron(laneId: string): boolean`
  - `apronReachM(contractRadiusM: number): number`
  - `growApronPath(lane: Lane, reachM: number): Point[]` — inner-first, `[0]` is the trunk's own outer vertex (shared, not moved).

- [ ] **Step 1: Add the constants**

In `src/village/constants.ts`, at the end of the trunk-network block:

```ts
// --- APRON (spec 2026-09-07 §5) -----------------------------------------
// The continuation of a trunk past its contract entry, out to the edge of
// the drawn tile. All initial, all expected to move at the render gate.

/** Apron length as a multiple of the contract radius. An OVERSHOOT, not a
 * target: `frame.ts` clips it to the tile exactly, so it only has to be
 * long enough. Measured worst case for tile-corner over contract radius is
 * 5.47 (pop 40 seed 1) against 2.26 at pop 1000; 8 clears both. */
export const APRON_REACH_FACTOR = 8;

/** Floor on that overshoot, for villages whose contract circle is tiny. */
export const APRON_REACH_FLOOR_M = 500;

/** Vertex spacing along an apron. Coarser than `LANE_SAMPLE_STEP_M` (12):
 * an apron is nearly straight and can be long, and every vertex is tested
 * against by the field and vegetation rejection passes. */
export const APRON_SAMPLE_STEP_M = 25;

/** How much of the arm's own terminal curvature the apron continues. A road
 * that was bending as it entered goes on bending, gently; 0 would draw a
 * ruled line off the end of a curve, which reads as a kink. */
export const APRON_CURVATURE_DAMP = 0.5;

/** Clamps on that continuation, so a footpath cannot spiral: the most an
 * apron may turn per sample step, and the most it may turn in total. */
export const APRON_MAX_TURN_PER_STEP_DEG = 2;
export const APRON_MAX_TOTAL_TURN_DEG = 30;
```

- [ ] **Step 2: Add the id helpers**

In `src/village/types.ts`, immediately after `branchLaneId`:

```ts
/**
 * A trunk's APRON: its continuation past the contract entry, out to the edge
 * of the drawn tile (spec 2026-09-07 §5.1). `/a` joins the `/b` branch and
 * `/c` connector id vocabulary.
 *
 * `isTrunk` deliberately still returns true for an apron id. Every one of
 * its call sites asks "is this structural road rather than village-grown
 * frontage?", and an apron is. `isApron` is the narrower question, asked
 * only where an apron must be held back from something a trunk is fed to.
 */
export function apronLaneId(trunkLaneId: string): string {
  return `${trunkLaneId}/a`;
}

/** True for an apron lane, including one `resolveCrossings` has split (it
 * appends its own `~x...` suffix). */
export function isApron(laneId: string): boolean {
  return /\/a(~|$)/.test(laneId);
}
```

- [ ] **Step 3: Write the failing tests**

Create `tests/village/apron.test.ts`:

```ts
/**
 * Apron geometry (spec 2026-09-07 §5.3): the continuation of a trunk past
 * its contract entry. Pure geometry — no model, no RNG.
 */
import { describe, it, expect } from 'vitest';
import { Point } from '../../src/types/point.js';
import { apronLaneId, isApron, type Lane } from '../../src/village/types.js';
import { apronReachM, growApronPath } from '../../src/village/skeleton/apron.js';
import { dist, polylineLength } from '../../src/village/geometry.js';
import { APRON_REACH_FLOOR_M } from '../../src/village/constants.js';

/** A straight trunk running inward along -y, outer end at (0, -100). */
const straight: Lane = {
  id: 'trunk-main-000', type: 'main', widthM: 5,
  points: [new Point(0, -20), new Point(0, -60), new Point(0, -100)],
};

describe('apron ids', () => {
  it('suffixes the trunk id with /a', () => {
    expect(apronLaneId('trunk-main-045')).toBe('trunk-main-045/a');
  });

  it('recognises an apron, a crossing-split apron, and nothing else', () => {
    expect(isApron('trunk-main-045/a')).toBe(true);
    expect(isApron('trunk-main-045/a~xtrunk-local-120')).toBe(true);
    expect(isApron('trunk-main-045')).toBe(false);
    expect(isApron('trunk-main-045/b45')).toBe(false);
    expect(isApron('lane-090/c')).toBe(false);
  });
});

describe('apron reach', () => {
  it('is a multiple of the contract radius, floored for tiny villages', () => {
    expect(apronReachM(264)).toBeGreaterThan(264 * 5.5);
    expect(apronReachM(10)).toBe(APRON_REACH_FLOOR_M);
  });
});

describe('growApronPath', () => {
  it('starts at the trunk’s own outer vertex and does not move it', () => {
    const apron = growApronPath(straight, 300);
    expect(apron[0].x).toBeCloseTo(0);
    expect(apron[0].y).toBeCloseTo(-100);
  });

  it('continues outward, away from the village, for the reach asked', () => {
    const apron = growApronPath(straight, 300);
    const tip = apron[apron.length - 1];
    // Straight trunk pointing at -y: the apron carries on that way.
    expect(tip.y).toBeLessThan(-380);
    expect(polylineLength(apron)).toBeGreaterThan(290);
    expect(polylineLength(apron)).toBeLessThan(310);
  });

  it('samples at roughly the apron step, not the lane step', () => {
    const apron = growApronPath(straight, 300);
    for (let i = 1; i < apron.length; i++) {
      expect(dist(apron[i - 1], apron[i])).toBeLessThanOrEqual(26);
    }
    expect(apron.length).toBeLessThan(20);
  });

  it('continues a bend rather than kinking straight off the end', () => {
    // A trunk curving as it arrives: each segment turns 10 deg.
    const curving: Lane = {
      id: 'trunk-trail-000', type: 'trail', widthM: 2,
      points: [new Point(0, -20), new Point(10, -58), new Point(24, -95)],
    };
    const apron = growApronPath(curving, 300);
    const turn = (a: Point, b: Point, c: Point): number => {
      const ab = Math.atan2(b.y - a.y, b.x - a.x);
      const bc = Math.atan2(c.y - b.y, c.x - b.x);
      return Math.abs(((bc - ab) * 180) / Math.PI);
    };
    // The join is smooth: no sharp corner where the apron meets the trunk.
    expect(turn(curving.points[1], apron[0], apron[1])).toBeLessThan(8);
    // And it keeps turning the same way it was.
    expect(apron[apron.length - 1].x).toBeGreaterThan(24);
  });

  it('never spirals, however hard the trunk was turning', () => {
    const hairpin: Lane = {
      id: 'trunk-footpath-000', type: 'footpath', widthM: 1.5,
      points: [new Point(0, -20), new Point(30, -50), new Point(20, -85)],
    };
    const apron = growApronPath(hairpin, 600);
    const start = Math.atan2(
      apron[1].y - apron[0].y, apron[1].x - apron[0].x,
    );
    const end = Math.atan2(
      apron[apron.length - 1].y - apron[apron.length - 2].y,
      apron[apron.length - 1].x - apron[apron.length - 2].x,
    );
    const totalTurnDeg = Math.abs(((end - start) * 180) / Math.PI);
    expect(totalTurnDeg).toBeLessThanOrEqual(31);
  });

  it('returns nothing for a degenerate lane', () => {
    const stub: Lane = { id: 'trunk-main-000', type: 'main', widthM: 5, points: [new Point(0, 0)] };
    expect(growApronPath(stub, 300)).toEqual([]);
  });
});
```

- [ ] **Step 4: Run the tests and watch them fail**

```
nix develop --command bash -c "npx vitest run tests/village/apron.test.ts"
```

Expected: fail — `src/village/skeleton/apron.ts` does not exist.

- [ ] **Step 5: Implement `apron.ts`**

Create `src/village/skeleton/apron.ts`:

```ts
/**
 * The APRON (spec 2026-09-07 §5): a trunk's continuation past its contract
 * entry, out to the edge of the drawn tile.
 *
 * Roads used to stop dead on the contract circle -- measured, the furthest
 * trunk point equalled `contractRadiusM` to the metre on every seed -- while
 * fields ran 70 m further and vegetation 150 m further still. This module
 * draws the missing road.
 *
 * Two rules from five failed attempts, both structural:
 *  - it APPENDS beyond the trunk's outer vertex and never moves it, because
 *    that vertex IS the boundary contract (`trunks-structural.test.ts` (b)
 *    allows 8 m; overwriting it measured 10.4 m);
 *  - it takes NO `SeededRandom`. Every apron is a pure function of geometry
 *    already fixed, so adding aprons cannot re-roll an existing village's
 *    fabric. Any future jitter takes a DERIVED stream (the
 *    `PROFILE_SEED_MULTIPLIER` pattern), never the shared one.
 *
 * The length drawn here is an OVERSHOOT. `frame.ts` clips it to the tile.
 */
import { Point } from '../../types/point.js';
import {
  APRON_CURVATURE_DAMP, APRON_MAX_TOTAL_TURN_DEG, APRON_MAX_TURN_PER_STEP_DEG,
  APRON_REACH_FACTOR, APRON_REACH_FLOOR_M, APRON_SAMPLE_STEP_M,
} from '../constants.js';
import { signedTurnDeg } from '../geometry.js';
import type { Lane } from '../types.js';

/** How long an apron is drawn before clipping (spec §5.3.3). */
export function apronReachM(contractRadiusM: number): number {
  return Math.max(contractRadiusM * APRON_REACH_FACTOR, APRON_REACH_FLOOR_M);
}

/** Bearing, in degrees, of the segment `a` -> `b`. */
function segBearingDeg(a: Point, b: Point): number {
  return (Math.atan2(b.x - a.x, -(b.y - a.y)) * 180) / Math.PI;
}

/**
 * The continuation of `lane` past its OUTER end (the last point -- lanes run
 * inner-first), `reachM` metres long, sampled every `APRON_SAMPLE_STEP_M`.
 *
 * `[0]` is the lane's own outer vertex, shared rather than copied-and-moved,
 * so the trunk and its apron are geometrically continuous and the contract
 * point is untouched.
 *
 * The heading continues the lane's terminal curvature, damped and clamped:
 * a road that was bending goes on bending gently, a straight one stays
 * straight, and nothing spirals.
 */
export function growApronPath(lane: Lane, reachM: number): Point[] {
  const pts = lane.points;
  if (pts.length < 2 || reachM <= 0) return [];

  const tip = pts[pts.length - 1];
  let headingDeg = segBearingDeg(pts[pts.length - 2], tip);

  // The turn the road was already making, per step, damped and clamped.
  let turnPerStepDeg = 0;
  if (pts.length >= 3) {
    const previous = segBearingDeg(pts[pts.length - 3], pts[pts.length - 2]);
    const raw = signedTurnDeg(previous, headingDeg) * APRON_CURVATURE_DAMP;
    turnPerStepDeg = Math.max(
      -APRON_MAX_TURN_PER_STEP_DEG, Math.min(APRON_MAX_TURN_PER_STEP_DEG, raw),
    );
  }

  const out: Point[] = [tip];
  let cursor = tip;
  let travelled = 0;
  let turnedDeg = 0;

  while (travelled < reachM) {
    const step = Math.min(APRON_SAMPLE_STEP_M, reachM - travelled);
    if (Math.abs(turnedDeg) < APRON_MAX_TOTAL_TURN_DEG) {
      headingDeg += turnPerStepDeg;
      turnedDeg += turnPerStepDeg;
    }
    const rad = (headingDeg * Math.PI) / 180;
    cursor = new Point(
      cursor.x + Math.sin(rad) * step,
      cursor.y - Math.cos(rad) * step,
    );
    out.push(cursor);
    travelled += step;
  }

  return out;
}
```

- [ ] **Step 6: Run the tests and watch them pass**

```
nix develop --command bash -c "npx vitest run tests/village/apron.test.ts"
```

Expected: PASS, 8 tests. If the curvature test fails on sign, check `signedTurnDeg`'s convention in `src/village/geometry.ts:36` before changing the test — the test encodes the spec, the implementation does not.

- [ ] **Step 7: Typecheck and commit**

```bash
nix develop --command bash -c "npx tsc --noEmit"
git add src/village/skeleton/apron.ts src/village/types.ts src/village/constants.ts tests/village/apron.test.ts
git commit -m "Apron geometry: a trunk's continuation past the contract circle

Pure geometry, no wiring and no RNG. Appends beyond the trunk's outer
vertex without moving it -- that vertex is the boundary contract, and
overwriting it is what broke the third attempt at this."
```

---

## Task 2: Aprons in the model, fed to nothing that builds

Wire `growApronPath` into `synthesizeTrunks` and hold the result back from every stage that would put a house, a lot or a block on it. One deliverable: aprons exist, and the census/block/seating numbers do not move.

**Files:**
- Modify: `src/village/skeleton/apron.ts` (add `growAprons`), `src/village/skeleton/trunks.ts:1370-1384`, `src/village/village-model.ts:374`, `:506`, `:626`, `:692`, `:770`, `src/village/dressing/fields.ts:302`
- Test: `tests/village/apron.test.ts` (extend), `tests/village/roads-reach-the-edge.test.ts` (create)

**Interfaces:**
- Consumes: `growApronPath`, `apronReachM`, `apronLaneId`, `isApron` from Task 1.
- Produces: `growAprons(lanes: Lane[], entries: TrunkEntry[], contractRadiusM: number): Lane[]` — the apron lanes only, not the input lanes. Callers concatenate.

- [ ] **Step 1: Write the failing test for `growAprons`**

Append to `tests/village/apron.test.ts`:

```ts
describe('growAprons', () => {
  const entries = [
    { point: new Point(0, -100), bearingDeg: 0, route: { bearingDeg: 0, type: 'main' as const, through: false }, farSide: false },
  ];

  it('gives one apron per lane whose outer end is a contract entry', () => {
    const aprons = growAprons([straight], entries as never, 100);
    expect(aprons).toHaveLength(1);
    expect(aprons[0].id).toBe('trunk-main-000/a');
  });

  it('inherits the trunk’s class and width so the stroke is continuous', () => {
    const [apron] = growAprons([straight], entries as never, 100);
    expect(apron.type).toBe('main');
    expect(apron.widthM).toBe(straight.widthM);
  });

  it('carries no parentId — exitRoads skips lanes that have one', () => {
    const [apron] = growAprons([straight], entries as never, 100);
    expect(apron.parentId).toBeUndefined();
  });

  it('ignores a lane whose outer end is not on an entry', () => {
    const inner: Lane = {
      id: 'lane-090', type: 'local', widthM: 3,
      points: [new Point(0, 0), new Point(10, 10)],
    };
    expect(growAprons([inner], entries as never, 100)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```
nix develop --command bash -c "npx vitest run tests/village/apron.test.ts"
```

Expected: FAIL — `growAprons` is not exported.

- [ ] **Step 3: Implement `growAprons`**

Add to `src/village/skeleton/apron.ts`:

```ts
import { dist } from '../geometry.js';
import { apronLaneId, type Lane } from '../types.js';
// Type-only, so there is no runtime cycle with `trunks.ts`, which imports
// `growAprons` from here.
import type { TrunkEntry } from './trunks.js';

/** A lane end counts as sitting on an entry within this — one apron sample
 * step, the same slack `trunks-structural.test.ts` (b) allows. */
const ON_ENTRY_M = 8;

/**
 * One apron per lane whose OUTER end sits on a contract entry (spec §5.2).
 *
 * Identification is by proximity to an ENTRY POINT, never by radius from the
 * origin: the fourth failed attempt identified arms by radius and got it
 * wrong in both directions -- `trimTails` cut arms back inside the circle at
 * pop 300, and at pop 40 arms ran past the fabric.
 *
 * Returns only the new lanes. The caller concatenates.
 */
export function growAprons(
  lanes: Lane[], entries: TrunkEntry[], contractRadiusM: number,
): Lane[] {
  const reachM = apronReachM(contractRadiusM);
  const out: Lane[] = [];
  // Sorted by id so the outcome can never depend on array position -- the
  // same discipline `rehomeOrphans` and `resolveCrossings` keep.
  for (const lane of [...lanes].sort((a, b) => a.id.localeCompare(b.id))) {
    if (lane.points.length < 2) continue;
    const tip = lane.points[lane.points.length - 1];
    if (!entries.some((e) => dist(e.point, tip) <= ON_ENTRY_M)) continue;
    const points = growApronPath(lane, reachM);
    if (points.length < 2) continue;
    out.push({
      id: apronLaneId(lane.id),
      type: lane.type,
      widthM: lane.widthM,
      points,
      // Deliberately no parentId: `dressing/fields.ts`'s `exitRoads` skips
      // any lane that has one, and the apron IS the road that leaves the
      // village now, so it is the road the field ring must open for.
      ...(lane.sourceRouteIds ? { sourceRouteIds: lane.sourceRouteIds } : {}),
    });
  }
  return out;
}
```

- [ ] **Step 4: Run it and watch it pass**

```
nix develop --command bash -c "npx vitest run tests/village/apron.test.ts"
```

Expected: PASS, 12 tests.

- [ ] **Step 5: Call it from `synthesizeTrunks`**

In `src/village/skeleton/trunks.ts`, in `synthesizeTrunks`, replace:

```ts
  const rehomed = rehomeOrphans(applied.trunks, applied.junctions, contractRadiusM);
  const resolved = resolveCrossings(rehomed.trunks, rehomed.junctions);
```

with:

```ts
  const rehomed = rehomeOrphans(applied.trunks, applied.junctions, contractRadiusM);
  // Spec 2026-09-07 §5.2. AFTER merging and pattern application, because a
  // draft-time extension would let `mergeTrunks` capture two arms out in the
  // apron and spec 5.1 forbids merging at the boundary. AFTER
  // `rehomeOrphans`, which skips ends at or beyond the contract radius
  // anyway. BEFORE `resolveCrossings`, so an apron crossing another road
  // becomes a junction like any other crossing -- the fifth failed attempt
  // could not reach this, because it patched after synthesis was over.
  const withAprons = [
    ...rehomed.trunks,
    ...growAprons(rehomed.trunks, entries, contractRadiusM),
  ];
  const resolved = resolveCrossings(withAprons, rehomed.junctions);
```

Add the import at the top of the file:

```ts
import { growAprons } from './apron.js';
```

Note the bare-network early return above (`roots.length === 0`) is left alone: a village with no surviving root has no road for an apron to continue.

- [ ] **Step 6: Run the whole suite and read the failures**

```
nix develop --command bash -c "npx vitest run" 2>&1 | tail -40
```

Expected: FAILURES, and they are the point of this step. Aprons now exist and are being fed to stages that must not see them. Write down every failing file — the exclusions in steps 7-10 must account for each one, and any failure NOT explained by an exclusion is a real defect to investigate before continuing.

- [ ] **Step 7: Exclude aprons from lot cutting**

`src/village/village-model.ts:374`, inside the growth loop:

```ts
      ...lanes.filter((l) => !isApron(l.id)).flatMap((l) => subdivideLane(
        l, green, lotRadiusM, f0, LOT_DEPTH_M, rng, lotFloorM, lotCapM,
        lotReachAt(l, green, lotProfile, site.population),
      )),
```

and the connector-lot cut at `:692`, which already filters to `isConnectorLane`, needs no change — confirm by reading it rather than assuming.

Add to the imports at the top of `village-model.ts`:

```ts
import { apronLaneId, isApron } from './types.js';
```

(merge into the existing `./types.js` import rather than adding a second one).

- [ ] **Step 8: Exclude aprons from blocks and relaxation**

`src/village/village-model.ts:506` and `:770` — both `blockAreas` calls take lanes; filter each:

```ts
  const shippedBlocks = blockAreas(relaxed.filter((l) => !isApron(l.id)), green).length;
```

`:626` — `relaxLanes` nudges lanes off buildings and there are none out here:

```ts
  const relaxedLanes = relaxLanes(lanes.filter((l) => !isApron(l.id)), spend.buildings)
    .map((relaxedLane) => { /* unchanged body */ })
    .concat(lanes.filter((l) => isApron(l.id)));
```

Read the surrounding revert-sweep loop before editing: it looks up `lanes.find((l) => l.id === relaxedLanes[i].id)`, so aprons must be present in `relaxedLanes` (they are, via the `concat`) and must be findable in `lanes` (they are — they came from there).

- [ ] **Step 9: Make `exitRoads` cut the corridor once**

`src/village/dressing/fields.ts:302`. A trunk that has an apron continuation is no longer the road that leaves the village; its apron is. Cutting from both draws the same corridor twice from two different tips.

```ts
export function exitRoads(green: Green, lanes: Lane[], belt: Point[]): RoadLine[] {
  const hasApron = new Set(
    lanes.filter((l) => isApron(l.id)).map((l) => l.id.replace(/\/a(~.*)?$/, '')),
  );
  const out: RoadLine[] = [];
  for (const lane of lanes) {
    if (lane.parentId !== undefined) continue;
    if (hasApron.has(lane.id)) continue; // its apron is the exit road
    // ... unchanged body
```

- [ ] **Step 10: Run the suite until it is green, then verify the numbers did not move**

```
nix develop --command bash -c "npx vitest run" 2>&1 | tail -20
```

Expected: **1135 passing** — the same count as the baseline, plus the 12 new apron tests, so **1147**. Every one of `village-model.test.ts`, `village-model-chase-regression.test.ts`, `seating.test.ts` and `spend-census.test.ts` must pass **unchanged**: they pin census, block and seating numbers, and they are the evidence that the apron is not feeding the fabric. If any of them needed its expectations edited, stop — an exclusion is missing, and editing the expectation hides it.

- [ ] **Step 11: Typecheck and commit**

```bash
nix develop --command bash -c "npx tsc --noEmit"
git add -A src/village tests/village
git commit -m "Aprons in the model, fed to nothing that builds

synthesizeTrunks grows one apron per contract entry, after pattern
application and before crossing resolution, so lot cutting, the census,
dressing and resolveCrossings all see the real roads.

Held back from lot cutting, block counting and relaxation; exitRoads now
cuts the field-ring corridor from the apron rather than the trunk, since
the apron is the road that leaves the village. Census, block and seating
numbers are unchanged, which is the evidence the fabric never saw it."
```

---

## Task 3: The frame, and the clip that makes a road touch the edge

**Files:**
- Create: `src/village/frame.ts`, `tests/village/frame.test.ts`
- Modify: `src/village/types.ts` (`Frame`, `VillageModel.frame`), `src/village/constants.ts` (`FRAME_PAD_M`), `src/village/geometry.ts` (`clipPolylineToRect`), `src/village/village-model.ts` (before the return, ~line 810), `src/village/render.ts:207-240`
- Test: `tests/village/frame.test.ts`, `tests/village/roads-reach-the-edge.test.ts`, `tests/village/every-class-connects.test.ts` (rewrite)

**Interfaces:**
- Consumes: `isApron` (Task 1), apron lanes on the model (Task 2).
- Produces:
  - `Frame = { minX: number; minY: number; maxX: number; maxY: number }` in `types.ts`
  - `VillageModel.frame: Frame` (required)
  - `computeFrame(parts: FrameParts): Frame` in `frame.ts`
  - `clipApronsToFrame(lanes: Lane[], frame: Frame): Lane[]` in `frame.ts`
  - `clipPolylineToRect(points: Point[], frame: Frame): Point[]` in `geometry.ts`

- [ ] **Step 1: Add `FRAME_PAD_M` and the `Frame` type**

`src/village/constants.ts`:

```ts
/** The margin between the outermost fabric and the edge of the drawn tile.
 * MOVED, not chosen: it must equal the literal `pad` `render.ts` has always
 * used, or every village's frame shifts. Trees still stand back from the
 * edge; only roads reach it. */
export const FRAME_PAD_M = 40;
```

`src/village/types.ts`, above `VillageModel`:

```ts
/**
 * The drawn tile, in burg-local metres (spec 2026-09-07 §7).
 *
 * The MODEL owns this, not the renderer, because apron lanes are clipped to
 * it: a renderer that re-derived its own bounds from the geometry would move
 * the very edge the roads were cut to. That inversion is what lets a road
 * touch the edge at all -- while lanes drove the bounds and the renderer
 * added a pad, every metre of extension pushed the frame one metre further
 * ahead of the road.
 */
export interface Frame {
  minX: number; minY: number; maxX: number; maxY: number;
}
```

and on `VillageModel`, after `contractRadiusM`:

```ts
  /** The drawn tile (spec §7.1). `render.ts` reads this and computes no
   * bounds of its own; aprons are clipped to it. */
  frame: Frame;
```

- [ ] **Step 2: Write the failing tests for the frame**

Create `tests/village/frame.test.ts`:

```ts
/**
 * The drawn tile (spec 2026-09-07 §7). Aprons are the one thing excluded
 * from the box and the one thing clipped to it -- that is what stops the
 * chase where every metre of road pushed the frame ahead of itself.
 */
import { describe, it, expect } from 'vitest';
import { Point } from '../../src/types/point.js';
import { computeFrame, clipApronsToFrame } from '../../src/village/frame.js';
import { clipPolylineToRect } from '../../src/village/geometry.js';
import type { Lane } from '../../src/village/types.js';

const frame = { minX: -100, minY: -100, maxX: 100, maxY: 100 };

describe('clipPolylineToRect', () => {
  it('keeps the prefix and ends exactly on the boundary', () => {
    const clipped = clipPolylineToRect(
      [new Point(0, 0), new Point(0, -50), new Point(0, -300)], frame,
    );
    const tip = clipped[clipped.length - 1];
    expect(tip.y).toBeCloseTo(-100);
    expect(tip.x).toBeCloseTo(0);
    expect(clipped).toHaveLength(3);
  });

  it('leaves a polyline that never leaves the rectangle alone', () => {
    const points = [new Point(0, 0), new Point(10, 10)];
    expect(clipPolylineToRect(points, frame)).toEqual(points);
  });

  it('clips on the first crossing, not the last', () => {
    const clipped = clipPolylineToRect(
      [new Point(0, 0), new Point(0, -300), new Point(0, 0)], frame,
    );
    expect(clipped[clipped.length - 1].y).toBeCloseTo(-100);
  });
});

describe('computeFrame', () => {
  it('pads the fabric by FRAME_PAD_M', () => {
    const f = computeFrame({
      lanes: [], buildings: [new Point(0, 0)], greenCentre: new Point(0, 0),
      dressing: [new Point(50, 60)],
    });
    expect(f.maxX).toBeCloseTo(90);
    expect(f.maxY).toBeCloseTo(100);
  });

  it('EXCLUDES apron lanes — the whole point', () => {
    const apron: Lane = {
      id: 'trunk-main-000/a', type: 'main', widthM: 5,
      points: [new Point(0, -50), new Point(0, -5000)],
    };
    const trunk: Lane = {
      id: 'trunk-main-000', type: 'main', widthM: 5,
      points: [new Point(0, 0), new Point(0, -50)],
    };
    const withApron = computeFrame({
      lanes: [trunk, apron], buildings: [], greenCentre: new Point(0, 0), dressing: [],
    });
    const without = computeFrame({
      lanes: [trunk], buildings: [], greenCentre: new Point(0, 0), dressing: [],
    });
    expect(withApron).toEqual(without);
  });

  it('still lets an ordinary lane drive the bounds', () => {
    const lane: Lane = {
      id: 'lane-090', type: 'local', widthM: 3,
      points: [new Point(0, 0), new Point(200, 0)],
    };
    const f = computeFrame({
      lanes: [lane], buildings: [], greenCentre: new Point(0, 0), dressing: [],
    });
    expect(f.maxX).toBeCloseTo(240);
  });
});

describe('clipApronsToFrame', () => {
  it('cuts an apron to the boundary and leaves everything else alone', () => {
    const apron: Lane = {
      id: 'trunk-main-000/a', type: 'main', widthM: 5,
      points: [new Point(0, -50), new Point(0, -5000)],
    };
    const trunk: Lane = {
      id: 'trunk-main-000', type: 'main', widthM: 5,
      points: [new Point(0, 0), new Point(0, -50)],
    };
    const out = clipApronsToFrame([trunk, apron], frame);
    expect(out.find((l) => l.id === 'trunk-main-000')).toEqual(trunk);
    const cut = out.find((l) => l.id === 'trunk-main-000/a')!;
    expect(cut.points[cut.points.length - 1].y).toBeCloseTo(-100);
  });

  it('drops an apron that starts outside the frame rather than shipping it', () => {
    const stray: Lane = {
      id: 'trunk-main-000/a', type: 'main', widthM: 5,
      points: [new Point(0, -500), new Point(0, -900)],
    };
    expect(clipApronsToFrame([stray], frame)).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

```
nix develop --command bash -c "npx vitest run tests/village/frame.test.ts"
```

Expected: FAIL — `src/village/frame.js` does not exist.

- [ ] **Step 4: Implement `clipPolylineToRect` in `geometry.ts`**

Append to `src/village/geometry.ts`:

```ts
/**
 * The prefix of `points` that lies inside `rect`, ending exactly on the
 * boundary where it first leaves (spec 2026-09-07 §7.2).
 *
 * First crossing, not last: a road that leaves the tile is gone, whatever it
 * does afterwards. Returns `[]` when the first point is already outside.
 */
export function clipPolylineToRect(
  points: Point[],
  rect: { minX: number; minY: number; maxX: number; maxY: number },
): Point[] {
  const inside = (p: Point): boolean => (
    p.x >= rect.minX && p.x <= rect.maxX && p.y >= rect.minY && p.y <= rect.maxY
  );
  if (points.length === 0 || !inside(points[0])) return [];

  const out: Point[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (inside(b)) { out.push(b); continue; }
    // Largest t in [0, 1] with a + t*(b - a) still inside: clip against each
    // of the four half-planes in turn.
    let t = 1;
    const limit = (num: number, den: number): void => {
      if (den === 0) return;
      const candidate = num / den;
      if (candidate >= 0 && candidate < t) t = candidate;
    };
    limit(rect.minX - a.x, b.x - a.x);
    limit(rect.maxX - a.x, b.x - a.x);
    limit(rect.minY - a.y, b.y - a.y);
    limit(rect.maxY - a.y, b.y - a.y);
    out.push(new Point(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t));
    return out;
  }
  return out;
}
```

- [ ] **Step 5: Implement `frame.ts`**

Create `src/village/frame.ts`:

```ts
/**
 * THE DRAWN TILE (spec 2026-09-07 §7).
 *
 * `render.ts` used to bound-box everything it was handed, lanes included,
 * and add a 40 m pad. That made "run the roads to the edge" impossible: every
 * metre of extension pushed the frame one metre further ahead of the road.
 *
 * The resolution is to make the apron the one thing EXCLUDED from the box
 * and the one thing CLIPPED to it. There is no fixed point to chase, and the
 * frame of a village that gains nothing else is unchanged.
 */
import { Point } from '../types/point.js';
import { FRAME_PAD_M } from './constants.js';
import { clipPolylineToRect } from './geometry.js';
import { isApron, type Frame, type Lane } from './types.js';

export interface FrameParts {
  lanes: Lane[];
  buildings: Point[];
  greenCentre: Point;
  /** Field vertices, edge stamps, vegetation and POI positions. */
  dressing: Point[];
}

/** The tile: everything that paints, EXCEPT aprons, padded by
 * `FRAME_PAD_M`. */
export function computeFrame(parts: FrameParts): Frame {
  const xs: number[] = [parts.greenCentre.x];
  const ys: number[] = [parts.greenCentre.y];
  const take = (p: Point): void => { xs.push(p.x); ys.push(p.y); };
  for (const b of parts.buildings) take(b);
  for (const p of parts.dressing) take(p);
  for (const lane of parts.lanes) {
    if (isApron(lane.id)) continue;
    for (const p of lane.points) take(p);
  }
  return {
    minX: Math.min(...xs) - FRAME_PAD_M,
    minY: Math.min(...ys) - FRAME_PAD_M,
    maxX: Math.max(...xs) + FRAME_PAD_M,
    maxY: Math.max(...ys) + FRAME_PAD_M,
  };
}

/**
 * Every apron cut to the frame; every other lane untouched.
 *
 * An apron whose first point is already outside the frame cannot happen
 * while the fabric reaches past the contract circle -- which it does on every
 * measured seed -- and is dropped rather than shipped as a road that starts
 * off-picture. `generateVillage` records a diagnostic when it does.
 */
export function clipApronsToFrame(lanes: Lane[], frame: Frame): Lane[] {
  const out: Lane[] = [];
  for (const lane of lanes) {
    if (!isApron(lane.id)) { out.push(lane); continue; }
    const points = clipPolylineToRect(lane.points, frame);
    if (points.length >= 2) out.push({ ...lane, points });
  }
  return out;
}
```

- [ ] **Step 6: Run the frame tests**

```
nix develop --command bash -c "npx vitest run tests/village/frame.test.ts"
```

Expected: PASS, 8 tests.

- [ ] **Step 7: Wire the frame into `generateVillage`**

In `src/village/village-model.ts`, after the `dressing` block and **before** `bridges` is computed, replace the return with:

```ts
  const frame = computeFrame({
    lanes: relaxed,
    buildings: spend.buildings.map((b) => b.position),
    greenCentre: green.centre,
    dressing: [
      ...dressing.fields.flatMap((f) => f.polygon),
      ...dressing.fieldEdges.map((e) => e.position),
      ...dressing.vegetation.map((v) => v.position),
      ...dressing.pois.map((p) => p.position),
    ],
  });
  const framedLanes = clipApronsToFrame(relaxed, frame);
  const droppedAprons = relaxed.filter((l) => isApron(l.id)).length
    - framedLanes.filter((l) => isApron(l.id)).length;
  if (droppedAprons > 0) {
    diagnostics.push(
      `apron: ${droppedAprons} approach road${droppedAprons === 1 ? '' : 's'} `
      + `started outside the drawn tile and was dropped`,
    );
  }

  return {
    site, green, lanes: framedLanes, lots: survivingLots, buildings: spend.buildings,
    // ... every other field unchanged ...
    frame,
    // Phase 3: computed on the FINAL lanes -- now after the apron clip, so
    // no bridge is ever placed outside the picture.
    bridges: findWaterCrossings(framedLanes, site.water),
  };
```

Add to the imports:

```ts
import { clipApronsToFrame, computeFrame } from './frame.js';
```

- [ ] **Step 8: Make the renderer read the frame**

`src/village/render.ts`, replacing the bounds block at `:207-240`. Delete the `lanePoints` / `fieldPoints` / `dressingPoints` / `xs` / `ys` computation used **only** for bounds and substitute:

```ts
  // Spec 2026-09-07 §7.3: the MODEL owns the frame. The renderer computing
  // its own bounds is what made "run the roads to the edge" impossible --
  // lanes drove the box and the pad ran ahead of every extension.
  const { minX, minY } = model.frame;
  const w = (model.frame.maxX - minX) * pxPerMetre;
  const h = (model.frame.maxY - minY) * pxPerMetre;
  const X = (x: number): number => (x - minX) * pxPerMetre;
  const Y = (y: number): number => (y - minY) * pxPerMetre;
```

Keep `edgeStamps` if it is used by the paint passes below — read the file and remove only what was there for bounds.

- [ ] **Step 9: Rewrite `every-class-connects.test.ts`**

Replace the file's header comment and both assertions. The old test asserted `furthest > contractRadiusM - 1` — a circle at roughly 0.4 of the tile half-width — and stayed green through the entire bug.

```ts
/**
 * Every route class must reach the EDGE OF THE TILE.
 *
 * This file used to assert that roads reached the CONTRACT CIRCLE, which is
 * an inner circle at roughly 0.4 of the drawn tile's half-width. All seven
 * classes passed it while the owner looked at a village whose roads petered
 * out in open field: on seed 55337, pop 500, every road ended at 188 m while
 * fields ran to 262 m, vegetation to 336 m and the tile was 664 x 631 m.
 * Two separate sessions cited it as evidence the village was connected.
 *
 * It now asserts the thing that was actually wanted (spec 2026-09-07 §9).
 *
 * WHY the per-class sweep exists (raised by the settlemaker-web session,
 * 2026-09-07): its builder rolls the road class at random, so a class that
 * failed to connect would look random rather than systematic and would be
 * miserable to diagnose from a bug report.
 */
import { describe, it, expect } from 'vitest';
import { generateVillage } from '../../src/village/village-model.js';
import { ROUTE_CLASS_ORDER } from '../../src/village/route-class.js';
import type { AzgaarBurgInput } from '../../src/input/azgaar-input.js';

describe('every route class connects a village to its boundary', () => {
  it.each(ROUTE_CLASS_ORDER)('%s reaches the tile edge', (kind) => {
    const burg = {
      name: 'Aldford', population: 500, port: false, citadel: false, walls: true,
      plaza: true, temple: true, shanty: false, capital: false,
      roadBearings: [{ bearing_deg: 45, kind }, { bearing_deg: 170, kind }],
    } as unknown as AzgaarBurgInput;
    const m = generateVillage(burg, 55337);
    const { minX, minY, maxX, maxY } = m.frame;
    const onBoundary = m.lanes.some((l) => l.points.some((p) => (
      Math.min(p.x - minX, maxX - p.x, p.y - minY, maxY - p.y) <= 1
    )));
    expect(onBoundary, 'no road reaches the edge of the drawn tile').toBe(true);
    // And the contract circle is still met, since a consumer aligns on it.
    const furthest = Math.max(
      ...m.lanes.flatMap((l) => l.points.map((p) => Math.hypot(p.x, p.y))),
    );
    expect(furthest).toBeGreaterThan(m.contractRadiusM);
  });
});
```

- [ ] **Step 10: Write the whole-model invariants**

Create `tests/village/roads-reach-the-edge.test.ts`:

```ts
/**
 * Spec 2026-09-07 §9: the invariants that say the roads actually got there,
 * measured on the shipped model rather than on any one stage of it.
 */
import { describe, it, expect } from 'vitest';
import { generateVillage } from '../../src/village/village-model.js';
import { isApron } from '../../src/village/types.js';
import { computeFrame } from '../../src/village/frame.js';
import type { AzgaarBurgInput } from '../../src/input/azgaar-input.js';

const POPS = [40, 120, 300, 500, 1000];
const SEEDS = [1, 2, 7, 55337];

const burg = (population: number): AzgaarBurgInput => ({
  name: 'Aldford', population, port: false, citadel: false, walls: true,
  plaza: true, temple: true, shanty: false, capital: false,
  roadBearings: [
    { bearing_deg: 45, kind: 'main' }, { bearing_deg: 170, kind: 'local' },
    { bearing_deg: 280, kind: 'trail' },
  ],
} as unknown as AzgaarBurgInput);

const each = (fn: (m: ReturnType<typeof generateVillage>, label: string) => void): void => {
  for (const pop of POPS) {
    for (const seed of SEEDS) fn(generateVillage(burg(pop), seed), `pop ${pop} seed ${seed}`);
  }
};

describe('roads reach the edge of the tile', () => {
  it('every contract entry ends on the frame boundary', () => {
    each((m, label) => {
      const { minX, minY, maxX, maxY } = m.frame;
      const aprons = m.lanes.filter((l) => isApron(l.id));
      expect(aprons.length, `${label}: no aprons at all`).toBeGreaterThan(0);
      for (const a of aprons) {
        const tip = a.points[a.points.length - 1];
        const toEdge = Math.min(tip.x - minX, maxX - tip.x, tip.y - minY, maxY - tip.y);
        const excused = m.diagnostics.some((d) => d.startsWith('coast:') || d.startsWith('apron:'));
        expect(toEdge <= 1 || excused, `${label}: ${a.id} stops ${toEdge.toFixed(0)} m short`).toBe(true);
      }
    });
  });

  it('the overshoot was always long enough to be clipped', () => {
    // If an apron was never clipped it ran out of drawn road before it
    // reached the frame, and APRON_REACH_FACTOR is too small.
    each((m, label) => {
      const { minX, minY, maxX, maxY } = m.frame;
      for (const a of m.lanes.filter((l) => isApron(l.id))) {
        const tip = a.points[a.points.length - 1];
        const onEdge = Math.min(tip.x - minX, maxX - tip.x, tip.y - minY, maxY - tip.y) <= 1;
        const excused = m.diagnostics.some((d) => d.startsWith('coast:'));
        expect(onEdge || excused, `${label}: ${a.id} was never clipped`).toBe(true);
      }
    });
  });

  it('nothing is built on an apron', () => {
    each((m, label) => {
      const apronIds = new Set(m.lanes.filter((l) => isApron(l.id)).map((l) => l.id));
      expect(m.lots.filter((l) => apronIds.has(l.laneId)), `${label}: lots on an apron`)
        .toHaveLength(0);
      const lotById = new Map(m.lots.map((l) => [l.id, l]));
      for (const b of m.buildings) {
        const lot = lotById.get(b.lotId);
        expect(lot && apronIds.has(lot.laneId), `${label}: ${b.id} seated on an apron`)
          .toBeFalsy();
      }
    });
  });

  it('the frame does not move when the aprons are taken away', () => {
    each((m, label) => {
      const without = computeFrame({
        lanes: m.lanes.filter((l) => !isApron(l.id)),
        buildings: m.buildings.map((b) => b.position),
        greenCentre: m.green.centre,
        dressing: [
          ...m.fields.flatMap((f) => f.polygon),
          ...m.fieldEdges.map((e) => e.position),
          ...m.vegetation.map((v) => v.position),
          ...m.pois.map((p) => p.position),
        ],
      });
      expect(without, `${label}: aprons are driving the bounds`).toEqual(m.frame);
    });
  });
});
```

- [ ] **Step 11: Run everything**

```
nix develop --command bash -c "npx vitest run" 2>&1 | tail -20
nix develop --command bash -c "npx tsc --noEmit"
```

Expected: all green. If "the overshoot was always long enough" fails, raise `APRON_REACH_FACTOR` — do not relax the test; it exists precisely so a too-small constant fails loudly instead of silently drawing a short road.

- [ ] **Step 12: Commit**

```bash
git add -A src tests
git commit -m "The model owns the drawn tile, and roads are cut off at it

render.ts bound-boxed everything it was handed, lanes included, and added
a 40 m pad -- so every metre a road was extended pushed the frame a metre
further ahead of it, and no road could ever touch the edge. The model now
computes the frame from everything EXCEPT the aprons and clips the aprons
to it, which removes the chase entirely.

every-class-connects asserted the contract circle, at roughly 0.4 of the
tile half-width, and stayed green through the whole bug; it now asserts
the tile edge."
```

---

## Task 4: The coast bend

**Files:**
- Modify: `src/village/skeleton/apron.ts`, `src/village/constants.ts`, `src/village/skeleton/trunks.ts` (pass `site.water` to `growAprons`)
- Test: `tests/village/apron.test.ts` (extend), `tests/village/coastline.test.ts` (extend)

**Interfaces:**
- Consumes: `growAprons` (Task 2), `pointInPolygon` (`src/geom/point-in-polygon.js`), `segmentIntersection`, `closestPointOnPolyline`, `dist` (`src/village/geometry.js`), `MERGE_CAPTURE_M` (`constants.js`).
- Produces: `growAprons(lanes, entries, contractRadiusM, water: Point[][])` — a fourth parameter. Returns `{ lanes: Lane[]; junctions: TrunkJunction[]; diagnostics: string[] }` instead of `Lane[]`.

**Measured, so this is not hypothetical:** on the `COASTAL` fixture (`oceanBearing: 123`, pop 500, seed 55337) a road at bearing 123 meets water **60 m past the contract circle**, with the frame a further 90 m out. `coastline.test.ts` asserts no lane point is in water.

- [ ] **Step 1: Add the coast constants**

`src/village/constants.ts`, after the apron block:

```ts
/** How far inland of the waterline a coast road runs. Enough that no lane
 * point is ever wet -- `coastline.test.ts` asserts exactly that. */
export const COAST_ROAD_STANDOFF_M = 10;

/** Cap on a coast-following run before the road simply ends at the shore
 * (spec §5.4.5). The `oceanBearing` coastline spans far wider than any
 * frame, so this is for real `coastlineGeometry` from FMG, where a bay can
 * curl back on itself. */
export const COAST_ROAD_MAX_RUN_M = 1200;
```

- [ ] **Step 2: Write the failing tests**

Append to `tests/village/apron.test.ts`:

```ts
describe('the coast bend', () => {
  // Water filling y > 0: a road heading +y meets it head on.
  const sea = [[
    new Point(-1000, 40), new Point(1000, 40),
    new Point(1000, 2000), new Point(-1000, 2000),
  ]];
  const seaward: Lane = {
    id: 'trunk-main-180', type: 'main', widthM: 5,
    points: [new Point(0, -20), new Point(0, 0)],
  };
  const entries = [{
    point: new Point(0, 0), bearingDeg: 180,
    route: { bearingDeg: 180, type: 'main' as const, through: false }, farSide: false,
  }];

  it('never puts a point in the water', () => {
    const { lanes } = growAprons([seaward], entries as never, 60, sea);
    const wet = lanes.flatMap((l) => l.points).filter((p) => p.y > 40);
    expect(wet).toHaveLength(0);
  });

  it('turns instead of stopping at the shore', () => {
    const { lanes } = growAprons([seaward], entries as never, 60, sea);
    const tip = lanes[0].points[lanes[0].points.length - 1];
    // It got a long way sideways, which a road that merely stopped could not.
    expect(Math.abs(tip.x)).toBeGreaterThan(200);
  });

  it('runs a standoff clear of the waterline, not on it', () => {
    const { lanes } = growAprons([seaward], entries as never, 60, sea);
    const alongShore = lanes[0].points.filter((p) => Math.abs(p.x) > 100);
    expect(alongShore.length).toBeGreaterThan(0);
    for (const p of alongShore) expect(p.y).toBeLessThanOrEqual(31);
  });

  it('is deterministic — the same input gives the same road', () => {
    const a = growAprons([seaward], entries as never, 60, sea);
    const b = growAprons([seaward], entries as never, 60, sea);
    expect(JSON.stringify(a.lanes)).toBe(JSON.stringify(b.lanes));
  });

  it('lands a second seaward road on the first and records a junction', () => {
    const second: Lane = {
      id: 'trunk-local-170', type: 'local', widthM: 3,
      points: [new Point(-6, -20), new Point(-6, 0)],
    };
    const both = [...(entries as never[]), {
      point: new Point(-6, 0), bearingDeg: 170,
      route: { bearingDeg: 170, type: 'local', through: false }, farSide: false,
    }];
    const { lanes, junctions } = growAprons([seaward, second], both as never, 60, sea);
    expect(lanes).toHaveLength(2);
    expect(junctions.length).toBeGreaterThan(0);
  });

  it('ends at the shore, and says so, when the coast never leaves the run cap', () => {
    // A small island of water the road can circle forever.
    const lagoon = [[
      new Point(-30, 40), new Point(30, 40), new Point(30, 100), new Point(-30, 100),
    ]];
    const { diagnostics } = growAprons([seaward], entries as never, 60, lagoon);
    // Either it escaped past the lagoon (fine) or it gave up and said so.
    if (diagnostics.length > 0) expect(diagnostics[0]).toMatch(/^coast:/);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

```
nix develop --command bash -c "npx vitest run tests/village/apron.test.ts"
```

Expected: FAIL — `growAprons` takes three arguments and returns an array.

- [ ] **Step 4: Implement the coast bend**

In `src/village/skeleton/apron.ts`, add:

```ts
import { pointInPolygon } from '../../geom/point-in-polygon.js';
import { closestPointOnPolyline, segmentIntersection } from '../geometry.js';
import { COAST_ROAD_MAX_RUN_M, COAST_ROAD_STANDOFF_M, MERGE_CAPTURE_M } from '../constants.js';
import type { TrunkJunction } from './trunks.js';

/** Where a polyline first enters water: the index of the segment that
 * crosses, and the crossing point. */
function firstWaterHit(
  points: Point[], water: Point[][],
): { index: number; point: Point } | null {
  for (let i = 1; i < points.length; i++) {
    let best: { point: Point; d: number } | null = null;
    for (const ring of water) {
      for (let j = 0; j < ring.length; j++) {
        const hit = segmentIntersection(
          points[i - 1], points[i], ring[j], ring[(j + 1) % ring.length],
        );
        if (!hit) continue;
        const d = dist(points[i - 1], hit);
        if (!best || d < best.d) best = { point: hit, d };
      }
    }
    if (best) return { index: i, point: best.point };
  }
  return null;
}

/** `p` pushed `COAST_ROAD_STANDOFF_M` away from `ring`, whichever side is
 * dry. Tested rather than derived from the winding, so it is right for a
 * ring of either orientation. */
function pushDry(p: Point, a: Point, b: Point, water: Point[][]): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const one = new Point(p.x + nx * COAST_ROAD_STANDOFF_M, p.y + ny * COAST_ROAD_STANDOFF_M);
  if (!water.some((ring) => pointInPolygon(one, ring))) return one;
  return new Point(p.x - nx * COAST_ROAD_STANDOFF_M, p.y - ny * COAST_ROAD_STANDOFF_M);
}

/**
 * A road that met the sea, turned, and followed the shore (spec §5.4).
 *
 * `direction` walks the ring's vertices forward (+1) or backward (-1) from
 * the crossing. Both are built; the caller keeps whichever gets further from
 * the origin in less road, which is the deterministic stand-in for "leaves
 * the tile first" -- the frame does not exist yet at synthesis time.
 */
function followShore(
  from: Point, ring: Point[], startIndex: number, direction: 1 | -1,
  water: Point[][],
): Point[] {
  const out: Point[] = [from];
  let run = 0;
  for (let k = 1; k <= ring.length && run < COAST_ROAD_MAX_RUN_M; k++) {
    const i = ((startIndex + direction * k) % ring.length + ring.length) % ring.length;
    const prev = ((i - direction) % ring.length + ring.length) % ring.length;
    const p = pushDry(ring[i], ring[prev], ring[i], water);
    run += dist(out[out.length - 1], p);
    out.push(p);
  }
  return out;
}
```

and rewrite `growAprons` to use them:

```ts
/** What one pass of `growAprons` produced: the new lanes, any junctions
 * where a second seaward road landed on the first, and any coast fallback
 * it had to take. */
export interface GrownAprons {
  lanes: Lane[];
  junctions: TrunkJunction[];
  diagnostics: string[];
}

export function growAprons(
  lanes: Lane[], entries: TrunkEntry[], contractRadiusM: number,
  water: Point[][] = [],
): GrownAprons {
  const reachM = apronReachM(contractRadiusM);
  const out: Lane[] = [];
  const junctions: TrunkJunction[] = [];
  const diagnostics: string[] = [];

  for (const lane of [...lanes].sort((a, b) => a.id.localeCompare(b.id))) {
    if (lane.points.length < 2) continue;
    const tip = lane.points[lane.points.length - 1];
    if (!entries.some((e) => dist(e.point, tip) <= ON_ENTRY_M)) continue;

    let points = growApronPath(lane, reachM);
    if (points.length < 2) continue;

    const hit = water.length > 0 ? firstWaterHit(points, water) : null;
    if (hit) {
      const ring = water.find((r) => r.some((_, j) => segmentIntersection(
        points[hit.index - 1], points[hit.index], r[j], r[(j + 1) % r.length],
      )))!;
      let nearest = 0;
      for (let j = 1; j < ring.length; j++) {
        if (dist(ring[j], hit.point) < dist(ring[nearest], hit.point)) nearest = j;
      }
      const landfall = pushDry(
        hit.point, ring[nearest], ring[(nearest + 1) % ring.length], water,
      );
      const forward = followShore(landfall, ring, nearest, 1, water);
      const backward = followShore(landfall, ring, nearest, -1, water);
      const escape = (path: Point[]): number => {
        let run = 0;
        for (let j = 1; j < path.length; j++) {
          run += dist(path[j - 1], path[j]);
          if (Math.hypot(path[j].x, path[j].y) >= reachM) return run;
        }
        return Infinity;
      };
      const fwd = escape(forward);
      const bwd = escape(backward);
      const chosen = fwd < bwd || (fwd === bwd && forward[1] && backward[1]
        && Math.abs(forward[1].x) <= Math.abs(backward[1].x)) ? forward : backward;
      if (fwd === Infinity && bwd === Infinity) {
        diagnostics.push(
          `coast: ${apronLaneId(lane.id)} follows the shore for `
          + `${COAST_ROAD_MAX_RUN_M} m without leaving the tile and ends at the water`,
        );
      }
      points = [...points.slice(0, hit.index), ...chosen];
    }

    // A second seaward road does not lay a parallel coast road: it lands on
    // the first, the same capture vocabulary `mergeTrunks` uses.
    const capture = MERGE_CAPTURE_M[lane.type];
    let landed: { onto: Lane; at: Point; cut: number } | null = null;
    for (let i = 1; i < points.length && !landed; i++) {
      for (const other of out) {
        const near = closestPointOnPolyline(points[i], other.points);
        if (near.distance <= capture) { landed = { onto: other, at: near.point, cut: i }; break; }
      }
    }
    if (landed) {
      points = [...points.slice(0, landed.cut), landed.at];
      const laneIds = [apronLaneId(lane.id), landed.onto.id].sort();
      junctions.push({ id: `j:${laneIds.join('+')}`, position: landed.at, laneIds });
    }

    if (points.length < 2) continue;
    out.push({
      id: apronLaneId(lane.id), type: lane.type, widthM: lane.widthM, points,
      ...(lane.sourceRouteIds ? { sourceRouteIds: lane.sourceRouteIds } : {}),
    });
  }

  return { lanes: out, junctions, diagnostics };
}
```

- [ ] **Step 5: Update the caller**

`src/village/skeleton/trunks.ts` — `synthesizeTrunks` now passes water and folds in the extra junctions and diagnostics:

```ts
  const grown = growAprons(rehomed.trunks, entries, contractRadiusM, site.water);
  const withAprons = [...rehomed.trunks, ...grown.lanes];
  const resolved = resolveCrossings(withAprons, [...rehomed.junctions, ...grown.junctions]);
```

`TrunkNetwork` gains a `diagnostics: string[]` field carrying `grown.diagnostics`, and `generateVillage` pushes them onto its own `diagnostics` array right after the `synthesizeTrunks` call at `village-model.ts:194`. Nothing is ever silent — the standing bar.

- [ ] **Step 6: Extend `coastline.test.ts`**

Append to `tests/village/coastline.test.ts`:

```ts
  it('runs a seaward road along the coast instead of into the sea', () => {
    const m = generateVillage(COASTAL, 55337);
    const ring = m.site.water[0];
    const wet = m.lanes.flatMap((l) => l.points).filter((p) => inPoly(p, ring));
    expect(wet, 'a road is in the water').toHaveLength(0);

    const { minX, minY, maxX, maxY } = m.frame;
    const reaches = m.lanes.some((l) => l.points.some((p) => (
      Math.min(p.x - minX, maxX - p.x, p.y - minY, maxY - p.y) <= 1
    )));
    expect(reaches, 'no road reaches the tile edge on a coastal village').toBe(true);
  });

  it('keeps the coast road on the seaward side of every building', () => {
    const m = generateVillage(COASTAL, 55337);
    const ring = m.site.water[0];
    const toWater = (p: { x: number; y: number }): number => Math.min(
      ...ring.map((q) => Math.hypot(q.x - p.x, q.y - p.y)),
    );
    const nearestRoad = Math.min(
      ...m.lanes.flatMap((l) => l.points).map(toWater),
    );
    const nearestBuilding = Math.min(...m.buildings.map((b) => toWater(b.position)));
    expect(nearestRoad).toBeLessThanOrEqual(nearestBuilding);
  });
```

- [ ] **Step 7: Run everything**

```
nix develop --command bash -c "npx vitest run" 2>&1 | tail -20
nix develop --command bash -c "npx tsc --noEmit"
```

Expected: all green. `trunks-structural.test.ts` (c) — no two lanes cross without a junction — now covers coast roads; if it fails, the landing in step 4 is cutting in the wrong place, not the test being wrong.

- [ ] **Step 8: Commit**

```bash
git add -A src tests
git commit -m "A seaward road bends and follows the coast

Owner ruling 2026-09-07: a road whose bearing points out to sea is not
truncated at the shore and not left short -- it turns and runs along the
coast until it leaves the tile. Measured on the coastal fixture, a road at
bearing 123 met water 60 m past the contract circle with the frame a
further 90 m out.

A second seaward road lands on the first rather than laying a parallel
coast road. Where a bay curls back so the shore never leaves the tile, the
road ends at the water and says so in the diagnostics."
```

---

## Task 5: Reconcile `docs/url-api.md`

The contract circle is documented as a handshake where a consumer's roads meet ours. It is fiction — the owner: "fmg adds nothing to the images, they are always viewed as an iframe in the map" — and this release is exactly what makes it false in a way a reader could act on (spec §11.5).

**Files:**
- Modify: `docs/url-api.md`

- [ ] **Step 1: Find the text**

```
grep -n -i 'contract\|handshake\|meet\|circle' docs/url-api.md
```

- [ ] **Step 2: Rewrite it**

Keep everything true about `contractRadiusM` as an **alignment** contract — a consumer holding it can line our tile up with FMG's own route lines, and `data-contract-radius` still states it on the root SVG. Remove every claim that a consumer draws a road to it, meets ours there, or that anything is left undrawn to avoid a double draw. State plainly that roads are drawn to the edge of the tile and cut off there. Reconcile it the same way the stale "population <= 600" line was.

- [ ] **Step 3: Check for the same claim elsewhere**

```
grep -rn -i 'handshake\|double.draw\|consumer.s road' docs/ src/ README.md
```

Fix any other instance, including code comments — `src/village/types.ts`'s `contractRadiusM` doc comment is the most likely second home for it.

- [ ] **Step 4: Commit**

```bash
git add docs src
git commit -m "url-api.md: the contract circle is alignment, not a handshake

It described a consumer drawing its road up to our circle and meeting ours
there. No such consumer exists -- the images are only ever iframed into
FMG's map -- and as of this release our roads run to the edge of the tile
anyway, so the text was about to become actively misleading."
```

---

## Task 6: The render gate

Numbers do not close this work. The owner gates on renders, and this session has already been caught once with passing metrics and a wrong picture (`visual-work-needs-eyes`). Rasterising is faithful as of 2.0.5 — the resolved-fills fix means `sharp` and a browser finally agree, so no var-resolving helper is needed.

**Files:**
- Create: a throwaway script in the scratchpad. Nothing in this task is committed to the repo.

- [ ] **Step 1: Render the sheet**

Populations 40 / 120 / 300 / 500 / 1000 landlocked; the coastal fixture with a seaward route; a four-route junction village; a through route; and the five biomes at pop 500. Two seeds each where it is cheap.

**Include the specimen the owner has already seen the bug in**, so the before/after is against a picture he recognises rather than a fresh one — the settlemaker-web session put this in front of him at the theme re-gate and its three approach roads cross the field belt properly and then end in open sand at ~60% of the half-width:

```
/fmg?name=Qasr&pop=600&seed=3&biome=desert&roads=40:main,165:main,285:main
```

**Do not touch field density while you are in there.** That same render prompted "desert shouldn't have so much farm land", which he explicitly classed as future work; it is recorded in the memory directory as `desert-farmland-density`. Changing it here would put an unrequested change inside a gate about roads.

- [ ] **Step 2: Check them yourself first**

Look for: a road that stops short; a road crossing another with no junction drawn; a coast road that reads as invented rather than as a road; a field ring that got worse now that `exitRoads` cuts to the frame (spec §11.1); trees standing in a road.

- [ ] **Step 3: Put them in front of Barry**

Say explicitly which of the risks in spec §11 each image does or does not settle. Do not describe the work as done until he has ruled.

- [ ] **Step 4: Record the outcome**

Update `village-arms-dont-reach.md` in the memory directory with the gate result and anything he ruled during it, and update the `MEMORY.md` pointer line.

---

## Task 7: Release (gated on Task 6)

Do not start this until Barry has passed the render gate.

- [ ] **Step 1: Bump the five version pins**

`package.json`; `package-lock.json` (**two root fields, by line number** — the old version string also appears as a dependency); `SETTLEMAKER_VERSION` in `src/output/geojson-builder.ts`; and the three test files asserting it: `origin-shift`, `degraded-generation`, `geojson-schema-v4`. This is a MINOR bump — new behaviour, no consumer contract removed.

- [ ] **Step 2: Full verification**

```
nix develop --command bash -c "npx vitest run" 2>&1 | tail -5
nix develop --command bash -c "npx tsc --noEmit"
```

Paste both outputs. Never claim green without them.

- [ ] **Step 3: Commit, tag and push**

Push `settlemaker` only. **Do not push `settlemaker-web`** — that repo's session owns its pin bump because that push IS the production deploy (`repo-push-ownership`).

- [ ] **Step 4: Tell the web session**

Message it with the tag and a re-baseline note split by kind of change — the lesson from 2.0.5, where a single-sentence note conflated a rasteriser-only change with a browser-visible one and nearly caused a false regression report. It must cover **cities as well as villages**: "every village changes" tells a consumer that village bytes are useless as a regression signal, which leaves cities as their only clean one, and a note silent on cities sends them hunting the wrong thing.

- **Villages, on screen:** every village changes, coastal or not — the field-ring corridor is now cut to the frame rather than to the contract circle.
- **Villages, data:** roads run to the tile edge; `VillageModel` carries a new `frame`; village GeoJSON `bounds` moves by up to 20 m on whichever axes a road exits (see the Self-Review's known gap). `frame` itself is **not** in the GeoJSON — spec §10 — so a consumer diffing GeoJSON will not see it appear; a consumer using the TypeScript API will.
- **Cities, SVG:** byte-identical, and safe to assert as a regression signal — but **not** because the settlement path is insulated from `src/village/`. It is not. Walking the transitive import graph from `src/generator/model.ts` and `src/output/svg-builder.ts` reaches 57 files, two of which are village files, through two independent doors: **`src/village/glyphs.ts`** via `src/generator/village-rows.ts` (`HOUSE_INK_RATIO`, `HUT_INK_RATIO`), and **`src/village/route-class.ts`** via `src/input/azgaar-input.ts` (`toLegacyKind`, called on every road bearing of every burg). City SVG holds still because this work modifies neither of those two — pinned by Task 0 — and because `svg-builder.ts` carries no version stamp.
- **Cities, GeoJSON:** differs by exactly one field, `settlemaker_version`, from the release bump in `src/output/geojson-builder.ts` — the same single-field diff every release produces, and the one their 2.0.3 check caught. Anything beyond that field is a real regression.

**Re-verify the city claim rather than copying it forward, and verify the right thing.** The question is NOT "does the settlement path import `src/village/`" — it does, and a direct-import check answers that wrongly. The question is whether this work touched either of the two village files the city pipeline actually reaches:

```bash
# The two files the settlement path reaches into, transitively.
git diff --name-only <base>..HEAD -- src/village/glyphs.ts src/village/route-class.ts
# ...and everything this work touched outside the village engine.
git diff --name-only <base>..HEAD -- src/ | grep -v '^src/village/'
```

Both must come back empty. If either does not, city SVG may move and the byte-identity assertion is off the table until it is explained.

**Two traps, both real, both hit on 2026-09-07:**

- **Name-based searching gives a false positive.** `src/generator/model.ts` imports `./village-rows.js` — that is `src/generator/village-rows.ts`, the 1.2.0 city-pipeline village rows, not the village engine. Grepping the *word* "village" in the city files hits it and looks exactly like the dependency being checked for. (Caught by the settlemaker-web session.)
- **Direct-import checking gives a false negative.** Both sessions checked only the imports written in `model.ts` and `svg-builder.ts`, concluded the city path was insulated from `src/village/`, and were wrong: `village-rows.ts` imports `../village/glyphs.js` one hop further down. The insulation claim was false; the byte-identity conclusion survived only because this work happens not to touch that file. **Walk the graph, don't read the top of two files.** The scratchpad script that found it is four lines of `node` following `from '...'` specifiers transitively.

Rucio/questables is dormant by ruling: no deploy, no cache wipe.

---

## Self-Review

**Spec coverage:** §5.1 apron id and predicate → Task 1 steps 2-3. §5.2 ordering inside `synthesizeTrunks` → Task 2 step 5. §5.3 straight geometry → Task 1. §5.4 coast bend, all five sub-rules → Task 4. §5.5 constants → Tasks 1 and 4 step 1. §5.6 signature → Task 2 step 3, revised in Task 4 step 5. §6 exclusion table → Task 2 steps 7-9 (the three free ones via `isTrunk` are verified by the suite staying green rather than by new code). §7 frame → Task 3. §8 no RNG → enforced by the signatures, which take no `SeededRandom`, and stated as a global constraint. §9 invariants → Task 3 steps 9-10 and Task 4 step 6. §10 GeoJSON unchanged → no task, deliberately: aprons flow through `geojson.ts`'s existing generic lane loop and `frame` is not exported. §11.5 url-api.md → Task 5. §12 render gate → Task 6.

**Known gap, stated rather than hidden:** the GeoJSON `bounds` helper (`src/village/geojson.ts:50`) computes its own AABB with `PAD = 20` over all lanes, so it will now extend 20 m past the frame on the axes a road exits. That is a real, small output change with no consumer asking either way. It is left alone because §10 rules the schema does not change this round; if Barry wants `bounds` to mean the drawn tile, it is a one-line change plus a schema-version decision.

**Type consistency:** `growAprons` changes shape between Task 2 (`Lane[]`) and Task 4 (`GrownAprons`). That is deliberate and called out in both tasks' Interfaces blocks — Task 4's step 5 updates the single caller. `Frame` is used identically in `types.ts`, `frame.ts`, `geometry.ts` (structurally, as an inline type) and every test. `isApron` and `apronLaneId` are imported from `./types.js` everywhere.
