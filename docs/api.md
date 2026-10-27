# Library API

All public generation uses the shared physical planner. `generateSettlement`,
`planSettlement`, `createSettlementModel` and `createSettlementSession` accept the
same options. See [migration from the retired API](migration-physical.md).

## Engine selection

`development.preset` explicitly selects `village` or `city`. Otherwise
`options.engine` overrides `burg.engine`; `auto` chooses village through 1,000
people and city above it. This selects a layout technique, not a different output
contract. All results have `kind: 'planned'`, a `SettlementModel`, SVG and physical
GeoJSON in local metres.

## Retained rendering sessions

`createSettlementSession(burg, options?)` generates once and retains a physical
scene. SVG and GeoJSON are created only when requested.

```js
import { createSettlementSession, BUILD_INFO } from 'settlemaker';

const session = createSettlementSession(burg, { seed: 42 });
const preview = session.renderView({ width: 1200, detail: 'auto' });
const recoloured = session.renderView({ appearance: { theme: 'blueprint' } });
const fullSvg = session.renderFull();
const geojson = session.exportGeoJson();
console.log(session.metadata, BUILD_INFO);
```

`renderView` accepts metre-based `bounds: {min_x,min_y,max_x,max_y}`, display
`width`, and `detail: 'auto' | 'full'`. Appearance changes apply to that call;
`theme: null` restores natural biome colours. `overviewRoadMinPixels: 0` disables
the default 1.5-display-pixel road minimum. Full exports retain physical widths.
Both detail modes preserve the same artwork, materials and outlines at every
zoom; offscreen artwork is culled using its painted bounds.

`renderFull(appearance?)` exports all artwork at the original bounds. GeoJSON
always covers the complete model, independent of the camera. Treat `session.scene`
as read-only. Sessions support viewports for both layouts and report resident
accounts, diagnostics, timing, build identity and physical coordinate metadata.
`BUILD_INFO` lets a host verify that page and worker use the same artifact.

## Burg input

The name `AzgaarBurgInput` reflects the original integration; you do not need an
Azgaar map or database to use it.

| Field | Type | Contract |
| --- | --- | --- |
| `name` | `string` | Required; also used to derive the default seed. |
| `population` | `number` | Required; drives the building budget and automatic planner selection. |
| `engine` | `'auto'`, `'village'`, `'city'` | Optional saved planner choice; default `auto`. |
| `port` | `boolean` | Required; requests harbour/jetty infrastructure. Does not supply water. |
| `waterfront` | `{ riverId?, shoreKind?, shoreFeatureId? }` | Optional FMG cell relationship authorizing inferred placement beside a river, ocean or lake, independently of port status. Supply the associated geometry. |
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
| `urbanDensity` | `number` | Retired budget input; accepted with a diagnostic. Use development occupancy controls. |
| `coreCapacity` | `number` | Retired core limit; accepted with a diagnostic. Use development.corePopulation. |
| `coastlineGeometry` | `{x, y}[][]` | Optional filled water polygons; **local metres**, never lon/lat. |
| `rivers` | `{centreline, widthM, meander?}[]` | Optional river surveys in metres for both layouts. |
| `waterContext` | `WaterContextV1` | Optional measured/unknown-unit water mode for both layouts. |
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
polyline. Use burg-local x-east/y-south coordinates in metres.

A nonempty polygon array takes precedence over the legacy `oceanBearing` coast.
Without `waterContext`, an empty array does not declare a measured dry survey.
`rivers` add channel polygons from at least two centreline points and a
positive `widthM`. Generated meanders are on by default; `meander: false` preserves
the surveyed centreline. Do not send the same river in both input fields.

For physical distance/coverage guarantees, use [water context v1](water-context-v1.md).
An empty measured survey suppresses a generated coast; `unknown-units` reports missing
scale rather than inventing a survey. Both physical layouts use the shared site
reader and coverage validation.

## Generation options

| Option | Meaning |
| --- | --- |
| `seed` | Safe integer; omitted derives a seed from the settlement input. |
| `engine` | `auto`, `village` or `city`; shorthand for layout selection. |
| `development` | Explicit preset, core/rural population and occupancy controls; see [planning](settlement-planning.md). |
| `theme` | Named colour treatment; omitted uses natural biome colours. |
| `style` | Partial `RenderTheme` overrides. |
| `skin` | Validated handle from `createSkin`. |
| `render` | Display width, bounds and detail level for the convenience SVG result. |
| `onStageTiming` | Observer for generation and output timing. |

Legacy `svg`, `geojson` and `village` option objects are retired. Use
`renderSettlement` for lower-level rendering settings and `exportSettlement` for
physical GeoJSON. See [appearance](appearance.md) for themes and skins.

## Results and diagnostics

Results contain `{kind: 'planned', model, svg, geojson}`. The model carries
`development`, `residents`, `buildings`, `districts`, `scene`, `diagnostics`,
optional `degradedFlags` and optional `waterContextResult`. Resident accounts report
requested, capacity, assigned and unassigned totals; inspect them for shortfalls.
Fatal measured-water errors throw `WaterContextError` with `waterContextResult`.

## Reproducibility and versioning

Store the input, resolved seed, package/build version, options and skin definition.
Physical GeoJSON has no changing timestamp. Geometry and IDs are deterministic
within a generator version; IDs are not promised permanent across releases.
Check `metadata.schema === 'settlemaker/physical-plan'` and `schema_version === 1`.

## Lower-level entry points

- `createSettlementModel`, `renderSettlement`, `exportSettlement`: generate once,
  render and export as needed.
- `assembleSvg`, `createSceneIndex`: shared scene rendering and spatial queries.
- `createSkin`, `skinBiomeFor`, `SKIN_SLOTS`, `SKIN_TOKENS`: [skin authoring](skins.md).
- URL codec and `parseSettlementUrl`: [URL integration](url-api.md).
- SVG bounds and tile helpers: [tiling](geojson.md#tiling).
