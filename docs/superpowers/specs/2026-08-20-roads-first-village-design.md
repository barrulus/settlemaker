# Roads-First Village Generation — Design

**Date:** 2026-08-20
**Status:** DESIGN. Approved section by section in brainstorm; awaiting Barry's review of
this document before an implementation plan is written.
**Scope:** hamlet and village only — population below ~1000. Towns and cities keep the
existing engine.
**Inputs to this design:** `2026-08-19-roads-first-predesign.md`, Barry's five-frame
wireframe (`wireframe.png`), the live symbol contract
(`settlemaker-web/dist/symbols/refined/integration.md` + `symbols.json`), and the batch-002
asset brief (`2026-08-20-asset-brief-batch002-greens-and-fields.md`).

---

## 1. What this replaces and why

The current engine is a port of watabou's MFCG: Voronoi patches, wards, recursive
bisection. Every reference render Barry has approved came instead from watabou's *Village*
Generator, which is road-skeleton-first. The rivers work (issue #4, parked) failed
precisely where the polygon model fought network-shaped intent, and three render-gate
rounds of constant-tuning did not converge.

This design builds the settlement the way the wireframe does: **a road skeleton solved by
explicit rules, then dressed with parcels until the census is housed.** Every feature on
the map traces to a nameable rule, so a wrong render is fixed by changing a rule rather
than by tuning a constant.

The old engine is untouched. A population threshold selects which engine runs; there is no
flag day and no migration.

---

## 2. Architecture

Five passes, one per wireframe frame. Each is a pure function of its input plus a seeded
RNG, testable in isolation.

| Pass | Name | Produces |
|---|---|---|
| 1 | Site | `Site` — origin, water, typed routes, biome, census |
| 2 | Skeleton | `LaneGraph` + `Green` |
| 3 | Parcels | `Lot[]` |
| 4 | Dwellings | `Building[]` |
| 5 | Dressing | `Parcel[]` (crofts, fields) + `Scatter[]` + POIs |

Rendering paints bands bottom-up: `parcel` → route → `structure` → `canopy`.

### Module layout

New directory `src/village/`, nothing shared with `src/generator/model.ts`:

```
geometry.ts                  bearings, arc-length, sampling, water membership
glyphs.ts                    the single reader of SYMBOL_MANIFEST
constants.ts                 every tunable from §11, in one place
site.ts                      input → Site
skeleton/green-siting.ts     which junction, which shape, how big
skeleton/lanes.ts            spine, arms, invented lanes
skeleton/relax.ts            lanes bend around acquired buildings (runs after pass 4)
parcels/strip.ts             offset a curving lane, clip it
parcels/lots.ts              subdivide a strip into lots
deck.ts                      dwelling decks per biome (culture later)
dwellings.ts                 spend the census
dressing/crofts.ts
dressing/fields.ts
dressing/scatter.ts
dressing/poi.ts
village-model.ts             orchestrates the five passes
```

### Shared foundations

Three modules sit under the five passes. They exist because the alternative is the same
helper written three times with three slightly different sign conventions — the classic
way a deterministic generator acquires a bug that only shows up at one bearing.

- **`geometry.ts`** — compass bearings (0 = N, clockwise) to and from vectors, angular
  gaps, polyline arc-length and sampling, unit vectors, distance, and "is this point in
  any water polygon". Passes 2, 3, 4 and 5 all use it. Nothing in `src/geom/` covers
  bearings or arc-length sampling, so this is new code, not a wrapper.
- **`glyphs.ts`** — the **only** module that reads `SYMBOL_MANIFEST`. Nominal footprint,
  ink extent, rotation class, `minScale`. The ink ratios currently living in
  `src/generator/village-rows.ts` move here and are re-exported from their old home, so
  there is one definition and the dependency points from the old engine to the shared
  module rather than from the new engine to the old one.
- **`constants.ts`** — every tunable in §11, in one file. §11 promises that a render-gate
  verdict maps to a single edit; that promise is only true if the constants are in one
  place rather than scattered across the passes that use them.

**Rule for every pass:** a pass that needs an angle, an arc-length, a glyph dimension or a
tunable **calls these modules**. It does not define its own local copy, and it does not
inline a literal. If a helper is needed in two passes, it belongs here; if a constant is
tuned at a gate, it belongs here.

### Invariants

- **Metres.** All geometry is metres in burg-local coordinates (origin = burg centre)
  until a single world-scale transform at render time. Glyph footprints are already
  metric, so no conversion happens at the asset boundary. An imperial readout, if ever
  wanted, is render-time formatting only.
- **Seeded determinism.** Every pass receives the RNG as a parameter; no globals. Same
  seed → identical bytes, as today.
- **Stable ids.** Every generated object carries an id derived from its *structural
  position*, never from an array index or iteration order:
  - lane — its origin (green arm bearing, or parent lane) plus its branch path;
  - lot — its lane id, side, and ordinal measured from the green end;
  - building — its lot id;
  - field — its wedge id and strip ordinal.

  Cheap now, expensive to retrofit. It is what will let a future editor store a manual
  edit against an object and have that edit survive regeneration; with index-based ids,
  any upstream change silently reassigns every stored edit to the wrong object. See §10.
- **Zero runtime dependencies**, unchanged.
- **External contract unchanged**: `AzgaarBurgInput` in, deterministic SVG + GeoJSON out,
  `data-bg="paper"` tiler contract, library served as `/lib/settlemaker.js`.

---

## 3. Pass 1 — Site

Resolves `AzgaarBurgInput` into local metres:

- **Origin**: burg centre, (0, 0).
- **Water**: `coastlineGeometry` polygons where supplied, `oceanBearing` half-plane
  otherwise.
- **Routes**: `roadBearings`, each carrying `bearing_deg`, `route_id`, `kind`, `group`,
  `through`, `relief`, `followsRiver`.
- **Census**: `population`, plus `urbanDensity` where the caller supplies it.
- **Biome** and flags (`port`, `temple`, `trade`, `plaza`, `citadel`, `walls`, `shanty`).

### Route vocabulary change

`RouteKind` grows from `road | foot | sea` to Barry's Bazgaar set:

```
royal | main | market | town | local | trail | footpath
```

plus the special groups `searoutes | airroutes | traderoutes`.

Back-compatible mapping for existing callers: `road → main`, `foot → trail`,
`sea → searoutes`. The three-value form remains accepted input forever; it is widened, not
replaced.

Class order, highest first: `royal > main > market > town > local > trail > footpath`.
The **road group** is `royal…local`; the **path group** is `trail` and `footpath`.

Settlemaker's own invented lanes are typed from the same vocabulary, so lane width is a
class rather than a tuning constant, and the renderer's per-type width/dash hierarchy
applies to invented lanes and FMG routes alike.

---

## 4. Pass 2 — Skeleton

### 4.1 Green siting

FMG supplies bearings, not geometry, so all incoming routes radiate from the origin: the
confluence *is* the origin. Siting is therefore displacement.

**Order within pass 2 is: shape (§4.2) → size (§4.3) → position (below) → lanes (§4.4).**
Position is resolved last because step 4 needs the radius. Size in turn needs only the
census and the highest road class, neither of which depends on position.

Displacement, applied in order:

1. Consider only **road-group** routes. Trails and footpaths never influence the green —
   they arrive between the houses, after the fact.
2. Green centre starts at the origin.
3. If a `through` route exists, the centre moves onto that route's line, so traffic
   crosses the green rather than passing beside it. With two through routes, the centre
   sits at their crossing.
4. If water lies within `radius + 6 m`, the centre is pushed away along the water bearing
   until it clears.

Where the only routes present are `local`, a green still forms — `local` earns a green
only as a last resort, but a last resort is still a resort. Where only trails and
footpaths arrive, the green is placed at the origin by fallback with the `round` shape.

### 4.2 Green shape

Selected by the count of road-group arms:

| Road-group arms | Shape |
|---|---|
| 1 (terminus) | `sm-green-round` |
| 2, forming one through route | `sm-green-lens`; `sm-green-lens-long` if that route is `main` or better |
| 3 | `sm-green-triangle` |
| 4 or more | `sm-green-square` |
| any of the above, clipped by water | `sm-green-d`, flat edge to the bank |

The `-a` / `-b` seed variant is a die roll. The shape is not.

### 4.3 Green size

```
diameter = min( max( floor(class) × √(pop / 300), floor(class) ), min(40 m, builtRadius / 1.5) )
```

**The cap beats the floor when they conflict** (ruling R8, 2026-08-20). Written as a
plain `clamp(value, floor, cap)` this is ambiguous whenever `cap < floor`, and the two
readings disagree: floor-wins would give a hamlet of 30 m built radius a 26 m green on a
royal road — a green nearly as wide as the village. The class floor is a minimum for a
green that has room, not a licence to exceed the settlement.

`floor(class)` by highest road class present: royal 26 m, main 22, market 20, town 16,
local 12.

`builtRadius` is *predicted* in this pass, before any geometry exists: the census divided
by the deck's mean occupancy gives a house count, times mean lot area, gives a built area,
whose radius bounds the green. The prediction is refined by the pass-4 feedback loop
(§6.3) if it turns out wrong.

### 4.4 Lanes

**Arms.** Each incoming route leaves the green at its bearing and continues to the edge of
the generated extent at its own class. A `through` route also exits at bearing + 180° with
wander. A terminating route simply stops at the green.

**Invented lanes** are added only when frontage runs out:

```
required = Σ (lot frontages the deck will need)
available = Σ (lane length × 2 sides) − water − green
add lanes until available ≥ required × 1.15
```

An invented lane either leaves the green at a free bearing (at least 35° from every
existing arm) or branches from an existing lane at 60–110°, between one third and two
thirds along it. Its class is one step below its parent — and for a green-attached lane,
which has no parent, one step below the **highest-class arm** meeting the green. Floored
at:

- `local` for lanes attached to the green — wagons must always reach the green;
- `trail` for second-order branches;
- `footpath` below that.

**Widths** in metres by class: royal 6, main 5, market 4.5, town 4, local 3.5, trail 2,
footpath 1.2. Width feeds both the drawn line and the parcel setback.

**Terrain.** FMG gives `relief` and `followsRiver` per route, and no terrain field inside
the burg. Accepted limitation (Barry, 2026-08-20: "FMG is not granular enough to give us
decent terrain info"): a labelled arm bends to follow its valley or river; an invented lane
cannot seek a valley nothing told us about. Not faked, not deferred to a constant.

### 4.5 Relaxation

Runs after pass 4, once buildings exist. Each lane is resampled and pushed off any building
intruding within `width/2 + 0.5 m`, then smoothed. Bounded at three iterations and 1.5 m
maximum displacement, so determinism holds and geometry cannot wander.

Lane tails that acquired no dwelling are trimmed back to the last building plus a short
stub. That trimming is the straggle at the edge of the fabric.

**Trimming goes by provenance** (ruling R15, 2026-08-20), because the two kinds of lane
mean different things:

- An **`arm-` lane is FMG's road** — the route to the next town, which exists whether or
  not anyone builds along it. It is never trimmed, with or without dwellings. Trimming
  one would delete the village's connection to the world, which is the subject of the
  reference wireframe's first frame.
- An **invented lane with dwellings** is trimmed back to its last building plus the stub.
- An **invented lane with no dwellings is dropped entirely.** It exists only to supply
  frontage the census turned out not to need; stubbed it reads as an error, and
  full-length it reads as a road to nothing.

### 4.6 Rule versus dice

**Rules:** green position, shape, size; arm bearings and classes; lane count; where an
invented lane attaches; lane widths.
**Dice:** wander amplitude along a lane; which seed variant of a green is drawn; the order
equally-scored lots are filled; per-instance size jitter (§6.4).

---

## 5. Pass 3 — Parcels

### 5.1 Strips

For each lane, offset the polyline both sides by `width/2 + setback`, setback 1.5–3 m by
class. The strip runs back from that line to the lot depth. The setback is what keeps
buildings clear of the lane — a hard requirement from the wireframe review.

### 5.2 Frontage gradient

```
frontage(d) = f0 × (1 + k · (d / R)^1.5)
```

`d` = distance from the green centre, `R` = built radius. Near the green frontage is `f0`;
at the fringe three to four times that. The dwelling does not shrink — the plot grows. This
single formula produces the whole density gradient of wireframe frame 4.

`f0` = the widest common dwelling in the deck + a gap term, and **the gap tightens as
population rises**: about 2.4 m of air between neighbours at pop 100, about 1.0 m at pop
900. A hamlet is loose around its green; a large village is crowded at the front.

When frontage falls below the dwelling's width the dwellings touch and become a row. Rows
are therefore a consequence, not a mode — and the same code produces terraces when the city
work arrives.

### 5.3 The green's perimeter is frontage

The green's outline is subdivided into inward-facing lots exactly as a lane strip is, at
the tightest frontages in the settlement. The best-scoring one or two are reserved for the
deck's capped landmark entries (inn, chapel) where population justifies them.

The ring of buildings around the green in frame 4 is therefore not a placement rule. It is
the ordinary subdivision applied to the most valuable frontage in the village.

Where the green is `sm-green-d` against water, the lots along its flat edge face the water
rather than the green (§8.4).

### 5.4 Clipping, in priority order

1. **Water** — a lot whose front is wet is dropped; a lot whose depth is wet is truncated.
2. **The green** — no lot inside it.
3. **Converging strips** — where two lanes' strips overlap, the higher-class lane keeps the
   overlap; the lower splits at the bisector.
4. **Inner curves** — where a tight bend folds a strip onto itself, the fold is removed.

Anything left with a front shorter than the minimum frontage is dropped, never squeezed.

**Corners** need no special case: at a junction the wedge goes to the higher-class lane,
and the resulting lot fronts that lane with its flank to the other.

### 5.5 Lot score

Each lot carries a score from: distance to the green (nearer is better), lane class
(higher is better), corner (better), water view (better). Pass 4 fills highest-scoring
lots first, so an under-populated settlement fills inward-out and fringe lots stay empty.

**Straggle is the absence of a rule, not a fraying rule.**

### 5.6 Crofts

Behind each lot sits its croft — the enclosed garden strip. Zero depth where frontage is
tight, 15–30 m at the fringe. The croft is dressed in pass 5, and its outer edge is where
the built fabric ends and the open fields begin: **toft → croft → furlong** is one
continuous depth axis running back from the lane.

### 5.7 Testable properties

Hold for every seed, so they are cheap regression cover before any render:

- no two lots overlap;
- every lot's front lies on a lane or on the green;
- no lot is narrower than the minimum frontage;
- no lot lies in water.

---

## 6. Pass 4 — Dwellings

### 6.1 The deck

```
DeckEntry {
  glyph        // manifest id, biome suffix resolved with temperate fallback
  occupancy    // people per dwelling
  weight       // relative frequency
  sizeFactor?  // semantic size multiplier, default 1.0 — scales footprint AND occupancy
  minFrontage? // metres; defaults to footprint width + gap
  cap?         // 'one' | n — capped entries are placed before ordinary ones
  requires?    // { pop: [min, max], flag: 'temple'|'trade'|'port', adjacency: 'water'|'road'|'green' }
}
```

A deck is per biome. Culture decks layer over biome decks in later work; the resolution
order is culture → biome → temperate.

Because a deck is per biome, integration.md's "never mix biome sets within one settlement"
rule is enforced structurally rather than by discipline.

Starting temperate village deck:

| glyph | occupancy | weight | notes |
|---|---|---|---|
| `sm-house` | 5 | 60 | |
| `sm-hut-straw` | 3 | 20 | |
| `sm-house-tiled` | 5 | 12 | |
| `sm-longhouse` | 12 | 6 | |
| `sm-house-large-tiled` | 6 | — | `cap: one`, `requires pop ≥ 250` — the reeve's house |
| `sm-inn` | 6 | — | `cap: one`, `requires pop ≥ 180`, adjacency `road` or `green` |
| `sm-chapel` | 0 | — | `cap: one`, `requires` temple flag or pop ≥ 300 |

Occupancy living on the deck entry is what makes Barry's later population work a **new
deck, not a new engine**: a nomadic culture is `{tent, occupancy 8}` or
`{wagon, occupancy 4}` and nothing else changes.

### 6.2 Spending the census

1. Capped landmarks first, onto the best-scoring lots they are eligible for — so the inn
   and the chapel take green frontage.
2. Then walk lots in descending score. For each, draw a weighted entry from the deck —
   **a capped entry leaves the pool once placed, and an entry whose `requires` is unmet
   never enters it** — filtered to entries whose `minFrontage` fits the lot. Place it;
   add its occupancy to the housed count.
3. Stop when housed ≥ census. Remaining lots stay empty.

Ties in lot score are broken by lot id, so the draw order is deterministic.

### 6.3 The feedback loop

Pass 2 *predicted* the frontage the census needs; this pass discovers the truth. If lots
run out before the population is housed:

- return to pass 2 for another lane, up to **three** rounds;
- if it still does not fit, tighten `f0`'s gap term by 15% and re-cut the lots;
- if it still does not fit after that, house the remainder in the highest-occupancy deck
  entry that fits the remaining lots, and record an overflow diagnostic.

Bounded in both directions, so it cannot spin, and each outcome is nameable at a render
gate ("it added a lane because the census overran the frontage").

### 6.4 Seating and sizing

**Seating.** The dwelling sits at the front of its lot, centred on the frontage with a
small jitter, set back 0–1.5 m; the remainder is yard. Bearing is the lot's inward normal —
exactly the manifest's `ridge-along-street` hint, and Barry's wireframe rule that houses
face the nearest road. Glyphs marked `invariant` (the round huts) are not rotated;
`snap-cardinal` glyphs snap. The manifest is authoritative on which is which.

**Sizing** uses three multipliers, deliberately separated:

| Multiplier | Range | Affects | Purpose |
|---|---|---|---|
| `sizeFactor` (deck) | per entry, e.g. 1.5 | footprint **and** occupancy | Semantic: an inn is bigger because an inn is bigger. Also cathedrals, temples, manors. |
| Instance jitter | ±10% | footprint only | Aesthetic: stops a row reading as stamped copies. |
| Fit sizing | 0.85–1.15× | footprint only | Practical: shrink into a slightly narrow lot rather than abandoning it; grow into a generously wide fringe lot so a cottage is not lost in its plot. |

**The bound applies to the non-semantic multipliers only.** Jitter is ±10% (0.9–1.1) and
fit is 0.85–1.15, so their product lands in **[0.765, 1.265]**, and that combined factor
is applied on top of the entry's `sizeFactor`. So an ordinary dwelling stays within
roughly 0.77–1.27× nominal, while an inn at `sizeFactor` 1.5 reaches roughly 1.15–1.9×.

`sizeFactor` is deliberately outside the bound: it is a statement about *what the
building is*, not variation applied to it. Clamping it would squash the very distinction
it exists to express. (Ruling R13, 2026-08-20 — an earlier draft of this section stated a
total bound of 0.85–1.65×, which was an arithmetic slip: it multiplied `sizeFactor` by
jitter and omitted fit.)

Fringe dwellings therefore end up slightly larger *and* much further apart, which is closer
to how a straggling edge actually looks than uniform dwellings would be.

**`minScale` is not one of these.** The manifest's `minScale` is a legibility floor — below
it interior linework dissolves and the renderer substitutes or drops the mark. It is a zoom
concern and must not be conflated with the sizing multipliers.

**Overlap uses ink extent, not the footprint box.** Several glyphs deliberately overhang
their footprint (tropical eaves, the desert hut's awning, the coastal drying rack), and
integration.md forbids clipping to the footprint. The check runs on the **scaled** ink
extent. If a draw does not fit, retry with a narrower deck entry; if none fits, leave the
lot empty. This is the village-rows lesson applied at parcel level.

---

## 7. Pass 5 — Dressing

Order is fixed, and each stage claims land the next must avoid. That ordering is what stops
trees growing in the ploughed strips.

### 7.1 Crofts

Each built lot's croft is textured and given a boundary from the edge set — `sm-edge-hedge`,
`sm-edge-wall`, `sm-edge-fence`, `sm-edge-ditch`, or none. The choice is by biome and
culture and is **held constant across the settlement**: a village that fenced some plots
and hedged others reads as an error, not as variety.

### 7.2 Fields

The wedges between lanes, beyond the crofts, are field land.

1. Clip each wedge against water, the crofts, and a maximum radius set by how much land the
   census needs to eat.
2. Subdivide into a bundle of long strips — a furlong — with one furrow direction per
   bundle.
3. Give neighbouring bundles different directions. That is what produces the medieval
   patchwork.
4. Assign crops from a per-biome table, alternating `sm-field-plough` / `sm-field-stubble`
   / `sm-field-fallow` across strips, so a handful of tiles yields a whole field system.
5. Stamp boundaries with the same edge asset as the crofts.

Cultures and biomes without settled agriculture (tundra, nomads, a hamlet that lives off
the water) take pasture or nothing. Fields are a deck-like input, not a universal.

### 7.3 Vegetation

Biome-density scatter, thinning outward from the fabric, avoiding lanes, lots, crofts and
fields. Clumps land in the leftover wedges.

**Water is neutral ground for scatter** — no strip, no bonus, no avoidance. Trees near a
bank occur only because ordinary scatter put them there.

### 7.4 POIs

Capped, rule-gated placements rather than scatter:

- well or market cross at the green's centre;
- the stone circle and its kind placed *outside* the fabric at a distance;
- a pier or boathouse where the shorefront meets the settlement (§8.4).

---

## 8. Cross-cutting rules

### 8.1 Determinism

One RNG instance, threaded through every pass as a parameter. Draw order is always defined
by a sorted key (lot score then lot id, lane id, wedge id) so no iteration order can leak.
Same seed → identical SVG bytes, verified by test as today.

### 8.2 Bands and shadows

Render order `parcel` → route → `structure` → `canopy`. Everything in `parcel` casts no
shadow and receives none. Within `structure`, all shadows for the band are drawn before any
ink, with the shadow offset applied **outside** the symbol's rotation — the single mistake
that makes a settlement look wrong immediately.

### 8.3 Biome consistency

One biome set per settlement, enforced by the deck. Temperate-only glyphs (cathedral,
chapel, temple, stone circle, keep, drum and square towers) are biome-agnostic and are
re-tinted with the biome's material tokens rather than substituted.

### 8.4 Shorefront

Where water comes within `builtRadius × 1.5` of the fabric, that stretch of bank is working
frontage, not scenery:

- scatter is suppressed there;
- lots may front the water directly, without a lane behind them;
- the pier or boathouse goes on the stretch nearest the green.

Beyond that distance the rule lapses and ordinary scatter resumes, so wooded banks still
occur at the edges of the map — they are just never a designed ribbon.

The `builtRadius × 1.5` figure is a starting value expected to move at a render gate.

### 8.5 Failure handling

Every pass fails soft, because a village with fewer houses is a better outcome than an
exception:

- no road-group routes → green at origin, `round` shape;
- census cannot be housed → §6.3's bounded ladder, then an overflow diagnostic;
- a lot cannot take any deck entry → left empty;
- a wedge is too small to hold a furlong → left as rough ground;
- water covers the site → the existing input validation rejects it, as today.

Diagnostics are recorded on the model rather than thrown, so a render gate can ask why.

---

## 9. Testing

**Unit** — geometry primitives: offsetting a curving polyline, subdividing by arc length,
clipping a strip against a polygon, the frontage gradient.

**Rule** — given a set of typed routes, the expected green shape, size and position; given
a census, the expected lane count. These are the tests that make verdicts reviewable.

**Property** — §5.7's four invariants, over many seeds.

**Determinism** — same seed, identical bytes, as today.

**Render gates with Barry's eyes are the only accepted acceptance test.** Metrics passed
while every render was wrong, repeatedly, through the rivers work and before. No amount of
green unit tests substitutes for looking at the picture.

---

## 10. Deferred, and explicitly not designed here

- **Towns and cities.** Walls, gates, blocks from enclosed lane faces, faubourgs, the
  bypass form of a through route, the green retreating inside the walls, `sm-green-crescent`.
  The parcel and lane primitives are built to survive that jump — a city block is the same
  perimeter subdivision — but no city rule is written against zero renders.
- **Culture decks.** The seam exists (§6.1); the content does not.
- **A local terrain field.** Accepted absence (§4.4); revisit only if FMG's granularity
  changes.
- **Rivers through the settlement.** The rivers work stays parked. Two river-independent
  fixes from that branch (`filterOutskirts` flat-density, farm-field water overhang,
  commit `e4fd30f`) remain worth cherry-picking regardless of engine.
- **Piers beyond a single placement**, harbours, and anything in a `route` band beyond
  lanes.
- **Manual editing** (watabou-style handles: bend a lane, drag the green, nudge a house).
  Not designed here, but deliberately not foreclosed. Two shapes are anticipated: edits as
  **constraints on the skeleton**, where passes 1–2 are frozen with the edit applied and
  passes 3–5 re-solve — which is what makes a stretched settlement stay coherent instead
  of smearing — and edits as an **override patch** applied to leaf objects after
  generation. Both depend on the stable-id invariant in §2 and on the passes staying pure;
  both are otherwise a settlemaker-web project (hit-testing, handles, undo, a persistence
  format for the constraint set), not a library one.

---

## 11. Open values expected to move at a render gate

These are starting values, not decisions. Each is a single named constant so a gate verdict
maps to one edit:

| Value | Start |
|---|---|
| Green diameter floors by class | royal 26 m, main 22, market 20, town 16, local 12 |
| Green diameter cap | 40 m, and `builtRadius / 1.5` |
| Frontage gradient exponent `k` and shape | `(d/R)^1.5`, fringe ≈ 3–4× `f0` |
| Gap term in `f0` | 2.4 m at pop 100 → 1.0 m at pop 900 |
| Setback from lane | 1.5–3 m by class |
| Croft depth | 0 m tight → 15–30 m fringe |
| Instance size jitter | ±10% |
| Fit sizing range | 0.85–1.15× |
| Shorefront reach | `builtRadius × 1.5` |
| Lane relaxation | 3 iterations, 1.5 m max |
| Frontage safety margin | 1.15× |
