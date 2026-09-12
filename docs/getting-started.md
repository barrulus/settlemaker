# Getting started

SettleMaker is an ES module library. The examples here use Node 24, the runtime
used to validate the 3.0.x npm release. A source checkout also includes an optional
Nix development shell; Nix is not required to install or use the npm package.

## Node.js

```sh
mkdir my-settlements
cd my-settlements
npm init -y
npm install settlemaker
```

Save the following as `generate.mjs`. The `.mjs` extension enables ESM without
changing your project's package settings; alternatively use `.js` and set
`"type": "module"` in your package.json.

```js
import { writeFile } from 'node:fs/promises';
import { generateSettlement } from 'settlemaker';

const burg = {
  name: 'Thornwall', population: 5000, biome: 'temperate',
  port: false, citadel: true, walls: true, plaza: true,
  temple: true, shanty: false, capital: false,
  roadBearings: [20, 145, 270],
};
const result = generateSettlement(burg, { seed: 42 });
await writeFile('thornwall.svg', result.svg);
await writeFile('thornwall.geojson', JSON.stringify(result.geojson, null, 2));
console.log(result.kind, result.degradedFlags);
```

```sh
node generate.mjs
```

Open the SVG in a browser or vector editor. Generation is synchronous; it can take
noticeable time for large inputs. In an interactive app, run expensive generation
in a worker so it does not block the UI. There is no asynchronous generator or
cancellation API in this release.

For CommonJS, load the ESM package from an async function:

```js
async function main() {
  const { generateSettlement } = await import('settlemaker');
  // Call generateSettlement with the complete burg object shown above.
  console.log(typeof generateSettlement);
}
main().catch(console.error);
```

## TypeScript

Declarations are included, and `@types/geojson` is installed transitively.
For Node ESM projects, use `module: "NodeNext"` and `moduleResolution: "NodeNext"`,
with a modern target and the `DOM` library if you explicitly configure `lib`:
URL helpers use Web Platform types. Install `@types/node` in your own project
when your code imports Node built-ins.

```ts
import { generateSettlement, type AzgaarBurgInput } from 'settlemaker';

const burg: AzgaarBurgInput = {
  name: 'Ashford', population: 300,
  port: false, citadel: false, walls: false, plaza: true,
  temple: true, shanty: false, capital: false,
};
const result = generateSettlement(burg, { seed: 2 });
if (result.kind === 'village') {
  console.log(result.model.buildings.length); // VillageModel
} else {
  console.log(result.model.patches.length);   // city Model
}
```

`GenerationParams` is an interface, not a constructor. For the city pipeline use
`mapToGenerationParams(burg, seed)` before `new Model(params).generate()`.
See [lower-level rendering](scene-schema.md#render-an-existing-city-model).

## Browser applications

With a bundler, use the same package import as Node:

```js
import { generateSettlement } from 'settlemaker';
```

For a page without a bundler, copy
`node_modules/settlemaker/dist/settlemaker.browser.js` into an asset directory
served by your application. This standalone ESM bundle includes the runtime
code and default artwork; it does not fetch SVG files during generation.

```html
<!doctype html>
<html lang="en">
  <meta charset="utf-8">
  <title>My settlement</title>
  <style>#map svg { display: block; width: 100%; height: auto; }</style>
  <div id="map"></div>
  <script type="module">
    import { generateSettlement } from './assets/settlemaker.browser.js';
    const result = generateSettlement({
      name: 'Ashford', population: 300, biome: 'temperate',
      port: false, citadel: false, walls: false, plaza: true,
      temple: true, shanty: false, capital: false,
      roadBearings: [18, 142, 267],
    }, { seed: 2 });
    document.querySelector('#map').innerHTML = result.svg;
  </script>
</html>
```

Serve the page over HTTP during development. Use a separate image document or
iframe for each map when displaying several maps: generated SVGs contain IDs
that can collide if multiple copies are inserted into the same DOM. See
[SVG embedding](scene-schema.md#embedding-svg).

## Load a portable skin

In Node, resolve the example distributed inside the installed package:

```js
import { readFile } from 'node:fs/promises';
import { createSkin, generateSettlement } from 'settlemaker';

const definitionUrl = import.meta.resolve('settlemaker/docs/examples/copperline.skin.json');
const definition = JSON.parse(await readFile(new URL(definitionUrl), 'utf8'));
const skin = createSkin(definition);
const result = generateSettlement({
  name: 'Brassworks', population: 2000, biome: 'steampunk',
  port: false, citadel: false, walls: false, plaza: true,
  temple: true, shanty: false, capital: false,
  roadBearings: [20, 145, 270],
}, { seed: 42, skin });
console.log(result.kind, result.svg.length);
```

In a browser, host a skin JSON file with your application, fetch it, check the
response and pass its parsed JSON to `createSkin`. Create the runtime handle with
the same loaded module instance that performs generation. To transfer a skin to
a worker or save it, transfer the definition JSON and load it there; do not
serialize or move the runtime handle between independently loaded bundles.

## Save and reproduce

Store the complete burg input, explicit seed, package version, rendering options
and skin definition/version. The same configuration reproduces the geometry and
SVG within a package version. Geometry and feature IDs may change on upgrades.
GeoJSON includes a creation timestamp, so complete JSON strings will differ even
when the geometry is identical. The city-only `geojson.generatedAt` option can
fix that timestamp; the village generator has no corresponding option.

[Full API](api.md) · [Output coordinates](geojson.md) · [Skin authoring](skins.md)
