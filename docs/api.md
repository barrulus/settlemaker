# Library API

Development preview: the [shared physical planner](settlement-planning.md) adds
`development` presets, resident accounting and one metre-based output model.
The legacy API and contracts documented below remain available.

The normal entry point is `generateSettlement(burg, options?)`. It returns
synchronously and selects the planner explicitly or, by default, by population. Import functions and types
from `settlemaker`; the published declarations are the complete reference.

> Shared appearance and explicit selection are unreleased additions after npm 3.0.1.

## Engine selection

| Entry point | Planner | Result |
| --- | --- | --- |
| `generateSettlement(burg, options)` | `burg.engine` or `options.engine`; automatic by default (village ≤1,000, city above) | Discriminated result: `kind: 'village'` or `'settlement'`. |
| `generateFromBurg(burg, options)` | City, regardless of population | City result without a `kind` discriminator. |
| `generateVillage(burg, seed)` | Village | `VillageModel`; call `renderVillage` and `generateVillageGeoJson` separately. |

Set `burg.engine` to `'auto'`, `'village'` or `'city'`. `options.engine` overrides
that saved choice for one call; `'auto'` restores population-based selection.
For example, `{ population: 2000, engine: 'village' }` selects the village planner,
and `{ population: 800, engine: 'city' }` selects the city planner. Population
still drives demand. Unknown selectors throw rather than silently choosing an engine.
The lower-level entry points always use their own planner. For compatibility,
small direct `generateFromBurg` calls retain the earlier compact layout unless
`burg.engine: 'city'` explicitly enables urban plots and native city building art.
`GenerationParams.cityLayout` exposes this choice for manually constructed models.
Keep `result.kind === 'settlement'` checks for cities; that existing discriminator
has not changed. Coordinate units follow the selected engine, not population.

Use positive populations. The high-level API is typed but is not a complete
validator of arbitrary input JSON. Validate external data in your application;
water context and skin definitions have their own explicit validation gates.

## Burg input

The name `AzgaarBurgInput` reflects the original integration; you do not need an
Azgaar map or database to use it.

| Field | Type | Contract |
| --- | --- | --- |
| `name` | `string` | Required; also used to derive the default seed. |
| `population` | `number` | Required; drives the building budget and automatic planner selection. |
| `engine` | `'auto'`, `'village'`, `'city'` | Optional saved planner choice; default `auto`. |
| `port` | `boolean` | Required; requests harbour/jetty infrastructure. Does not supply water. |
| `citadel` | `boolean` | Required; requests a city citadel. |
| `walls` | `boolean` | Required; requests fortifications. Village and city wall planners differ. |
| `plaza` | `boolean` | Required; city plaza request. Villages have their own green planner. |
| `temple` | `boolean` | Required; requests religious features, interpreted by each planner. |
| `shanty` | `boolean` | Required; city shanty request. |
| `capital` | `boolean` | Required; city capital/administrative request. |
| `biome` | `string` | Optional; terrain and artwork selection, or a named biome from the supplied skin. |
| `roadBearings` | `RoadBearingInput[]` | Optional; actual external approaches. See [roads](#roads). |
| `oceanBearing` | `number` | Optional compass bearing for a generated coast when explicit water does not take precedence. |
| `harbourSize` | `'large'` or `'small'` | Optional city harbour scale, used with `port: true`. |
| `urbanDensity` | `number` | Optional positive occupancy input; alters the population/building budget. |
| `coreCapacity` | `number` | Optional city core-population input; default 10,000. It is a planning input, not a certified housed population. |
| `coastlineGeometry` | `{x, y}[][]` | Optional filled water polygons; **village metres or city mesh units**, never lon/lat. |
| `rivers` | `{centreline, widthM, meander?}[]` | Optional village river surveys in metres. City generation does not use this field. |
| `waterContext` | `WaterContextV1` | Optional measured/unknown-unit water mode; supported for villages only. |
| `trade` | `boolean` | Optional city trade-centre/market request. |
| `culture`, `elevation`, `temperature` | `string`, `number`, `number` | Accepted optional source metadata. No general culture, elevation or climate simulation is exposed by these fields. |

Set all seven required flags explicitly, including `false` values. Flags are
requests, not a promise that every output contains the feature. Do not infer
village support for a city feature merely because the input interface is shared.
In particular, villages do not use city wards or the city citadel planner.

## Roads

Bearings run clockwise from north: 0 north, 90 east, 180 south, 270 west.
Each approach can be a number or a record:

```ts
import type { RoadBearingInput } from 'settlemaker';

const roads: RoadBearingInput[] = [
  { bearing_deg: 36, kind: 'royal', route_id: 'r17', through: true },
  { bearing_deg: 209, kind: 'royal', route_id: 'r17', through: true },
  { bearing_deg: 117, kind: 'town', route_id: 'r23', relief: 'valley' },
  { bearing_deg: 281, kind: 'footpath', route_id: 'p4', group: 'trails' },
];
```

Land classes are `royal`, `main`, `market`, `town`, `local`, `trail`, `footpath`.
Legacy `road`, `foot`, `sea`, and group aliases `roads`, `trails` are also
accepted. Bare bearings use the default main-road meaning in villages. Cities
map rich classes to their legacy road/foot/sea categories. Sea records do not
become village land streets.

`through` is a continuation/growth hint; it **never invents another approach**.
Supply both independently measured sides of a continuing road, with the same
`route_id`. `group`, `relief` (`flat`, `valley`, `descent`, `ascent`, `ridge`) and
`followsRiver` provide city growth hints. `followsRiver` does not generate water.

`roadBearings: []` explicitly says there are no external approaches. Omitting the
field also leaves villages without external approaches, but allows the city's
legacy random-gate fallback. Shared village streets may carry several route IDs;
input record count is not a promised street count. Road classes can change inside
a village while approach provenance remains available in GeoJSON.

## Water

`coastlineGeometry` describes filled water areas, including rivers and lakes,
using simple rings with at least three distinct points. Closure is implicit;
repeating the first point is also accepted. Input rings are combined as filled
water rather than interpreted as outer/hole pairs. Send banks, not a shoreline
polyline. Use burg-local x-east/y-south coordinates with the correct engine's units.

A nonempty polygon array takes precedence over the legacy `oceanBearing` coast.
Without `waterContext`, an empty array does not declare a measured dry survey.
Village `rivers` add channel polygons from at least two centreline points and a
positive `widthM`. Generated meanders are on by default; `meander: false` preserves
the surveyed centreline. Do not send the same river in both input fields.

For physical distance/coverage guarantees, use [water context v1](water-context-v1.md).
An empty measured survey suppresses a legacy coast; `unknown-units` reports missing
scale rather than inventing a survey. A city call with `waterContext` throws
`WaterContextError`, including a direct `generateFromBurg` call. City polygon units
must not be guessed from the village metre convention.

## Generation options

| Option | Used by | Meaning |
| --- | --- | --- |
| `seed` | Both | Explicit numeric seed; otherwise derived from the settlement name. |
| `engine` | Both | Overrides `burg.engine` for `generateSettlement`. |
| `theme` | Both | A `ThemeName` such as `night` or `blueprint`; omitted uses natural biome colours. |
| `style` | Both | Partial `RenderTheme` colour overrides after palette/skin and `svg.theme`. |
| `skin` | Both | A validated handle from `createSkin`; selects artwork/materials and custom biome inheritance. |
| `village.pxPerMetre` | Village | SVG display scale; default 4. Model and GeoJSON stay in metres. |
| `village.theme` | Village | A complete `VillageTheme`; use `villageThemeFor` to start from a preset. |
| `svg.palette` | Both | A custom `Palette` or `PALETTES` entry; takes precedence over named `theme`. |
| `svg.theme` | Both | Legacy location for shared colour overrides; city geometry style fields remain city-specific. |
| `svg.assetSet` | City | Explicit low-level artwork set; overrides skin artwork. |
| `svg.symbols` | City | Defaults true; false hides placed symbols/marks and exposes building polygons. Vegetation remains. |
| `svg.padding` | City | Bounds padding in local units; default 20. |
| `svg.clipId` | City | Frame clipping ID. Does not namespace all other SVG IDs. |
| `svg.skin`, `svg.skinBiome` | Both | Lower-level skin selection; prefer the top-level `skin` for shared generation. |
| `geojson.generatedAt` | City | Override the output timestamp. |
| `geojson.padding` | City | Bounds padding; match `svg.padding` if you change it. |
| `geojson.settlemakerVersion` | City | Metadata override for specialised consumers; normally leave it alone. |

Colour controls are shared. Geometry-specific options stay with their planner:
village road widths come from physical road classes, while city `arteryWidth`,
`roadWidth`, `casingDelta` and `seamStroke` are drawing controls. Shared `shoreWidth`
is interpreted in each renderer's local units; village `shadowOffset` is in metres.
`village.theme` is a legacy complete override for village ground, water, shadows
and any tokens it specifies; it is applied last. `svg.shift` is a low-level city
option; high-level generation supplies its calculated `originShift`.

Named themes are `default`, `classic`, `parchment`, `blueprint`, `bw`, `ink`,
`night`, `ancient`, `colour`, `simple`. `default` explicitly selects parchment;
omitting the theme selects natural regional colours. Named palettes recolour
native material tokens and procedural artwork in both planners. Fine-grained
`style` fields only affect their documented roles; they are not arbitrary CSS.

The shared biome API is `BIOMES`, `normaliseBiome` and `biomeThemeFor`.
The five natural appearances are `temperate`, `desert`, `tundra`, `tropical`,
`coastal`. The old `VILLAGE_BIOMES`, `normaliseVillageBiome` and `villageThemeFor`
exports remain aliases. FMG names such as `hot desert` and `taiga` are normalised
in both planners. `steppe` retains its planning meaning and uses temperate colours.

See [shared appearance](appearance.md) for precedence, examples and visual review.

## Results and diagnostics

`svg`, `geojson`, `model`, `degradedFlags` and `originShift` are present on both
high-level branches. Narrow `result.kind` before using planner-specific model fields.
`waterContextResult` is optional and belongs to the measured village-water path.

City `degradedFlags` reports dropped `walls`/`citadel` requests. Villages return
`[]`; that is not a guarantee that every supplied city-oriented flag was honoured.
City `metadata.building_capacity` reports the ordinary-building target, placement
and any shortfall. Village `metadata.diagnostics` reports its own planner diagnostics.
See [GeoJSON](geojson.md) before treating building counts as population accounting.

Fatal measured-water errors throw `WaterContextError`, whose
`waterContextResult` contains the issue code and any required survey radius.
Other generation errors should also be surfaced by your application rather than
replaced with a successful-looking empty map.

## Reproducibility and versioning

Keep the full input, resolved seed, package version, options and skin definition.
Seeded geometry and SVG output are deterministic within that configuration and
version. GeoJSON's `generated_at` timestamp is deliberately time-dependent.
Feature IDs are deterministic within a build, not permanent IDs across upgrades.
The city's generation hash and the village's literal `'village'` metadata value
are not substitutes for recording the package version and skin configuration.

## Lower-level entry points

- `mapToGenerationParams`, `Model`, `buildScene`, `assembleSvg`, `generateSvg`,
  `generateGeoJson`: [city scene and rendering](scene-schema.md).
- `generateVillage`, `renderVillage`, `generateVillageGeoJson`: village stages.
- `createSkin`, `skinBiomeFor`, `SKIN_SLOTS`, `SKIN_TOKENS`: [skin authoring](skins.md).
- `encodeBurgParam`, `decodeBurgParam`, `encodeJsonParam`, `decodeJsonParam`,
  `parseSettlementUrl`: [URL integration](url-api.md).
- `parseSvgViewBox`, `declaredMetersPerUnit`, `computeTileInfo`, `cropSvgToTile`,
  `enumerateTiles`, `totalTileCount`: [tiling](geojson.md#tiling).
