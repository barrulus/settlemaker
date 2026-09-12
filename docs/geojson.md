# GeoJSON, coordinates and identity

Both planners return a `FeatureCollection` with a top-level `metadata` foreign
member. The current `metadata.schema_version` is **4**. Filter features by
`properties.layer`, then inspect the geometry type and the fields for that engine.
Do not assume that sharing a schema number makes the two planners interchangeable
at the individual property level.

The return type is the standard GeoJSON `FeatureCollection` type. It does not
expose every engine-specific foreign member statically. Applications reading
metadata from external files should validate it before use; the tables below
describe the generated data.

## Coordinate frames

| Property | Village | City |
| --- | --- | --- |
| `metadata.coordinate_system` | `burg_local_y_down` | `local_origin_y_down` |
| `metadata.coordinate_units` | `metres` | `settlement_units` |
| Origin | Original burg position | Local output frame; may include the coastal translation |
| Axes | x east, y south | x right/east, y down/south |
| `scale.meters_per_unit` | 1 | Population-based estimate |
| `scale.source` | `village_metres` | `population_heuristic_v1` |
| `local_origin_shift` | `{dx: 0, dy: 0, source: 'none'}` | Actual translation and reason |

These are **local planar coordinates**, not WGS84 longitude and latitude. A GIS
or map library expecting geographic GeoJSON needs an explicit placement transform.
Do not feed them directly into a geographic map and expect correct placement.
The city scale is an estimate, not a physical survey. This is why measured
`waterContext` is currently restricted to the village planner.

`metadata.local_bounds` has `min_x`, `min_y`, `max_x`, `max_y`. For villages this is
the drawn tile frame in metres. Village SVG coordinates are translated and scaled
for display; the root's `data-px-per-metre` records that scale. In particular,
changing `village.pxPerMetre` does not change GeoJSON coordinates.

## Shared metadata

| Key | Meaning |
| --- | --- |
| `schema_version` | Output structure version, currently 4. |
| `settlemaker_version` | Package/generator version. Record it with saved maps. |
| `settlement_generation_version` | City input hash or the village marker `'village'`; not a complete cache key. |
| `generated_at` | Generation timestamp; differs between otherwise identical runs. |
| `local_bounds` | Local output extent. |
| `scale` | `meters_per_unit`, `diameter_meters`, `diameter_local`, `source`. Diameter describes settlement scale, not necessarily the full surrounding frame. |
| `stable_ids` | Engine-specific ID hints; treat actual IDs as opaque strings. |
| `poi_density` | `'hamlet'` or `'town'` POI regime. This is not the village/city planner discriminator. |
| `degraded_flags` | Dropped city walls/citadel requests; empty for villages. |
| `local_origin_shift` | Output translation. Do not apply it again to already generated output. |

City outputs above population 1,000 also carry `building_capacity`:
`basis: 'ordinary-building-budget'`, `target`, `placed`, `shortfall`, `corePlaced`,
`outerPlaced`, and `status: 'met' | 'shortfall'`. `corePlaced + outerPlaced = placed`;
`shortfall = max(0, target - placed)`. These are ordinary-building counts, not a
certified housed population. The same object is available through
`Model.getBuildingCapacity()` and `Scene.buildingCapacity`.

Village metadata adds `contract_radius_m`, `green_relation`, optional `outline_m`
and `diagnostics`. The contract circle locates supplied approaches, while
`local_bounds` describes the drawn frame; they are different extents. Measured
water diagnostics are returned as `result.waterContextResult` and on the village
site. Do not assume there is an equivalent top-level GeoJSON field.

## City features

| `layer` | Geometry | Selected properties |
| --- | --- | --- |
| `ward` | Polygon | `wardType` |
| `building` | Polygon | `building_id`, `wardType` |
| `street` | LineString | `street_id`, `streetType` (`artery`, `road`, `alley`, `park`), optional `width` |
| `green` | Polygon | `kind: 'garden'`, `wardType` |
| `water` | Polygon / MultiPolygon | Water geometry; inspect the emitted geometry type. |
| `wall` | LineString | `wallType` |
| `tower` | Point | `wallType` |
| `entrance` | Point | `entrance_id`, gate type, bearings and matched route information |
| `pier` | Polygon | `wardType` |
| `poi` | Point | `poi_id`, `kind`, `ward_type`, `building_id` |

City POIs may be attached to an ordinary building, or float at a placed well,
market, mill or pier. Those floating kinds use `building_id: null`; other adopted
POIs have a building ID. Ward labels describe attribution, not a guarantee that
the feature lies inside the corresponding ward polygon. The engine does not
supply narrative names for streets or POIs.

City bridge rendering information is available in `Scene.layers.bridges`;
there is no matching promise that city GeoJSON contains village-style `crossing`
features. Likewise, city park/field/vegetation rendering is richer than the
selected GeoJSON layers above; use the scene when reproducing city presentation.

## Village features

| `layer` | Geometry | Selected properties |
| --- | --- | --- |
| `building` | Polygon | `building_id`, `lot_id`, `glyph`, `occupancy`, `bearing_deg` |
| `street` | LineString | `street_id`, `streetType`, widths, setback, optional route provenance and role |
| `green` | Point | `shape`, `variant`, `diameter_m`, `bearing_deg`, `relation`, optional `outline_m` |
| `field` | Polygon | `field_id`, `glyph`, `furrow_bearing_deg` |
| `water` | Polygon | `water_id`; interior rings preserve land islands when present |
| `crossing` | Point | `crossing_id`, `street_id`, `span_m`, `bearing_deg`, `narrow`, optional deck and centreline |
| `wall` | LineString | `wall_id`, `wallType: 'village_wall'`, `material` |
| `gate` | Point | `gate_id`, `route_ids` |
| `junction` | Point | `junction_id`, `street_ids` |
| `poi` | Point | `poi_id`, `kind`, `glyph`, `bearing_deg` |

Village POIs do not carry the city POI `building_id`/`ward_type` contract. A village
green is a Point plus shape data, whereas a city garden is a Polygon. Village
wall openings are `gate` features, not city `entrance` features. Consumers must
branch where these differences matter.

### Village road cross-sections

| Property | Meaning in metres |
| --- | --- |
| `width_m` | Reserved road corridor. |
| `surface_width_m` | Painted travelled surface. |
| `setback_m` | Additional distance from corridor edge to parcel frontage. |
| `surface_clip_m` | Optional polygon limiting paint at a width transition. |

The frontage offset from the centreline is `width_m / 2 + setback_m`. A surface
width is not a parcel reservation. `route_role` can be `approach`, `street` or
`through`; `streetType` describes the drawn segment's class, which may differ
from the incoming route class. `route_ids` carries provenance on shared or
continuing streets. Optional `parent_street_id` records the model's parent lane.

Street LineStrings stay continuous for connectivity. To reproduce the map's
surfaces, clip road paint out of water and apply any `surface_clip_m`. Render
short bridge decks separately using crossing `deck_m` and `centreline_m` where
present and `narrow` is true. A continuous line through water alone is not a
bridge surface. Decks include dry abutments; do not use the Point feature as the
entire deck geometry.

## IDs and persistence

Every street feature has its own `street_id`. A supplied route ID can appear on
multiple approach/continuation features; it identifies external provenance, not
a unique generated street. Village junctions name the participating street IDs.
City gate features echo matched input routes in `matched_route_id` and, where
present, `matched_route_ids`.

Do not parse prefixes to discover geometry or engine type. City IDs are allocated
with prefixes such as `b`, `s`, `p`, `g`; village IDs use their own content-derived
forms. IDs repeat for identical inputs within a generator version, but are not
promised stable across releases. Persist user annotations with the generating
configuration and have a migration strategy if you regenerate after an upgrade.

Skins retain semantic IDs and categories. A Copperline power-station drawing can
occupy a religious-building slot; it does not turn the GeoJSON kind into a new
industrial feature taxonomy. Store the requested skin and biome separately.

## Tiling

The package crops an SVG into a local square tile pyramid. It does not assign
geographic web-map coordinates or rasterize PNG tiles for you. Starting with a
`result` and its original `burg`:

```js
import {
  parseSvgViewBox, declaredMetersPerUnit, computeTileInfo, cropSvgToTile,
} from 'settlemaker';

const viewBox = parseSvgViewBox(result.svg);
if (!viewBox) throw new Error('SVG has no usable viewBox');
const tileInfo = computeTileInfo(
  viewBox,
  burg.population,
  declaredMetersPerUnit(result.svg),
);
const rootTileSvg = cropSvgToTile(result.svg, tileInfo, 0, 0, 0);
```

`declaredMetersPerUnit` reads village SVG scale so the tile helper does not
substitute its population heuristic. City SVGs use the helper's scale estimate
when no explicit override is supplied. Preserve `data-bg="paper"` if you
post-process a generated SVG: the cropper uses that rectangle to extend the
background to the tile bounds.

Use `enumerateTiles(tileInfo.maxZoom)` or `totalTileCount` to plan the pyramid,
and a rasterizer such as your application's SVG image pipeline if you need PNGs.
Keep your host-map placement transform separate from this local z/x/y scheme.

## Version handling

Check `metadata.schema_version === 4` for this contract, and tolerate optional
fields and unfamiliar layers that your application does not use. A future
breaking structure change needs a new schema version. Additive artwork or road
fields need not change that number. The old [schema-v3 note](schema-v3.md) is a
historical migration record, not the schema check for current output.
