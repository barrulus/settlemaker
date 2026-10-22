# GeoJSON, coordinates and identity

All public generation exports a `FeatureCollection` with top-level `metadata`.
Check **`metadata.schema === 'settlemaker/physical-plan'`** and
**`metadata.schema_version === 1`**. This contract is shared by village and city
layouts. The retired schema-4 contract is described in historical releases;
see [migration](migration-physical.md) before upgrading saved data.

## Coordinate frames

Coordinates and widths are local metres: x east, y south, with
`coordinate_system: 'local_metres_y_down'`, `coordinate_units: 'metres'` and
`scale: {meters_per_unit: 1, source: 'physical_layout_v1'}`. They are not WGS84
longitude/latitude. Geographic GIS/map integration needs an explicit placement
transform. SVG uses the same metre-based frame; display size and viewport changes
do not change exported geometry.

## Shared metadata

Metadata carries `schema`, `schema_version`, `coordinate_system`,
`coordinate_units`, `local_bounds`, `scale`, `residents`, `development` and `seed`.
Bounds are `{min_x,min_y,max_x,max_y}`. Resident accounting reports requested,
capacity, assigned and unassigned totals, with inside/outside wall and available
urban/rural splits. Development records preset, core population, occupancy and
rural population settings. Save package/build identity alongside the export.
There is no generation timestamp in this contract.

## Features

Filter `features` by `properties.layer`. Only features present in the generated
settlement are emitted. Optional properties depend on the feature and layout.

| Layer | Geometry | Properties |
| --- | --- | --- |
| `building` | Polygon | `building_id`, `kind`, `capacity`, `residents`, `district_id`, `inside_walls`, `urbanity`, optional `settlement_role` |
| `district` | Polygon | `district_id`, `urbanity`, `inside_walls`, optional `settlement_role`, `character`, `occupied_area_m2`, `area_m2` |
| `street` | LineString | `street_id`, `streetType`, optional `role`, `width`, `route_ids` |
| `path` | LineString | `width` |
| `bridge` | LineString | `width` |
| `field` | Polygon | `glyph`, `bearing_deg` |
| `ground` | Polygon | `surface: 'paved'`; underlying dense urban ground |
| `green` | Polygon | Optional `purpose`, `surface` |
| `water` | MultiPolygon | Interior rings preserve land islands |
| `wall` | LineString | `material` |
| `entrance` | LineString | `route_ids` |
| `pier` | Polygon | Layer only |
| `vegetation` | Point | `glyph`, `width_m`, `bearing_deg` |
| `symbol` | Point | `glyph`, `building_id`, optional `building_ids`, `width_m`, `height_m`, `bearing_deg` |

Building footprints include non-residential features with zero capacity. Symbol
points describe placed artwork and can reference one or several building IDs;
they are not additional residents. A `bridge` line plus width describes its deck.
An entrance is a line across a gate opening, not the old city point/bearing record.
There is no separate `poi` layer in the physical contract.

`ground` polygons are base surfaces beneath buildings, roads and explicit gardens;
their areas overlap those features. Private open spaces in `green` can carry
`surface: 'paved'` for a yard rather than planted ground.

## Extraction

`generateSettlement` and `planSettlement` return `result.geojson`. Serialize it
with `JSON.stringify(result.geojson, null, 2)` to save a `.geojson` file.
`exportSettlement(model)` exports an existing model, and
`session.exportGeoJson()` exports a retained session. Neither needs to generate
another settlement. Exports contain the full model, independent of preview zoom.

The CLI writes `settlement.geojson`, `settlement.svg` and `residents.json`:

```sh
npm run generate -- --population 10000 --is-city --seed 2 --out output/my-city
```

## IDs and persistence

Treat IDs as opaque strings. Streets have generated identities; `route_ids` are
external provenance and can occur on more than one generated feature. IDs are
repeatable for identical inputs within a generator version, but can change across
releases. Save input, seed, options, skin and build identity alongside annotations.
Skins retain semantic identity when only artwork changes.

## Tiling

The tile helpers crop an SVG into a local square pyramid. They do not assign
geographic web-map coordinates or rasterize PNGs. Starting with a `result` and
its physical view box:

```js
import { parseSvgViewBox, computeTileInfo, cropSvgToTile } from 'settlemaker';

const viewBox = parseSvgViewBox(result.svg);
if (!viewBox) throw new Error('SVG has no usable viewBox');
const tileInfo = computeTileInfo(viewBox);
const rootTileSvg = cropSvgToTile(result.svg, tileInfo, 0, 0, 0);
```

`computeTileInfo` defaults to one metre per unit and derives zoom from the actual
extent. Its second argument is retained for call compatibility and does not affect
scale; a third argument can declare another SVG's metres per unit.

Use `enumerateTiles` or `totalTileCount` to plan the pyramid. Preserve
`data-bg="paper"` if post-processing SVG; cropping uses it to extend backgrounds.
Keep geographic placement separate from local tile coordinates.

## Version handling

Gate on both the schema name and version. Tolerate additive properties and layers.
Old schema-4 files cannot be interpreted as physical output simply by changing
metadata. See [migration](migration-physical.md).
