# Roads to the Tile Edge

**Date:** 2026-09-07
**Status:** Approved design, awaiting implementation plan
**Owner:** Barry — the render gate at the end of this work is his call, and the two rulings in §3 are his
**Supersedes:** the reading of the contract circle as the outer limit of drawn road; `docs/url-api.md`'s "handshake where a consumer's roads meet ours" text (§11)
**Preserves:** every trunk-network rule from `2026-08-25-trunk-network-design.md` — the contract circle, entries at exact bearings, class-aware staggered merges, the convergence-pattern palette, the no-proper-crossing invariant. Nothing in §5 of that spec is re-opened here.

---

## 1. The defect, measured

A village's roads stop dead on the contract circle while its fields and trees
carry on well past them. Not approximately — exactly:

| scenario | contract radius | furthest trunk point | fields | vegetation | tile |
|---|---|---|---|---|---|
| pop 500, seed 55337 | 188 m | **188 m** | 262 m | 336 m | 664 × 631 m |
| pop 40, seed 1 | 45 m | **45 m** | 85 m | 170 m | 369 × 333 m |
| pop 300, seed 1 | 142 m | **142 m** | 227 m | 300 m | 589 × 526 m |
| pop 1000, seed 7 | 264 m | **264 m** | 393 m | 461 m | 855 × 832 m |
| pop 900, seed 3 | 242 m | **242 m** | 344 m | 407 m | 827 × 862 m |

The furthest trunk point equals the contract radius to the metre on every
seed, because `contractEntries` puts each entry *on* the circle and the
network is drawn from there inward. There is nothing beyond it to draw.

The result is a village with 150 m of open ground between the last road end
and the frame, and roads that peter out in a field. The owner's words: "we
have nothing connecting INTO our villages from the outside", and after
`roads=` shipped in 2.0.4, "roads still don't reach".

**The premise that died.** The circle was defended as a handshake where a
consumer's road meets ours. The owner: "fmg adds nothing to the images, they
are always viewed as an iframe in the map." There is no second road and never
was a double-draw risk. The circle remains a routing contract — a consumer
holding `contractRadiusM` can still line our tile up with FMG's route lines —
but it is not a limit on what we draw.

## 2. Why five patches failed, and what each forbids

Recorded so the implementation cannot repeat them. Each line is a constraint
on the design, not history.

1. **Extend after `dressVillage`** → roads drove through fields, trees and
   houses; three invariant families caught it. *Fabric must be laid AROUND
   full-length roads, not the other way round.*
2. **Extend before dressing** → fields and vegetation invariants passed. Real
   progress, and the reason the fix sits where §5 puts it.
3. **Replacing the tip vertex** destroyed the point on the contract circle;
   `trunks-structural.test.ts` (b) wants a vertex within 8 m of it and
   measured 10.4 m. *APPEND beyond the tip. Never overwrite it.*
4. **Identifying arms by radius** is wrong in both directions: `trimTails` cut
   arms back INSIDE the circle at pop 300 (every end at 68 m against a 146 m
   circle), and at pop 40 arms ran PAST the fabric. *Identity is an id
   predicate, never a distance from the origin.*
5. **Still failing after all that**: buildings seated on the new road (lots
   and census run before dressing, so "before dressing" is still too late),
   lanes crossing with no junction (`resolveCrossings` runs *inside* trunk
   synthesis), and roads off-canvas on four pop-40 seeds. *The extension must
   exist before lot cutting, census, dressing AND crossing resolution — which
   means inside `synthesizeTrunks`.*

**And the constraint that killed every one of them.** `render.ts:233`
bounding-boxes everything it is handed, lanes included, and adds `pad = 40`.
Every metre a road is extended pushes the frame one metre further ahead of
it. While the pad exists and lanes drive the bounds, **a road cannot touch the
edge**. §7 is the resolution.

## 3. Owner rulings recorded (2026-09-07)

Decided. Do not re-open in implementation.

1. **A road is cut off exactly at the tile edge** and runs off the picture,
   like a road on a map tile. The exported geometry matches the drawing — no
   overrun in the data, no stub stopping short of the boundary.
2. **A road whose bearing points out to sea bends and follows the coast**
   until it leaves the tile. Not truncated at the shore, not left short. The
   cost — this invents road FMG never supplied — was stated and accepted.

## 4. What is explicitly NOT changing

- The contract circle: its radius, `CONTRACT_RADIUS_FACTOR`, the entry
  bearings, `data-contract-radius`, and the GeoJSON echo of it.
- Every rule in `synthesizeTrunks` up to and including pattern application:
  drafting, merging, the convergence palette, `rehomeOrphans`.
- Lot cutting, the census, the escalation chase, `trimTails`, relaxation, and
  the growth budget — none of which the new geometry is allowed to feed.
- The 40 m pad around the fabric. Trees still stand back from the edge; only
  roads reach it.
- The city engine. Untouched.

## 5. The apron lane

### 5.1 What it is

Each contract entry gains one continuation lane — the **apron** — carrying the
same `type` and `widthM` as the trunk it continues, and the trunk's
`sourceRouteIds` where it has them.

Its id is the trunk's id plus the suffix **`/a`**, joining the existing
`/b` (branch) and `/c` (connector) id vocabulary. `resolveCrossings` may split
it, appending its own `~x…` suffix, so the predicate is:

```ts
/** A trunk's outward continuation, drawn past the contract circle. */
export function isApron(laneId: string): boolean {
  return /\/a(~|$)/.test(laneId);
}
```

`isTrunk` is **left alone** and goes on returning `true` for an apron id. That
is correct at all four of its call sites — `trimTails` (relax.ts:285),
`extendOne` (lanes.ts:768), `connectDeadEnds` (lanes.ts:1086) and the invented
lane budget (lanes.ts:1733) — every one of which is asking "is this structural
road rather than village-grown frontage?", and an apron is. `isApron` is the
new, narrower question, used only where §6 says so.

The apron carries **no `parentId`**, deliberately and against the local
convention for derived lanes. `dressing/fields.ts`'s `exitRoads` skips any
lane with a `parentId`, and the apron must be seen there — it is now the road
that leaves the village, so it is the road the field ring must open for.

Points run inner-first, matching `Lane.points`' documented order: `points[0]`
is the shared vertex on the contract circle, the last point is the tile edge.

### 5.2 Where it is created

Inside `synthesizeTrunks`, **after `rehomeOrphans`, before
`resolveCrossings`**:

```
entries → drafts → mergeTrunks → pattern application → rehomeOrphans
        → [ growAprons ]  ← new
        → resolveCrossings → pruneJunctions
```

That position is the entire fix, and each neighbour is deliberate:

- **After merging and pattern application**, because a draft-time extension
  would let `mergeTrunks` capture two arms out in the apron. Spec 5.1 forbids
  merging at the boundary: every route gets its own entry, and merges happen
  against the grown fabric, deeper in.
- **After `rehomeOrphans`**, which skips any lane whose inner end sits at or
  beyond the contract radius — so an apron would be a no-op there anyway, and
  running it first keeps that function's reasoning about the circle intact.
- **Before `resolveCrossings`**, so a coast road crossing another arm becomes
  a junction like any other crossing. This is what attempt 5 could not reach.
- **Before everything in `generateVillage`**, so lot cutting, the census,
  growth, relaxation and dressing all see the real roads.

### 5.3 Geometry: the straight case

For each surviving lane whose outer end is a contract entry point:

1. **Direction.** The unit tangent at the entry, taken from the lane's last
   two points. Not the entry bearing — the road has curved on its way in, and
   the continuation must leave along the road, not along the radius.
2. **Curvature.** The apron continues the arm's own terminal bend, damped by
   `APRON_CURVATURE_DAMP`, rather than drawing a fresh random bow. A royal
   road stays nearly straight; a footpath keeps wandering, in the direction it
   was already wandering. **No RNG draw** — see §8.
3. **Length.** `apronReachM = max(contractRadiusM × APRON_REACH_FACTOR,
   APRON_REACH_FLOOR_M)`. This is an overshoot, not a target: §7 clips it to
   the frame exactly, so it only has to be *long enough*. Measured worst case
   for tile-corner-over-contract-radius is 5.47 (pop 40, seed 1), against 2.26
   at pop 1000; `APRON_REACH_FACTOR = 8` clears it with margin and
   `APRON_REACH_FLOOR_M = 500` covers the smallest villages. §9's invariant
   fails loudly if it is ever short, rather than silently drawing a short road.
4. **Vertices** every `APRON_SAMPLE_STEP_M`, plus the exact endpoint.

### 5.4 Geometry: the coast bend

Not hypothetical. On the `COASTAL` fixture (`oceanBearing: 123`, pop 500,
seed 55337) a road arriving at bearing 123 meets water **60 m past the
contract circle**, with the frame a further 90 m out. `coastline.test.ts`
asserts no lane point is in water; a naive extension breaks it on the first
coastal village.

Where an apron's polyline intersects a `site.water` ring — found analytically
per segment with the existing `segmentIntersection`, not by marching — it:

1. **Stops** `COAST_ROAD_STANDOFF_M` short of the waterline.
2. **Turns** and follows the shore, offset inland by
   `COAST_ROAD_STANDOFF_M` along each shore segment's outward normal, until it
   leaves the frame.
3. **Direction of turn**: whichever of the two reaches the frame boundary in
   less invented road. Ties break toward the lower absolute bearing of the
   first shore segment — deterministic, no RNG.
4. **A second seaward arm does not lay a parallel coast road.** It runs into
   the first within `MERGE_CAPTURE_M` for its class, lands on it, and records
   a junction — the same capture vocabulary `mergeTrunks` already uses.

   **Generalised 2026-09-07 during implementation: this applies to EVERY
   apron, not only coast roads.** Two FMG routes half a degree apart sit
   ~1.6 m apart on the contract circle, so their aprons run within 4 m of each
   other for hundreds of metres and draw as one road with a doubled stroke.
   `trunks-structure.test.ts`'s near-parallel bar catches it, and its `joined`
   exemption is exactly how the same case is already handled for trunks, which
   merge via `mergeTrunks`. So an apron that comes within
   `MERGE_CAPTURE_M[its class]` of an already-emitted apron lands on it and
   records a junction.

   **This does not violate spec 5.1.** That rule forbids merging ENTRIES: every
   route still gets its own point on the circle at its exact bearing, and none
   of them move. The merge happens outside the circle, in the apron, where two
   converging routes genuinely would converge. §9's first invariant is
   therefore satisfied TRANSITIVELY — an entry whose apron merged reaches the
   tile edge via the road it merged into, traceable through the junction.
5. **Fallback**: if the shore curves such that following it never leaves the
   frame within `COAST_ROAD_MAX_RUN_M`, the road ends at the shore and the
   model records a diagnostic naming the lane. A documented, counted
   termination — never a loop, never silent.

The `oceanBearing` fallback coastline spans `±COAST_WIDE_MULT × standoff`
laterally, far wider than any frame, so (5) is expected to fire only on real
`coastlineGeometry` from FMG. It must still exist.

**Why the coast road is safe here and nowhere else.** It is laid before any
fabric. Growth checks `crossesAnyLane` against every existing lane, so the
village grows *around* the coast road rather than through it. Laid after
growth, it would cut through houses — which is attempt 1, again.

### 5.5 New constants

All initial, all in `constants.ts`, all expected to move at the render gate.

| constant | value | what it does |
|---|---|---|
| `APRON_REACH_FACTOR` | 8 | overshoot length as a multiple of `contractRadiusM` (§5.3.3) |
| `APRON_REACH_FLOOR_M` | 500 | floor on that overshoot, for the smallest villages |
| `APRON_SAMPLE_STEP_M` | 25 | vertex spacing along the apron |
| `APRON_CURVATURE_DAMP` | 0.5 | share of the arm's terminal curvature the apron continues |
| `COAST_ROAD_STANDOFF_M` | 10 | how far inland of the waterline a coast road runs |
| `COAST_ROAD_MAX_RUN_M` | 1200 | cap on a coast-following run before §5.4.5's fallback fires |
| `FRAME_PAD_M` | 40 | the pad, moved out of `render.ts`'s literal so the model can use it |

`FRAME_PAD_M` is a move, not a new value: it must equal the 40 the renderer
uses today, so the frame does not shift on villages that gain nothing else.

### 5.6 Signature

`synthesizeTrunks` already takes `site`, so `site.water` is in hand for §5.4
and no new parameter is needed. Apron lanes are returned in
`TrunkNetwork.trunks` alongside every other lane; there is no separate
collection, and `TrunkNetwork` gains no field.

## 6. What the apron is excluded from

| Stage | Apron included? | Why |
|---|---|---|
| Lot cutting (`subdivideLane`, `lotReachAt`) | **No** | Houses do not line the road out to the tile edge. `ARM_LOT_RADIUS_SHARE` already caps trunk lots well inside; the apron is excluded outright. |
| `trimTails` | No-op | Already exempt via `isTrunk`. Attempt 4's failure was radius-based identification; the predicate is not. |
| `connectDeadEnds` | **No** | Already excluded via `isTrunk`. An apron end at the tile edge is not a dead end to be closed. |
| `blockAreas` / the block floor | **No** | Two aprons and a coast road must not enclose "a block" in open field and satisfy the block floor with it. |
| `relaxLanes` | **No** | It nudges lanes off buildings; there are none out here. |
| Growth (`saturateDisc`) | **No** | Added 2026-09-07 during implementation — the most consequential omission in the original table. Growth uses its lane list for the frontage budget, coverage seeding and branching, so three long radial aprons made whole angular sectors look already covered and `seedCoverageLane` declined to seed them: measured as a 64 deg laneless sector against a 60 deg ceiling, and a miss on the anisotropy floor. Growth is the village's own fabric; an apron is road outside it. `grown.lanes` REPLACES the lane list each round, so the aprons must be concatenated back after every growth round. |
| Green siting (`green-siting.ts`) | **No** | Added 2026-09-07 during implementation — this row was missing and the omission was caught by `green-on-network.test.ts`. `spineOf`/`nearestOnNetwork` read `network.trunks` directly and picked the longer, same-class apron as the spine the green is sited against. An apron is road OUTSIDE the village; the green is sited relative to the village's own network. |
| The frame (§7) | **No** | The whole point. This is the "lanes stop driving the bounds" half of the constraint in §2. |
| `resolveCrossings` | **Yes** | A crossing without a junction is a defect wherever it happens. |
| `exitRoads` (field-ring corridor) | **Yes** | It is now the road that leaves the village. A trunk that has an apron continuation is skipped there, so the corridor is cut once, from the road that actually exits. |
| Vegetation rejection | **Yes** | Trees stand clear of a road. |
| Field obstacles | **Yes** | Fields part around a road. |
| Painting | **Yes** | Same class, same width, one continuous stroke. |
| GeoJSON lanes | **Yes** | §10. |

Three of those exclusions are already free — `trimTails`, `connectDeadEnds`
and the invented-lane budget screen on `isTrunk`, which an apron id satisfies.
The rest — lot cutting, `blockAreas`, `relaxLanes`, the frame, and
`exitRoads`' skip of a trunk that has an apron — need an explicit `isApron`
filter added at the call site.

## 7. The frame

### 7.1 Ownership moves to the model

`render.ts` currently derives the picture from whatever it is handed. It
stops. The model computes the frame and the renderer reads it.

Added to `VillageModel`:

```ts
/**
 * The drawn tile, in burg-local metres. The model owns this because the
 * apron lanes (§5) are clipped to it: a renderer that re-derived its own
 * bounds from the geometry would move the edge the roads were cut to.
 */
frame: { minX: number; minY: number; maxX: number; maxY: number };
```

### 7.2 How it is computed, and when

At the end of `generateVillage`, after `dressVillage`, before
`findWaterCrossings`:

1. `frame` = the bounding box of buildings, the green centre, **all non-apron
   lane points**, field polygons, edge stamps, vegetation and POIs, grown by
   `FRAME_PAD_M` (40, moved out of `render.ts`'s literal into `constants.ts`).
2. Every apron polyline is clipped: keep the prefix from `points[0]` to the
   first crossing of the frame rectangle, with the exact intersection point as
   its final vertex.
3. `bridges` is computed after the clip, so no bridge is ever placed outside
   the picture.

There is no fixed point to chase, because the thing being clipped is the one
thing excluded from the box.

**Dressing sees the unclipped apron, and that is fine.** Fields and vegetation
run their rejection tests against lane corridors; the part of an apron beyond
the frame passes through ground where no field block or tree exists, so
clipping before or after dressing gives the same fabric. Clipping last is what
lets the clip use the finished fabric's own bounding box.

An apron whose `points[0]` already lies outside the frame is degenerate — it
cannot happen while the fabric reaches past the contract circle, which it does
on every measured seed — and is handled by dropping the apron and recording a
diagnostic rather than shipping a road that starts off-picture.

### 7.3 The renderer

`renderVillage` reads `model.frame` for `minX`/`minY`/`w`/`h` and computes no
bounds of its own. `data-bg="paper"` keeps its current meaning and
`settlement-tiler`'s `cropSvgToTile` contract is unaffected: the paper rect
still spans the whole viewBox.

**Expected diff on a landlocked village:** the frame should be *identical* to
today's on most seeds, because lanes never reached past the fabric anyway
(measured: the furthest lane point is inside the fabric bbox on six of seven
sampled seeds). What moves is the field ring, via `exitRoads` now cutting its
corridor to the frame instead of to the circle. That is a visible change on
every village, coastal or not, and §11 carries it as a risk rather than a
footnote.

## 8. Determinism

**The apron consumes no randomness.** Its direction, curvature, length, coast
turn and merge are all derived from geometry already fixed. Two consequences,
both wanted:

- The shared `rng` stream that `synthesizeTrunks` and everything downstream
  draws from is untouched, so the fabric of an existing village does not
  re-roll. A 2.0.5 → this-release diff is attributable: new apron lanes, a
  changed field ring, vegetation cleared along the new corridor.

  **One measured exception, found during implementation 2026-09-08.** I claimed
  repeatedly that landlocked villages would be geometrically unchanged. That is
  false for **4 of 90 dry villages measured**, all pop-40 `panel-cross`, and the
  reason is worth stating because it corrects a premise I had been reasoning
  from: **growth reaches PAST the contract circle at pop 40**, because the block
  chase escalates the disc. `apron.ts` already recorded the same observation in
  its own words — "at pop 40 arms ran past the fabric" — which is why aprons are
  identified by entry proximity rather than by radius. So a radial apron is in
  growth's way at that size, not only a coast road.

  Those four villages change because growth now refuses to cross an apron it
  previously crossed. Two real crossing violations on dry ground —
  `lane-269 × trunk-local-r-local/a` and
  `trunk-main-r-main/b31/b75 × trunk-trail-r-trail/a` — were being shipped
  before this work and are removed by it. The change is a strict improvement,
  and byte-identity was the wrong bar to have set.

  That the difference comes ONLY from crossing decisions was proved, not
  asserted: with the obstacle list forced to a plain copy — plumbing live,
  obstacles ignored — the same 90-village dump is byte-identical to the
  pre-change one.
- Same seed, same village, still byte-identical — the existing determinism
  test covers it unchanged.

Where a future tuning pass wants jitter on the apron, it takes a derived
stream (the `PROFILE_SEED_MULTIPLIER` pattern), never the shared one.

## 9. Invariants and tests

**Must keep passing, unchanged:**

- `trunks-structural.test.ts` (b): every route still meets the contract circle
  at its exact bearing, within 8 m. Guaranteed by appending rather than
  replacing (§5.1) — this is attempt 3's grave.
- `trunks-structural.test.ts` (c): no two lanes cross without a junction — now
  covering aprons and coast roads.
- `trunks-structural.test.ts` (d): a trunk trail/footpath does not end in open
  ground. An apron's inner end is the shared entry vertex, which lies on its
  trunk, so it passes by construction.
- `coastline.test.ts`: no lane point in water — now with a road running to the
  shore and along it.
- `village-model.test.ts` and the chase-regression suite: the census, block
  floor and seating numbers must not move. If they do, something the apron was
  supposed to be excluded from is seeing it.
- Determinism, end to end.

**Must change:**

- `every-class-connects.test.ts` asserts `furthest > contractRadiusM - 1`.
  That is a circle at roughly 0.4 of the tile half-width, and it stays green
  through the entire bug — the file says so in its own header, and the
  settlemaker-web session independently reported the same thing. It becomes:
  **every route class reaches the frame boundary.** The file's header comment,
  which currently explains what the test deliberately does not cover, is
  rewritten to say what it now does.

**New:**

1. **Every contract entry reaches the tile edge.** For each route bearing (and
   each far side of a through route), the apron continuing that entry ends
   within one sample step of the frame rectangle's boundary. The one permitted
   exception is a coast-fallback termination (§5.4.5), which must be
   accompanied by its diagnostic — so a short road is either at the edge or
   explained.
2. **The overshoot is always long enough.** Every apron was clipped, i.e. no
   apron's own drawn length was exhausted before the frame was reached. This
   is what makes `APRON_REACH_FACTOR` safe to be a constant rather than a
   prediction.
3. **Nothing is built on the apron.** No lot, no building, no croft whose
   `laneId` is an apron id or whose position lies in an apron corridor outside
   the contract circle.
4. **The frame excludes aprons.** Removing every apron lane from a model
   leaves the frame unchanged.
5. **Coast**: on the coastal fixture, the seaward road reaches the frame, no
   lane point is in water, and the coast road stays on the seaward side of
   every building.

## 10. Consumer contract

`contractRadiusM`, `data-contract-radius` and the GeoJSON junction export keep
their current meanings exactly. Apron lanes appear in the GeoJSON lane
collection like any other lane, carrying their class — which is what makes the
data match the picture, per ruling 3.1.

`frame` is **not** exported to GeoJSON this round. No consumer has asked for
it, the images are always iframed, and adding it is a schema change with a
version bump attached. Reversible in a later release if the tiler ever wants
it; the viewBox already carries the same information for anyone reading the
SVG.

### 10.1 `bounds` — owner ruling 2026-09-07, target recorded, work not yet scheduled

`src/village/geojson.ts:50`'s `bounds` helper computes its own AABB over
buildings, **all lanes**, fields, vegetation and the green centre, padded by
20 m. It therefore tracks the LANES, and this release moves it: roads now
reach further, so the box grows on whichever axes a road exits.

**Barry has ruled that `bounds` should mean THE DRAWN TILE** — the same
rectangle the SVG viewBox covers — **not the lane box.** Both options were put
to him explicitly (keep the lane AABB, no schema decision; or make it the
rendered frame) and he chose the drawn tile.

That target is recorded here even though the work is not scheduled in this
plan, because the failure mode to avoid is a future reader finding "bounds:
no change needed" and treating the lane box as settled intent. It is not. The
lane box is the status quo, not the goal.

**What is still open is the SEQUENCING, and it is the owner's call**, because
a schema version bump is a consumer-contract decision:

- **Now**, in this release: the model gains a `frame` in §7 anyway, so
  `bounds` becomes close to reading it off. One disturbance to the field
  instead of two.
- **Later**, as its own release: keeps §10's no-schema-change rule intact, at
  the cost of `bounds` moving in this release (because roads reach further)
  and then changing meaning in the next — two disturbances to one field, in
  consecutive releases, where one would do.

**SEQUENCING RULED, 2026-09-07: NOW.** It lands in this release, while the
frame is in hand — one disturbance to the field instead of two. The plan
carries it as Task 3.5.

Two sub-decisions taken with it, both reversible, both recorded with what they
cost:

- **`diameterM` keeps measuring the village, not the tile.** The private
  `bounds()` helper feeds both the exported `local_bounds` and `diameterM`,
  and those ask different questions — the ruling was about the exported field.
  The helper stays as `inkBounds`, serving `diameterM` alone.

  **And `inkBounds` must itself exclude aprons — a seventh exclusion site,
  corrected during implementation.** Keeping the helper unchanged carried the
  right intent to the wrong input: aprons are clipped to the tile edge, so
  counting them made "the village's extent" the TILE's extent. Measured before
  the correction, `diameter_meters` came out LARGER than the whole tile — 727.0
  against a 711.5 tile at pop 500, 402.4 against 371.6 at pop 40, 884.4 against
  844.3 at pop 1000 — for a field whose doc comment calls it "the village's
  overall extent … its own diameter, measured". With aprons excluded it sits
  consistently ~40 m inside the tile span, which makes
  `diameter_meters < tileSpan` a real invariant (the tile is the fabric plus a
  40 m pad, so the village cannot exceed the tile that frames it) rather than
  the coincidence it would otherwise be.
- **`GEOJSON_SCHEMA_VERSION` is NOT bumped, because this is a BUG FIX.**
  Corrected 2026-09-07 after the settlemaker-web session measured the
  production artifact: `local_bounds` has always meant the drawn tile, and
  cities already satisfy `local_bounds == viewBox` to the decimal (asserted at
  `tests/entrance-output.test.ts:389` and `:399`). **The village engine was
  violating it** — short by exactly 40 m in each dimension, because
  `geojson.ts`'s `PAD` is 20 against the renderer's 40. You do not bump a
  schema version to fix an implementation that was breaking the schema. The
  shared-constant argument is a second reason, not the main one.

  **The case rests on the invariant, not on any consumer.** Villages violate
  something cities honour and the codebase already asserts; that was true
  before anyone went looking for a consumer and stays true regardless of
  whether one exists.

  Context for whoever rebuilds questables, recorded because it is worth
  inheriting rather than because anything is pending: it persisted
  `local_bounds` as a `jsonb NOT NULL` column, configured its projection from
  it, called `view.fit(sidecar.local_bounds)`, and its design doc called
  `svg_viewbox == local_bounds` within 0.1 "a settlemaker invariant" — which
  villages missed by 400x. It is **parked, and due a major overhaul after this
  work** (owner, 2026-09-07), so its stored 40 m-short values die with the old
  system; there is no migration to write and no warning anyone must act on.
  Explicitly: this must not constrain design here. Where a correct change to
  settlemaker would be awkward for questables' stored data, make the correct
  change.

  The village engine never had the test cities have. Task 3.5 adds it.

## 11. Risks, carried openly

1. **`exitRoads` changes every village.** The field-ring corridor is cut from
   a lane's outermost segment; that segment is now at the tile edge. Landlocked
   temperate villages that nobody asked to change will change. Expected to
   read better — the ring currently closes up beyond the road tip — but it is
   a whole-fleet visual change and belongs in front of the owner at the gate.
2. **The coast road is invented geometry.** FMG never supplied it. Accepted
   under ruling 3.2, but it is the part most likely to look wrong first.
3. **A village pinched between coast road and shore.** Growth avoids crossing
   the coast road, so a village very close to the water has less room. The
   `strangled` fixture is the place to watch it.
4. **`synthesizeTrunks` is the most heavily gated code in the engine**
   (G1/G2/G3). This adds a stage to it. The mitigation is that the new stage
   is additive, consumes no randomness, and touches no existing branch.
5. **`docs/url-api.md` still describes the contract circle as a handshake
   where a consumer's roads meet ours.** It is fiction — the same kind as the
   stale "population <= 600" line that was already reconciled. It must be
   corrected in this work, not left for later, because this release is exactly
   what makes it false in a way a reader could act on.

## 12. Render gate

Numbers do not close this work; the owner's eye does
(`visual-work-needs-eyes`). Rasterising is faithful as of 2.0.5, so plain
`sharp` renders are honest and no var-resolving helper is needed.

The gate sheet: populations 40 / 120 / 300 / 500 / 1000 landlocked; the
coastal fixture with a seaward route; a four-route junction village; a through
route; and the five biomes at pop 500. Rendered from this branch and put in
front of the owner before anything is tagged.

## 13. Out of scope

- The four-theme re-gate (now owed against the live site, not local renders).
- Rivers and bridges — parked, and untouched here beyond running
  `findWaterCrossings` after the clip.
- Any change to the city engine, the tiler, or `settlemaker-web`.
