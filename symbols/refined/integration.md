# SettleMaker symbols — integration instructions

For an agent wiring these 91 symbols into a map renderer. Everything you need is in
this folder; nothing depends on the sheet they were designed on.

## What is in the folder

| File | Use |
| --- | --- |
| `symbols.svg` | Sprite, 22 temperate symbols + their silhouette twins |
| `symbols-biomes.svg` | Sprite, 45 biome symbols + twins (desert, tundra, tropical, coastal) |
| `symbols-parcel.svg` | Sprite, 24 parcel-band assets: 12 greens, 8 field tiles, 4 edge stamps |
| `sm-*.svg` | The same symbols as standalone files, one per id |
| `symbols.json` | Manifest: placement contract for every id, plus tokens and biome map |

Load the three sprites once into the document (inline them, or fetch and inject — they
are `width="0" height="0"` and paint nothing on their own), then reference symbols
with `<use href="#sm-house">`. Use the standalone files only where you need a symbol
in isolation, e.g. a UI palette thumbnail or an `<img>`.

## Drawing a symbol

Every symbol is a 64×64 viewBox with its anchor at (32, 32). The root carries no
colour of its own — ink and stroke weight come from the two tokens:

```css
:root { --sm-ink: #33262e; --sm-sw: 2; }
```

Fills come from named tokens (`--sm-stone`, `--sm-timber`, `--sm-mud`, `--sm-thatch`,
`--sm-shingle`, `--sm-snow`, `--sm-lead`, the canopy and plant greens, …). All 29 are
listed in `symbols.json → tokens` with the values the set was drawn against, and every
fill in the sprites has that value as its own CSS fallback — so the symbols render
correctly with no stylesheet at all, and re-tint the moment you define a token.

Place a symbol by translating its anchor to the world point, then scaling, then
rotating, then moving the anchor back:

```
translate(x, y) rotate(bearing) scale(k) translate(-32, -32)
```

## The shadow contract

There is exactly one light in the world and it never moves.

- `symbols.json → shadow` gives it: `offset [2.6, 3.6]`, `opacity 0.2`, `color #46303c`.
- Draw the shadow from the symbol's **silhouette twin** — `#sm-house-sil`, etc. The
  twin is a single flat shape with `fill="currentColor" stroke="currentColor"`, so set
  `color` on the wrapping group.
- Apply the offset **outside** the symbol's own rotation, never inside it. Rotating
  the offset is the one mistake that makes a settlement look wrong immediately.

```html
<g transform="translate(2.6,3.6)" opacity="0.2" color="#46303c">
  <use href="#sm-house-sil" transform="translate(196,118) rotate(-8) scale(0.62) translate(-32,-32)"></use>
</g>
<use href="#sm-house" transform="translate(196,118) rotate(-8) scale(0.62) translate(-32,-32)"></use>
```

Draw **all** shadows for a z-band before **any** ink in that band, or buildings will
cast onto their neighbours' roofs.

**Vegetation casts nothing.** Every `zBand: "canopy"` symbol has no silhouette twin
and takes no shadow — the same rule the original tree marks follow. Do not invent one.

## Z-bands

Three bands, drawn in this order:

1. `parcel` — greens, field textures, field edges. Changes in the ground.
2. `structure` — buildings, wells, walls, gates, towers, faith buildings, henge.
3. `canopy` — all vegetation, over everything.

Within a band, shadows first, then ink (see above).

Draw roads **between** parcel and structure, so a road paints over a green's edge where
the two meet. Without that overlap the patch reads as a plate lying on the map.

**Ground carries no ink, and no lines.** A green strokes with `--sm-common-band` (#8aa855) at
4.2u under its `--sm-common` fill, so its edge reads as a band of worn turf ringing the patch
rather than an outline around a shape; the interior is a sparse stipple in the same tone. No
`--sm-ink`, and nothing linear — a dark hairline reads as a drawn object no matter how thin,
and any interior line long enough to see reads as fake at this scale. Field tiles and edge
stamps do use ink, at the weights below.

**Weight in `parcel` is judged on screen, not as authored** — and the two kinds of asset fail
in opposite directions. A field pattern lives in user space and is *never* scaled by your
placement factor; a green *is* placed at 2–2.5× and takes its strokes up with it. Both are
authored so they land at or below the buildings: furrows 0.5u flat, green outline 0.5u
(≈1.2u once placed), cart ruts 0.4u, worn fringe 0.28u, edge stamps ≤1.0u — against a house
outline of 2.2u × scale(0.5) = 1.1u. If you change placement scales, re-check this: ground
that out-inks structure stops reading as ground and starts reading as an object.

**Nothing in `parcel` casts or receives a shadow**, and nothing in it has a silhouette
twin — it is a change in the ground, not a thing standing on it. Same rule as canopy,
for the opposite reason.

## Classes

`symbols[id].cls` says how a symbol is used:

- `fixed` — placed once at a point. Buildings, wells, greens.
- `canopy` — placed once, drawn in the canopy band, casts nothing.
- `pattern` — **repeated, not placed.** Field textures (`tileAxis: "xy"`) and field
  edges (`tileAxis: "x"`).

## Village greens (`parcel`, `cls: "fixed"`)

Six shapes, two seeds each. The shape is a fossil of the junction that made it, so pick
by road topology, not at random — `symbols[id].junction`:

| `junction` | id | Shape |
| --- | --- | --- |
| `terminus` | `sm-green-round-{a,b}` | Round / oval blob |
| `through-road` | `sm-green-lens-{a,b}` | Lens / spindle, 2.5:1 |
| `through-road-long` | `sm-green-lens-long-{a,b}` | Lens / spindle, 4:1 |
| `y-junction` | `sm-green-triangle-{a,b}` | Rounded triangle |
| `crossroads` | `sm-green-square-{a,b}` | Rounded rectangle, 1.3:1 |
| `cut-by-edge` | `sm-green-d-{a,b}` | D-shape, one straight edge |

- **Uniform scale only.** The aspect is drawn in — that is why lens and lens-long are two
  drawings rather than one stretched asset. A stretched outline smears its stroke weight.
- **No centre mark.** Place `sm-well` (or the biome's well, or a cross) on top, in
  `structure`. The greens draw only cart ruts and a worn fringe.
- `sm-green-d` has its flat edge on the **south** (`upVector [0,-1]`,
  `orientationHint: "flat-to-water"`) — rotate so that edge lays against the bank or wall.
- Fill from `--sm-common` (#a8bf6d) with the band in `--sm-common-band` (#8aa855); re-tint both
  together with `--sm-yard` (#dfd3b3) for a beaten-earth market or `--sm-yard-sand` for a
  desert plaza. One set serves all five biomes. Turf sits deliberately lighter than the
  temperate ground (#a3c98d) so the patch is visible as turf, not just as an outline.
- **No ink, no lines.** The edge is the turf band; the interior is stipple only. There is no
  contour to thin and no tracks to vary.

## Field textures (`parcel`, `cls: "pattern"`, `tileAxis: "xy"`)

Eight seamless 64×64 tiles. Use each as an SVG `<pattern>` with `patternUnits="userSpaceOnUse"`,
then clip the fill to the parcel the generator produced:

```html
<pattern id="p-plough" width="64" height="64" patternUnits="userSpaceOnUse"
         patternTransform="rotate(30)">
  <use href="#sm-field-plough" width="64" height="64"></use>
</pattern>
<path d="…the parcel outline…" fill="url(#p-plough)"></path>
```

| id | Reads as | `direction` |
| --- | --- | --- |
| `sm-field-plough` | Ridge-and-furrow, freshly worked | `along-x` |
| `sm-field-stubble` | After harvest — cut stalks, furrow faint | `along-x` |
| `sm-field-fallow` | Resting: tussock over a furrow ghost | `along-x` |
| `sm-field-pasture` | Grazed grass, no crop lines | `none` |
| `sm-field-orchard` | Quincunx canopy dots | `along-x` |
| `sm-field-vine` | Close-spaced row crop / terraced vines | `along-x` |
| `sm-field-paddy--tropical` | Flooded plots, low bunds | `along-x` |
| `sm-field-irrigated--desert` | Small plots split by channels | `along-x` |

- **Rotate the pattern, never the tile.** `direction: "along-x"` means the furrows are drawn
  along +x; put the strip's angle in `patternTransform`. `direction: "none"` tiles need no
  rotation at all.
- `footprint` is the tile's world size in metres (16×16 for the arable tiles, 24×24 for
  orchard and paddy, 12×12 for pasture) — set the pattern's scale from that, not from taste.
- **Weight.** Furrow strokes are ~0.5u — see the note under Z-bands. If a field competes with
  the houses, it is too heavy: lighten it or close the soil-to-ground value gap.
- **No borders.** A tile draws no boundary of its own; the boundary is an edge stamp. A tile
  that drew its own border would become a grid of boxes the moment it tiled.
- Alternate `sm-field-plough` and `sm-field-stubble` across neighbouring strips — that
  alternation is where field variety comes from.
- Tundra has no crop tile: use `sm-field-pasture` re-tinted, or no fields at all.

Each tile is built by generating its texture once and replicating it at the eight neighbour
offsets inside a clip, so anything crossing an edge or corner reappears exactly opposite. If
you ever edit a tile, keep that structure — and keep full-span line wobble periodic over
exactly 64 units, which replication alone cannot fix.

## Field edges (`parcel`, `cls: "pattern"`, `tileAxis: "x"`)

`sm-edge-hedge`, `sm-edge-wall`, `sm-edge-fence`, `sm-edge-ditch` — stamps repeated along
a boundary path the generator emits. Same idiom as the wall kit, with two differences:

- **Rotate each stamp to the path's local tangent** (free rotation, not snap-cardinal).
- **No silhouette twins, no shadow.** A hedge is a boundary, not a tree line — it sits in
  `parcel` and must never occlude a building.

Ink bleeds past both ends of the 64u box so abutting copies overlap and the run reads
continuous. Do not inset to avoid the overlap. `sm-edge-ditch` shades its **local south**
side. `sm-edge-hedge` uses the `--sm-canopy-*` tokens so it re-tints with the biome.

Culture picks the edge type, and *none* is a legitimate choice — the same
`sm-field-plough` reads as England with hedges and as Spain without them.

## Biomes

`symbols.json → biomes` maps a biome to its id suffix and the ground colour the set was
drawn against:

| biome | suffix | ground |
| --- | --- | --- |
| temperate | *(none)* | `#a3c98d` |
| desert | `--desert` | `#d9c48f` |
| tundra | `--tundra` | `#e6ecef` |
| tropical | `--tropical` | `#6d9e5c` |
| coastal | `--coastal` | `#cfd6b0` |

Resolve a symbol as `basename + suffix`, and **fall back to the temperate id when the
suffixed one does not exist** — biome sets are deliberately partial. Each covers
dwellings, a well, an inn, a grand religious building, a three-piece fortification kit
and its own vegetation; the temperate-only marks (house-tiled, house-large-tiled,
hut-mud, hut-round, cathedral, chapel, temple, stone circle, the keep and the drum/square
towers) are biome-agnostic — re-tint them with that biome's material token rather than
looking for a variant.

Do not mix biome sets inside one settlement. The roof logic is what distinguishes them
— flat with a parapet double-line and no ridge (desert), heavy ridge with two snow
drifts (tundra), deep eaves on stilts (tropical), staggered shingle courses (coastal) —
and mixing reads as an error, not as variety.

## Assembling the fortification kit

Wall, gate and tower tiles sit on a **64u pitch**, so tile *n* is placed at `x = 64n`.

- Wall tiles bleed past the 64u box on both sides. Abutting copies overlap their ink and
  read as one continuous run. Never inset them to avoid the overlap.
- **Gates and towers drop over a wall position; they do not replace it.** Always place
  the wall tile first at the same coordinate, then the gate or tower over it. The gate
  carries its own matching curtain band so the courses run through unbroken.
- `tileAxis: "x"` means the run extends along the tile's local x; rotate the whole run
  with `snap-cardinal` bearings for the other three sides.
- Corners have their own tile (`sm-kit-corner`, arms west and south) — rotate 90° for
  the other three.
- Palisade tiles (tundra, tropical) are a post row, but their silhouette twin is a
  solid bar on purpose: per-post shadows read as a dotted line rather than a barrier.

When placing with `<use>`, give every element explicit `width="64" height="64"` and an
`x` offset. Without width/height a `<use>` defaults to 100% of the viewport and gets
auto-centred, which silently shifts every tile.

## Adjacency requirements

`requires.adjacency` must be satisfied by the placer, not the renderer:

- `sm-inn` (all biomes) and `sm-kit-gate` — `road`.
- `sm-boathouse--coastal` — `water`, with its open mouth pointed at it.

## Things that will look wrong if you get them wrong

1. Rotating the shadow offset with the symbol.
2. Giving vegetation or anything in `parcel` a shadow.
3. Rotating a `locked` or `invariant` sub-part.
4. Clipping a symbol to its footprint.
5. Placing a gate or tower without a wall tile beneath.
6. Mixing biome suffixes within one settlement.
7. Stretching a green to fit its junction instead of picking the right drawn aspect.
8. Rotating a field tile's contents instead of its `patternTransform`.
9. Letting a field tile draw its own border.
10. Drawing ink before all shadows in the same z-band.
