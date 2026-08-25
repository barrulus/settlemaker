# Village Engine — AFMG Readiness and Ship Sequence

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** take the roads-first village engine from "accepted at the render gates" to "usable in production against real AFMG data", in the order the owner approved on 2026-08-24.

**Where this came from:** the AFMG contract simulation (`scripts/probe-afmg.ts`, committed a7bb2d5; findings in the fix-wave report under "AFMG contract simulation"). It fed realistic AFMG-shaped input at pop 300/900 and measured what today's engine does with it.

**Branch:** `roads-first-village` (worktree `.claude/worktrees/roads-first-village`), UNMERGED, at `a7bb2d5`, 962 tests green.

---

## Standing bars — every phase below must hold these

The density and anisotropy campaigns (gates 5–8) are ACCEPTED work. No task in this plan may regress them. Re-measure with `scripts/gate-metrics.ts` and `scripts/probe-village.ts`, and report per fixture (300 s1, 300 s2, 600 s1, 900 s1, 900 s2):

- census fully housed, or an explicit diagnostic naming the shortfall — never silent;
- zero lane crossings; zero stubs; interior dead ends closed; widest laneless sector < 60°;
- painted-ink gap medians ≤ 1.6 m, measured between genuine consecutive neighbours;
- land use ≥ 65% at 6 m on the BODY denominator (the ink-based variant reads ~87% and flatters — never gate on it);
- enclosed blocks ≥ 2 at pop 300, ≥ 6 at pop 900 where achievable;
- fabric anisotropy: long/short axis ratio ≥ 1.5, cv ≥ 0.15;
- field parcels non-polar: curved perimeter share ≤ ~33%.

**Method rules, learned the hard way:**
- Nothing downstream of growth may key off `predictedBuiltRadius` (it under-predicts the real fabric ~2.5×; this has caused four separate defects).
- Any new visual metric must be validated against a render KNOWN to have the defect before it is trusted — one round's first metric scored a known-bad ring as good.
- Rasterise and LOOK before claiming a visual bar. Metrics have passed while the picture was wrong at least three times.
- Commit exploratory work on a scratch branch before reverting it.

---

## Phase 1 — Multi-route robustness (AFMG's common case)

**Why first:** AFMG junction burgs routinely carry 5–8 routes. Measured today: five routes at pop 300 → **90 of 300 unhoused, zero blocks, a visible starfish**; eight routes → 104 unhoused, 49 buildings, and three roads drawn splayed ~1° apart. This is the accepted density work silently failing on realistic input, and it lands the moment the contract does.

- [x] Reproduce from the probe (`hub`, `fan` scenarios) and instrument WHY the census starves: is it arm count eating the lane budget, coverage seeding competing with the arms, or lots dying at the extra junction mouths? Report the numbers before changing anything — the lot-death histogram (`scripts/probe-lots.ts`) is the tool. *(Done ab72dbf: arms spend 115%/172% of the round-0 lane budget; coverage-seeding and junction-mouth deaths ruled out by measurement.)*
- [x] Fix the mechanism the data names. Likely candidates, in the order the evidence has favoured before: arms should not each demand their own coverage sector; the growth budget must count only frontage that can carry lots; near-identical bearings should merge into one arm rather than three splayed ones. *(Done ec785b3..61ec22e: FMG arms exempt from the growth budget; block-aware escalation chase with faithful snapshot/restore. Plus a1fa796..7a87432: growth-time loop closures survive trimming — the block-closure half of the same starvation.)*
- [x] Near-duplicate bearings: define and apply a minimum separation for INCOMING arms (they currently only de-duplicate ids, not geometry), so 1.2° apart becomes one road, not three. *(Done 5bc1fa5: `INCOMING_ARM_MERGE_DEG = 5`, highest-class survivor, `sourceRouteIds` provenance.)*
- [x] Acceptance: at 3, 5 and 8 routes, pop 300 and 900 — census fully housed, blocks ≥ 2 / ≥ 6, no starfish by eye, all standing bars hold. *(Measured 0439db3/7a87432: census 18/18, blocks 18/18, crossings/ink-gap/land-use/polar 18/18 across tri/hub/fan × 300/900 × seeds 1-3. Open, carried to Phase 6 in the SDD ledger: fan arm-tips visual awaits the owner's render call; 4 marginal non-seed-1 bar items — hub300s2 cv 0.148, tri300s3 sector 80°, tri300s2 cv 0.123, tri900s2 stubs 1/3.)*

## Phase 2 — Paint the water

**Why:** `src/village/render.ts` contains the word "water" zero times. Water constrains the model but is never drawn, so every coastal/river render is a village with an unexplained bite out of it — and we have been judging those renders blind. Renderer-only; no model change.

- [ ] Paint water polygons in a band beneath the parcel band (the old engine's `svg-builder.ts` water pass is the reference for palette and layering; do not import from it — the village engine stays independent).
- [ ] Shoreline treatment consistent with the refined asset set; `data-bg="paper"` contract untouched.
- [ ] Acceptance: coastal and river scenarios render with legible water; a landlocked village is byte-identical to today; render tests extended.

## Phase 3 — Narrow water is an obstacle, not a boundary

**Why:** the profile caps each bearing at the shore, so a **4 m brook stretched a pop-900 village into a 7.2:1 sliver** (baseline 3.3:1). Separately, fields respect water but lanes and houses do not: 43–82 m of lane runs through the river with no bridge, and because `clipLots` tests only the frontage midpoint, **houses stand in the water**.

- [ ] Classify water by width at the point of contact: below `NARROW_WATER_M` it is an obstacle (locally avoided), at or above it is a boundary (caps the radius profile as today).
- [ ] Buildings: clip against the whole claim/ink footprint, not the frontage midpoint — no house may stand in water.
- [ ] Lanes: either avoid narrow water or mark the crossing as a `bridge` in the model (RENDER ONLY IF CHEAP — full bridge geometry belongs to the deferred rivers work; a marked crossing is enough for now).
- [ ] Acceptance: the brook scenario returns to ~baseline anisotropy; zero buildings in water at every scenario; the strangled-site case (water on three sides) emits a diagnostic instead of silently collapsing farmland 145k → 8.9k m².

## Phase 4 — Output parity

**Why:** today the village engine emits its own SVG only. Every existing consumer — settlemaker.com, the `/fmg` endpoint, settlement-tiler — expects the old engine's contract.

- [ ] Themed SVG via `render-theme.ts` (parchment default), honouring the `data-bg="paper"` rect the tiler's `cropSvgToTile` depends on.
- [ ] GeoJSON v4 feature parity: buildings, lanes (with route class and `route_id` echoed), green, fields, water, POIs — matching the existing schema's property names.
- [ ] Stable ids across both outputs (the structural-id invariant, R-series rulings).
- [ ] Acceptance: a village round-trips through the same consumer path as an old-engine settlement; golden-file tests for both outputs.

## Phase 5 — Population routing

- [ ] Route by population at the documented ceiling (`VILLAGE_POP_CEILING` = 1000): below → village engine, above → existing engine.
- [ ] One entry point for callers; the choice is an implementation detail, not a caller decision.
- [ ] Acceptance: a sweep across the boundary produces valid output either side with no contract difference visible to a consumer.

## Phase 6 — Merge and ship

- [ ] Whole-branch review (superpowers:requesting-code-review) on the most capable model.
- [ ] Resolve the deferred-minor list carried in the fix-wave report.
- [ ] superpowers:finishing-a-development-branch → merge to master, release bump, submodule bump for settlemaker-web.
- [ ] Owed operational tasks: rucio tile cache wipes (two outstanding from earlier releases).

---

## Deferred, deliberately — after ship, and built ONCE for both engines

- **Rivers and bridges properly:** crossable water, fords, bridges, riverside frontage. A parked branch (`rivers-bridges`) exists with river-independent bug fixes worth cherry-picking. This is shared with the city work — build it once.
- **Cities, roads-first:** the remaining half of the original rethink. The village primitives (lanes, parcels, ink economy, anisotropic growth, planar field subdivision) are meant to survive the jump.
- **`followsRiver`** (inert today): drive the lane polyline — a low-frequency meander scaled to lane length, plus a green-siting bias to sit beside the water rather than astride it.
- **`relief`** (inert today): a fourth, non-random per-bearing term in `buildRadiusProfile` with angular falloff — valley/descent extend the body, ridge/ascent compress it. The profile's mean-square normalisation trades ground between bearings, so it costs no census.
- **Asset debt:** non-temperate trees have no shadow twins in the refined set.
