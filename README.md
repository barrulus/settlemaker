# SettleMaker

**Generate settlement maps. Bring your own world.**

SettleMaker is a procedural map engine for Node.js and browsers. Give it a
settlement's population, roads, terrain and seed; get an SVG map, local GeoJSON
and a model you can inspect. It draws small villages and large cities through
separate planners, with shared input and output entry points.

The bundled artwork depicts medieval settlements. Portable **skins** can replace
buildings, vegetation, field textures and material colours for your own setting,
without forking the engine. Copperline includes industrial, steampunk and modern
examples. The city generator builds on
[watabou's TownGeneratorOS](https://github.com/watabou/TownGeneratorOS).

<p align="center">
  <a href="https://raw.githubusercontent.com/barrulus/settlemaker/v3.0.1/docs/examples/gallery/temperate-village.svg"><img src="https://raw.githubusercontent.com/barrulus/settlemaker/v3.0.1/docs/examples/gallery/temperate-village.png" width="420" alt="Ashford: a generated temperate village with individual homes, roads and fields" /></a>
  <a href="https://raw.githubusercontent.com/barrulus/settlemaker/v3.0.1/docs/examples/gallery/temperate-city.svg"><img src="https://raw.githubusercontent.com/barrulus/settlemaker/v3.0.1/docs/examples/gallery/temperate-city.png" width="420" alt="Thornwall: a generated walled city using the current city artwork" /></a>
</p>

Ashford, population 300, and Thornwall, population 10,000. Both are real
`generateSettlement` outputs, seed 2. Click an image for the full SVG.
[Explore the gallery and exact inputs](https://github.com/barrulus/settlemaker/blob/v3.0.1/docs/gallery.md).

## Install and generate a map

```sh
npm install settlemaker
```

The package uses **ES modules** and includes TypeScript declarations. Save this
as `generate.mjs` and run `node generate.mjs`:

```js
import { writeFile } from 'node:fs/promises';
import { generateSettlement } from 'settlemaker';

const burg = {
  name: 'Ashford',
  population: 300,
  biome: 'temperate',
  port: false,
  citadel: false,
  walls: false,
  plaza: true,
  temple: true,
  shanty: false,
  capital: false,
  roadBearings: [
    { bearing_deg: 18, kind: 'main', route_id: 'north-road' },
    { bearing_deg: 142, kind: 'town', route_id: 'south-road' },
    { bearing_deg: 267, kind: 'local', route_id: 'west-road' },
  ],
};

const result = generateSettlement(burg, { seed: 2 });
await writeFile('ashford.svg', result.svg);
await writeFile('ashford.geojson', JSON.stringify(result.geojson, null, 2));
console.log(result.kind); // 'village'
```

For a city, change `population` to a value above 1,000. `walls`, `citadel`,
`plaza` and `temple` describe requested features; their treatment depends on the
planner and available geometry. Use `generateSettlement` as your normal entry
point. `generateFromBurg` explicitly invokes the city planner, even for a small
population.

CommonJS callers can use `await import('settlemaker')` inside an async function.
In a browser app, import from `settlemaker` through your bundler, or serve the
standalone ESM file `node_modules/settlemaker/dist/settlemaker.browser.js` yourself.
The engine needs no rendering service or runtime artwork downloads.

[Node, browser and TypeScript setup](https://github.com/barrulus/settlemaker/blob/v3.0.1/docs/getting-started.md)

## What the engine produces

| Output | What you can use it for |
| --- | --- |
| `svg` | A complete vector map with embedded artwork; display, save or rasterize it. |
| `geojson` | Buildings, streets, water and engine-specific features in **local coordinates**, with version and scale metadata. These are not longitude/latitude coordinates. |
| `model` | The generated `VillageModel` or city `Model`, selected by `result.kind`. |
| `degradedFlags` | City requests such as walls or citadel that generation had to drop. The village branch returns an empty array. |
| `originShift` | The city's optional coastal output translation; zero for villages. |
| `waterContextResult` | Diagnostics when using the supported measured village-water contract. |

At population **1–1,000**, the village planner builds roads, lots, dwellings,
greens and landscape in metres. Above **1,000**, the city planner builds wards,
streets, lots, fortifications and outskirts in its own local units. Both return
SVG and GeoJSON, but their feature sets, IDs and model types differ.

Layouts and SVGs are repeatable for the same inputs, seed, rendering options and
package version. GeoJSON includes a changing `generated_at` timestamp. Save the
input, seed, package version and any skin alongside output you want to reproduce.

[API and input reference](https://github.com/barrulus/settlemaker/blob/v3.0.1/docs/api.md)
· [GeoJSON, scale and identity](https://github.com/barrulus/settlemaker/blob/v3.0.1/docs/geojson.md)

## Biomes, roads and water

The default artwork covers **temperate, desert, tundra, tropical and coastal**
settlements. These select different buildings, vegetation and landscape rules;
changing a biome can change the generated layout. A coastal artwork choice alone
does not supply a shoreline: provide water geometry or `oceanBearing`.

<p align="center">
  <img src="https://raw.githubusercontent.com/barrulus/settlemaker/v3.0.1/docs/examples/gallery/desert-village.png" width="280" alt="Qasra: desert village with native buildings and field textures" />
  <img src="https://raw.githubusercontent.com/barrulus/settlemaker/v3.0.1/docs/examples/gallery/tundra-village.png" width="280" alt="Snowmere: tundra village with snowy roofs and natural ground" />
  <img src="https://raw.githubusercontent.com/barrulus/settlemaker/v3.0.1/docs/examples/gallery/tropical-village.png" width="280" alt="Reedbank: tropical village beside a supplied river" />
</p>

Supply every real road approach independently, using clockwise bearings from
north. `through: true` describes a continuing route; it does not create an
opposite exit. Use route IDs to retain provenance through shared streets and city
gates.

Water can come from filled polygons, village river centrelines, or a generated
coast from `oceanBearing`. The measured `waterContext` contract is supported only
by the village planner. Cities reject that mode; their legacy polygon input uses
city-local units. `port` requests infrastructure, rather than controlling whether
water is visible.

[Road and water inputs](https://github.com/barrulus/settlemaker/blob/v3.0.1/docs/api.md#roads)
· [Measured-water contract](https://github.com/barrulus/settlemaker/blob/v3.0.1/docs/water-context-v1.md)

## Make it your own

A skin is a JSON document loaded with `createSkin`. It can replace exact SVG
slots, set material tokens and define named biomes that inherit existing terrain
behaviour. Partial skins inherit any artwork they omit.

Using `burg` from the first example:

```js
import { createSkin } from 'settlemaker';

const skin = createSkin({
  version: 1,
  id: 'moon-glass',
  name: 'Moon Glass',
  tokens: { '--sm-stone': '#badcea' },
  biomes: {
    lunar: {
      base: 'tundra',
      village: { ground: '#68748c' },
      city: { paper: '#68748c' },
    },
  },
});

const moonVillage = generateSettlement(
  { ...burg, biome: 'lunar' },
  { seed: 2, skin },
);
await writeFile('moon-village.svg', moonVillage.svg);
```

For artwork replacement, `SKIN_SLOTS` supplies the supported IDs, view boxes,
anchors and placement constraints. Skin format 1 exposes **693 runtime slots**.
The downloadable default artwork contains **852 drawings**; catalogue drawings
and runtime slots serve different purposes.

<p align="center">
  <a href="https://raw.githubusercontent.com/barrulus/settlemaker/v3.0.1/docs/examples/gallery/copperline-village.svg"><img src="https://raw.githubusercontent.com/barrulus/settlemaker/v3.0.1/docs/examples/gallery/copperline-village.png" width="420" alt="Copperline industrial artwork applied to the village engine" /></a>
  <a href="https://raw.githubusercontent.com/barrulus/settlemaker/v3.0.1/docs/examples/gallery/copperline-city.svg"><img src="https://raw.githubusercontent.com/barrulus/settlemaker/v3.0.1/docs/examples/gallery/copperline-city.png" width="420" alt="Copperline steampunk artwork applied to the city engine" /></a>
</p>

Copperline covers all runtime slots and supplies `industrial`, `steampunk` and
`modern` presets. Skins change presentation and select an existing biome base;
they do not add new planning algorithms, occupancy rules or GeoJSON categories.
Some roads, walls and bridges are generated geometry rather than replaceable SVG
slots. Read the authoring guide for the supported controls and limits.

[Create a skin](https://github.com/barrulus/settlemaker/blob/v3.0.1/docs/skins.md)
· [JSON schema](https://github.com/barrulus/settlemaker/blob/v3.0.1/docs/skins.schema.json)
· [Copperline](https://github.com/barrulus/settlemaker/blob/v3.0.1/symbols/copperline/README.md)
· [Artwork catalogue](https://github.com/barrulus/settlemaker/blob/v3.0.1/docs/current-symbol-library.md)

## Choose your integration

| Task | Guide |
| --- | --- |
| Generate and save maps in Node or a browser app | [Getting started](https://github.com/barrulus/settlemaker/blob/v3.0.1/docs/getting-started.md) |
| Understand every input and rendering option | [Library API](https://github.com/barrulus/settlemaker/blob/v3.0.1/docs/api.md) |
| Join features, place output on a map or crop tiles | [GeoJSON and coordinates](https://github.com/barrulus/settlemaker/blob/v3.0.1/docs/geojson.md) |
| Embed the separately hosted renderer in an iframe | [URL adapter contract](https://github.com/barrulus/settlemaker/blob/v3.0.1/docs/url-api.md) |
| Render an existing city scene | [Scene and rendering contract](https://github.com/barrulus/settlemaker/blob/v3.0.1/docs/scene-schema.md) |
| Draw a complete alternative setting | [Skin authoring](https://github.com/barrulus/settlemaker/blob/v3.0.1/docs/skins.md) |
| Build, test or regenerate documentation | [Development](https://github.com/barrulus/settlemaker/blob/v3.0.1/docs/development.md) |

The npm library runs in your application. The website at
[settlemaker.com](https://settlemaker.com) is a separate application with its own
deployment cycle. Publishing an npm release does not update that site. The URL
codec does not transport skins or fetch arbitrary skin files.

## License and attribution

The engine is **GPL-3.0-only**. See
[LICENSE](https://github.com/barrulus/settlemaker/blob/v3.0.1/LICENSE) and
[NOTICE](https://github.com/barrulus/settlemaker/blob/v3.0.1/NOTICE) for the terms,
upstream attribution and dependency notices.

The six default artwork collections are distributed under **CC BY 4.0 with a
rendered-output exception**, described in
[symbols/LICENSE](https://github.com/barrulus/settlemaker/blob/v3.0.1/symbols/LICENSE).
Their [credits](https://github.com/barrulus/settlemaker/blob/v3.0.1/symbols/CREDITS)
ship with the package. **Copperline is GPL-3.0-only** and is outside that artwork
exception. Keep each collection's terms with redistributed artwork.
