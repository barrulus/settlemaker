# Scene and rendering

Both physical layouts use `SettlementModel.scene`, a shared Scene v2 in local
metres. Rendering and GeoJSON derive from this model:

```text
createSettlementModel → SettlementModel.scene → renderSettlement → SVG
                      SettlementModel       → exportSettlement → GeoJSON
```

The scene contains geometry and saved glyph placement; rendering supplies artwork
and appearance. Treat retained session scenes as read-only.

## Render an existing city model

The same API renders either development preset:

```js
import { generateSettlement, renderSettlement, PALETTES } from 'settlemaker';

const burg = {
  name: 'Thornwall', population: 5000, biome: 'temperate',
  port: false, citadel: true, walls: true, plaza: true,
  temple: true, shanty: false, capital: false,
  roadBearings: [20, 145, 270],
};
const result = generateSettlement(burg, { seed: 42 });
const scene = result.model.scene;
const svg = renderSettlement(result.model, { palette: PALETTES.night });
console.log(scene.version, svg.length);
```

Generate once without allocating SVG or GeoJSON:

```js
import { createSettlementModel, renderSettlement, exportSettlement } from 'settlemaker';

// burg is the complete object from the preceding example.
const model = createSettlementModel(burg, { seed: 42 });
const svg = renderSettlement(model);
const geojson = exportSettlement(model);
```

## Scene fields

| Field | Meaning |
| --- | --- |
| `version` | Literal 2. |
| `seed`, `population`, optional `name`, `biome` | Generating context. |
| `bounds` | Local output bounds. |
| `metersPerUnit` | 1 for physical models; geometry uses metres. |
| `buildingCapacity` | Optional ordinary-building budget accounting. |
| `layers` | The geometry and instance arrays described below. |

| Layer | Contents |
| --- | --- |
| `water` | `{rings, synthetic}`; even-odd output rings retain islands. |
| `fields` | Polygon `ring`, `angleDeg`, optional native `glyph` and `hatch`. Pattern pitch is independent of parcel size. |
| `furrows` | Deprecated array; current scenes leave it empty and use field direction instead. |
| `greens` | Polygon rings with optional planned paths and path width. City squares and most dense private yards carry `surface: 'paved'`; gardens and parks retain planting. |
| `ground` | Optional underlying dense-city polygon rings with `surface: 'paved'`. Render before explicit greens, water, roads and buildings. |
| `vegetation` | Position, glyph/legacy `kind`, scale and rotation. |
| `symbols` | Glyph `id`, position, scale, optional `scaleY`, `buildingId`, `buildingIds`, `materialVariant`, `artworkVariant`, rotation, and `zBand`. |
| `roads` | Paths with `kind: 'artery' | 'road' | 'alley'` and optional width. |
| `buildings` | Polygon, semantic ward `kind`, `landmark`, optional `id` and `glyphBacked`. |
| `piers` | Polygon rings. |
| `walls` | Polylines, towers, gates and `large`; optional curtain/rubble/palisade material. Gates retain route IDs. |
| `bridges` | Optional on v2 scenes; bank-to-bank path, width and ID. |

An instance's scale gives its art-box size in scene units; artwork coordinates
come from the selected glyph's view box and anchor. Preserve non-square boxes and
`scaleY`. Native field tiles may have a 32-unit box, structure slots commonly 64,
and downloadable authoring assets can use other dimensions. There is no universal
2×2 authoring rule for current glyphs.

`artworkVariant` selects a saved default housing appearance (0–7 on the current
temperate housing slots), including its shadow. Omitted or unsupported values
use the base glyph. Custom skin glyph overrides take precedence over variants.

## Appearance and artwork

`renderSettlement(model, options)` accepts shared assembly appearance options,
including `palette`, partial `theme`, `skin`, `skinBiome`, `assetSet`, `symbols`
and `clipId`, plus physical viewport `bounds`, display `width` and `detail`.

The default asset set is **`SETTLEMENT_SET`**, containing the current native biome
artwork. `REFINED_SET` and `SCHEMATIC_SET` remain explicit lower-level alternatives.
`assetSetFor` returns the current default. `paletteForBiome` supplies the same
natural ground/water palette used by villages. Explicit `palette` recolours
native artwork and procedural materials as well as the scene's drawing styles.
The shared high-level `theme` option selects a named palette for either engine;
see [appearance controls](appearance.md).

For an artist-facing integration, prefer `createSkin` and the [skin contract](skins.md).
It validates portable JSON, allowed SVG fragments and exact slot names without
requiring changes to the asset lookup code. An explicit city `assetSet` overrides
a skin's artwork. Skin colours/biomes and renderer overrides follow the precedence
in the skin guide.

`AssetSet` remains a lower-level API for trusted code. It has a name, legacy
semantic `symbols`, optional `patterns`, `glyphs`, placement `manifest` and
`refined` styling flag. Its legacy symbols use a unit box, while `glyphs` carry
explicit view boxes and anchors. Do not apply the legacy unit-box convention to
portable skin glyphs.

## SVG styling and geometry

Current SVGs combine group CSS, material custom properties and presentation
attributes inside native or procedural artwork. They are not wholly styled by
one CSS block, and changing a group fill does not recolour every roof or tree.
Use documented theme/token controls instead of rewriting arbitrary SVG attributes.

City groups include fields, greens, water, roads, buildings, landmarks, shadows,
placed symbols/marks, vegetation and walls. Some groups are omitted when empty;
procedural artwork can add nested groups, masks and patterns. These group names
are not the village renderer's DOM contract. For city building identity, emitted
`data-building-id` attributes connect applicable polygons/symbols to GeoJSON IDs.
Compound symbols also carry `buildingIds` (SVG `data-building-ids`): all real
wing identities, including the primary `buildingId`. Their wings remain separate
building features and population records. Rendering a compound hides every
linked footprint; disabling or omitting its artwork restores those footprints.
Viewport queries retain the entire linked group when its artwork enters view.
Use GeoJSON for semantic feature queries rather than inferring a feature solely
from its colour or DOM position.

`symbols: false` hides placed city symbols and overlay marks. It leaves vegetation
and actual building polygons available. It is not a universal switch to remove
all embedded artwork.

## Embedding SVG

The `data-bg="paper"` rectangle is used by the tile cropper. Preserve it when
post-processing. Village roots also declare `data-px-per-metre`; use it to retain
their physical scale through tiling.

Generated SVG IDs are scoped to a document. When displaying several maps, prefer
separate `<img>` documents (including SVG Blob URLs), `<object>` elements or
iframes. A unique city `clipId` only changes selected clipping/pattern IDs; it
does not namespace every glyph, CSS selector or village ID. It is insufficient
by itself to make multiple inline maps independent. A custom inline compositor
must consistently namespace IDs, references and applicable styles.

SVG output is self-contained for artwork. A browser host is responsible for
responsive sizing, pan/zoom, downloads and visible errors. Those behaviours are
not implemented by importing the generator alone.

## Evolution and saved scenes

Optional fields such as `layers.bridges`, field `glyph`, wall `material` and symbol
`materialVariant` / `artworkVariant`, and `layers.ground` extend Scene v2. Consumers should handle their absence in older
saved scenes. Breaking changes to existing field meaning or structure require a
scene version change.

A saved scene is not a complete reproduction package: retain the generator
version, skin definition and renderer options too. A `SettlementSkin` runtime
handle must be recreated from JSON in the module instance doing the rendering.

### City street surfaces

Generated urban scenes carry road widths from the planner's reserved corridors.
The assembler paints both the casing and inner surface inside that width. Local
streets between blocks share `kind: 'alley'` with service lanes and use the same
centreline geometry as GeoJSON streets. Their connections are made in the model
before city glyph placement, so repainting does not change building access.
Explicit `arteryWidth`/`roadWidth` rendering overrides still take precedence for
trunks and approaches when a custom presentation needs them.
