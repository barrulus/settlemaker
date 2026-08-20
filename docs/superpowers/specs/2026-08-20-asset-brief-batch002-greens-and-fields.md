# Asset Brief — Batch 002: Village Greens, Field Textures, Field Edges

**Date:** 2026-08-20
**For:** the SVG design agent
**Authority:** the live refined set —
`settlemaker-web/dist/symbols/refined/integration.md` and its `symbols.json`
(67 symbols). That is the binding contract. The batch-001 `settlemaker-symbol-spec.org`
is **retired and must not be used as a reference.**
**Context:** feeds the roads-first village generator (pre-design
`2026-08-19-roads-first-predesign.md`). Village-and-below scope only.

---

## 1. Why this batch exists

The refined set gives us **objects** — houses, wells, inns, trees, wall kits. This batch
gives us **ground**: the open common at the centre of a village, and the cultivated land
around it. The generator produces the *shapes* of that ground from the road skeleton;
your job is the shape that cannot be generated (the green) and the textures that fill
the shapes that can (the fields).

Which technique applies to what:

| Thing | Who makes the outline | Who makes the surface |
|---|---|---|
| Village green / market square | **You** — a drawn shape, picked by junction type, uniformly scaled | You |
| Field / furlong / croft | **The generator** — clipped to the land between lanes | **You**, as a seamless tile |
| Field boundary | The generator emits the path | **You**, as a stamp repeated along it |

A green is small and its identity is its outline, so it is drawn. A field is large and
must fit whatever land is left over, so only its texture is drawn.

---

## 2. Two extensions to the live contract

Both are genuinely new. Neither exists in the refined set today, and both need Barry's
sign-off before you rely on them.

### 2.1 A third z-band: `parcel`

`integration.md` currently defines two bands, drawn `structure` then `canopy`. This batch
needs a band **below both**:

| Band | Contents | Shadows |
|---|---|---|
| **`parcel`** *(new)* | greens, fields, orchards, yards, field boundaries | **casts none, receives none** |
| `structure` | buildings, wells, walls, gates, towers, faith buildings, henge | as today |
| `canopy` | all vegetation | none, as today |

The no-shadow rule is the important half. Everything in `parcel` is a change in the
ground, not a thing standing on it. **No `-sil` twin for anything in this batch.** The
existing "vegetation casts nothing" rule now has a sibling: "ground casts nothing."

### 2.2 A second class: `pattern`

The set has `cls: "fixed"` and `cls: "canopy"`. Field textures and field edges are
neither — they are repeated, not placed. They take `cls: "pattern"` with:

```js
"sm-field-plough": {
  "cls": "pattern",
  "viewBox": [0, 0, 64, 64],
  "footprint": [16, 16],       // METRES — the tile's world size, as everywhere else
  "anchor": [32, 32],
  "tileAxis": "xy",            // NEW VALUE — tiles in both axes (wall kits use "x")
  "direction": "along-x",      // NEW KEY — "along-x" | "none"; how the renderer rotates it
  "zBand": "parcel",
  "tags": ["field", "arable"],
  "minScale": 0.3
}
```

Edge stamps need no new key at all — they reuse the wall kit's proven idiom:
`tileAxis: "x"`, one tile spanning its `footprint[0]` metres of boundary, abutting copies
overlapping their ink so the run reads continuous.

So the total contract delta is: one new band, one new class, one new `tileAxis` value,
one new key.

---

## 3. Deliverable A — village greens (6 ids × 2 seed variants = 12 files)

The open ground at the settlement's centre. Its shape is a fossil of the junction that
made it, so the generator picks the shape by road topology, not at random:

| id | Shape | Chosen when |
|---|---|---|
| `sm-green-round` | Round/oval blob | A road terminates here — nothing passes through |
| `sm-green-lens` | Lens/spindle, ~2.5:1 | One through-road, no major branch — the square is a swelling of the street |
| `sm-green-lens-long` | Lens/spindle, ~4:1 | Same, on a longer market street |
| `sm-green-triangle` | Rounded triangle | Y-junction, three roads |
| `sm-green-square` | Rounded rectangle, ~1.3:1 | Crossroads, four or more roads |
| `sm-green-d` | D-shape, one straight edge | Any of the above cut by water or a wall; the straight edge lays against the bank |

Two seed variants each (`-a`, `-b`), differing only in how the outline wanders. Same
nominal proportions, so the generator can swap them freely.

### Rules

- `cls: "fixed"`, `zBand: "parcel"`, `rotation: "free"`, standard 64×64 viewBox, anchor
  (32, 32) — same as every other `fixed` symbol.
- **Hand-drawn edges.** A true circle or true rectangle reads as CAD next to the refined
  marks. Wobble the outline the way the tree canopies are wobbled. A perfect disc is the
  specific failure mode to avoid.
- **Uniform scale only.** The generator scales `k` and rotates; it will never stretch one
  axis. That is why `lens` and `lens-long` ship as separate drawings instead of one
  stretched asset — a stretched outline smears its stroke weight and gives the trick away.
- **Fill from a token,** so one shape serves a grazed green, a beaten-earth market and a
  sand plaza by re-tinting: `--sm-common` (new, §6) for turf, existing `--sm-yard`
  (`#dfd3b3`) for worn earth, existing `--sm-yard-sand` for the desert set. Every fill
  carries its value as a CSS fallback, per the refined set's discipline.
- **Interior: near-empty.** A hint of cart ruts across the middle and a slightly worn
  fringe. Nothing else. The generator places `sm-well` (or the biome's well) on top — do
  **not** draw a well or a cross into the green.
- **`sm-green-d`'s straight edge** must be at a known bearing so the generator can aim it
  at the water: put it on the **south** edge (`upVector [0,-1]`, flat side at +y) and
  declare `orientationHint: "flat-to-water"`, matching how `sm-boathouse--coastal` uses
  `mouth-to-water`.
- **`footprint`** in metres at 1×. Suggested: round 30×30, lens 40×16, lens-long 56×14,
  triangle 34×30, square 34×26, D 32×24. Self-consistency is what matters; the generator
  scales from these.
- **`minScale`**: these get used large — 0.25 is fine.
- **Biomes:** one set serves all five. Re-tint via tokens rather than drawing variants —
  the same rule the refined set applies to its biome-agnostic marks (cathedral, keep,
  towers).

---

## 4. Deliverable B — field textures (8 seamless tiles)

`cls: "pattern"`, `zBand: "parcel"`, `tileAxis: "xy"`. Each is a **seamless tile** used as
an SVG `<pattern>` with a `patternTransform` rotation, so one tile serves every field of
that crop at every size and every furrow angle.

| id | Reads as | `direction` |
|---|---|---|
| `sm-field-plough` | Ridge-and-furrow, freshly worked. The workhorse. | `along-x` |
| `sm-field-stubble` | The same land after harvest — cut stalks, paler, furrow faintly legible | `along-x` |
| `sm-field-fallow` | Resting: rough tussock over an old furrow ghost | `along-x` |
| `sm-field-pasture` | Grazed grass, tufts, no crop lines | `none` |
| `sm-field-orchard` | Regularly spaced small canopy dots in quincunx | `along-x` |
| `sm-field-vine` | Close-spaced row crop / terraced vines | `along-x` |
| `sm-field-paddy--tropical` | Flooded plots, water sheen, low bunds | `along-x` |
| `sm-field-irrigated--desert` | Small square plots divided by channels — obviously watered, not rained on | `along-x` |

Tundra needs no crop tile: the generator uses `sm-field-pasture` re-tinted, or omits
fields entirely for cultures that do not farm.

### Rules

- **Seamless in both axes.** Verify by tiling 3×3 and looking for a seam. This is the
  single most important acceptance criterion here, and the corners are where it goes
  subtly wrong.
- **Directional tiles run along +x only.** The generator rotates the whole pattern to
  match the strip; furrows drawn at an angle inside the tile cannot be corrected.
- **`footprint` is the tile's metre size.** Suggest 16 × 16 m for plough/stubble/fallow/
  vine, 24 × 24 m for orchard and paddy, 12 × 12 m for pasture. Draw at 64×64 as usual.
- **No outline.** The tile has no boundary of its own — the edge is Deliverable C. A tile
  that draws its own border becomes a grid of boxes the moment it tiles.
- **Weight discipline.** Furrow lines at `calc(var(--sm-sw) * 0.5)` or lighter. Fields are
  the largest area of ink on the map; at full strength they shout down the houses, which
  are the subject. When in doubt, lighter.
- **Plough and stubble must differ enough** to read as a patchwork when alternated across
  neighbouring strips. That alternation is how the generator gets variety from two assets.

---

## 5. Deliverable C — field edges (4 stamps)

`cls: "pattern"`, `zBand: "parcel"`, `tileAxis: "x"` — the wall kit's idiom exactly.

| id | Reads as | Suggested `footprint` |
|---|---|---|
| `sm-edge-hedge` | A run of small dense canopy blobs; the enclosure look | 8 × 2 m |
| `sm-edge-wall` | Drystone — irregular coursing, no mortar line | 8 × 1.4 m |
| `sm-edge-fence` | Post-and-rail, or hurdles | 6 × 1.4 m |
| `sm-edge-ditch` | Ditch-and-bank: a paired line, shaded on one side | 10 × 2.4 m |

These do a disproportionate amount of the work: the same `sm-field-plough` reads as
England with hedges and as Spain with none. Biome and culture pick the edge type, and
"none" is a choice the generator will make often.

### Rules

- **Run axis is local x**, centred on `y = 32`, entering at `x = 0` and leaving at
  `x = 64`. The generator rotates each stamp to the path's local tangent — so unlike the
  wall kit these rotate freely, not `snap-cardinal`.
- **Let the ink bleed past the 64u box on both ends,** exactly as the wall tiles do, so
  abutting copies overlap and the run reads continuous. Do not inset to avoid overlap.
- **Butt-joins cleanly to itself.** Same seam discipline as the field tiles.
- `sm-edge-hedge` uses the existing `--sm-canopy-*` tokens so it re-tints with the biome's
  vegetation, but it stays in `parcel` — a hedge is a boundary, not a tree line, and must
  not occlude buildings the way `canopy` does.
- **No silhouette twins** (see §2.1). The wall kit has them; these do not.

---

## 6. Tokens

Reuse before inventing. Already in `symbols.json → tokens` and fit as-is: `--sm-yard`,
`--sm-yard-sand`, `--sm-dry`, `--sm-dry-b`, `--sm-olive`, and the `--sm-canopy-*` family
for hedges and orchard canopies.

Four new ones are needed:

| Token | For | Suggested |
|---|---|---|
| `--sm-common` | Grazed green / common ground | duller and yellower than `--sm-canopy-b` (`#74a552`) |
| `--sm-soil` | Worked earth in a ploughed field | warm mid-brown, lighter than `--sm-mud` (`#c99a63`) |
| `--sm-furrow` | The shaded side of each furrow | ~15% darker than `--sm-soil` |
| `--sm-crop` | Standing or cut crop, stubble, straw | between `--sm-thatch` (`#d8bd7e`) and `--sm-dry` (`#9aa86a`) |

Pick the values while drawing, add them to `symbols.json → tokens`, and give every fill
its value as an inline CSS fallback so the set renders correctly with no stylesheet —
the discipline the refined set already follows.

---

## 7. Acceptance checklist

The refined set's existing rules apply in full. These are the additions:

1. **Seam test** — every field tile rendered 3×3; no visible seam at any edge or corner.
2. **Rotation test** — every `along-x` tile at 0°, 30°, 90°; furrows stay coherent and no
   seam reappears.
3. **Run test** — every edge stamp repeated 6× in a straight line and again along a curve;
   the run reads continuous, with no gap and no doubled post.
4. **Scale test** — every asset at its declared `minScale`; the mark still reads.
5. **Weight test** — a ploughed field behind a row of `sm-house` at village scale. If your
   eye goes to the field before the houses, lighten it.
6. **No-shadow check** — nothing in this batch has a `-sil` twin, and nothing in `parcel`
   casts or receives a shadow.
7. **Green wobble check** — no green's outline should be describable as a circle or a
   rectangle.
8. **Patchwork check** — `sm-field-plough` and `sm-field-stubble` alternated across
   adjacent strips read as two different fields, not as a rendering artefact.
9. **Band check** — with all three bands composited, greens and fields sit under
   buildings, hedges sit under buildings, and canopy still overhangs everything.

---

## 8. Out of scope for this batch

- `sm-green-crescent` (a green wrapping a central church or mound) — a town-and-up shape;
  defer to the city work.
- Piers, jetties, bridges and anything that would need a `route` band.
- Terracing on slopes and water meadows — both need elevation the generator does not have.
- Any change to existing refined symbols. This batch is purely additive.
