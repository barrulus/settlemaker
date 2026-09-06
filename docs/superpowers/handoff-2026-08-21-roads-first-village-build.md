# Roads-First Village Engine — Build Handoff

**Date:** 2026-08-21
**Branch:** `roads-first-village` (worktree `.claude/worktrees/roads-first-village`)
**Spec:** `docs/superpowers/specs/2026-08-20-roads-first-village-design.md`
**Plan:** `docs/superpowers/plans/2026-08-20-roads-first-village.md`
**Range:** `e20bf6b..ce8e2f1`, 42 commits
**Tests:** 553 → 759 passing (58 → 78 files), `tsc --noEmit` clean

Passes 1–4 of the design are implemented, plus a minimal renderer. **Pass 5 (crofts,
fields, vegetation, POIs) is deliberately a separate plan**, to be written after the
first render gate.

---

## Render the gate images

```bash
nix develop --command bash -c "npx tsx scripts/render-village.ts <pop> <seed> > out.svg"
```

The SVG is standalone — it carries its own glyph defs and stylesheet, so it opens in a
browser with no sprite injection.

Measured sweep (seed 1, one terminating `main` route): pop 60 → 15 buildings / 6 lanes;
150 → 30 / 10; 300 → 59 / 13; 600 → 120 / 24; 900 → 179 / 37. The full census is housed
across the whole band, with no overflow diagnostic.

---

## Gate observations — for the owner's verdict, deliberately NOT tuned

These are the things I noticed rendering the spread. Tuning them without the owner's eye
is the mistake the parked rivers work made, so they are recorded rather than acted on.
All map to §11 constants.

1. **The green reads small against the fabric.** 22 m across a ~350 m extent (~6%),
   where the reference wireframe's disc is nearer 25%. `GREEN_DIAMETER_FLOOR_M`.
2. **Buildings sit looser to their lanes than frame 4 shows.** Driven by
   `LANE_SETBACK_M` + `LOT_DEPTH_M` and, since the final fix wave, by `f0` — see item 5.
3. **No distinct ring of buildings fronts the green.** The ring lots exist and score
   highest, but at 22 m the green's circumference only yields a handful, so it does not
   read as the ring in the wireframe. Related to item 1.
4. **Lanes render as flat brown slabs** with no casing/core treatment, unlike the old
   engine's roads. Purely a renderer question.
5. **`f0` is now the widest *common* dwelling (10 m, the longhouse), not the typical
   one.** That is what spec §5.2 says, and the final review was right that the old
   literal `8` was unrelated to the deck. But it means one relatively rare glyph sets
   the spacing for every plot, which widens the whole settlement. If the fabric reads
   too loose at the gate, the question to settle is whether `f0` should be the widest
   entry or a weighted mean of the deck.
6. **Two invented lanes can cross without forming a junction** (pop 300, seed 1). This
   one may be a defect rather than a tuning — see the pass-5 blocker below.
7. **Dwellings render at batch001 dimensions** (~25% small) and the green is a plain
   stand-in ellipse, because the refined 91-symbol set and the batch-002 greens are not
   ingested into `src/assets/`. Expected, per the owner's ruling that the old glyph set
   and old engine retire together. Not a layout verdict.

---

## Known gaps, recorded not patched

**Pass-5 blocker — spec §5.4's converging-strip and inner-curve clipping is not
implemented.** `clipLots` does water and the green only. Measured: 89 cross-lane
lot-front pairs closer than 0.8× their mean frontage at pop 300, 337 at pop 900. Today
the building-level `overlaps()` gate masks it (leaving ~19 empty top-scoring lots per
run — holes near the green where the fill order says there should be none), so nothing
renders wrong. But pass 5 consumes lot *depth* for crofts and fields, so it will surface
there as crofts growing through each other. Fix it together with the two §5.7 property
tests the suite still lacks — "no two lots overlap" and "every lot's front lies on a lane
or the green" — in one considered change, as the first item of the pass-5 plan. Probably
the same root cause as gate observation 6.

**`urbanDensity` is dropped at the door.** `buildSite` does not carry it into `Site`, so
a caller's density preference cannot reach the deck. Spec §3 lists it in the census.

**`scoreLots` implements 2 of §5.5's 4 terms** — the corner and water-view bonuses are
absent.

**Branch bearings are measured from the wrong reference** (`lanes.ts`): a branch's angle
is taken against the green-radial direction to its parent's *first* point rather than the
parent's local direction at the branch anchor, so §4.4's "60–110° off the parent" is
inaccurate for second-order branches and wandering parents.

**Shadow offset does not scale with zoom** (`render.ts`) — it is in raw pixels, where the
old engine's equivalent is in model units.

**`sm-green-d` is chosen whenever the green's *initial* position was wet**, even if the
push later cleared the water entirely; and `Green` carries no water-facing direction, so
§5.3's "lots on the flat edge face the water" has nowhere to read from.

---

## Rulings made during the build

Twenty decisions taken on the owner's behalf. Each is recorded with its reasoning and
what it costs if wrong; the list below is the index.

| # | Ruling |
|---|---|
| R1 | The in-repo manifest is the retired batch001 generation — do not regenerate it; tests assert delegation, not values; decks drop entries whose glyph is absent |
| R2 | Dwellings report `free` rotation while batch001 is loaded (a dated, self-removing shim), else nothing would face its lane |
| R3 | Task 6's water fixture never clipped the green — fix the fixture, not the implementation |
| R4 | A lane's first point sits exactly on the green's rim (emit, then accumulate drift) |
| R5 | Landmarks take the best lots; the spec does not say *which* landmark wins |
| R6 | Sea routes never become land lanes |
| R7 | The widened route vocabulary is narrowed at the boundary into the old engine, so a `trail` cannot silently acquire a road's weight |
| R8 | Green diameter: the cap beats the class floor when they conflict |
| R9 | The water push direction derives from the water, not from an arbitrary arm |
| R10 | Invented green-attached lanes get their own id space (`lane-NNN`), so identity cannot change meaning between regenerations |
| R11 | Setback is per lane class (1.5–3 m), not a flat 2 m |
| R12 | Seating honours the glyph's rotation class from the manifest |
| R13 | The size bound applies to the non-semantic multipliers; `sizeFactor` is deliberately outside it |
| R14 | Capped landmarks retry the next eligible lot rather than being skipped on a collision |
| R15 | Tail trimming goes by provenance: FMG arms are never trimmed; unused invented lanes are dropped |
| R16 | The frontage loop measures the actual mean lot frontage and escalates on the measured shortfall |
| R17 | The renderer emits standalone SVG and draws a stand-in green |
| R18 | `<use>` of a viewBox'd `<symbol>` needs explicit width/height — or plain `<g>` defs, which is what was chosen |
| R19 | Final-review fix wave scope: eight findings in one wave |
| R20 | Spec §5.4's converging-strip clipping is the pass-5 blocker, recorded not patched |

---

## Process notes worth keeping

- **Nearly every task found a genuine defect in its own brief.** The plan was wrong about
  the green's clamp direction, the ring's coordinate origin, the frontage loop, the size
  bound, the shadow markup and more. Implementers that stopped and said "these two things
  cannot both be right" were the single most valuable behaviour in the build.
- **Two of the three most serious bugs were found by running and looking, not by
  reading.** The frontage loop silently housed only 74% of a 900-person village while
  every unit test passed, and the first render was a solid black mass while the tests
  happily counted the right number of buildings.
- **Five times a guard shipped that no test would have noticed if deleted.** Worth
  watching for as a pattern rather than five coincidences.
