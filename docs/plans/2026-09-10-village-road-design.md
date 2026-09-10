# Village road design: implementation plan

Date: 2026-09-10

Branch: `improve/village-road-design`

Baseline: `aa841a4` (`master`, v2.3.0)

Status: implemented and validated on `improve/village-road-design`.

See [implementation results](2026-09-10-village-road-results.md) for measurements,
commands, engineering refinements and remaining calibration limits. The checklist
records the implemented outcomes; conditional alternatives such as variable-width
road geometry were evaluated without adding unnecessary public-model changes.

## Outcome

Make villages consistently attractive across settlement sizes: a handful of homes needs a handful of access routes; a larger village can support streets, courts and useful loops. Roads should bend smoothly, meet deliberately and occupy space appropriate to their use. Preserve the existing building artwork, compact fabric in successful larger villages, and connections to the surrounding map.

The governing rule is **use existing frontage first, then add road only when it provides useful capacity or access**. Geometry, placement and rendering must agree about where that road is and how much space it occupies.

This is a coordinated change to the village engine, delivered in reviewable phases. It does not require a replacement city generator or a new user-facing collection of tuning switches.

## Evidence and baseline limitations

The initial review generated 24 inland temperate villages with one legacy `road` at 225 degrees: populations 40, 80, 119, 120, 150, 300, 600 and 900, seeds 1–3. Fourteen renders were inspected. Internal length excludes `isTrunk` lanes and includes village branches and green connectors.

| Population | Buildings | Internal road length across three seeds | Metres per building |
|---|---:|---:|---:|
| 40 | 8 | 165–292 m | 20.6–36.5 |
| 80 | 16 | 251–379 m | 15.7–23.7 |
| 150 | 38 | 275–381 m | 7.2–10.0 |
| 300 | 69–76 | 440–678 m | 6.4–8.9 |
| 600 | 147–151 | 973–1,120 m | 6.4–7.6 |
| 900 | 224–225 | 1,590–2,051 m | 7.1–9.2 |

At population 40, 77–87% of internal length has no directly assigned buildings. That alone does not prove redundancy: roads can serve buildings indirectly. The renders also show long loops around empty ground.

Population 150, seed 1 has a 164-degree heading reversal inside `lane-049/b77`. This is a bend within a street, not an intersection angle.

The 77 assertions in the initial targeted test run passed, but Vitest exited unsuccessfully with an unhandled worker `onTaskUpdate` timeout. Establish a clean baseline during phase 1; do not describe that earlier run as green.

Local review artifacts currently live under ignored `output/road-review/`. Phase 1 makes the evidence reproducible from tracked fixtures and tooling, without relying on those files or absolute paths in the temporary probe.

## Design commitments

1. Existing usable frontage counts towards demand. Long external approaches neither pay for distant housing nor consume the village's entire local-road allowance.
2. A short inhabited dead end is valid. A loop needs a capacity, access or meaningful shortcut benefit. Empty sectors can remain gardens, vegetation or open land.
3. Settlement character changes gradually with dwelling demand and available space. Population thresholds must not abruptly force a ring network onto a hamlet.
4. In larger villages, compactness and useful block formation remain preferences. Reducing road length must not recreate long radial ribbons and empty wedges.
5. Smooth each accepted road before committing its lots. The renderer uses the same sampled centreline used by collision, parcel, water and export code.
6. Preserve regional route class and route identity. Local service role, road surface width and roadside space are distinct concerns.
7. Keep deterministic results for identical inputs within the new generator version. Layout changes from v2.3.0 are expected; preserve public contracts and referential integrity rather than historical generated coordinates.
8. Every search and feedback pass has a bounded cost and a recorded reason for accepting, rejecting or stopping growth. Avoid replacing the current rules with an unbounded optimiser.

## Protected contracts

- Every supplied land route retains its required representation, identity/provenance, contract-circle entry and connection to the visible tile edge where the existing contract requires it.
- Aprons remain obstacles to crossing, while remaining outside local frontage, coverage and growth-budget calculations.
- Housing, lot references, landmark access, water clearance, building overlaps and road connectivity remain valid after every committed change.
- SVG and GeoJSON agree on geometry and width semantics. Preserve schema, coordinate frame, scale and alignment metadata; document any additive width properties.
- The village/city routing boundary remains 1,000 inclusive. Include city controls because shared route-class helpers are imported by the city input mapper.
- No deployment, publication or release is part of completing this branch's implementation.

## Phase 1 — Reproducible comparison and diagnostics

Primary files: new `scripts/review-village-roads.ts`, shared fixtures under `tests/fixtures/`, relevant metric helpers, `package.json` and `tsconfig.scripts.json` as needed.

- [x] Create one typed fixture catalog consumed by the visual report and focused regressions.
- [x] Preserve the initial 24-case panel and add a curated stress panel: no supplied road, trail-only, explicit local/main/royal roads, an opposed through pair, three routes, close bearings, coastline and constrained-water sites, landmarks, and different dwelling decks.
- [x] Include boundary cases around 119/120/121, 899/900 and 1,000/1,001. Use representative combinations rather than a costly full Cartesian product.
- [x] Produce a standalone HTML comparison with before/after views, seed and input labels, a roads-only overlay, buildings, widths and a scale bar. Provide both matched-scale detail and whole-settlement views.
- [x] Record JSON metrics: required-route length separately from internal length; housed population; ordinary dwelling count; metres per dwelling; occupied frontage; length without direct frontage; components and access failures; loops; severe bends; runtime and feedback rounds.
- [x] Measure turns at a fixed physical sampling distance and estimate bend radius so denser sampling cannot make an angular street appear improved numerically. Separate bends from junction angles and ignore degenerate segments.
- [x] Capture baseline outputs from `aa841a4`, with input, seed, revision and tool configuration recorded. Keep heavy renders in `output/`; track the small fixtures and measurement baseline needed for reproducibility.
- [x] Reproduce and diagnose the prior runner timeout. Check worker contention and repeated generation before changing timeout settings; retain every assertion.

Completion: a documented local command regenerates the panel without the web repo, a running server, an absolute workspace path or a new dependency download. Baseline failures are explicitly recorded.

## Phase 2 — House hamlets before growing a network

Primary files: `src/village/village-model.ts`, `skeleton/lanes.ts`, `constants.ts`; extract a small frontage/placement evaluator if it makes the existing passes reusable.

- [x] Extract a deterministic evaluation of existing lanes using the real lot clipping, overlap resolution, dwelling deck and census rules. Include green frontage and planned landmark reservations.
- [x] Attempt initial housing on supplied routes and green access before calling mesh growth.
- [x] Remove the branch-spacing-derived minimum radius as an instruction to fill a hamlet with roads. Keep required geometric clearance around the green and landmarks.
- [x] For unmet demand, offer short access lanes sized from the remaining buildable frontage need. Keep inhabited dead ends and stop when the census and required access are satisfied.
- [x] Blend towards clustered street growth as dwelling demand increases. Avoid adding another hard population threshold that only moves the current discontinuity.
- [x] Allow sensible compact forms: homes along a road, a cluster around a green, or a short branching lane. A roadless input must still obtain a usable internal access structure.
- [x] Use isolated or replayable random streams for trial evaluations. Rejected candidates must not randomly redraw standing houses or consume the final dressing stream.

Completion: all eight homes are housed in the population-40 fixtures, required routes remain intact, and the empty peripheral loops are removed. Aim for at least a 50% reduction in median internal length on the original population-40 panel; treat this as an initial visual calibration target, not a universal rule that overrides valid access.

Add meaningful regressions for existing frontage satisfying demand, a necessary short branch, a valid inhabited dead end, and access in a roadless hamlet. Keep larger-village visual controls in the report throughout.

## Phase 3 — Useful growth and safe removal of redundant links

Primary files: `skeleton/lanes.ts`, `skeleton/blocks.ts`, `skeleton/relax.ts`, `village-model.ts`; proposed focused modules `skeleton/network.ts` and `skeleton/growth.ts`.

- [x] Introduce an internal graph view with junctions and edges split at actual attachments. Preserve public lane IDs and provenance through an adapter; avoid an unnecessary public-model rewrite.
- [x] Associate occupied frontage and required destinations with graph edges. Treat access through the green explicitly so green-fronting buildings are not misclassified as disconnected.
- [x] Reuse current branch, arc and extension primitives as candidate generators, then rank a bounded candidate set rather than accepting the first geometrically possible action.
- [x] First reject water conflicts, crossings, lost access and infeasible geometry. Then compare additional buildable capacity, required access and shortcut benefit against road length, junction crowding and unusable leftover land.
- [x] Credit usable existing frontage; measure the marginal gain after clipping and convergence instead of treating every metre of centreline as two successful rows of houses.
- [x] Retain compactness and useful block formation as preferences for larger settlements. Replace compulsory block floors and block-chase rounds once the new selection policy covers their useful purpose.
- [x] Replace blanket dead-end connection with a benefit check. Shortcuts must save meaningful absolute and relative route distance for occupied destinations, not merely connect two nearby points.
- [x] Remove redundant edges or empty loop sections while preserving all required route continuity, every occupied access path and surviving parcel references. An empty lane that is the only route to homes remains necessary.
- [x] Revalidate graph attachments after trimming. Replace blanket connector/joiner exemptions with explicit dependency checks; do not delete empty lanes independently of their neighbours.
- [x] Preserve the best valid housed state across failed candidates and bounded feedback. Record capacity failure, geometry failure and exhausted search separately.

Completion: small settlements no longer retain empty loops just because their lanes protect one another. Larger settlements retain compact clusters and useful connections, without higher overflow or a return to sparse radial ribbons. Compare distributions and the worst fixtures, not only averages.

Tests should cover an empty redundant cycle, a necessary empty access edge, a useful shortcut, a useless shortcut, green access, and a failed growth trial preserving the last valid state.

## Phase 4 — Tangent-aware junctions and smooth centreline geometry

Primary files: `skeleton/lanes.ts`, `geometry.ts`, `skeleton/relax.ts`, `parcels/strip.ts`, `render.ts`; add a small shared curve helper where appropriate.

- [x] Reject snaps that make a road reverse towards its previous segment. Search attachment positions compatible with the approach direction and available junction spacing.
- [x] Replace the last stretch of a connecting lane with a bounded curve into its junction. Preserve a clear main-street continuation and allow genuine T-junctions.
- [x] Sample by chord-error tolerance and bend radius, with limits on sample count. Decouple geometric sampling distance from branch spacing and growth length.
- [x] Apply this to branch snaps, arc ends and post-growth connectors. Distinguish junction turns from kinks inside one continuing edge.
- [x] Finalise candidate curves before lot cutting. Recheck water, road intersections and usable frontage after smoothing; reject or locally retry candidates that no longer fit.
- [x] Pin shared junction positions during any later relaxation. Move incident edges coherently rather than pushing their endpoints independently.
- [x] Audit trim cutoffs and interpolate the actual endpoint where appropriate, preserving graph attachments and occupied frontage.
- [x] Add explicit round SVG joins. Rendering remains a presentation of accepted model geometry, with no separate renderer-only spline.

Completion: the observed population-150 seed-1 reversal is gone, short arcs read as curves, and junctions remain connected. The panel has no unexplained reverse-direction snap. Radius and chord-error limits are documented and checked alongside parcel and water clearance.

Tests should exercise backward snaps, a valid perpendicular junction, a curved join near a building or shore, shared-junction relaxation and export/render centreline agreement.

## Phase 5 — Road surface and roadside space appropriate to use

Primary files: `types.ts`, `route-class.ts`, `constants.ts`, `render.ts`, `geojson.ts`, `parcels/strip.ts`, `parcels/lots.ts`, `dwellings.ts`, dressing clearance consumers.

- [x] Inventory every `widthM` consumer and document current semantics before changing them.
- [x] Define a shared cross-section resolver: travelled surface, reserved corridor and frontage setback. Give existing models a backward-compatible default; preserve route-class vocabulary and legacy mapping.
- [x] Assign village-created lanes an initial service role from intended demand and access: small path, residential lane or busier village street. Avoid inferring demand solely from construction depth or parent class.
- [x] Calibrate widths against painted building dimensions, with the following initial *surface* ranges as experiments: paths about 0.8–1.2 m, lightly used access lanes 1.5–2 m, busier village lanes 2–3 m. These are art-direction starting points, not asserted historical standards or fixed acceptance limits.
- [x] Reconcile local widths, setbacks and usable capacity before final placement. If changed demand alters the cross-section, run a bounded reevaluation of affected lots; do not widen a road through committed houses.
- [x] Treat the current 55% minor-lane paint multiplier as a migration concern. Replace its hidden width/corridor mismatch with the explicit resolver once geometry and exports share the intended meaning.
- [x] Preserve the scale of explicitly supplied major routes. Review whether surface treatment and edge transitions make them read better through hamlets before considering any generic-input policy change.
- [x] Use consistent transitions where local streets meet wider roads. If variable-width geometry is introduced, provide matching collision and export semantics rather than an SVG-only taper.
- [x] Keep styling calibrated across themes, low zoom and cropped tiles. Assess the occupied roadside corridor as well as the coloured line.

Completion: paths and village streets have an obvious but restrained hierarchy; narrow roads allow appropriately close houses; no width changes introduce collisions or contradict exported geometry. City controls remain unchanged.

Tests should cover default compatibility, surface/corridor separation, close frontage on a path, a wider road's clearance, and SVG/GeoJSON width agreement.

## Phase 6 — Consolidate, validate and document

Primary files: the modules changed above, affected tests, README and relevant schema/API documentation.

- [x] Retire superseded block-chase, coverage, budget and trim rules rather than leaving conflicting policies active behind more constants.
- [x] Replace long historical implementation commentary in touched sections with the current rule and a link to the design history. Retain explanations of important consumer contracts.
- [x] Keep tunables grouped around demand, useful connections, geometry and cross-sections. Each remaining control should have a clear effect visible in the review panel.
- [x] Update tests that specifically encode retired aesthetic choices. Preserve their underlying access, housing and determinism guarantees; never regenerate snapshots solely to silence failures.
- [x] Run the curated panel on fixed seeds plus a held-out seed set, reporting medians, upper tails and the worst examples by settlement size and route configuration.
- [x] Run type checks, relevant village tests, public API/output/tiler checks, shared route-class checks and city controls. Run the complete suite once the implementation is stable; require a clean runner exit or explicitly document a reproducible pre-existing blocker.
- [x] Compare runtime distributions to the phase-1 baseline. Investigate material regressions before accepting more sampling or candidate evaluation; reuse spatial queries and cached placement results where profiling justifies it.
- [x] Document intentional layout changes, width semantics and any metadata/cache implications. Audit `settlement_generation_version`, currently the constant `village`, without silently changing an external cache contract.
- [x] Produce a final before/after report with identical inputs, reproducible commands, remaining exceptions and test results.

Completion: the new policy improves hamlets and larger villages across the visual panel, retains public integration behaviour, and has clean validation. Branch work is ready for review; release work remains a separate action.

## Delivery order and checkpoints

| Order | Reviewable change | Evidence required before the next phase |
|---|---|---|
| 1 | Baseline fixtures and report tooling | Reproducible measurements and screenshots; clean or explicitly diagnosed baseline |
| 2 | Hamlet frontage-first growth | Eight-home examples look appropriately small; full access and housing |
| 3 | Demand-aware network growth and pruning | Useful compact larger villages; no protected empty loops or severed access |
| 4 | Smooth joins and curve sampling | No observed snap reversals; consistent model/parcel/export geometry |
| 5 | Shared cross-sections and visual hierarchy | Widths and setbacks agree; small-lane and major-route examples both read well |
| 6 | Remove old rules and complete regression review | Held-out seeds, performance comparison, clean validation and final report |

Checkpoints are engineering and visual verification steps, not mandatory permission prompts. Tune against the same panel after each behavioural phase. If one phase exposes a conflict, fix or simplify that phase before adding another compensating rule.

## Original starting point

Start with phase 1: a repository-native review command and fixture catalog. Capture `aa841a4` before changing generation, then implement the frontage-first hamlet path against that baseline. This makes every subsequent design decision inspectable and prevents a pleasing seed from hiding a general regression.
