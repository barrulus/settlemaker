# settlemaker URL API — the FMG adapter contract

This document is for **AFMG** (Azgaar's Fantasy Map Generator — the world
mapping tool by Azgaar) and any other integrator who wants to embed a
settlemaker-rendered settlement without touching this repository. It is
self-contained: everything you need to build a working link is either quoted
verbatim below or copy-paste runnable.

## 1. Overview

settlemaker's web renderer is a single iframe-embeddable page: point an
`<iframe>` at it with the right query string and it renders one settlement as
an SVG, deterministically, from that URL alone. **The URL is the entire API**
— there is no separate request/response protocol, no server-side session, no
JavaScript SDK to install. AFMG (or any host page) owns all surrounding UI
— map chrome, burg picker, zoom controls — and only needs to construct a URL
and drop it into an iframe `src`.

Throughout this document, the renderer's base URL is written as
`https://<site>.netlify.app/fmg` — substitute the actual deployed origin. (The bare site root `/` serves a human-facing builder page; the machine endpoint that renders from URL parameters is `/fmg`.)

## 2. Quick start

**Bare URL** — no query string at all. Renders a random demo settlement,
seeded from the page load, so it demos something on first visit:

```
https://<site>.netlify.app/fmg
```

**Flat tier** — human-typable query params, useful for manual testing and
simple links:

```
https://<site>.netlify.app/fmg?name=Salt+Harbour&pop=4200&seed=7&port=1&walls=1&oceanBearing=135&harbourSize=large
```

**Real integrations use `i=`.** The flat tier only covers a handful of
boolean/number fields; it cannot express road bearings or coastline geometry.
Production AFMG links should use the compressed `i=` payload described next
— the flat tier exists for humans, not for the adapter.

## 3. The `i=` payload (primary channel)

### Envelope

```json
{ "v": 1, "burg": { "...": "AzgaarBurgInput, see below" }, "seed": 7 }
```

- `v` — payload version. Currently `1`. See "Evolution policy" below.
- `burg` — an `AzgaarBurgInput` object (verbatim interface below).
- `seed` — optional. When present it overrides the deterministic
  name-derived seed, so re-encoding the same burg with the same `seed`
  always reproduces the same settlement.

### Encoding pipeline

```
JSON.stringify(envelope)  →  UTF-8 bytes  →  deflate-raw compress  →  base64url (no padding)
```

The result is placed in the `i` query parameter: `?i=<result>`.

- "deflate-raw" is the raw DEFLATE stream (no zlib or gzip header) — the
  same format produced by the Web platform's `CompressionStream('deflate-raw')`
  and consumable by `DecompressionStream('deflate-raw')`.
- "base64url" is standard base64 with `+` → `-`, `/` → `_`, and `=` padding
  stripped.

**Practical size bound.** `i=` has no hard length limit enforced by this
renderer, but very large payloads (mainly `coastlineGeometry`, which is the
only field whose size scales with map detail) risk hitting URL-length limits
in intermediary infrastructure (proxies, CDNs, logging). Two practical
mitigations: round coastline coordinates to about 1 decimal place before
encoding — the renderer's own output only carries 2-decimal precision
anyway, so extra input precision buys nothing — and keep the encoded `i=`
value under roughly 8 KB for safety margin against intermediary limits.

### The `AzgaarBurgInput` interface

Copied verbatim from `src/input/azgaar-input.ts`:

```typescript
/**
 * A road bearing either as a plain compass angle (back-compat) or a richer record
 * carrying the caller's route_id so questables-style consumers can round-trip
 * the matched route on each gate output feature.
 */
export type RoadBearingInput =
  | number
  | {
      bearing_deg: number;
      route_id?: string;
      kind?: RouteKind;
    };

/**
 * Input data from Azgaar's Fantasy Map Generator (maps_burgs table).
 */
export interface AzgaarBurgInput {
  name: string;
  population: number;
  port: boolean;
  citadel: boolean;
  walls: boolean;
  plaza: boolean;
  temple: boolean;
  shanty: boolean;
  capital: boolean;
  culture?: string;
  elevation?: number;
  temperature?: number;
  /**
   * Compass bearings (degrees, 0=N clockwise) of roads approaching the burg.
   * Bare numbers work for back-compat; pass objects to have the matched
   * `route_id` echoed back on the gate output feature.
   */
  roadBearings?: RoadBearingInput[];
  /** Compass bearing (degrees, 0=N clockwise) to nearest ocean — enables coastline clipping for port cities */
  oceanBearing?: number;
  /** Harbour size for port cities — 'large' for major sea routes + big pop, 'small' otherwise */
  harbourSize?: 'large' | 'small';
  /** People per household — FMG's urbanDensityInput. Drives the building budget. */
  urbanDensity?: number;
  /** Azgaar biome name (e.g. "desert", "temperate") — selects default asset set + palette. */
  biome?: string;
  /** Trade-center burg — guarantees a market/plaza ward (Azgaar wishlist). */
  trade?: boolean;
  /**
   * Water polygons surrounding the burg, in burg-local coordinates (origin at
   * burg centre, same scale as the generated mesh — roughly the wall radius).
   * Each entry is a closed polygon of water (ocean, lake, cove, etc.); a patch
   * whose centroid lies inside any polygon is classified as water.
   *
   * When set, this replaces the `oceanBearing` half-plane heuristic with
   * fidelity-preserving classification against the actual world geometry.
   * `oceanBearing` remains an acceptable fallback when vector coastlines are
   * not available.
   */
  coastlineGeometry?: Array<Array<{ x: number; y: number }>>;
}
```

`RouteKind` is re-exported from the package root; treat it as an opaque
string tag round-tripped from your own route data if you use `roadBearings`
objects — settlemaker does not interpret its value beyond echoing it back on
the matching gate output feature.

**Which fields are actually required, precisely:**

- In the TypeScript interface above, the seven boolean flags (`port`,
  `citadel`, `walls`, `plaza`, `temple`, `shanty`, `capital`) have no `?` —
  they are required fields of `AzgaarBurgInput`. Set every one of them
  explicitly (`false` when the burg doesn't have that feature); don't omit
  them.
- At runtime, the `i=` decoder (`decodeBurgParam` in `src/url/codec.ts`)
  only validates that `burg.name` is a string and `burg.population` is a
  number — it does not check the seven booleans at all. A hand-built JSON
  payload that omits them will still decode successfully, and generation
  will treat every missing boolean as falsy (no port, no walls, etc.),
  which is silent and easy to get wrong.
- **Recommendation:** always set all seven booleans explicitly in the
  payload you send, even when `false`. Every other field
  (`culture`, `elevation`, `temperature`, `roadBearings`, `oceanBearing`,
  `harbourSize`, `urbanDensity`, `biome`, `trade`, `coastlineGeometry`) is
  genuinely optional and can be omitted (not set to `null`) when unknown.

### Adapter snippet

This is the exact encoding pipeline in plain browser JavaScript — no
libraries, no build step. It uses only web-platform globals
(`TextEncoder`, `Blob`, `CompressionStream`, `btoa`), so it runs unmodified
in any modern browser and in Node 18+:

```js
async function settlemakerUrl(base, burg, seed) {
  const payload = { v: 1, burg, ...(seed !== undefined ? { seed } : {}) };
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const packed = new Uint8Array(await new Response(stream).arrayBuffer());
  let bin = ''; for (const b of packed) bin += String.fromCharCode(b);
  const b64url = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${base}?i=${b64url}`;
}
```

Usage:

```js
const url = await settlemakerUrl('https://<site>.netlify.app/fmg', {
  name: 'Toprak',
  population: 13,
  port: true,
  citadel: false,
  walls: false,
  plaza: false,
  temple: false,
  shanty: false,
  capital: false,
  oceanBearing: 200,
}, 42);
iframe.src = url;
```

## 4. Flat parameters (human tier)

For manual testing and simple links, the renderer also accepts flat query
parameters instead of `i=`. This tier can only express the fields listed
below — it has no equivalent for `roadBearings` or `coastlineGeometry`.

| Param | Type | Default | Notes |
|---|---|---|---|
| `name` | string | `Burg <seed or pop or 0>` | |
| `pop` | number | `300` | maps to `population` |
| `seed` | number | (name hash) | overrides the deterministic seed |
| `port` | boolean | `false` | |
| `citadel` | boolean | `false` | |
| `walls` | boolean | `false` | |
| `plaza` | boolean | `false` | |
| `temple` | boolean | `false` | |
| `shanty` | boolean | `false` | |
| `capital` | boolean | `false` | |
| `trade` | boolean | `false` | only present at all when true |
| `oceanBearing` | number | (unset) | compass degrees, 0=N clockwise |
| `harbourSize` | `large` \| `small` | (unset) | any other value is dropped, not passed through |
| `biome` | string | (unset) | |
| `urbanDensity` | number | (unset) | only kept if `> 0`; when unset, the generator falls back to a population-scaled default curve — see §6 |

That's all 15 flat data params (`src/url/params.ts`'s `FLAT_DATA_PARAMS`).

**Boolean convention:** a boolean param is `true` only for the literal
values `1` or `true`; anything else (including absence) is `false`.

**Precedence rule:** if `i=` is present in the query string, every flat data
param above is ignored entirely — `i=` wins outright, it is not merged with
the flat tier.

## 5. Presentation parameters

Two additional params control appearance only. They apply identically in
both the `i=` tier and the flat tier, and **never affect geometry** — the
same burg with different `theme=`/`style=` values produces the same street
plan, walls, and building placement, only different colors/strokes.

### `theme=<preset>`

Selects a named built-in palette. Valid values (from `src/output/palette.ts`
`PALETTES`):

```
default, classic, parchment, blueprint, bw, ink, night, ancient, colour, simple
```

(`default` and `parchment` are the same palette; `default` is the
alias used when `theme=` is omitted entirely.) An unrecognized `theme=`
value renders a visible error card rather than silently falling back.

### `style=<compressed JSON>`

Same codec as `i=` (`JSON → UTF-8 → deflate-raw → base64url`), but the
decoded payload is a **partial** override of the render theme — a plain
object with zero or more of the keys below, applied on top of whatever
palette is in effect. Use `encodeJsonParam` from `src/url/codec.ts` (or the
inline equivalent of the adapter snippet above) to build it.

The full `RenderTheme` shape it draws from (`src/output/render-theme.ts`):

```
paper, water, waterEdge, fieldFill, fieldFurrow, greenFill, treeFill,
roadCasing, roadCore, buildingFill, buildingStroke, landmarkFill,
shadowColor, shadowOpacity, shadowOffset, arteryWidth, roadWidth,
casingDelta, seamStroke, shoreWidth
```

For what each of these groups/classes controls visually (walls, wards,
roads, water, etc.), see [`docs/scene-schema.md`](./scene-schema.md), which
documents the `Scene`/SVG group and class vocabulary these theme keys are
applied against.

**`style=` is whitelist-validated, not passed through raw.** This is a
deliberate security property, not an incidental limitation: a decoded
`style=` payload is run through `sanitizeThemeOverrides`
(`src/url/params.ts`), which:

- accepts only the exact `RenderTheme` key names above — any other key is
  silently dropped;
- for color-valued keys, accepts only strings matching `/^#[0-9a-fA-F]{3,8}$/`
  (3–8 hex digits after `#`); anything else for that key is dropped;
- additionally accepts the literal `null` for `water` and `waterEdge` only
  (this disables water rendering entirely), and only there;
- for numeric keys (`shadowOpacity`, `arteryWidth`, `roadWidth`,
  `casingDelta`, `seamStroke`, `shoreWidth`), accepts only finite JS numbers;
- for `shadowOffset`, accepts only `{ dx, dy }` where both are finite
  numbers, and rebuilds a fresh object rather than reusing the input
  reference.

Anything that doesn't match its slot's shape is dropped, not coerced or
rejected outright — the rest of a partially-invalid `style=` payload still
applies. This means a malformed or hostile `style=` value can never break
the page or inject markup: at worst, individual overrides silently fail to
apply and the palette default shows through instead.

## 6. Guarantees

- **Determinism.** This guarantee applies to any URL carrying at least one
  data param (`i=` or any flat data param from §4, with or without
  `theme=`/`style=`): the same URL always renders byte-identical SVG.
  Nothing in the pipeline consults wall-clock time or unseeded randomness
  once a seed is resolved. The bare no-param URL is the deliberate
  exception — it seeds itself from the page load (see §2 "Bare URL") and is
  *intentionally* random on every visit, not a violation of this guarantee.
- **Versioned envelope.** The `i=` envelope's `v` field is checked exactly;
  an envelope with any other value than the currently supported version
  produces a visible error, never a best-effort guess at reinterpreting an
  unknown shape.
- **Errors are visible, not silent.** Any decode/generation failure renders
  a visible error card in the page (never a blank iframe), carrying a
  machine-readable reason: `base64 | inflate | json | version | shape` for
  `i=`/`style=` decode failures (`UrlCodecError.reason` in
  `src/url/codec.ts`), or a generic generation-failure message otherwise.
- **Route fidelity.** External roads rendered match the supplied
  `roadBearings` exactly: same count, bearings, and kinds, with any
  `route_id` you attached echoed back on the matching gate output feature.
  The generator invents no additional external connections beyond what's
  supplied. The two "no data" cases are distinct and matter:
  - `roadBearings: []` (present, empty) is authoritative — "this burg
    genuinely has no roads" — and yields zero external roads.
  - Omitting `roadBearings` entirely means "route data unknown", and
    settlemaker falls back to legacy behavior: it invents plausible random
    gates and roads rather than assuming routelessness.

  Send `[]` when you know the burg has no roads; omit the field only when
  you have no route data at all. (Internal lanes within the settlement are
  a separate, unrelated concern and are not counted here.)
- **Water fidelity.** When `coastlineGeometry` is supplied, the rendered
  water outline follows that geometry (clipped to the local frame) rather
  than Voronoi patch shapes — open sea/rivers reach the frame edge, matching
  the world map's orientation, and nothing is built or routed over water.
  `oceanBearing` remains a fallback heuristic when vector coastlines aren't
  available.
- **Population budget.** Ordinary building count is derived from
  `population` divided by `urbanDensity` (people per household), then
  capped — so a population of 13 renders a handful of buildings, not a
  filled town mesh, and very large populations don't produce an unbounded
  building count. When `urbanDensity` is omitted, the default is **not** a
  fixed constant — it's a population-scaled curve (`densityCurve` in
  `src/generator/generation-params.ts`): 4 people/household up to
  population 500 (villages), rising log-linearly to a ceiling of 12 at
  population ≥ 20 000 (cities), so denser settlements pack proportionally
  more people per building rather than sprawling into an ever-larger
  building count. An explicit `urbanDensity` (`> 0`) always overrides the
  curve outright. This only changes the *default* value fed into the same
  population/density division above — same-URL determinism (identical
  `i=`/flat params + seed → byte-identical output) is unaffected, since the
  curve is a pure function of `population` alone. The number of Voronoi
  patches (and so the physical size of the walled area and the count of
  distinct building footprints) also scales with population, up to a cap;
  populations large enough to hit that cap keep growing the wall but express
  the remaining population as denser texture within existing footprints
  rather than more of them.

## 7. Evolution policy

- The `i=`/`style=` payload shapes evolve by **adding optional fields only**.
  Existing integrations are never broken by a new field appearing.
- A breaking change to the `i=` envelope bumps `URL_PAYLOAD_VERSION`
  (currently `1`, in `src/url/codec.ts`). Decoding an envelope whose `v`
  doesn't match the currently supported version always fails visibly (see
  Guarantees) — it is never silently reinterpreted.
- Any deprecation of a flat param, theme preset, or `RenderTheme` key will be
  announced in this file before removal.
