# Shared appearance and engine selection

SettleMaker 3.1 adds shared appearance controls and explicit village/city
selection. The examples below use the 3.1 API; the local review compares
planners and themes at the same scale.

For the shared metre-based model, density profiles and explicit resident allocations,
see [shared settlement planning](settlement-planning.md). The `engine` controls
below select physical development presets; both return the same model and units.

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
console.log(village.model.development.preset, city.model.development.preset); // 'village', 'city'
```

| Choice | Behaviour |
| --- | --- |
| Omitted or `auto` | Village through 1,000 people, city above it; both use the physical planner. |
| `village` | Rural roads, individual dwellings, greens and agricultural surroundings; population still drives demand. |
| `city` | Urban wards, city building plots, fortifications and outskirts; population still drives demand. |

`options.engine` overrides `burg.engine`; `auto` restores population-based selection.
An explicit `development.preset` takes precedence over either selector.
All output geometry uses metres, x east and y south. Measured `waterContext`
uses the shared site reader for both layouts. Population remains demand; available
land and bounded planning can leave residents unassigned.

Old `engine=city` and `engine=village` URLs select these physical presets.
The URL envelope remains version 1; results now always have `kind: 'planned'`.

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
engine changes can alter geometry. The layouts retain different densities and features within one physical model.

`BIOMES`, `normaliseBiome` and `biomeThemeFor` expose the shared regional defaults.
Use these shared exports for both development presets.

## Precedence

1. The effective biome supplies natural colours and artwork.
2. A skin supplies replacements and material tokens.
3. An explicit named `theme` recolours materials and drawing surfaces.
4. Top-level `style` applies specific colour overrides.

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
`shoreWidth` and `shadowOffset` use local metres for both layouts.

For an existing model, use `renderSettlement(model, { palette: PALETTES.night })`.
For interactive recolouring, use `session.renderView({appearance:{theme:'night'}})`.
See [the migration guide](migration-physical.md) for retired options.

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
physical rendering, larger villages, smaller cities, measured-water engine
validation and URL round trips. Before a release, run the full suite and
`npm run docs:check`, update the package version, and regenerate the release gallery.
