# Shared settlement planning

The physical planner is the sole public generation pipeline.

The physical planner combines village frontage plots and city blocks in a common
pipeline. Population specifies demand. The development preset controls building
spacing, architecture and residential capacity. Fields, vegetation, rendering,
resident accounting and GeoJSON export use one model in local metres.

Calls without `development` choose a physical layout from the engine selector or
population. All calls return `kind: 'planned'` and local metres. See
[migration](migration-physical.md) for the retired model and coordinate contracts.

## Generate a village or city

```js
import { generateSettlement } from 'settlemaker';

const burg = {
  name: 'Ashford', population: 800, biome: 'temperate',
  roadBearings: [20, 145, 270], walls: true, plaza: true, temple: true,
  port: false, citadel: false, shanty: false, capital: false,
};
const village = generateSettlement(burg, {
  seed: 2, development: { preset: 'village' },
});
const city = generateSettlement(burg, {
  seed: 2, development: { preset: 'city' }, theme: 'blueprint',
});
console.log(city.kind); // 'planned'
console.log(city.model.residents.assigned); // 800
console.log(village.geojson.metadata.coordinate_units); // 'metres'
```

`planSettlement(burg, options)` is the explicit entry point for the same pipeline.
Both entry points return `{ kind, model, svg, geojson }`.

| Option | Meaning |
| --- | --- |
| `development.preset` | Required: `village` for dispersed frontage development, `city` for compact blocks and progressively more detached outskirts. |
| `development.corePopulation` | Residents to accommodate inside the main wall. Requires `burg.walls: true`; integer from zero to total population. |
| `development.centreOccupancy` | Capacity of an ordinary dense city building; default 8 (or `edgeOccupancy` if higher). |
| `development.edgeOccupancy` | Capacity of an ordinary detached dwelling; default 4. |
| `development.ruralPopulation` | Optional city-only rural resident target, deducted from the same total. Nonnegative integer, less than total population, and no greater than population minus the resolved core target. Default 0 plans no additional rural settlements. |
| `seed` | Deterministic integer seed; otherwise derived from the name. |
| `theme`, `style` | Shared appearance controls; they do not alter housing or geometry. |
| `skin` | Replacement artwork and biome inheritance. A different inherited biome can change generation; create a new model when changing skins. |
| `render.width`, `render.bounds`, `render.detail` | Display width, viewport in metres and artwork detail; described below. |
| `onStageTiming` | Optional callback receiving `{ stage, durationMs, attempt? }`. Timings are observations, never part of the deterministic model. |

The city preset defaults to 80% of residents inside the walls, capped at 10,000.
The village preset uses `edgeOccupancy` throughout; a capacity gradient requires
the city preset. This does not prevent city outskirts using detached village art.
A walled village without an explicit target encloses its dwellings. An unwalled
settlement has all its residents outside walls. Population never selects the
preset once `development` is supplied.

City development varies across districts. Central buildings have higher
capacity and closer spacing. Outer plots have more open ground and increasingly
use detached village artwork. New outer districts grow next to existing urban
districts, with roads influencing the outline. The walled core retains urban
spacing throughout. Large cities add neighbourhoods rather than stretching a
fixed number of precincts along distant roads.

The physical planner keeps ordinary house footprints in
a bounded physical range. Sparse outskirts use wider gaps, paired houses and
short street runs instead of shrinking each roof inside its old plot. Workshop
approaches, garden neighbourhoods and crofts use coherent local spacing rules.
Public commons and natural groves reserve suburban ground before residential
demand is allocated. The commons policy targets 4% of eligible suburban land
area, choosing each next common to serve previously uncovered district centres
and favouring nearby approaches. Access is a Euclidean proxy at three typical
district widths, not a measured walking route. Whole-district reservations may
undershoot; they never exceed 150% of the target. Very small suburbs may have no
eligible whole district within that budget. These constraints preserve room for
housing rather than silently treating the target as guaranteed provision.
Green features distinguish `purpose: 'public' | 'private'
| 'natural' | 'civic'`; civic squares retain their paved surface. Districts expose
`character`, `settlementRole`, `occupiedAreaM2` and `areaM2` for review. These
areas describe accepted geometry; they are not a claim that every remaining
gap is accessible or suitable for infill. Offline benchmark and review tooling
uses `reviewSettlementGround` to estimate the partition of district ground into explicit building
footprints, artwork-declared courts, road corridors, walls, public/private/natural
greens, civic space, water and unclassified residual. The bounded deterministic cell-centre sampler reports sample count and spacing
per district; narrow gaps can fall between samples, and residual component counts
are estimates at that resolution. Sample areas are weighted to each district’s
exact boundary area. Its masks use square-ended road segments and 3 m wall corridors. They report failed-placement
area as unknown: rejected candidate polygons are not retained, so unexplained
open ground cannot honestly be relabelled failed placement or intentional court.
Review timing is recorded separately from generation.

The default city house accommodates eight residents, compared with four in a
detached village dwelling. Dense blocks use smaller individual footprints in
long attached rows, separated by narrow service streets, with wider sites for
properly sized tenements. The core selects existing high-density artwork where
its measured ink and physical dimensions fit; ordinary street houses remain
part of the same neighbourhood. A larger illustration does not silently add
residents or merge building identities. Population sets the
amount of housing to plan; it does not merge neighbouring roofs or erase row
ends to make the number of buildings match a census. Spare capacity is reported
explicitly. Set `centreOccupancy` when your setting needs a different number of
residents per city house.
District geometry includes public precincts and parks as well as residential
blocks; only residential buildings contribute to the population account.

Road influence extends across the growing city: development reaches farther
along approaches, with shorter edges between them and seeded variation in the
outer outline. Growth remains connected without forcing a circular boundary.
Outside the core, density follows distance through neighbouring blocks to the
nearest outer edge. Every side, inlet and route end transitions towards detached
housing and gardens, including irregular blocks. A long extension on one side
does not keep the shorter sides dense.
Village approaches join their existing continuations and bend gently through
dry farmland; road junctions and water-routed approaches retain their anchors.

Waterfront structures scale with population even when `harbourSize` is explicitly
`large`: below 150 residents there are no piers, and from 150 through 999 there
is at most one short, narrow jetty. Physical jetties extend at most 6 m into the
water and are at most 1.2 m wide. Neither category has warehouses, a basin or
breakwaters. Beach landings have a semicircular sandy beach, up to 12 m across, with a footpath ending on it; village jetties
have a compact quay at most 24 m long. Towns of 1,000 or more retain commercial
harbour buildings. Ocean breakwater entrances scale with frontage, up to 24 m
for small harbours and 32 m for large harbours. Even on narrow sites, the opening
must exceed the navigable lane by at least 6 m, leaving clearance around both
beacon heads. Berths fit the remaining sheltered frontage.

River cities can reserve several bridges to a connected opposite-bank
neighbourhood, including cities without a port designation. The crossing target
is the larger of one per 8,000 residents or one per 400 m of the square root of
planned urban area, rounded up and capped at six. Candidate landings must be at
least 80 m apart. This is a target, not a guarantee: surveyed banks, dry connected
approaches, the population-dependent span limit and available outer housing
land can reduce the number built. Added approaches reserve ground before houses
are placed, and the same bridge geometry is used in the scene and GeoJSON.

City squares are paved, and parks contain small shade groves with clear paths
and central lawns. Trees are planted after the final housing geometry and scale
are known, without changing housing supply or consuming generation randomness.
Markets and temples occupy compact public sites within developed blocks,
with shops and temple ancillary buildings around them. These non-residential
buildings appear in the scene and GeoJSON but do not add residential capacity.
Public courts retain street access. Dense residential blocks use shallower
rear courts, and notches along walls are clipped from their buildings rather
than forcing the whole block into a sparse compound layout.
Ordinary cities do not automatically reserve a barracks precinct; a requested
citadel still supplies military architecture.
Wells use their catalogue dimensions in metres. Temples have a physical size
limit instead of growing to fill an entire ward. Corner houses are placed at
street corners, and courtyard inns require a sufficiently large plot; smaller
inns use street-house artwork while keeping their point-of-interest identity.

## A large city with a small historic core

```js
import { planSettlement } from 'settlemaker';

const capital = planSettlement({
  name: 'Capital', population: 200000, biome: 'temperate',
  roadBearings: [20, 145, 270], walls: true, plaza: true, temple: true,
  port: false, citadel: false, shanty: false, capital: false,
}, {
  seed: 2,
  development: { preset: 'city', corePopulation: 10000 },
});
console.log(capital.model.residents.insideWalls.assigned);
console.log(capital.model.residents.outsideWalls.assigned);
console.log(capital.model.residents.unassigned);
```

The resident account reports requested population, available capacity, assigned
residents and unassigned residents, both overall and on either side of the main
wall. Buildings carry `capacity`, `residents`, `districtId`, `insideWalls` and
`urbanity`. Capacity is a development assumption, not a survey of actual living
space or a claim about the number of floors drawn in a glyph.

Allocation never exceeds a building's capacity. A constrained layout reports a
shortfall rather than inflating occupancy or moving residents across a requested
wall allocation. Generation makes bounded attempts to provide more plots and
land before reporting the result. Always check `model.residents.unassigned`.

### Optional inhabited countryside

```js
const region = planSettlement({ ...burg, population: 20000, walls: true }, {
  seed: 2,
  development: { preset: 'city', corePopulation: 10000, ruralPopulation: 2000 },
});
console.log(region.model.residents.rural.assigned); // 2000 on a suitable site
console.log(region.model.residents.urban.assigned); // 18000 on a suitable site
```

An explicit rural target interprets population as the total demand for this
generated region. Existing farm residences contribute to that target first;
new farmsteads and small hamlets provide the remainder within the cultivated
region. The field envelope is planned first and shared with rural placement.
Existing approach sections inside that envelope supply short bent farm tracks;
most sites contain one to three homes, with a minority of compact six to twelve
home hamlets. Higher demand branches the connected track network into available
cultivated ground rather than lengthening rows beyond the farms.

Homes and full-width access corridors reserve ground before field subdivision.
Physical field validation checks contained claims as well as edge intersections,
so a small farmhouse cannot be swallowed by a large field between sample points.
When a coarse regional parcel meets rural homes or tracks, that parcel receives
bounded local subdivision before the same clearance checks run. Distant parcels
keep their geometry and crop choices; rural clusters retain smaller cultivated
plots between their access lanes instead of becoming broad empty lawns.
The cultivated edge has route-related lobes and uncultivated indentations, with
whole fringe parcels tapering into the surrounding natural ground. Water and
existing reservations still constrain every accepted site. Rural homes do not
enlarge the city's empty field exclusion belt; fields remain between clusters.

Urban/rural accounts are separate from inside/outside-wall accounts. The rural
target never borrows an explicit core allocation. Capacity shortages remain
reported when water or available frontage prevents placement. With the default
zero target, no new hamlets are generated and existing farm residences retain
their proportional occupancy; the rural subtotal reports those existing people.
Buildings carry `settlementRole` so they can be counted once across both views.

Stage timings include layout attempts, topology, roads, neighbourhoods, plots,
glyph fitting, scene extraction, rural placement, resident allocation and
landscape. `layout` includes its child stages and `plots` includes `glyphs`;
do not add inclusive durations together. The convenience output function also
reports `svg` and `geojson`. Enabling profiling does not change model data.

## One coordinate contract

`model.coordinateSystem` is `local_metres_y_down`: the burg origin is `(0, 0)`,
x increases east and y increases south. All footprints, street widths, district
boundaries, water and landscape positions are in metres. The block layout uses a
fixed three-metre mesh unit internally and converts at the layout boundary;
scale does not depend on population, viewport padding or surrounding farmland.

`model.scene` is the geometry consumed by both the renderer and the exporter.
`model.buildings` adds resident accounting to residential building footprints;
non-residential scene buildings export zero capacity and residents.

```js
import { renderSettlement, exportSettlement, PALETTES } from 'settlemaker';

// Use a model returned by planSettlement or generateSettlement.
const svg = renderSettlement(capital.model, { palette: PALETTES.night });
const geojson = exportSettlement(capital.model);
```

SVG declares `data-px-per-metre="1"` and the same local origin. Changing its
viewBox changes the view, not the geometry. The local GeoJSON contract is
identified by `metadata.schema: 'settlemaker/physical-plan'`,
`metadata.coordinate_system: 'local_metres_y_down'`,
`coordinate_units: 'metres'`, `scale.meters_per_unit: 1` and
`scale.source: 'physical_layout_v1'`. Its `schema_version: 1` is a separate
physical-plan contract; it is not legacy GeoJSON schema 4.

Feature layers include buildings, streets, fields, vegetation, greens, paths,
water, piers, walls, entrances, districts, symbols and bridges. Polygon rings
close explicitly; water retains polygon/hole grouping. Residential building IDs
match between the model, SVG artwork and GeoJSON. Local coordinates still need a
world-map transform before use as longitude and latitude.

## Responsive rendering and zoom

Use `createSettlementModel(burg, options)` when you only need the model. It skips
SVG assembly and GeoJSON export. Generate once, then reuse that model for changes
to framing or appearance. Generation and rendering are synchronous APIs; run them
in a Web Worker in an interactive browser application.

`renderSettlement` defaults to a display width of 1,200 pixels. All zoom levels
retain the same native artwork: roof shapes, plot borders and fills, tree species,
field materials, paving and harbour equipment. Glyph definitions are shared and
objects wholly outside the viewport are omitted; visible objects are never
replaced with different shapes or colours. The model, resident counts and exported
GeoJSON remain complete.

```js
// A 900-pixel-wide view of a 120-metre square around the centre.
const closeupSvg = renderSettlement(capital.model, {
  width: 900,
  bounds: { min_x: -60, min_y: -60, max_x: 60, max_y: 60 },
});
// Preserve all artwork in this view, for a detailed standalone export.
const detailedSvg = renderSettlement(capital.model, {
  bounds: { min_x: -60, min_y: -60, max_x: 60, max_y: 60 },
  detail: 'full',
});
```

Zoom by changing `bounds` and rendering again. Both `auto` and `full` preserve
artwork at every display size. Retained sessions can emphasize approach roads in
`auto` mode; set `overviewRoadMinPixels: 0` for exact physical road widths, or use
`detail: 'full'`. Full SVG exports can also be magnified without losing artwork.

Input coastline polygons and rivers also use metres for both presets. Measured
water uses the shared site reader and survey-coverage checks. A supplied coastline
is not shifted towards the settlement. Large settlements can require a larger
survey. Measured water supports both layouts; URL engine selectors choose physical presets.

## CLI

From the source checkout:

```sh
npm run build
node scripts/settlemaker.mjs --population 800 --out output/village
node scripts/settlemaker.mjs --population 800 --is-city --out output/city
node scripts/settlemaker.mjs --population 200000 --is-city --walls --core-population 10000 --out output/capital
```

The package command is `settlemaker` after installation of a release containing
this feature. It writes `settlement.svg`, `settlement.geojson` and
`residents.json` into the output directory. It exits with status 2 if residents
remain unassigned, and status 1 for invalid input. `--help` lists the basic usage.

## Visual review and performance

```sh
npm run review:settlements
```

Open `output/appearance-review/index.html`. It shows twelve maps: village and
city at 300, 800 and 2,000 residents, using seeds 2 and 7. Biome and theme controls
apply to every displayed map. Switch between settlement-centre and full-landscape
views at equal scale, or explicitly fit each landscape separately. Every panel
reports its view width, residential building count and resident allocation.
The page works when opened directly from disk. Previews load as you scroll and
assemble in a worker, so controls remain responsive. Click a map to zoom and pan;
the viewer redraws each viewport and can download its current SVG.

A separate temperate, natural-theme 200,000-person example includes its SVG,
GeoJSON, resident split and measured generation time. `metrics.json` records all
fixtures, distinguishing model generation, cached reads and generation with
exports. The large-city panel also opens the interactive viewer, loading its model
only when requested. The large preview frames the city and adjoining farms;
Fit in its viewer includes the whole agricultural landscape. Its standalone SVG
is a landscape overview with every building;
zoom in the viewer to recover detailed artwork. Decorative vegetation uses a
coarser sampling grid at large extents;
its individual tree dimensions, housing and coordinate scale are unchanged.
Farmland extent follows population demand beyond the legacy village horizon.
Large landscapes use larger agricultural parcels to keep subdivision and
rendering bounded; internal city streets do not become infinite field-cutting
roads. Both housing and agricultural parcels remain physical metre geometry.

Run `npm test -- tests/settlement-plan.test.ts --maxWorkers=2 --pool=threads` for
physical-scale, density, resident-accounting, determinism and large-city checks.
