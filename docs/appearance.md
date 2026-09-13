# Shared appearance and engine selection

These are **unreleased additions after npm 3.0.1**. Build this source checkout to
try them. Published 3.0.1 screenshots remain a record of that release; regenerate
the local review below to see the new behaviour.

For the new metre-based model, density profiles and explicit resident allocations,
see [shared settlement planning](settlement-planning.md). The `engine` controls
below retain the legacy planner models and coordinate contracts.

## Choose the planner independently

The engine choice is generation data. Save it on the burg alongside population,
biome and road approaches:

```js
import { generateSettlement } from 'settlemaker';

const burg = {
  name: 'Ashford', population: 2000, engine: 'village', biome: 'temperate',
  port: false, citadel: false, walls: false, plaza: true,
  temple: true, shanty: false, capital: false,
  roadBearings: [20, 145, 270],
};
const village = generateSettlement(burg, { seed: 2, theme: 'blueprint' });
const city = generateSettlement(
  { ...burg, population: 800, engine: 'city' },
  { seed: 2, theme: 'blueprint' },
);
console.log(village.kind, city.kind); // 'village', 'settlement'
```

| Choice | Behaviour |
| --- | --- |
| Omitted or `auto` | Village through 1,000 people, city above it; existing integrations retain their selection. |
| `village` | Rural roads, individual dwellings, greens and agricultural surroundings; population still drives demand. |
| `city` | Urban wards, city building plots, fortifications and outskirts; population still drives demand. |

`options.engine` overrides a saved `burg.engine` for one call. Set the option to
`auto` to restore automatic selection. Direct `generateVillage` and
`generateFromBurg` calls always select their own planner. Explicit city selection
also enables urban plot allocation, city building artwork and capacity metadata
below 1,000 people. Small legacy direct city calls without that selection retain
their earlier compact layout.

Choosing a planner does not rescale external geometry. Village inputs use metres;
city polygons use mesh units. Measured `waterContext` follows the village planner,
even above 1,000 people, and is rejected for a city even below 1,000. Larger
villages can need a survey beyond the minimum 3,000 m; the existing coverage error
reports a required radius. Limits from available land, road access and bounded
planning still apply: explicit selection is not a guarantee of unlimited capacity.

URL adapters can send `engine=city&pop=800` or `engine=village&pop=2000`. Compressed
`i=` inputs store the same property in `burg.engine` and take precedence over
flat data fields. URL envelope version 1 and result discriminator `'settlement'`
are retained. Update the host's library before enabling its selector.

## Biome, theme and skin

These controls have distinct jobs in both planners:

| Control | What it changes |
| --- | --- |
| `burg.biome` | Regional architecture, vegetation, fields and planning rules, plus natural ground, water and shadows. |
| `options.theme` | A named colour treatment for both engines, including native artwork materials. |
| `options.style` | Specific shared colours such as `paper`, `roadCore`, `smInk` or `buildingFill`. |
| `options.skin` | Replacement SVG artwork, material tokens and custom names inheriting existing biomes. |

Without a named theme, `temperate`, `desert`, `tundra`, `tropical` and `coastal`
use shared natural colours in both engines. FMG names such as `hot desert`,
`taiga` and `tropical rainforest` resolve consistently. Unknown names fall back to
temperate. `steppe` retains its separate field planning and temperate appearance.

Themes are `default`, `classic`, `parchment`, `blueprint`, `bw`, `ink`, `night`,
`ancient`, `colour` and `simple`. Explicit `default` means parchment; it is not
the same as omitting the theme. `paletteForTheme(name)` validates the name and
returns the corresponding `Palette`; `PALETTES` remains available for pickers.

A theme changes colours while retaining regional shapes and the same generated
geometry. A desert city remains a desert city in blueprint colours. Biome or
engine changes can alter geometry. The planners keep their different densities,
features and scales; shared colours do not make their models interchangeable.

`BIOMES`, `normaliseBiome` and `biomeThemeFor` expose the shared regional defaults.
The original village-prefixed exports remain compatibility aliases.

## Precedence

1. The effective biome supplies natural colours and artwork.
2. A skin supplies replacements, shared material tokens and its renderer-specific
   `village`/`city` settings. Custom biome settings override the skin defaults.
3. An explicit named `theme` recolours material tokens and drawing surfaces.
   `svg.palette`, if provided, overrides that named palette.
4. Shared `svg.theme` colour overrides apply, followed by top-level `style`.
5. Legacy `village.theme` applies last on villages: its ground, water and shadow
   fields replace those colours, and supplied tokens override the resolved tokens.

A palette recolours tokenised custom artwork as well as stock artwork. Literal
colours in replacement SVGs remain literal: use `var(--token, #fallback)` when
creating theme-responsive skins. Theme resolution updates inline fallbacks too,
so rasterizers see the same colours without relying on CSS variable support.
Masks and clipping geometry are not recoloured. Natural city streets use a pale
paved surface with an earth-coloured edge, while village roads retain their earth
surface. Shared biome colours do not require identical street materials.

City road widths follow the corridors reserved around their blocks. Streets
between blocks and the service-lane connections appear in both SVG and GeoJSON;
colour themes do not enlarge those corridors. Explicit city drawing-width
overrides remain available for custom presentation.

`style` supports the common colour roles of `RenderTheme`, not arbitrary CSS.
Physical village road widths remain driven by road class, with the themed casing
painted inside that footprint. City-only drawing widths (`arteryWidth`,
`roadWidth`, `casingDelta`, `seamStroke`) do not redefine village roads.
`shoreWidth` follows local renderer units; village `shadowOffset` is in metres.

Existing integrations passing `svg.palette` and `svg.theme` now theme villages
as well as cities. Low-level village rendering accepts the same palette:

```js
import { generateVillage, renderVillage, PALETTES } from 'settlemaker';

const model = generateVillage({
  name: 'Snowmere', population: 300, biome: 'tundra',
  port: false, citadel: false, walls: false, plaza: true,
  temple: true, shanty: false, capital: false,
  roadBearings: [20, 145, 270],
}, 2);
const svg = renderVillage(model, 4, undefined, {
  palette: PALETTES.night,
  style: { paper: '#101820', smInk: '#ddddcc' },
});
console.log(svg.length);
```

## Review and test

From a source checkout:

```sh
npm run build
node scripts/review-appearance.mjs
```

Open `output/appearance-review/index.html` in a browser. The expanded review now
uses the [shared physical planner](settlement-planning.md): twelve maps across
three populations and two seeds, with every biome and theme, equal-scale views,
and a separate 200,000-person city with a 10,000-person walled core. Theme changes
reuse saved models. The old `review-appearance.mjs` command runs this review too.

Run the focused regression checks:

```sh
npm test -- tests/shared-appearance.test.ts tests/settlement-engine.test.ts --maxWorkers=2 --pool=threads
```

The tests cover regional/palette parity, unchanged themed geometry, skin and
legacy option precedence, larger villages, smaller cities, measured-water engine
validation and URL round trips. Before a release, run the full suite and
`npm run docs:check`, update the package version, and regenerate the release gallery.
