# Rivers and Bridges — Design

**Date:** 2026-08-18
**Issue:** [#4 — Rivers through the settlement, with entry/exit points and bridges](https://github.com/barrulus/settlemaker/issues/4)
**Status:** Approved by owner in design review (this session), pending implementation plan.

## Context and ordering

Three geometry/params issues are open: #3 (population-scaled harbours), #4 (rivers
and bridges), #5 (watabou-parity generation parameters). Owner decision: **#4 ships
first** — river cities will also be port cities, so #3's pier/harbour ladder must be
able to serve river banks, and #5's parameter engine should be built over correct
geometry components. #3 follows this work; #5 follows #3.

Prior art this design builds on:

- The 2026-08-04 coastline fix (settlemaker `531c576`, merged `3c2b2e7`): water
  renders from supplied real geometry as one even-odd path clipped to `#frame-clip`;
  patch water classification is **placement-only**. This is the proven pattern rivers
  reuse. Pinned by `tests/toprak-regression.test.ts`.
- Coastal wall circuits (round-cores-faubourgs, merged `540215d`): `CurtainWall`
  already survived one open/irregular-circuit generalization; river walls reuse that
  seam.
- `Topology` (`src/generator/topology.ts`): streets are A* over patch vertices with a
  `blocked` list (citadel + wall vertices minus gates). Bridges use the identical
  mechanism.

## Approach (decided)

**Polygon for pixels, spine for semantics.** Two representations of the same river,
each doing what it is good at:

- A **corridor polygon** (spine buffered by half-width per side) feeds the existing
  water classification and even-odd render path — rivers get the shoreline-quality
  rendering that already works.
- A retained **spine polyline + width profile** is the semantic backbone: bridge
  points live on it, walls terminate against its banks, boat navigability is a walk
  along it, and issue #3 will later ask it where the banks are for river piers and
  quays.

Rejected alternatives: polygon-only (river has no identity; bridge siting, wall
termination and pier work would reverse-engineer the shape from a blob) and
first-class-entity-only (abandons the proven polygon render path and risks
re-fighting the blocky-water problem).

## Input surface

### FMG path (primary)

`AzgaarBurgInput` gains:

```ts
riverGeometry?: Array<{
  /** Burg-local coords, origin = burg centre, same scale as the mesh —
      the coastlineGeometry convention. */
  points: Array<{ x: number; y: number; w?: number }>; // w = river width at that point
  name?: string; // reserved for issue #6 labels
}>
```

- One polyline = one river through/past the burg.
- Two polylines whose endpoints meet = **confluence** (spine tree).
- A polyline ending inside coastal water = **estuary** (corridor unioned with the
  coastal water polygon).
- Width is per-point (rivers widen downstream) with a single fallback width when FMG
  supplies only one number, and a **minimum-width clamp** so a mapped stream never
  renders thinner than a street stroke.

### Params

- The dead `GenerationParams.riverPath?: Point[]` stub (never consumed, never set by
  `mapToGenerationParams`) is **deleted**, replaced by `rivers?: RiverInput[]`.
- `riverNeeded?: boolean` is the procedural switch: supplied geometry always wins;
  `true` with no geometry synthesizes a river; absent/false = no river. This boolean
  is deliberately the shape issue #5's future tri-state maps onto.

## Core representation

New module `src/generator/river.ts` owning a `RiverCourse`, built once, early, read
by everything downstream:

- **Spine** — smoothed centreline polyline(s), a small tree for confluences (each
  branch knows its downstream continuation).
- **Width profile** — interpolated along the spine.
- **Corridor polygon(s)** — the buffered spine; the only thing classification and
  rendering consume.
- **Bank chains** — explicit left/right corridor edges; walls terminate against
  them, #3 anchors piers/quays to them.
- **Flags** — `reachesCoast` (estuary), `navigable` (default true; drives the
  no-obstruction rule).

River islands need no special input: they emerge where the corridor splits around
land (branch pair or braided input polylines); even-odd parity already renders land
holes correctly (`classifyWater` ring-parity fix `397acd0`).

Patches whose centroid falls inside a corridor classify as water exactly like
coastal patches: placement-only; pixels always come from real geometry.

## The river–settlement population ladder (owner-confirmed)

Settlements form *at* crossings, historically — the bridge seeds the town, and only
genuine cities span the river. Band boundaries (~1 000 and ~10 000) are starting
values, tuned at render gates. 10 000 deliberately rhymes with
`DEFAULT_CORE_CAPACITY`.

### Village (pop < ~1 000) — settlement at the crossing, one bank

- Exactly **one** crossing: a **ford** below a starting threshold of pop ~250, a
  single bridge above it, sited where the primary route crosses.
- Fabric clusters around the bridgehead on one bank; at most a couple of buildings
  across the water (bridgehead-inn pattern).
- The river passes **beside** the village — tangent, never through.

### Town (pop ~1 000–10 000) — one-bank town, river as edge

- Fabric stays on the dominant bank.
- If walled, the riverside stretch of wall runs **along the bank** (bank-chain
  vertices become wall vertices; the river reads as that side's moat).
- One bridge on the largest through-route, landing **at a wall gate**
  (bridge-at-gate: the toll point is literal). A second bridge only if a second
  major route genuinely crosses.
- A port, if any, sits **outside the walls**, downstream (hook reserved for #3; the
  band threshold lives in one shared constant so #3 reads the same number).

### City (pop > ~10 000) — the river wends through

- Fabric spans both banks; the corridor threads the settlement (the MFCG look).
- 3–5 bridges, each justified by a route or by connecting major fabric clusters.
- Waterfront infrastructure may come inside the walls (#3's scope).

### Mechanism: bank affinity

FMG's river cannot be moved, but the town can. Below the city threshold, core-patch
seeding and the urbanisation field are biased hard to one bank — chosen by where
road entries concentrate and where there is room — the same steering trick the
ovoid/coastal rank already plays on seeds. Above the threshold the bias dissolves
and patches straddle. Nothing is forbidden, only steered.

## Pipeline placement

`RiverCourse` is resolved (input or synthesized) **before `buildPatches`**. Order:

1. Resolve river →
2. `buildPatches` (seeding avoids the corridor; bank affinity applied) →
3. `classifyWater` (corridor joins water classification; riverside patches marked
   like shoreline patches) →
4. walls →
5. bridges + streets →
6. wards/geometry as today.

No new land-budget knob: water patches are unbuildable, so a river-split city
naturally needs more patches for the same census via the existing
`patchAreaForDemand` machinery.

## Bridges

**Bridges are chosen before streets, on the spine** (bridges-as-gates, owner
decision):

1. Collect desire lines: (road-entry gate ↔ plaza/centre) pairs whose straight line
   crosses the corridor, plus opposite-bank patch clusters that would otherwise
   disconnect.
2. Score candidate spine stations by: route importance served (`through` routes in
   the `roads` group dominate; `trails` score low), number of desire lines served,
   corridor narrowness (real bridges pick narrow points), and minimum spacing from
   already-chosen bridges.
3. Take the top station(s) per the population band's budget. A village takes only
   the single best crossing and the settlement centre gravitates to it.
4. Each chosen station becomes a **crossing chain**: bank point → optional mid-river
   vertices → bank point, roughly perpendicular to the spine, snapped into the
   patch-vertex graph.

**Streets:** `Topology.blocked` grows all water-corridor vertices *except* the
crossing chains, which are added as traversable edges — structurally identical to
wall-vertices-minus-gates. A* funnels streets over bridges for free; nothing can
ford elsewhere. Far-bank fabric connects to its nearest bridge with no new routing
logic.

**Invariant:** a bridge with no street feeding it is a bug.

## Walls at the water (owner decision: never span the channel)

- **Town:** riverside wall follows the bank chain; bridge lands at a gate.
- **City:** the circuit hits the corridor twice and splits into **two arcs**, one
  per bank, each terminating in a tower at the water's edge (four terminal towers).
  The channel stays open.
- Rationale: river routes carry boats; the waterway must remain passable through the
  settlement.

## Boat passage (navigability invariant)

For a `navigable` river, nothing solid is ever placed in the corridor: no building,
wall segment, or tower intersects it. Bridges are decks drawn **over** the water,
not fills — the channel under them stays geometrically continuous. Issue #3's river
ports rely on this.

## Rendering

- Corridor polygon joins the existing even-odd water path in the water paint pass —
  same fill and shore stroke from `render-theme.ts`. Estuaries are seamless (one
  unioned polygon).
- **Bridges:** drawn in the roads pass as a deck — the street segment over the
  corridor, slightly widened with end caps, painted after water so it reads as
  spanning it (the MFCG look).
- **Fords:** render as nothing — road runs to each bank, water passes over.
  Stepping-stone/symbol dressing deferred to #6. The `sm-bridge` symbol is reserved
  for village-scale flavour later, not load-bearing.
- No new paint pass; the `data-bg="paper"` tiler contract is untouched.

## Procedural fallback

When `riverNeeded: true` with no geometry:

- Entry bearing prefers alignment with any `followsRiver` road entry (a valley road
  implies where the valley is); exit bearing roughly opposite.
- Meander between them with seeded noise — lazy curves at village scale — and
  **always reach the map edge at both ends** (water bleeds off-frame; never an
  enclosed blob — the parked-water lesson).
- Width from a small population-scaled default.
- All randomness through the instance `SeededRandom`: same seed → same spine → same
  SVG bytes.

From the spine onward, procedural and FMG rivers share every downstream step.

## Outputs

- **GeoJSON:** new `river` features (line + polygon) and `bridge` / `ford` features,
  additive — questables keeps working untouched until it opts in.
- **Degraded flags:** `DegradedFlag` gains `'river'` for a requested river that is
  geometrically infeasible (e.g. corridor would swallow the map).

## Testing

**Byte-stability first:** with no river input, output is byte-identical to today —
pinned by md5 of fixture SVGs per population band. The feature is inert without
river input, so merging is safe at any point.

Unit tests (new files alongside the existing suite):

- Spine → corridor buffering: width interpolation, min-width clamp, confluence
  union, island hole parity.
- Bridge ladder: counts per band (village exactly 1, ford below the ~250 starting
  threshold; town 1–2; city 3–5); best crossing lies on the highest-scoring
  `through`+`roads` route.
- Bank affinity: below the city threshold ≥ 80% (starting value) of built fabric on
  the dominant bank; above it, both banks hold fabric.
- Wall invariants: town riverside wall follows the bank chain; city circuit splits
  into two arcs with terminal towers; walled bridge lands on a gate.
- **Navigability invariant as a hard test:** no building/wall/tower polygon
  intersects the corridor; only bridge decks cross it.
- Determinism: same seed + same river input → identical SVG; procedural fallback
  same seed → identical spine.

**Render gates** (visual work needs eyes — metrics have passed while renders were
wrong): each band gets a change→render→owner gate via the review harness (vite 5199,
`make-review-page.ts` contact sheet): village ford; village bridge; walled town with
river-edge wall and bridge-at-gate; 10k+ city with the river wending through;
confluence; estuary; river island. Threshold constants (band boundaries, bridge
counts, bank-affinity strength) are tuned at these gates, not in advance.

## Deploy notes

- The questables settlement tile cache still has no version key; shipping this adds
  a **third owed rucio cache wipe** — or the deploy finally fixes version-keying on
  the questables side.
- Netlify (settlemaker.com) picks the change up via the usual settlemaker-web
  submodule bump.

## Addendum — render-gate 2 verdict model (2026-08-19, owner-directed)

Round-2 review replaced several first-draft behaviours. This addendum is binding
over the corresponding sections above.

### Village morphology (fords and village bridges)

A route that DEAD-ENDS at the river terminates in a **riverside town square**;
houses branch off the square **along the river bank**, not along the approach
road. The approach road stays sparse — people cluster at the water unless the
route is a through route. Far-bank development exists **only when the route
continues onward** (through route): then the crossing carries the road and the
fabric straddles the crossing (dense at the bridgehead, both sides). A far-bank
route stub with a token house is wrong.

### Town band

Default **one** bridge; a second is exceptional, not budgeted. No empty ward
carve-outs on the river side (under investigation as a defect, not a design
choice).

### City band (pop ≥ 10 000) — corrected wall reading

"Wall stops at banks" always meant the circuit is CLOSED across the river by
**chains/water-gates** (owner clarification): the wall reaches each bank and the
two river crossings render as water-gate/chain spans that boats pass under —
the Darkwood look — never as an open gap between disconnected arcs. The
existing river-gap wall segments are the vehicle: render them as spans instead
of skipping them.

Population, routes, and bridges must AGREE: routes and gates concentrate on the
populated side(s); bridges sit where the fabric is (internal streets of the
city, typically 1–2 like the reference), never a cluster of decks on an
unpopulated bank. Fabric genuinely astride the river is the target for this
band.

### Confluence

Cross-river connection must be visually real — a painted road over a deck
joining the built clusters (graph-level component union is not sufficient
evidence).

## Out of scope

- Pier/quay/harbour geometry on river banks — issue #3 (next), consuming this
  design's bank chains and navigability flag.
- River/water tags in the public parameter surface — issue #5, mapping onto
  `riverNeeded`.
- Labels for named rivers, stepping-stone/boat dressings — issue #6.
- Lakes and ponds as standalone bodies (no spine) — future; `coastlineGeometry`
  already covers lakeside burgs.
