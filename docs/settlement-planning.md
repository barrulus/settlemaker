# Shared settlement planning

Development preview after npm 3.0.1. Build this checkout before using these APIs.

The physical planner combines village frontage plots and city blocks in a common
pipeline. Population specifies demand. The development preset controls building
spacing, architecture and residential capacity. Fields, vegetation, rendering,
resident accounting and GeoJSON export use one model in local metres.

Existing calls without `development` retain their legacy result types and
coordinates. Selecting `development` explicitly opts into the new `planned`
result and physical output contract. This avoids silently changing coordinates
for existing integrations.

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
| `seed` | Deterministic integer seed; otherwise derived from the name. |
| `theme`, `style`, `skin` | Shared appearance controls; they do not alter housing or geometry. |
| `render.width`, `render.bounds`, `render.detail` | Display width, viewport in metres and artwork detail; described below. |

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

The default city house accommodates eight residents, compared with four in a
detached village dwelling. Dense blocks use smaller individual footprints in
long attached rows, separated by narrow service streets. Population sets the
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

City squares are paved, and occasional parks retain their planted trees.
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

// Use a model returned by planSettlement or generateSettlement with development.
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

`renderSettlement` defaults to an overview for a display width of 1,200 pixels.
It draws building footprints and simple canopy shapes when their detailed artwork
would be too small to see, and omits objects outside the viewport. These are display
choices: the model, resident counts and exported GeoJSON remain complete.
Overview fields retain their regional crop colours when furrows are too small
to draw, so farmland remains distinguishable from grass.

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

Zoom by changing `bounds` and rendering again: native artwork returns as its
displayed size increases. Magnifying an already exported overview SVG cannot
restore omitted detail. `detail: 'full'` retains every visible glyph regardless
of display size; using it for an entire large city produces a much heavier SVG.
Legacy renderers retain their existing full-artwork behaviour.

Input coastline polygons and rivers also use metres for both presets. Measured
water uses the shared site reader and survey-coverage checks. A supplied coastline
is not shifted towards the settlement. Large settlements can require a larger
survey. The new planner does not change the legacy water or URL adapter contracts.

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
