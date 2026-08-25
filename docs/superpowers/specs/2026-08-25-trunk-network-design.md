# Trunk Networks: the Boundary Contract for Village Roads

**Date:** 2026-08-25
**Status:** Approved design, awaiting implementation plan
**Owner:** Barry — every render gate in this work is his call
**Source material:** the owner's three sketches (through / crossroad / royal), `assets/2026-08-25-trunk-network-sketches.jpeg`. Where this spec and the sketches disagree, the sketches win.
**Supersedes:** the arm model of `buildArms` (each FMG route drawn as a near-straight radial from the green rim); `INCOMING_ARM_MERGE_DEG` input merging; Phase 1's open "fan bare arm-tips" visual question.
**Preserves:** all of Phase 1's interior-fabric machinery (budget-exempt seeded roads, rib/arc/coverage/void growth, weld-protected loop closure, block-aware escalation chase with faithful snapshot/restore, lot placement, census spending) and every numeric standing bar.

---

## 1. The problem this solves

Phase 1 (multi-route robustness, complete at `52181a8`) fixed the numbers: at 3–8 incoming routes the census houses 18/18, blocks close 18/18, and the interior meshes. The pictures still failed the owner's eye: N routes drawn as N near-straight spokes converging on the green makes every junction settlement look like a pizza, however good the fabric between the slices is.

The owner's diagnosis goes deeper than the symptom: **real routes do not all converge on the town centre.** Inward roads merge with each other before the town, thread it as a network, and diverge again after leaving. The green is a place the network serves — not the hub everything radiates from. The generator's topology, not its geometry, is what is wrong.

## 2. The inversion, stated once

Today: green first → arms radiate from its rim → fabric grows on the arms.

After this work: **contract circle first → trunk network synthesized from the circle inward → green sited relative to the network → fabric grows on the network.**

Roads-first, finally literal.

## 3. Owner rulings recorded (2026-08-25)

These are decided; do not re-open them in implementation:

1. **The contract circle is purely a routing contract.** We choose its size per settlement. It is not a render or tile boundary.
2. **How many roads reach the centre is emergent from the merge rules.** No fixed target.
3. **Merges are class-aware** — a smaller road merges into a larger one where they come close enough — **and staggered**: merge points happen at varying stages, before, at, or just after housing begins.
4. **No placement rule for the green is hard.** The generator has complete creative freedom to pick the most appropriate relationship per situation. Worked example from the owner: a route TERMINATING at a burg fed only by footpaths/trails should terminate at the green, and the footpaths terminate on a road between houses (or on the route). Greens astride roads are already supported by the green-shape library and are a legitimate choice.
5. **An FMG "crossroads" does not have to mean a perfect junction point** — a perfect junction remains a possibility, one pattern among several (owner's option (b)).

## 4. Reading of the sketches (the aesthetic contract)

- **Panel 1 (Through):** FMG's hatched route stubs exist only at the frame edge. Inside, the through route is ONE meandering road S-curving through the settlement, passing beside the green (green in a crook of the curve, well inside it); houses line the road and short side lanes; fields fill wedges; the henge sits off-network among fauna.
- **Panel 2 (Crossroad):** four entries, no X. The approaches land at staggered junctions on an irregular loop around the core; the green sits inside the loop, fed by streets crossing it. (Pattern status: one of several — ruling 5.)
- **Panel 3 (Royal):** the royal road sweeps through in one confident, gentle curve and does not deviate for the village; the village organises around it. The green sits just off the road, reached by short lanes. Minor routes join the network at staggered points.
- **Across all three:** class dominance is geometric (the bigger the road, the stiffer its curve; smaller bends to meet larger), junctions are staggered rather than coincident, and the green is a resident of the network.

## 5. Design

### 5.1 Contract circle and entries

- Default radius: a factor (initially ~2.5–3×, tuned at gate 1) of the expected built extent derived from population via the same closed forms the disc machinery already uses. **Never `predictedBuiltRadius`** (standing method rule; four historical defects). Overridable per settlement via `GenerationParams`.
- Each FMG route → an **entry point** on the circle at its bearing, carrying `route_id`, class, kind, `through`, and (inert today) `relief`/`followsRiver`. A through route yields two entries, near and far bearing.
- **No input merging.** FMG sent three routes at 90.0°/90.5°/91.2° → three entry stubs at the boundary. They merge within the first metres inside because the merge rules make it so. `INCOMING_ARM_MERGE_DEG` is retired; contract fidelity at the boundary improves over Phase 1.

### 5.2 Trunk synthesis

A new module builds the trunk network from the entries inward, before any green or fabric exists.

- **Class stiffness.** Highest class present draws first. Royal/main roads: large-radius, low-deflection curves that refuse to deviate much for the village (panel 3). Town roads: moderate curvature. Tracks/trails: wander. Smaller classes bend to meet larger; never the reverse.
- **Staggered, class-aware merges.** A lesser trunk merges into a greater one when within a class-dependent capture distance. Merge points are seeded into three bands: in the fields, at the built edge, just inside housing (ruling 3). No forced separations, no forced merges.
- **Convergence palette** (seeded, context-weighted; ruling 5): whatever survives merging resolves as one of —
  - staggered-Y tree (routes pairwise-merge into 1–3 roads before the core),
  - irregular core loop with staggered landings (panel 2),
  - main street with side roads landing on it (panels 1, 3),
  - true perfect junction (rare),
  - terminal-at-green (terminating route, trail-fed burg; ruling 4's worked example).
  Weights come from context: route count, class mix, presence of a through/royal route, population.
- **Aim.** Synthesis aims its convergence zone at the FMG burg point, so the network always arrives near the nominal centre.
- **Determinism.** Entries sorted stably; every choice drawn from the existing `SeededRandom` stream. Same seed + same input → same network.

### 5.3 Green siting

The green is sited relative to the finished trunk network, near the burg point, choosing one of four relationships — seeded, weighted by what the network actually did:

- **astride** (road runs through the green — existing pass-through green shapes),
- **tangent** (green in a crook, beside the main road; panels 1, 3),
- **terminal** (route ends at the green; ruling 4's example),
- **enclosed** (inside a core loop; panel 2).

The well stays in the green. Where the green is not directly on a trunk, short connector lanes tie it in. No relationship is hard-ruled (ruling 4); the weighting must make the choice read as a consequence of the roads.

### 5.4 Growth integration (trunks replace arms)

- Trunks seed `saturateDisc` exactly as arms do today, **budget-exempt** (Phase 1's rule: the growth budget governs only what the village adds). `isFmgArm` generalises to a single exported `isTrunk` helper with a proper id namespace.
- Ribs, arcs, coverage lanes, void fills attach along trunks as they do along arms today. Weld-protected loop closure, block chase, snapshot/restore, lots, census: unchanged.
- Trail-class entries terminate on the network between houses or on a route (ruling 4) — they never demand their own line to the centre.
- Fabric anisotropy arises primarily from trunk geometry (houses strung along curved roads) — the honest version of the number the anisotropy bar measures.
- The starfish dies structurally: between built edge and circle an approach road is simply a road crossing fields, and only as many exist as survive the merges (typically 2–4, curved).

### 5.5 Ids, provenance, output contract

- **Stable ids (R-series invariant):** trunk ids are content-derived from route id + bearing + class; junction ids derive from the trunks that meet. Growth-invented lanes keep their existing scheme.
- **Provenance:** trunks accumulate the `route_id`s they serve as merges happen; a segment carrying three merged routes lists three. Phase 4's GeoJSON echoes the list. (This resolves Phase 1's duplicated-provenance question: sharing is the point.)
- **Boundary alignment:** at the circle each entry stub is exactly one FMG route at its exact bearing. The circle radius is exported as a model/GeoJSON property so consumers can align our tile with FMG's route lines. Phase 4 (output parity) inherits this as a requirement.

### 5.6 Gates, bars, tests

- **Render gates (owner's eyes, in the project's established gate style):**
  - **G1 — trunks alone:** bare road networks over empty ground for scenarios matching the three sketch panels (plus the existing tri/hub/fan). Stiffness constants, capture distances, and pattern weights are tuned here. Nothing else starts until G1 passes the owner's eye.
  - **G2 — green + fabric:** green siting and full growth on trunks.
  - **G3 — acceptance matrix re-run:** full scenario × population × seed sweep.
- **Bars:** every Phase 1 numeric bar stays (census housed or explicit diagnostic; zero crossings/stubs; laneless sector; ink-gap medians; land use ≥65% BODY; blocks ≥2/≥6; anisotropy ratio/cv; polar share). The matrix is **re-baselined** — the topology change invalidates Phase 1's numbers, including its four carried marginal items. "No starfish by eye" is superseded by "reads like the sketches", judged by the owner at each gate.
- **Structural tests:** every FMG route reaches the circle at its bearing; no trunk crossings without a junction; trails terminate on the network; entry stubs never merged at the boundary; determinism per seed. Unit tests for merge capture, class stiffness ordering, pattern selection weights.
- **Method rules carried forward:** nothing keys off `predictedBuiltRadius`; new visual metrics validated against a known-bad render before trusted; rasterise and LOOK before claiming a visual bar; exploratory work committed on a scratch branch before revert.

## 6. Explicit non-goals

- **Bypass at village scale** is in the palette only implicitly (a loop is bypass-adjacent); a deliberate long-way-around bypass treatment is city-scale work, deferred with the cities phase.
- **Rivers/bridges, `followsRiver`, `relief`:** deferred as before; entries carry the fields so the trunk module can consume them later without contract change.
- **Cities:** the trunk primitives are designed to survive the jump (same intent as the village primitives), but nothing here implements city-scale.
- **POI/glyph placement** (cathedrals, henges, inns): explicitly a motivation for this architecture (glyphs want frontage: an inn at a junction, a henge off-network) but not implemented here — the trunk network just makes it possible.

## 7. Ship-plan impact

This becomes the **new first item of the remaining ship plan**, before Phase 2 (paint the water), in `docs/superpowers/plans/2026-08-24-village-afmg-readiness.md`. Phases 2–5 are unchanged in content; their baselines re-measure after this lands. Phase 1's carried open items (fan arm-tips visual; 4 marginal non-seed-1 bar readings) are superseded/re-baselined by this work — recorded in the SDD ledger.
