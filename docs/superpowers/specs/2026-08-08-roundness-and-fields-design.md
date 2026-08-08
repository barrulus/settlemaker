# Settlement roundness and field placement — design

**Date:** 2026-08-08
**Status:** approved, ready for planning
**Supersedes:** the "roundness" and "spotty field placement" entries in the
fidelity round 2–4 backlog (`docs/test-urls.md`).

## Problem

Settlement outlines are too circular. This is the oldest item on Azgaar's
wishlist and has survived four fidelity rounds.

The cause is exact, not diffuse. `Model.buildPatches` seeds points on a
spiral disc, sorts every Voronoi point by distance from the origin, and takes
the first `nPatches` as the inner city (`model.ts:334`). That is literally
"select a disc". The wall is `findCircumference(inner)`, so the wall inherits
the disc. Voronoi jitter is the only thing preventing a polygon-approximated
circle, which is why the result reads round at every population.

Field placement fails for a related reason. `buildFarms` decides farmland
from angle alone — `waveRadius = a·sin(θ+c) + b·sin(2θ+d)` compared against a
single global `cityRadius` (max vertex distance over all city patches).
Three consequences:

1. Fields know nothing about roads or water — only angle and one radius.
2. `a = normal()×2` and `b = normal()` are unbounded, so `waveRadius` can go
   negative over an arc and produce no fields there, or balloon over another.
3. One global radius cannot track a non-round outline. The moment the city
   elongates, the farm belt stays circular and detaches from the built edge
   on the short axis.

Point 3 means roundness and fields are not separable problems. The same
change must address both.

## Governing decision: the wall bounds the core, not the settlement

A settlement holds at most `coreCapacity` people (default **10 000**) inside
its walled core. Population beyond that grows *outside* the walls, along
roads and as terrain permits. A 250 000-person city is a ~10 000-person
walled core plus extensive extramural sprawl — not a 250 000-person disc.

This is historically right (medieval walls rarely enclosed more than a few
tens of thousands; Paris and London grew faubourgs outside their gates) and
it is what makes roundness tractable: the core may stay roughly round while
the *settlement* reads as elongated, because the sprawl follows the roads.

The cap applies whether or not the burg has walls. Walls *draw* the core
boundary; they do not define it.

### `coreCapacity` is a ceiling, not a target

A settlement below the cap must NOT put its whole population inside the
walls. Faubourgs outside the gates, ribbon development along the approach
roads, and clusters at a bridge or mill were normal at every size — not a
big-city phenomenon.

So the core has its own share rule, independent of the cap. The extramural
share scales with population:

```
extramuralShare(pop) = clamp(0.20 + 0.1642·(log₁₀(pop) − log₁₀(300)), 0.20, 0.45)
```

| population | outside the walls |
|---|---|
| 300 | ~20% |
| 1 200 | ~30% |
| 4 000 | ~38.5% |
| 10 000 | ~45% |
| 50 000 | ~80% (cap binds) |
| 250 000 | ~96% (cap binds) |

**Why the low end is this high.** The first curve (8% at 300 rising to 25% at
10 000) was set from historical intuition and proved far too low to *render*
as anything. A town of 4 000 has roughly 26 patches in total, so a 20% share
bought 5 patches of extramural growth — which cannot physically ring a core,
and measured only 11–17 of 24 angular sectors covered. Cities, whose share is
driven by the cap rather than the curve, reached 24/24. The share is
therefore set by what reads correctly at the smallest walled settlements, not
by a demographic estimate.

**Budget alone is not sufficient.** The greedy placement rewards adjacency to
already-built patches (this is what fuses crowded ribbons into a belt), which
directly fights ring *completion* — extra budget otherwise piles onto one
side. Placement must prefer filling an empty angular sector over thickening
an existing cluster, so that a raised share turns into coverage rather than a
fatter lobe.

The core therefore holds `min(pop × (1 − extramuralShare(pop)), coreCapacity)`
people, and the sprawl budget is whatever the total budget has left. The
curve is continuous, so nothing changes abruptly at the cap boundary: below
it the share rule governs, above it the cap does.

**This was a real defect in the first implementation.** Because
`nCore = corePatchCount(min(pop, coreCapacity))` and
`nPatches = populationToPatches(pop)` are identical expressions for any
population at or below the cap, the sprawl budget `nPatches − nCore`
evaluated to exactly zero, and every burg under 10 000 put 100% of its
people inside the walls.

## Architecture

The change introduces two pure functions and lets existing phases read them.
No new pipeline phase is required for shape; one new zoning step is required
for sprawl.

### A. Shape field — `src/generator/shape-field.ts`

A function of direction only:

```
scaleAt(θ) = 1 + Σ roadLobe(θ, bearingᵢ) − waterPenalty(θ) + harmonics(θ)
```

- **roadLobe** — each supplied road bearing raises the radius along its
  direction, decaying with angular offset.
- **waterPenalty** — directions whose ray meets water (from
  `coastlineGeometry`, or the `oceanBearing` half-plane fallback) are
  suppressed, so the core does not reach for the sea.
- **harmonics** — two low-order random terms, seeded from the model rng, so
  that an inland roadless burg is still not a perfect circle.

Normalised so mean scale ≈ 1. This preserves enclosed area: the core holds
the population it is supposed to, it simply is not a disc.

**Consumed by `buildPatches`:** sort candidate points by warped distance
`|p| / scaleAt(θ_p)` rather than raw `|p|`, then take the first `nCore`. The
wall inherits the lobed shape for free. The Voronoi mesh itself is unchanged.

### B. Urbanisation field — `src/generator/urbanisation.ts`

A function of position:

```
built(p) = halo(distanceFromCoreEdge) + Σ over roads corridor(alongDist, perpDist) + neighbourBonus(p)
```

**The halo term is what makes extramural growth read as a settlement rather
than as spokes.** Real towns wrap their walls in a continuous skirt of
building; the roads then carry thinner ribbons out of that skirt. Without a
halo the field can only score points that lie along a road ray, and the
render shows bare spikes radiating from a wall with empty ground between
them — which is what the first implementation produced.

Required behaviour, from review of the rendered output:

1. **The halo fully encompasses the core.** It is a function of distance
   from the core edge in EVERY direction, not of any road, so an
   extramural ring exists even for a burg with no roads at all. It decays
   with distance so the skirt is dense against the wall and thins outward.
2. **The halo carries the majority of extramural population**; spokes carry
   the minority. At metropolis scale the settlement must read as "largely
   focussed around the city, with smaller arms following the routes".
3. **Spokes taper.** A ribbon narrows as it runs out — its corridor
   half-width shrinks with distance along the ray, not just its score.
4. Above the core cap, the halo grows outward (a thicker skirt) rather than
   the core growing.

`corridor` decays with distance along the road ray and with perpendicular
offset from it. Patches are ranked by `built(p)`; the top `nSprawl` become
suburbs. All three requested forms fall out of this single field:

- **ribbons** — the corridor term itself.
- **belt** — where adjacent roads' corridors overlap near the gates, plus
  `neighbourBonus` (a bonus for touching already-built patches), which fuses
  crowded ribbons into continuous fabric.
- **satellites** — additional corridor bumps at intervals further along the
  same rays, enabled automatically above a population threshold. They are
  on-road by construction because the bumps sit on the ray.

No separate code path per form.

### C. Zoning

Every patch receives a zone label: `core`, `suburb`, `satellite`, `farm`, or
`wilderness`. Labels are assigned from the two fields above and are the
single source of truth for downstream styling.

### D. Fields

`buildFarms` loses its sinusoid and its global `cityRadius`. A patch becomes
farmland when it is near built fabric but not itself built:

```
farm(p) = proximityToBuilt(p) − built(p) − water
```

`proximityToBuilt` is graph distance over patch adjacency from any built
patch (1–3 hops, depth scaling with population — more mouths, more fields),
not a radius. That is what lets the belt track a lobed outline instead of
detaching from it.

Subtracting `built(p)` pushes fields out of the road corridors and
concentrates them in the wedges between ribbons. This is what makes the
ribbons legible as ribbons and the gaps read as gaps.

With no `a·sin(θ+c)` term left, the unbounded-amplitude bug disappears by
construction.

## Budgets

- `nCore = patchesFor(min(population, coreCapacity))`.
- `nSprawl = totalBuiltBudget − nCore`, where `totalBuiltBudget` is the
  existing `MAX_PATCHES` pool, so sprawl consumes exactly what the core does
  not.
- **Total built patches stay ≤ 220** (`MAX_PATCHES`). Core and sprawl draw
  from one pool, so the 8-second generation budget that fitted this cap in
  round 4 holds unchanged. A 250k city with three roads gets roughly a
  28-patch core and ~190 patches of sprawl.
- The Voronoi mesh must be sized from the *total* built budget, not from
  `nCore` — otherwise there is no countryside for the sprawl to occupy.
- `buildWalls` culls patches beyond `radius × 3` (`model.ts:451`). With a
  small core that radius collapses and would cull the ribbons; the filter
  must key off sprawl extent instead.
- `this.nPatches` is currently read in several places that assume it means
  "the inner city" — citadel selection at index `nPatches`, and the outskirts
  probability `1/(nPatches − 5)`. Each use must be audited and pointed at
  either `nCore` or the total budget explicitly.

## Edge cases that must be handled

**Roadless burgs.** `roadBearings: []` is authoritative and common. With no
roads there are no corridors, so overflow falls back to a belt shaped by
harmonics and water alone. Without this, a routeless 250k burg silently
returns to being a disc.

**Disconnected core.** Warped selection can pick a core in two pieces — a
lobe joined by nothing — which is exactly the input that makes
`findCircumference` walk a wrong boundary (the failure mode round 4 guarded
against). The core set gets a connectivity pass before the wall is built:
flood-fill from the centre, drop strays, top up from adjacent patches until
`nCore` is reached.

## API surface

Additive only. `URL_PAYLOAD_VERSION` stays at `1`.

- `coreCapacity?: number` on `AzgaarBurgInput`, default 10 000.
- `coreCapacity` added to `FLAT_DATA_PARAMS` (16 params) and to the builder
  page form.
- `docs/url-api.md`: document the field, and rewrite §6's population-budget
  section. "The walled area grows with population" stops being true — a
  substantive contract change for Azgaar even though no payload breaks.

Satellites get no knob; they are automatic above a population threshold.

## Scene contract and the symbol library

Zone labels must reach the `Scene` as semantic data rather than staying
internal to the generator. `BuildingFeature.kind` already carries ward type
for exactly this purpose; `zone` joins it. `FieldPlot` gains `ringDepth`
(adjacency hops from built fabric) rather than `zone` — every field plot is
by definition in the `farm` zone, so a zone tag would carry no information,
whereas ring depth is what distinguishes near orchards from open crop
further out. `SCENE_VERSION` bumps.

This is the hook the SVG symbol library (`web/public/symbols/batch001/`, 38
symbols and an authoring spec) will key off in a later round: satellite
hamlets drawing `sm-hut-straw` and `sm-longhouse` where the core draws
`sm-house-tiled`, orchards and vineyards in the near fields against open crop
further out. **Wiring the symbols themselves is out of scope here** — this
round only guarantees the semantic data is present so the symbols can be
attached without re-plumbing the generator.

## Verification

Roundness gets a metric rather than an opinion. `Polygon.compactness`
(`4πA/P²`, already implemented) is measured on the built outline — 1.0 is a
circle. The current baseline must be measured first across a seed sweep, then
the acceptance threshold set from it; the test asserts a fixed ceiling rather
than a vague improvement. Settlements with two or more roads are the ones
held to it — a single-road burg has little to elongate along.

Also verified:

- Core population stays within tolerance of `coreCapacity` across a
  population sweep.
- Built patches ≤ 220 at population 250 000; generation stays inside the 8s
  budget (re-run the 60-seed stress that fitted `MAX_PATCHES`).
- Every suburb patch lies within some road corridor.
- Zero built patches in water.
- Roadless burgs produce a belt, not a disc.
- The core is connected.
- Unit tests for both fields in isolation — they are pure functions, so this
  is cheap and covers the interesting cases directly (opposed roads elongate;
  water suppresses; corridors decay).

## Expected fallout

Output changes for essentially every settlement, including villages. The
pinned village hashes that round 4 deliberately kept byte-stable must be
regenerated, and `SETTLEMAKER_VERSION` bumps to invalidate downstream tile
caches (see the questables cache note — that cache has no version key of its
own). This is unavoidable: a shape change that spared villages would mean
villages stayed round.

## Out of scope

- **Patch sizing.** Larger patches are a separate lever, deferred until the
  shape and zoning are right and can be judged.
- **Symbol wiring.** This round provides the semantic hooks only.
- Remaining round 2–4 backlog untouched here: harbour inland fallback,
  oblique piers, `.furrow` class scoping, near-degenerate palettes, web
  worker for large cities.
