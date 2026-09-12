# City scene and rendering contract

`Scene` version **2** is the semantic rendering representation of the **city**
planner. Villages use `VillageModel` and `renderVillage`; they do not pass through
`buildScene`. Use [GeoJSON](geojson.md) for exported feature data from both planners,
and [skins](skins.md) for portable artwork that works in both.

```text
City:     Model → buildScene → Scene v2 → assembleSvg → SVG
Village:  VillageModel → renderVillage → SVG
```

The scene stores geometry, semantic kinds, saved glyph selections and material
variant indices. It does not contain SVG fragment bodies or a complete theme.
`assembleSvg` supplies the artwork and appearance. The complete declarations live
in [src/scene/scene.ts](../src/scene/scene.ts).

## Render an existing city model

This complete example uses the high-level city generator to retain its coastal
shift and degradation behaviour, then renders the saved model in another palette:

```js
import { generateFromBurg, buildScene, assembleSvg, PALETTES } from 'settlemaker';

const burg = {
  name: 'Thornwall', population: 5000, biome: 'temperate',
  port: false, citadel: true, walls: true, plaza: true,
  temple: true, shanty: false, capital: false,
  roadBearings: [20, 145, 270],
};
const result = generateFromBurg(burg, { seed: 42 });
const scene = buildScene(result.model, { shift: result.originShift, padding: 20 });
const svg = assembleSvg(scene, { palette: PALETTES.night });
console.log(scene.version, svg.length);
```

`generateSvg(model, options)` is a convenience wrapper around those two stages.
When rerendering a model from `generateFromBurg`, pass its `originShift` if you
want the same output coordinate frame. When generating SVG and GeoJSON separately,
use the same shift and padding for both.

For direct control over city generation:

```js
import { mapToGenerationParams, Model, generateSvg, generateGeoJson } from 'settlemaker';

// burg is the complete object from the preceding example.
const params = mapToGenerationParams(burg, 42);
const model = new Model(params).generate();
const svg = generateSvg(model);
const geojson = generateGeoJson(model);
```

`GenerationParams` is a TypeScript interface. It cannot be called with `new`.
This direct path does not reproduce the two-pass coastal output translation
performed by `generateFromBurg`; use that high-level function when you want it.

## Scene fields

| Field | Meaning |
| --- | --- |
| `version` | Literal 2. |
| `seed`, `population`, optional `name`, `biome` | Generating context. |
| `bounds` | Local output bounds. |
| `metersPerUnit` | Optional city scale estimate for rendering, not a survey. |
| `buildingCapacity` | Optional ordinary-building budget accounting. |
| `layers` | The geometry and instance arrays described below. |

| Layer | Contents |
| --- | --- |
| `water` | `{rings, synthetic}`; even-odd output rings retain islands. |
| `fields` | Polygon `ring`, `angleDeg`, optional native `glyph` and `hatch`. Pattern pitch is independent of parcel size. |
| `furrows` | Deprecated array; current scenes leave it empty and use field direction instead. |
| `greens` | Polygon rings with optional planned paths and path width. |
| `vegetation` | Position, glyph/legacy `kind`, scale and rotation. |
| `symbols` | Glyph `id`, position, scale, optional `scaleY`, `buildingId`, `materialVariant`, rotation, and `zBand`. |
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

## Appearance and artwork

`assembleSvg(scene, options)` accepts `palette`, partial `theme`, `skin`,
`skinBiome`, `assetSet`, `symbols` and `clipId`. `generateSvg` also accepts scene
`padding` and `shift`.

The default asset set is **`SETTLEMENT_SET`**, containing the current native biome
artwork. `REFINED_SET` and `SCHEMATIC_SET` remain explicit lower-level alternatives.
`assetSetFor` returns the current default. `paletteForBiome` currently supplies
its palette fallback; the artwork and material selection provide much of the
visible biome variation. Do not assume each biome corresponds to a different
named city palette.

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
`materialVariant` extend Scene v2. Consumers should handle their absence in older
saved scenes. Breaking changes to existing field meaning or structure require a
scene version change.

A saved scene is not a complete reproduction package: retain the generator
version, skin definition and renderer options too. A `SettlementSkin` runtime
handle must be recreated from JSON in the module instance doing the rendering.
