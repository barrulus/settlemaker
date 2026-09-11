# Flora and farming library

Open [index.html](index.html) locally. It includes biome and category selectors,
seeded variations, a tundra snow switch, crop direction, three parcel outlines and
downloads of the displayed SVG. No server or network is required.

The village and city generators now use this library through the shared runtime
registry. Biome/habitat selection, plant size and real field polygons are wired
in; see [runtime integration](../../docs/artwork-integration.md). The original
`symbols/refined` remains available as reference artwork.

## Inventory

| Asset | Forms | Saved SVGs |
| --- | ---: | ---: |
| Flora | 14 per biome × 5 biomes | 210, three seeds per form |
| Tundra snow state | Same 14 forms | 42, the same three seeds |
| Seamless fields | 6 per biome × 5 biomes | 30 |
| Farm parcels | Each field in three outlines | 90 |
| Total | | 372 |

Flora varies its canopy contour, branch layout, leaf angles, clump arrangement
and details reproducibly. Species have different geometry seeds, even when their
underlying drawing family is shared. Snow is a separate state, so changing weather
does not move the plant or change its underlying form. Snow lies on crown surfaces
and low cushions. No corner crescents or vertical snow strips are used.

The eight SVG/PNG review sheets are the five biome sheets, `fields`, `tundra-snow`
and `scenes`. The scene sheet includes the existing village drawings for context;
the individual farm assets contain no buildings. Individual assets are in
`individual/`; all definitions are also available in `symbols.svg`.

## Rendering and placement

- `symbols.json` records the viewBox, anchor, measured ink bounds, habitat/site
  requirements, biome, seed and suggested world footprint for each asset.
  `nominalFootprint` is a **metre-scale art-direction suggestion**, not a measured
  botanical size or a calibrated runtime collision footprint. Other coordinates
  are SVG art units. Runtime collision uses separately measured ink bounds at the
  selected metre scale.
- Flora uses a 64 × 64 canvas and a [32, 32] anchor. Trees and taller shrubs occupy
  the canopy band; low plants occupy the parcel band. Review sheets show plants
  at equal sizes for inspection, not equal world sizes. A fern should not become
  the same map size as an oak when placed.
- Plants and fields have **no cast shadows or silhouette twins**. Internal darker
  crown lobes describe foliage, not an offset ground shadow. Low ground plants and
  field parcels also have `receivesShadow: false`, following the refined parcel
  contract. Canopy plants can receive structure shadows if the renderer supports it.
- Preserve the SVG viewBox and scale uniformly. Art is top-down and can rotate
  with local layout. Root and frond details are inside each flora viewport.
- Colour uses `--sm-landscape-{biome}-{role}`, shared `--sm-ink`, `--sm-snow` and
  `--sm-landscape-wood` custom properties with explicit fallback palettes.
- All IDs start with `sm-flora-`, `sm-field-` or `sm-farm-` and always carry a biome
  suffix. They do not collide with the earlier refined/building/infrastructure IDs.
  Farm SVGs contain local pattern/clip IDs. Rename IDs and their references when
  embedding multiple copies inline, or use the sprite with `<use>`. The gallery
  assigns unique IDs to every inline preview.

## Fields and parcels

`fieldTile(biome, kind, {seed})` in `scripts/art/farms.mjs` produces a seamless
32 × 32 full-bleed tile. Use it inside `<pattern patternUnits="userSpaceOnUse">`.
Set `patternTransform="rotate(...)"` on the pattern to change crop direction;
do not rotate and crop the individual tile, which would leave gaps. Keep texture
pitch independent of the destination parcel's bounding box. Tile pitch is in art
units; convert it deliberately to the desired field-row scale.

Tiles do not contain field perimeter fences, gates, headlands or water sources.
They are textures, and an irrigated tile alone is not a complete irrigation system.
The gallery shows a 4 × 4 repeat and downloads the unrotated source tile.

`farmParcel(biome, kind, {seed, form, angle, id})` composes a tile into a crooked,
riverside or terrace-shaped 160 × 128 parcel. It adds unplanted margins and lanes,
or bunds and channels where appropriate. `form` describes geometry: a riverside
outline does not automatically make its crop flood-tolerant, and a terrace outline
does not imply elevation. Supply a unique XML-safe `id` when embedding its body.

Cultivated parcels have an entrance at [80, 112], with a six-unit access width.
Headlands and internal paths are pale soil/turf, not inked building walls. Irrigated
parcels publish their actual `waterInlet` on the outline at y=32. Connect it to a
real water source. Desert resting basins show empty channels. Tropical paddies use earth bunds
and muted shallow beds; drained paddies expose soil, without desert-style
perimeter water channels.
The plot does not generate a village water network or guarantee a viable gradient.

Natural tundra grazing is an unfenced land-use patch, with no plough rows or
formal entrance. Its suggested footprint is extensive. The conditional fringe
garden has a much smaller suggested footprint; do not scale it like a grain field.

## Habitat choices

Biome sets are regional options for a fantasy map, not a claim that every plant
belongs everywhere in that biome. Keep `site`, `natural`, `conditional`, `fringe`,
`smallPlot` and `irrigation` metadata when extending selection policy. The default
runtime mix excludes conditional tundra gardens and treeline trees; wet-margin
plants require nearby water in village scatter. Species now form seeded local
stands in both engines, with dominant canopies and occasional understory. Crown
highlights are filled shapes without repeated dark outlines. Tropical paddy
selection requires an explicit river supply; an ocean alone is insufficient.

- Temperate: woodland canopies, orchard trees, hedgerow shrubs, damp woodland
  plants, meadow flowers and freshwater reeds; grain, fallow, gardens, orchards
  and hay. Wet-margin plants should follow water, not appear in every woodland.
- Desert: separate irrigated oasis palms/reeds from dry scrub and grasses.
  Cacti and succulents are explicitly regional options. Date and olive groves,
  fodder and vegetable basins are supplied with irrigation. FAO's
  [Siwa oasis description](https://www.fao.org/giahs/giahs-around-the-world/egypt-siwa-oasis-dates-system/en)
  informed the managed oasis mix of date palms, olives and alfalfa.
- Tundra: low willow/birch, heath, lichen, moss and sedges dominate. Trees and
  snags are explicitly **forest-fringe-only**. The
  [NPS plant-form guide](https://www.nps.gov/dena/learn/nature/plants-by-form.htm)
  distinguishes dwarf tundra shrubs from subarctic forests. Natural summer grazing
  is the default land-use art. A managed meadow and a small sheltered garden are
  optional subarctic-fringe illustrations, not a claim that open tundra supports
  ordinary arable farming. Winter fields are deliberately not invented.
- Tropical: broad canopies, palms, banana, bamboo and fern forms, with separate
  freshwater reed and intertidal mangrove options. Mangroves are restricted to warm
  tidal sites, following [NOAA's habitat description](https://oceanservice.noaa.gov/facts/mangroves.html).
  Wet paddies have bunds and irrigation; root gardens and orchards use dry surfaces.
- Coastal: temperate maritime trees, salt-tolerant low plants and dune tufts.
  Crop plots require sheltered, non-tidal, non-saline ground; the orchard is a
  sheltered apple form. Saltmarsh flora is not a licence to put cereal fields in
  salt water. Warm tropical coastal palms and mangroves live in the tropical set.

The renderers carry these requirements as metadata; they do not enforce a map's
geography. Automated habitat-aware selection remains an integration task.

## Regeneration and checks

From the `city-glyphs` worktree:

```sh
node scripts/build-landscape-symbols.mjs
node scripts/check-landscape-symbols.mjs
node scripts/render-symbol-previews.mjs
```

The builder reads the new village house SVGs for the scene sheet. Generate the
village library first if starting with an empty artwork directory. PNG previews
require working system fonts; SVG and HTML use ordinary sans-serif fallbacks.
The check renders padded glyphs to detect clipping, compares pattern fills against
unclipped wrapped motifs across seams, checks saved references and determinism,
and verifies that cultivated entrances stay open.
