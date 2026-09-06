# Village Pass 5 — Dressing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dress the gate-4-passed village fabric — crofts, fields, vegetation, POIs — per spec §7, up to a render gate. Starts by paying the R20 debt (§5.4 converging-strip clipping) because everything in this plan consumes lot depth.

**Architecture:** One new pure pass (`src/village/dressing/`) that runs after dwellings and lane relaxation, taking the finished fabric (lanes, lots, buildings, green, site) plus the seeded RNG, and returning claims: crofts, field bundles, vegetation, POIs. Each stage claims land the next must avoid — that ordering is what stops trees growing in the ploughed strips (§7). The renderer grows a real `parcel` band under the routes and a `canopy` band above the structures.

**Tech Stack:** TypeScript, zero runtime dependencies, vitest, nix develop. Metres, burg-local coordinates.

**Spec:** `docs/superpowers/specs/2026-08-20-roads-first-village-design.md` §5.4, §5.6, §7, §8.2–8.5.
**Prior gates:** gate 2 fixed the band order — route band first, green paints OVER routes; pass-5 fields paint UNDER routes. Keep it.

## Global Constraints

Everything from the pass 1–4 plan still binds, verbatim: metres; `SeededRandom` threaded as a parameter with draw order over sorted keys; stable structural ids; zero runtime deps; existing engine untouched; `nix develop` for every command; reuse `geometry.ts` / `glyphs.ts` / `constants.ts` — never a local angle helper, never an inlined tunable, `glyphs.ts` stays the only manifest reader; `.js` import extensions; commit after every task, no Co-Authored-By lines.

Additions for this plan:

- **Claims are polygons in claim order.** Crofts claim first, fields second, vegetation scatters into what is left, POIs are rule-gated points. A later stage takes the earlier stages' claims as an input it must avoid; no stage reaches back and edits an earlier claim.
- **One edge style per settlement** (§7.1): drawn once per village from biome/culture, used by crofts AND field boundaries. A village that fenced some plots and hedged others reads as an error.
- **Fields are a deck-like input, not a universal** (§7.2): per-biome crop tables; tundra/non-agri take pasture or nothing.
- **Water is neutral ground for scatter** (§7.3): no strip, no bonus, no avoidance beyond the shorefront rule.
- **Render bands** (§8.2): `parcel` (fields, crofts, edges — under routes) → route → green parcel → `structure` → `canopy`. Canopy shadows before canopy ink, offset outside rotation, same as structures.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/village/parcels/overlap.ts` | §5.4 rules 3–4: converging-strip and inner-curve clipping (R20) |
| `src/village/dressing/edges.ts` | The settlement's single edge style; stamping a boundary polyline |
| `src/village/dressing/crofts.ts` | Croft polygon behind each built lot; depth by frontage-gradient position |
| `src/village/dressing/fields.ts` | Wedges → furlong bundles → strips → crops per biome |
| `src/village/dressing/vegetation.ts` | Biome-density scatter, thinning outward, avoiding all claims |
| `src/village/dressing/pois.ts` | Well at the green, stone circle outside the fabric, boathouse on shore |
| `src/village/dressing/index.ts` | Pass-5 orchestration: crofts → fields → vegetation → POIs |
| `tests/village/overlap.test.ts` etc. | One test file per module |

`village-model.ts` gains the pass-5 call and the new model fields; `render.ts` gains the parcel and canopy bands. Both are modifications, listed per task.

---

### Task 1: Pay the R20 debt — §5.4 rules 3–4 plus the missing §5.7 property tests

The handoff measured 89 cross-lane lot-front pairs closer than 0.8× their mean frontage
at pop 300, 337 at pop 900. Today the building-level `overlaps()` gate masks it (~19
empty top-scoring lots per run); crofts consume lot DEPTH, so unclipped it surfaces as
crofts growing through each other. First task, on purpose.

**Files:**
- Create: `src/village/parcels/overlap.ts`
- Modify: `src/village/parcels/lots.ts` (`clipLots` calls the new pass), `src/village/village-model.ts` (nothing new — clipLots already runs per round)
- Test: `tests/village/overlap.test.ts`, extend `tests/village/invariants.test.ts`

**Steps:**
- [ ] `resolveConvergingLots(lots, lanes): Lot[]` — where two lots from DIFFERENT lanes claim overlapping ground (front distance below the sum of their half-frontages plus depth interference), the higher-class lane keeps its lot; the lower-class lane's lot is dropped if its front lies inside the winner's claim, or keeps a truncated `depthM` to the bisector otherwise. Class tie → nearer the green wins; still tied → lexically smaller lane id (stable, not array order).
- [ ] Inner curves (§5.4 rule 4): within ONE lane, where a tight bend folds the strip so consecutive lots' claims overlap (their fronts closer than 0.8× mean frontage along the chord), drop the later ordinal — the fold is removed, never squeezed.
- [ ] §5.7 property tests, across the seed×population probe grid: **no two lots overlap** (rect claims at frontage × depth) and **every lot's front lies on a lane or the green** (distance to its lane's offset edge or ring radius below epsilon).
- [ ] Measure and record in the commit message: empty top-scoring lots per run before/after (expect ~19 → ~0), housed census unchanged across the grid.

### Task 2: The settlement's edge style and the edge stamper

**Files:**
- Create: `src/village/dressing/edges.ts`
- Test: `tests/village/edges.test.ts`

**Steps:**
- [ ] `settlementEdgeStyle(biome, rng): EdgeStyle` — one draw per village: temperate {hedge .5, wall .2, fence .2, ditch .1}; desert/tundra favour wall/fence; `none` is a legal outcome and its probability rises for poor/small sites (population below the landmark threshold).
- [ ] `stampEdge(polyline, style): EdgeStamp[]` — walk the polyline, one `sm-edge-*` stamp per footprint length (8 m), each with position + bearing along the segment; no stamp across a lane corridor (edges break at gates/mouths).
- [ ] Types: `EdgeStyle`, `EdgeStamp { glyph, position, bearingDeg }`, ids `edge:<ownerId>:<i>`.

### Task 3: Crofts — toft → croft as one depth axis

**Files:**
- Create: `src/village/dressing/crofts.ts`
- Modify: `src/village/types.ts` (Croft), `src/village/village-model.ts`
- Test: `tests/village/crofts.test.ts`

**Steps:**
- [ ] For each BUILT lot (a building seated on it): croft = quadrilateral behind the lot, width = lot frontage, depth from the gradient position — zero where `frontageAt(d)` is within 10% of f0 (tight fronts have no gardens), rising to CROFT_DEPTH_MAX_M (25) at the fringe. Empty lots get no croft — straggle stays absence.
- [ ] Clip croft depth against water, lanes (a croft never crosses a lane corridor), the green, and other lots' claims (Task 1 makes these disjoint; keep the check as an invariant).
- [ ] Boundary = the croft's three open sides, stamped with the settlement edge style (Task 2); the lane-facing side is open.
- [ ] Croft id = its lot id (`croft:<lotId>`); deterministic order by lot score then id, same as the fill.
- [ ] Tests: no croft overlaps a lane corridor or another croft; croft depth 0 near the green at pop 900 (tight fronts), >0 at the fringe; determinism.

### Task 4: Fields — wedges, furlongs, crops

**Files:**
- Create: `src/village/dressing/fields.ts`
- Modify: `src/village/types.ts`, `src/village/village-model.ts`, `src/village/constants.ts`
- Test: `tests/village/fields.test.ts`

**Steps:**
- [ ] Wedges: the angular sectors between adjacent green-attached lanes (sorted by bearing), from the croft line outward to FIELD_RADIUS = builtRadius × FIELD_RADIUS_FACTOR (census-eating cap, §7.2 rule 1). Wedge id from its two bounding lane ids.
- [ ] Clip each wedge against water, all crofts, all lot claims, and the lanes' corridors.
- [ ] Furlongs: subdivide each wedge into strips FURROW_WIDTH_M (~12) wide, one furrow direction per bundle, neighbouring bundles rotated — direction = the wedge's bisector bearing ± jitter, alternating the perpendicular between adjacent wedges (§7.2 rule 3, the patchwork).
- [ ] Crops per biome table: temperate cycles plough/stubble/fallow with occasional orchard/vine near the fabric; desert → irrigated; tropical → paddy; tundra/steppe → pasture only; non-agri (fishing hamlet flag when it exists) → pasture or nothing. Alternate along the bundle so a handful of tiles yields a field system (§7.2 rule 4).
- [ ] Strip boundaries stamped with the settlement edge style (§7.2 rule 5), breaking at lane crossings.
- [ ] Ids: `field:<wedgeId>:S<i>`. Tests: strips within a bundle share a direction, adjacent bundles differ, nothing overlaps a croft/lane/water, determinism, tundra gets pasture only.

### Task 5: Vegetation — scatter into what is left

**Files:**
- Create: `src/village/dressing/vegetation.ts`
- Modify: `src/village/types.ts`, `src/village/village-model.ts`, `src/village/constants.ts`
- Test: `tests/village/vegetation.test.ts`

**Steps:**
- [ ] Poisson-ish dart throwing on a seeded grid (deterministic: iterate grid cells in sorted order, one rng draw each): density from biome, thinning with distance from the fabric centre by VEG_FALLOFF, cut off at VEG_RADIUS_FACTOR × builtRadius.
- [ ] Rejection: lanes (corridor + margin), lots, crofts, field strips, the green, water surfaces. Water BANKS are neutral — no bonus, no avoidance (§7.3).
- [ ] Shorefront suppression (§8.4): within builtRadius × 1.5 of the fabric, scatter on the bank stretch is suppressed; beyond it ordinary scatter resumes.
- [ ] Glyphs by biome: temperate deciduous/deciduous-small/conifer mix; desert olive/palm-date/scrub; tundra conifer--tundra/snag; tropical broadleaf/palm-fan; coastal dune-grass/tamarisk. Clumps: a successful dart spawns 0–3 neighbours within CLUMP_RADIUS_M.
- [ ] Ids `veg:<cellX>x<cellY>`. Tests: nothing on a lane/lot/croft/field/green/water; density falls with distance; determinism.

### Task 6: POIs — capped, rule-gated placements

**Files:**
- Create: `src/village/dressing/pois.ts`
- Modify: `src/village/types.ts`, `src/village/village-model.ts`
- Test: `tests/village/pois.test.ts`

**Steps:**
- [ ] Well (`sm-well`, biome variant) at the green's centre, nudged off any under-green lane centreline by its own radius; every village of pop ≥ WELL_MIN_POP (40) gets one. The green is the one place a structure may sit on `parcel` ground.
- [ ] Stone circle (`sm-stone-circle`): probability STONE_CIRCLE_CHANCE (~0.08), placed OUTSIDE the fabric at 1.5–2× builtRadius on a bearing clear of lanes and fields by its 30 m footprint; skipped when no clear bearing exists (fail soft, §8.5).
- [ ] Boathouse (`sm-boathouse--coastal`): coastal sites only, on the §8.4 shorefront stretch nearest the green, facing the water. (No pier glyph in the refined set — boathouse is the shorefront POI until one exists.)
- [ ] Ids `poi:well` / `poi:stone-circle` / `poi:boathouse`. Tests: well present and clear of lane corridors; stone circle absent from the fabric's claimed ground; determinism; landlocked site → no boathouse.

### Task 7: Renderer — parcel band under the routes, canopy above the structures

**Files:**
- Modify: `src/village/render.ts`
- Test: extend `tests/village/render.test.ts`

**Steps:**
- [ ] Band order (§8.2 + gate 2): field strips and crofts (`parcel`, textures via SVG `<pattern>` defs built from the vendored pattern glyphs, one def per used tile), then edge stamps, then the ROUTE band (unchanged), then the green parcel OVER the routes (unchanged), then structures (buildings + well + stone circle + boathouse in the existing shadow-then-ink order), then canopy: all tree shadows, then all tree ink, offset outside rotation.
- [ ] Field/croft polygons are clipped shapes filled with the pattern; strip boundaries are the edge stamps, not strokes.
- [ ] `parcel` casts and receives no shadow (§8.2). Patterns tile in world units (16 m tiles), anchored to the village origin so neighbouring strips don't visibly seam-shift.
- [ ] Regression: `<pattern>` defs must carry explicit width/height/patternUnits (the `<symbol>` viewport bug's cousin); test asserts the def shape and that a field strip's fill references an emitted def.

### Task 8: Probe, render gate, page

**Steps:**
- [ ] Extend `probe-village` output: crofts, field strips, trees, POIs per village; assert census/extent unchanged from gate 4.
- [ ] Full suite + determinism (same seed → identical SVG bytes).
- [ ] Render the ten-panel sweep (60/150/300/600/900 × 2 seeds) plus one coastal and one through-route village; **look at every panel** before showing the owner (the visual-work-needs-eyes rule; twice the worst bugs were invisible to tests).
- [ ] Rebuild `~/settlemaker-village-gate` as gate 5 with captions and a what-changed note. Await the verdict.

---

## Explicitly out of scope

Themed SVG + GeoJSON output parity, and population routing — both queued AFTER this
gate. `urbanDensity` into `Site` and the §5.5 corner/water-view score terms stay
recorded debts unless a task above trips over them.
