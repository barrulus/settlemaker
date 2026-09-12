# URL adapter contract

This guide describes the **3.0.x library's URL codec** and the hosting contract
for a renderer at `https://settlemaker.com/fmg`. The URL envelope version remains
**1**. The npm library and hosted website have separate release cycles; a package
publication alone does not establish which generator a website is running.

Use the [library API](api.md) when your application generates maps itself. Use a
URL adapter when a host such as Azgaar's Fantasy Map Generator embeds a separately
deployed renderer. There is no HTTP JSON generation endpoint or iframe result
message protocol in this contract.

## Endpoints and responsibility

| Path | Role |
| --- | --- |
| `/fmg` | Embedded renderer receiving a burg URL. |
| `/` | Human-facing application; do not use it as the burg-rendering endpoint. |
| `/symbols` | Artwork browsing, outside the input protocol. |

The host supplies the URL and owns its surrounding UI. The renderer parses it,
generates SVG and displays success, warnings or a visible error. Hosts cannot
read a cross-origin iframe's model, GeoJSON or JavaScript result. Direct library
consumers can read those results without an iframe.

## Build a complete link

```js
import { encodeBurgParam } from 'settlemaker';

const burg = {
  name: 'Ashford', population: 300, biome: 'temperate',
  port: false, citadel: false, walls: false, plaza: true,
  temple: true, shanty: false, capital: false,
  roadBearings: [
    { bearing_deg: 36, kind: 'main', route_id: 'r17', through: true },
    { bearing_deg: 209, kind: 'main', route_id: 'r17', through: true },
    { bearing_deg: 117, kind: 'town', route_id: 'r23' },
  ],
};
const url = new URL('https://settlemaker.com/fmg');
url.searchParams.set('i', await encodeBurgParam(burg, 42));
console.log(url.href); // use as the iframe src or external-open link
```

The codec uses Web Platform globals, including
`CompressionStream('deflate-raw')` and `DecompressionStream('deflate-raw')`.
Verify support in the host environment. The library provides no compression
polyfill. The full [input reference](api.md#burg-input) is shared with direct
library calls; always supply all required flags explicitly.

## Compressed payload

`i=` contains this envelope:

```json
{
  "v": 1,
  "burg": {
    "name": "Ashford",
    "population": 300,
    "port": false,
    "citadel": false,
    "walls": false,
    "plaza": true,
    "temple": true,
    "shanty": false,
    "capital": false
  },
  "seed": 42
}
```

Encoding is JSON → UTF-8 → raw DEFLATE → unpadded base64url. Raw DEFLATE has no
zlib/gzip header. `encodeBurgParam` and `decodeBurgParam` implement this envelope;
`encodeJsonParam` and `decodeJsonParam` provide the generic JSON codec used by
presentation overrides.

`v` must equal 1. `seed` is optional; otherwise generation derives it from the
burg name. The decoder checks the envelope, a plausible name/population and any
water context. It is not complete validation of every burg field. Validate
untrusted integration data before calling generation.

`i=` takes precedence over **all flat data fields**, including a flat `seed`.
A malformed `i=` is an error, not permission to retry with flat fields.
Presentation parameters remain separate and apply after input decoding.

## Roads

Send one record per **actual land approach**, with its independently measured
clockwise bearing from north. Keep both sides of a continuing route even when
they are not 180 degrees apart; use the same `route_id` for those two records.
`through: true` is a hint and never creates an exit.

| Source meaning | `group` | `kind` |
| --- | --- | --- |
| Known land-road class | `roads` | `royal`, `main`, `market`, `town`, `local` |
| Known trail class | `trails` | `trail`, `footpath` |
| Road group without a class | `roads` | `road` |
| Trail group without a class | `trails` | `foot` |
| Sea, air or trade-only network without a land approach | — | Exclude from land approaches. |

Do not transmit UI labels such as `"roads / royal"` as a kind. `local` is accepted,
but an adapter should not invent it for missing source classes. `relief` and
`followsRiver` carry optional city growth hints. See [road inputs](api.md#roads).

Village approaches preserve source provenance as they join shared internal
streets. Drawn village street classes can change to `town`, `local` or `footpath`;
a small roadside hamlet can retain a major through road. City outputs use their
legacy road/foot categories and gate matching. Do not assume identical feature
counts or names in both engines.

An explicit `roadBearings: []` means no external approaches. Omitted approaches
also produce none in villages; the city planner retains its legacy random-gate
fallback when the field is absent.

## Water and physical units

The full [water-context v1 specification](water-context-v1.md) remains the
normative contract for measured **villages, population 1–1,000**. A city input with
`waterContext` is rejected with `water-context-unsupported-engine`; the host must
not strip the object and silently reinterpret its metre geometry as city units.

| Input | Village | City |
| --- | --- | --- |
| `coastlineGeometry` | Filled polygons in burg-local metres | Filled polygons in city-local mesh units |
| `rivers` | Centreline, positive `widthM`, optional `meander: false` | Not consumed by city generation |
| `oceanBearing` | Generated coast when explicit/measured inputs do not supersede it | Legacy generated coast fallback |
| `waterContext` | Validated survey/unknown-unit mode | Rejected |

Positive x points east and positive y south. Do not send geographic coordinates
or assume city-local units are metres. `port` controls infrastructure, not water
visibility. A `coastal` biome chooses artwork but does not itself add an ocean.

A nonempty `coastlineGeometry` array represents **filled areas**, not bank lines.
Include all relevant water polygons and preserve narrow channels and bends. For
village rivers, supply a centreline with width or a filled polygon, not duplicate
representations. `followsRiver` alone creates no water.

For measured water, carry summaries, polygon associations, declared geometry
error and survey coverage together. An empty measured survey suppresses the
legacy coast; unknown units remain a diagnostic state. URL compression/length
problems must not fall back to a flat URL that loses measured-water semantics.
Simplify only within the declared physical error budget, or show an encoding error.
There is no automatic iframe resurvey protocol.

## Flat parameters

The flat tier is convenient for manual examples:

```text
https://settlemaker.com/fmg?name=Ashford&pop=300&seed=2&biome=temperate&plaza=1&temple=1&roads=18:main,142:town,267:local
```

| Parameter | Parsed meaning |
| --- | --- |
| `name` | Name; default derived from seed/population if omitted. |
| `pop` | Finite population; defaults to 300. |
| `seed` | Optional numeric seed. |
| `port`, `citadel`, `walls`, `plaza`, `temple`, `shanty`, `capital`, `trade` | True for `1` or `true`; otherwise false. |
| `biome` | Input biome name. |
| `urbanDensity`, `coreCapacity` | Optional positive numbers. |
| `oceanBearing` | Optional finite compass bearing. |
| `harbourSize` | `large` or `small`. |
| `roads` | Comma-separated `bearing[:class[:through]]` records. |

`roads=36:main:through,209:main:through,117:town` supplies all three approaches.
Bearings wrap into `[0, 360)`; default class is `main`. Valid flat classes are the
seven land classes in `ROUTE_CLASS_ORDER`; legacy/group aliases are not accepted
by this flat syntax. Invalid classes or continuation tokens throw a `roads` error.
Flat records cannot carry route IDs, relief, river following or measured water.

With no data fields, `parseSettlementUrl` chooses a demo input and seed. That
includes a URL containing only presentation fields. A URL with explicit input and
a resolved seed is reproducible within the same deployed generator version; the
bare demo URL intentionally is not.

## Presentation

| Parameter | Used by | Meaning |
| --- | --- | --- |
| `theme` | City | Named palette. |
| `style` | City | Compressed JSON with partial `RenderTheme` overrides. |
| `villageTheme` | Village | One of `temperate`, `desert`, `tundra`, `tropical`, `coastal`. |

City palette keys are `default`, `classic`, `parchment`, `blueprint`, `bw`, `ink`,
`night`, `ancient`, `colour`, `simple`. `default` aliases `parchment`; `classic` selects the
original classic palette. The parser returns the name; a renderer must validate it against
`PALETTES` and display an unknown-palette error itself.

`style` accepts hex colour fields, nullable water colours, finite theme numbers
and a finite `{dx, dy}` shadow offset. Unknown fields/wrong value shapes are dropped
by `sanitizeThemeOverrides`. Accepted material keys include `smInk`, `smStone`,
`smTimber`, `smVoid`, `smCanopy1`, `smCanopy2`, alongside the geometry style fields in
[RenderTheme](../src/output/render-theme.ts). This is not arbitrary CSS.

`villageTheme` changes ground, water, shadows and material tokens without changing
the input biome's dwelling/landscape selection. An invalid name is a
`UrlCodecError` with reason `villageTheme`, even when the city engine would run.
The city presentation fields have no effect on the village renderer, and vice versa.

**Skins are a direct library feature.** There is no `skin=` URL option, remote skin
fetch, or embedded skin definition in this protocol. A host that offers a skin
picker must explicitly load a definition and pass the resulting handle to the
library API. There is also no `symbols=` or `fit=` URL option in this parser.

## Implementing a renderer

```js
import {
  parseSettlementUrl, generateSettlement, PALETTES, villageThemeFor,
} from 'settlemaker';

// In a browser page:
const parsed = await parseSettlementUrl(new URLSearchParams(location.search));
const palette = parsed.paletteName === undefined ? undefined : PALETTES[parsed.paletteName];
if (parsed.paletteName !== undefined && !Object.hasOwn(PALETTES, parsed.paletteName)) {
  throw new Error(`Unknown palette: ${parsed.paletteName}`);
}
const result = generateSettlement(parsed.burg, {
  seed: parsed.seedOverride,
  svg: { palette, theme: parsed.themeOverrides },
  village: parsed.villageThemeName
    ? { theme: villageThemeFor(parsed.villageThemeName) }
    : undefined,
});
// Display result.svg and any result.waterContextResult diagnostics.
```

Wrap parsing/generation in your page's error handler. `UrlCodecError.reason` can
be `base64`, `inflate`, `json`, `version`, `shape`, `villageTheme` or `roads`.
Fatal water errors use `WaterContextError.waterContextResult`; successful measured
results can still contain warnings. Keep errors and warnings visible without
hover or interaction, including inside pointer-disabled previews.

The library does not render diagnostic cards for you. An iframe host must provide
those in its page, and must not assume a source-map popup or console error is a
usable explanation for an embedded user. See [embedding and zoom](fmg-embed-zoom.md).

## Deployment and compatibility

Pin the renderer to a tested library release, deploy its diagnostics alongside it,
then enable corresponding measured-water inputs in the sending application.
Validate preview and external-open links together. Do not infer website support
from the npm `latest` tag.

Payload v1 evolves through optional additions. Breaking changes to the envelope
require a new version; decoders reject an unsupported version. Geometry changes
can occur without a URL or GeoJSON version bump, so save the package/build version
with any cached preview or generated IDs.

[Current generated fixtures and preview links](gallery.md) · [Input API](api.md)
