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

The renderer is deployed at **`https://settlemaker.com/fmg`** — that is the
URL to build against.

The site serves three paths, and only one of them is this API:

| Path | Audience | What it is |
|---|---|---|
| `/fmg` | machines | **The endpoint this document specifies.** Chrome-free renderer; the query string is the entire input. |
| `/` | humans | A builder page — a form that composes a link and previews it live. Ignores `i=` and the flat params. |
| `/symbols` | artists | Reference sheet for the SVG symbol library and its authoring spec. Not part of the API. |

Point iframes at `/fmg`, never at `/`. (Links predating 2026-08-06 used the
bare root as the render endpoint; those now land on the builder page and
silently ignore their parameters.)

## 2. Quick start

**Bare URL** — no query string at all. Renders a random demo settlement,
seeded from the page load, so it demos something on first visit:

```
https://settlemaker.com/fmg
```

**Flat tier** — human-typable query params, useful for manual testing and
simple links:

```
https://settlemaker.com/fmg?name=Salt+Harbour&pop=4200&seed=7&port=1&walls=1&oceanBearing=135&harbourSize=large
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
      group?: 'roads' | 'trails';
      through?: boolean;
      relief?: RouteRelief;
      followsRiver?: boolean;
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
  /**
   * People the walled core may hold. Population beyond this grows outside
   * the walls along roads. Default DEFAULT_CORE_CAPACITY (10 000) — walls
   * historically enclosed a core, not an entire metropolis.
   */
  coreCapacity?: number;
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

`RouteKind` (`'road' | 'foot' | 'sea'`) and `RouteRelief`
(`'descent' | 'ascent' | 'valley' | 'ridge' | 'flat'`) are both exported from
the package root. `route_id` is still round-tripped untouched onto the
matching gate output feature. `kind` is echoed back the same way, but it is
no longer purely opaque: `kind: 'foot'` marks the approach as a footpath,
which (like `group: 'trails'`) strongly suppresses settlement growth along
it — see the next section.

### Route character — how the optional road fields shape growth

Settlement growth outside the walls (faubourgs, roadside development,
outlying hamlets) is **asymmetric by design**: it concentrates on the one or
two most attractive approaches instead of ringing the walls evenly. The four
optional per-road fields below decide which approaches win. They map
directly onto data FMG already extracts per approach (route group, whether
the route continues past the burg, corridor relief, whether the road follows
a river):

| Field | Values | Effect on growth along that road |
|---|---|---|
| `group` | `'roads'` \| `'trails'` | Trails attract almost none (weight ×0.15). Absent = treated as a road. |
| `through` | boolean | A route that continues past the burg attracts more (×1.5) than one that dead-ends there. |
| `relief` | `'flat'`/`'valley'`/`'descent'`/`'ascent'`/`'ridge'` | Easy ground is neutral; `ascent` halves growth (×0.5); `ridge` quarters it (×0.25). |
| `followsRiver` | boolean | A valley road along a river attracts slightly more (×1.2). **No river is rendered** — this is a weighting hint only; river geometry is not part of the contract yet. |

Rules an adapter can rely on:

- **Absent fields never disqualify a road.** Every field is optional and an
  omitted field is neutral ("unknown"), so bare-number bearings keep working
  exactly as before.
- **Ties are broken deterministically per settlement.** When several
  approaches score equally (e.g. all bare numbers), a seeded tilt makes one
  or two dominate anyway — real towns don't grow evenly — and the same URL
  always picks the same winners.
- Sending richer data doesn't change the roads themselves (count, bearings,
  and `route_id` echo are governed by the Route fidelity guarantee in §6);
  it only steers where houses cluster.

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
  `harbourSize`, `urbanDensity`, `coreCapacity`, `biome`, `trade`,
  `coastlineGeometry`) is
  genuinely optional and can be omitted (not set to `null`) when unknown.

**Ocean data is gated on `port`.** `oceanBearing`, `coastlineGeometry`, and
`harbourSize` are honoured only when `port: true`. FMG sends `port` explicitly
and may attach ocean data to any coastal burg whether or not it has a
harbour — settlemaker deliberately drops all three at the mapping layer when
`port` is `false`, so a coastal-but-portless burg renders as a plain inland
town, never with coastline, water, or shoreline walls.

**Fields accepted but not yet consumed.** `culture`, `elevation` and
`temperature` are part of the interface and decode fine, but nothing in the
current generator reads them — sending them changes no pixel today. They are
declared because they're the fields most likely to drive future output
(culture-specific asset sets, elevation-aware terrain, temperature-driven
vegetation), so an adapter that populates them now will pick up that
behaviour without a payload change. Everything else in the interface is
live.

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
const url = await settlemakerUrl('https://settlemaker.com/fmg', {
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
| `coreCapacity` | number | `10000` | only kept if `> 0`; people the walled core may hold — see §6 |

That's all 16 flat data params (`src/url/params.ts`'s `FLAT_DATA_PARAMS`).

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

### Symbol/mark visibility — consumer CSS, not a URL param

settlemaker now places generator-native POI glyphs (wells, mills, market
crosses, church marks, etc. — see `docs/scene-schema.md`'s `SCENE_VERSION 2`
notes) directly in the rendered SVG, in two groups: `#symbols` (structure
glyphs, e.g. wells and mills) and `#marks` (overlay glyphs drawn on top of
their host building, e.g. a church cross). **There is no URL param to turn
these off.** A host page that wants to suppress them — for example, an
integrator layering its own symbol set over the settlement — does it with
plain CSS on the embedded document, the same way any other group/class in
the SVG's style contract is overridden (see `docs/scene-schema.md` §3):

```css
#symbols, #marks { display: none; }
```

`#symbols` and `#marks` are stable group ids in the SVG/asset styling
contract (`docs/scene-schema.md` §3), not an internal implementation detail,
so this rule is safe to depend on. It applies to any consumer that gets hold
of the SVG markup directly — e.g. a library caller reading `svg` off
`generateFromBurg`'s result and post-processing or wrapping it before
display. No `i=`/flat/presentation param exists or is planned for this; the
off-switch is deliberately a plain-CSS consumer concern, consistent with
every other appearance override in this document (§5), rather than a new
query-string knob.

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
  a separate, unrelated concern and are not counted here.) The optional
  route-character fields (`group`/`through`/`relief`/`followsRiver`, §3)
  never change the rendered roads themselves — only where extramural
  buildings cluster along them. All approach roads join the internal street
  network; none stop short of the settlement.
- **Water fidelity.** When `coastlineGeometry` is supplied, the rendered
  water outline follows that geometry (clipped to the local frame) rather
  than Voronoi patch shapes — open sea/rivers reach the frame edge, matching
  the world map's orientation, and nothing is built or routed over water.
  `oceanBearing` remains a fallback heuristic when vector coastlines aren't
  available. Both are honoured only for `port: true` burgs — a coastal
  burg with `port: false` renders as an inland town regardless of what
  ocean data arrived; see §3.
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
  curve is a pure function of `population` alone. The built footprint
  (walled core plus extramural growth) also scales with population, up to a
  hard cap of 220 built patches (`MAX_PATCHES` in
  `src/input/azgaar-input.ts`). Per-patch texture scales alongside it — from
  ~9 airy detached houses per patch for villages to ~30 tight row-house
  blocks per patch, reaching full city texture around population 10 000
  (`perPatchDensity`, log-scaled from population 600).
- **Walled-core capacity.** The walled core holds at most `coreCapacity`
  people (default 10 000). Below the cap, roughly 10–20% of the population
  still lives outside the walls — faubourgs at the gates and development
  along the most attractive approach roads (see "Route character" in §3),
  rising with settlement size. Above the cap the walled core stops growing
  and all overflow lives outside it, so a metropolis renders as a compact
  walled old town inside a much larger unwalled sprawl. Pass a custom
  `coreCapacity` to move that boundary. Walled settlements read as dense,
  compact circuits (ordered row housing, party walls); coastal walled
  settlements carry their wall along the water's edge, with the harbour
  gate opening onto the quay and piers.

## 7. Evolution policy

- The `i=`/`style=` payload shapes evolve by **adding optional fields only**.
  Existing integrations are never broken by a new field appearing.
- A breaking change to the `i=` envelope bumps `URL_PAYLOAD_VERSION`
  (currently `1`, in `src/url/codec.ts`). Decoding an envelope whose `v`
  doesn't match the currently supported version always fails visibly (see
  Guarantees) — it is never silently reinterpreted.
- Any deprecation of a flat param, theme preset, or `RenderTheme` key will be
  announced in this file before removal.
