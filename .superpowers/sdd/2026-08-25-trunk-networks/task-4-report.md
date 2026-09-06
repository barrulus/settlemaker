# Task 4 report: convergence patterns and `synthesizeTrunks`

## Status: DONE

Commit: `d3ed17a` "Task 4: convergence-pattern palette and synthesizeTrunks entry point"
(branch `roads-first-village`, on top of `41dc7ee`).

## What was built

`src/village/skeleton/trunks.ts` gained:

- `export type ConvergencePattern = 'y-tree' | 'loop' | 'main-street' | 'junction' | 'terminal'`
- `export interface TrunkNetwork { trunks, junctions, pattern, contractRadiusM, entries }`
- `export function choosePattern(roots, hasThrough, bestClass, allFeedersTrails, rng)` —
  `terminal` is a hard precondition (non-through primary main/royal with only
  trail-class feeders); everything else draws from `PATTERN_WEIGHTS.through` /
  `.many` (4+ roots) / `.few`, in draw order `main-street, loop, y-tree, junction`.
- `export function synthesizeTrunks(site, contractRadiusM, builtEdgeRadiusM, rng)` —
  entries → drafts (`drawTrunkPath(entry.point, origin, type, rng)`) →
  `mergeTrunks` → `choosePattern` on the surviving roots → dispatch to
  `applyMainStreet` / `applyLoop` / `applyYTree` / `applyJunction` /
  `applyTerminal` → `resolveCrossings` (the proper-crossing-becomes-a-junction
  invariant, via a split that keeps the inner half's id and suffixes the outer
  half `~x<otherLaneId>`).

`src/village/constants.ts` gained `PATTERN_WEIGHTS` (commented "initial, tuned
at G1"), three rows (`through`, `many`, `few`) summing to 1 each.

`tests/village/trunks-patterns.test.ts` is new, covering brief items (a)-(g).

## A real bug found and fixed along the way

`SeededRandom`'s first `float()` call from a fresh instance is
`(seed * 48271) % N / N`, which for every seed in 1..100 (the brief's own
statistical-test range, since `seed < N/48271 ≈ 44488`) is a tiny number —
0.0000225 at seed 1, 0.00225 at seed 100. A single-draw weighted pick that
consumes this as its very first random call is therefore biased almost
entirely toward whichever pattern sits first in draw order, independent of
its configured weight. This silently made the `(a)` "4+ roots → loop
reachable" test fail (100/100 draws landed `main-street` despite an 0.08
weight) while the "through → main-street ≥ 0.6" test happened to pass for the
wrong reason (main-street being first in order). Fixed by having
`weightedPattern` burn one throwaway `rng.float()` before the real draw —
determinism per seed is untouched (same seed always burns the same way).
This is a property of the shared `SeededRandom` LCG, not something specific
to trunks.ts, and is worth remembering if any other pass ever does a
single-draw weighted pick straight off a freshly-seeded stream.

## Test summary

`npx vitest run tests/village/trunks-patterns.test.ts`: 10/10 passed.
Full suite: 95 files / 1019 tests passed (up from 1009 baseline), plus one
known-benign `vitest-worker onTaskUpdate` RPC timeout (infra flake, not a
test failure — 0 failed tests reported).
`tsc --noEmit`: clean.
(Superseded after the review fix below: 11/11 in the file, 1020 in the full
suite.)

## Design notes / judgment calls (for review)

- **`hasThrough` detection**: computed from whether BOTH the near and far
  entries of a `through` route survived merging as distinct roots (matched
  by their content-derived lane ids via `trunkLaneId`), not from `Site`
  metadata directly — this is what makes `applyMainStreet` able to find the
  exact pair to redraw as one spine.
- **main-street's "other roots land on spine"**: uses `nearestPoint` (closest
  existing spine vertex to the feeder's own circle-entry point), then
  `relandInnerEnd` truncates the feeder's polyline from the nearest existing
  sample outward, prefixed by the landing point. This is an approximation
  (vertex-nearest, not true segment projection) — acceptable given the
  brief's "tuned at G1" framing, and SAMPLE_STEP_M (6m) keeps the error
  small.
- **y-tree's degenerate-midpoint trap**: naively averaging two roots'
  *inner* ends would always yield the origin itself (every fresh root's
  inner end is exactly the aim point before any pattern runs), producing no
  Y at all. Fixed by picking a "direction" point along each branch at a
  fixed radius (`builtEdgeRadiusM * 1.5`, chosen safely clear of the
  `builtEdgeRadiusM * 0.5` threshold test (d) checks) instead of the inner
  end, then averaging *those* and pulling toward origin by a fixed factor
  (0.7). This was the source of the first (d) test failure (7 lanes near
  origin instead of ≤3) until the radius was widened past the test's own
  threshold.
- **Crossing-split id convention**: inner half keeps the original lane id;
  outer half becomes `${id}~x${sanitizeForId(otherLaneId)}` — content-derived
  and collision-resistant without a counter, per the brief's anticipated
  subtlety (1). Documented in the `resolveCrossings` docstring.
- **`applyMainStreet` fallback**: if `choosePattern` returns `main-street`
  but no through pair actually survived merging (shouldn't happen given how
  `choosePattern` is fed, but the two are decoupled functions), it falls
  back to `applyJunction` rather than crashing.

## Follow-up fix: `resolveCrossings` fixed-point (review Important finding)

The task review flagged `resolveCrossings`'s original single forward pass as a
compliance gap against the spec-authoritative no-proper-crossing invariant:
the sweep reads `out.length` live, so a newly-appended split half IS checked
against later indices, but never against an index the outer loop already
passed — a genuine structural gap, independently confirmed.

**What I could and couldn't reproduce.** I first tried to prove the gap
inductively from the splitting semantics (pure truncation: every split half
is a strict subset of one input lane's original points, with the new vertex
lying exactly on an existing segment). Under that model, for a PAIR that
crosses exactly once, the gap turns out not to bite: whichever of the two
lanes is checked first (by index order) always sees the OTHER lane's full,
not-yet-split geometry, and a truncated half can never gain a crossing its
un-truncated original didn't have. So a single-crossing miss needs a
three-lane relay (A×B unresolved surviving as a split half that A never
re-checks) that I could not actually construct — every arrangement I tried
by hand got caught anyway, because the lane that ends up "orphaned" from a
later split already had its full-geometry check completed earlier in the
same pass. I could not disprove a miss in full generality either, so this
is a reasonable but incomplete argument, not a proof of safety.

**What does reproduce, reliably**: a PAIR that crosses ITS OWN COUNTERPART
TWICE (a real multi-segment polyline can wander back across another). The
single pass's `findCrossing` returns only the FIRST intersection along the
scan order; splitting on it truncates both lanes into halves, and the
SECOND real intersection between those same two original lanes can end up
living entirely between two already-split halves that the forward-only
sweep never re-compares. Found by brute-force random search (200k trials of
three random 3-vertex polylines) rather than hand construction — logged the
exact coordinates and used them verbatim in the regression test so it's a
concrete, non-flaky repro rather than a seeded-random search.

**Fix**: `resolveCrossings` is now a genuine fixed point. Each iteration
does one full `findFirstCrossingPair` scan of the CURRENT lane list from
scratch (index 0 every time), splits the first crossing it finds, and loops
again; it returns once a complete scan finds none. Capped at
`trunks.length^2 + 8` iterations with a thrown `Error` on overrun — every
split strictly grows the lane count without ever un-crossing an existing
pair, so on a finite, fixed set of underlying segments the real crossing
count cannot be inexhaustible; the cap exists to turn a latent bug into a
loud failure rather than a hang, and is not expected to fire. Split id/
orientation conventions (inner half keeps the original id, outer half gets
`~x<otherLaneId>`, inner-first point ordering) are unchanged.

**TDD**: added
`resolveCrossings: single-pass forward sweep can leave a residual crossing`
to `tests/village/trunks-patterns.test.ts`, calling the now-exported
`resolveCrossings` directly with the three hand-placed (well, brute-force-
found) lanes. Verified RED against the pre-fix code (residual crossing
between `A` and `B~xC`), then GREEN after the fixed-point rewrite.
`resolveCrossings` is now exported from `trunks.ts` (previously private) so
the regression test can call it without going through `synthesizeTrunks`.

**Re-verification after the fix**:
- `tests/village/trunks-patterns.test.ts`: 11/11 passed (10 from the
  original palette work + the new regression).
- Full suite: 95 files / 1020 tests passed, same benign
  `vitest-worker onTaskUpdate` RPC timeout as before (0 test failures
  reported, exit code 0).
- `tsc --noEmit`: clean.

The review's two Minors (multi-through feeder pairing, noted for Task 5;
loop junction laneIds) are deferred to the ledger, per instruction — not
addressed here.

## Files touched

- `/home/barrulus/dev/settlemaker/.claude/worktrees/roads-first-village/src/village/skeleton/trunks.ts`
- `/home/barrulus/dev/settlemaker/.claude/worktrees/roads-first-village/src/village/constants.ts`
- `/home/barrulus/dev/settlemaker/.claude/worktrees/roads-first-village/tests/village/trunks-patterns.test.ts`
