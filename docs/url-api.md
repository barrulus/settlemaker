# settlemaker URL API — the FMG adapter contract

This document is for **AFMG** (Azgaar's Fantasy Map Generator — the world
mapping tool by Azgaar) and any other integrator who wants to embed a
settlemaker-rendered settlement without touching this repository. It is
self-contained: everything you need to build a working link is either quoted
verbatim below or copy-paste runnable.

**Release:** 2.4.0 (2026-09-10). URL payload version stays `1`; GeoJSON schema
version stays `4`. See [release and FMG handoff notes](releases/2.4.0.md).

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
scalar fields and simple road bearings; it cannot express route IDs or water polygons.
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
      /**
       * Either the legacy three-kind form or a real route class from the
       * seven-type vocabulary. Widened, never replaced — `road`, `foot` and
       * `sea` remain valid input forever (see src/village/route-class.ts).
       */
      kind?: RouteKind | RouteType | 'roads' | 'trails';
      group?: 'roads' | 'trails';
      /** Continuation/growth hint only. Supply every actual approach separately. */
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
  /** Compass bearing (degrees, 0=N clockwise) to nearest ocean — fallback shoreline, independent of port */
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
   * burg centre; x east, y south). Villages use metres; cities use local mesh
   * units. Each entry describes a filled water polygon (ocean, lake, river,
   * cove, etc.), not a shoreline or river centreline. Rings close implicitly.
   *
   * When set, this replaces the `oceanBearing` half-plane heuristic with
   * fidelity-preserving classification against the actual world geometry.
   * `oceanBearing` remains an acceptable fallback when vector coastlines are
   * not available.
   */
  coastlineGeometry?: Array<Array<{ x: number; y: number }>>;
}
```

`RouteKind` is the legacy vocabulary (`road`, `foot`, `sea`). `RouteType`
is the seven land classes: `royal`, `main`, `market`, `town`, `local`,
`trail`, `footpath`. `RouteRelief` is `descent`, `ascent`, `valley`, `ridge`,
or `flat`. These types are exported from the package root.

### Required approach data for FMG adapters

Send **one `roadBearings` record per actual land approach**, with its measured
`bearing_deg` (0° north, clockwise), `kind`, and stable `route_id`. Measure each
side independently: a road entering at 36° might leave at 209°, not 216°.
A continuing route uses the same `route_id` on both records. Distinct routes
may arrive at very similar bearings; retain both records. Shared streets
inside the settlement do not erase their provenance.

```json
"roadBearings": [
  { "bearing_deg": 36, "kind": "royal", "route_id": "r17", "through": true },
  { "bearing_deg": 209, "kind": "royal", "route_id": "r17", "through": true },
  { "bearing_deg": 117, "kind": "town", "route_id": "r23" },
  { "bearing_deg": 281, "kind": "footpath", "route_id": "p4" }
]
```

**`through` never creates an exit.** It is a route-character hint; both
approaches must be supplied to draw a continuing connection. Older village
builds incorrectly invented a bearing +180° exit for this hint. Adapters that
relied on that behaviour must now supply the measured other side. Payload
version remains `v: 1`: the envelope and encoding are unchanged, and this
corrects the existing no-invented-external-connections guarantee.

Adapters that only know route groups should send `kind: "road"`
with `group: "roads"`, or `kind: "foot"` with `group: "trails"`. The aliases
`kind: "roads"` and `kind: "trails"` are also accepted. A group-only trail
record defaults to `trail`; a bare bearing defaults to `main`. Unknown class
values fall back to a path and log a warning. Sea routes are not land entries.

The live FMG style menu displays group/class pairs. Translate those into
separate payload fields; do not send the display label (such as
`"roads / royal"`) as `kind`:

| FMG group / class | `group` | `kind` |
|---|---|---|
| roads / royal, main, market, town, local | `roads` | the class name |
| trails / trail, footpath | `trails` | the class name |
| roads, without a class | `roads` | `road` (legacy fallback to main) |
| trails, without a class | `trails` | `foot` (legacy fallback to trail) |
| searoutes / feeder, coastal | — | exclude from land approaches |
| airroutes, traderoutes | — | exclude from land approaches |

`local` is accepted when FMG has that class, and is used for generated village
streets. Its absence from a particular map's menu does not require FMG to
invent local inbound routes. Sea feeder/coastal classes are not land classes;
do not convert them to `local`. Route styling (stroke widths, dash patterns,
colours) stays in FMG: this payload carries route meaning, while settlemaker
chooses physical road widths for the settlement scale.

Inside villages, streets use **`town`, `local`, or `footpath`**. The incoming
class describes the approach outside the built area; it does not require a
royal road to become the village's backbone. Streets follow shared irregular
parcel boundaries, and extra residential lanes require housing demand.
For a small hamlet (up to 120 people) with two broadly opposing approaches
of the same royal, main or market class, the major road can continue through
and organise the houses along it. This exception currently applies on dry
sites; water-constrained sites use the routed street network.

Village GeoJSON street features expose `route_role` (`approach`, `street`,
or `through`) alongside `streetType`, widths and route provenance. Classification
may change at the village edge while connectivity and supplied bearings remain
preserved. See the [village output fields](./schema-v3.md#village-road-cross-sections),
which are additive fields under the current GeoJSON schema version 4.

### Water geometry for FMG adapters

Despite its name, `coastlineGeometry` carries **all filled water polygons**:
sea, lake and river. A river needs both banks joined into a polygon, with its
width and bends preserved; a centreline or a single bank is not sufficient.
Use simple, non-self-intersecting rings with at least three distinct vertices.
The last vertex is implicitly joined to the first; repeating the first is
also accepted. Rings are combined as water, not interpreted as holes.

For villages, coordinates are burg-local **metres**, with `(0, 0)` at the
burg, positive x east and positive y south. Convert map coordinates and widths
with the same scale; do not send world coordinates or longitude/latitude.
For cities, use the existing burg-local mesh coordinate scale. Extend sea and
river polygons beyond the intended tile bounds so their ends do not appear as
artificial shorelines. Include every relevant water body: a non-empty polygon
array replaces the `oceanBearing` fallback rather than adding to it.

`oceanBearing` alone supplies a generated shore in the given direction; it
cannot describe a river, real headland or estuary. `port` controls docks, not
whether supplied water appears. `followsRiver` is a route hint only.

Village ordinary road paint is clipped out of water; short bank-to-bank
crossings are drawn as timber bridges. Custom GeoJSON renderers should apply
the same water clipping and use crossing `deck_m`/`centreline_m` geometry
([output fields](./schema-v3.md#village-road-cross-sections)). Continuous street
LineStrings describe connectivity and are not themselves a bridge surface.

### Route character — how the optional road fields shape city growth

Settlement growth outside the walls (faubourgs, roadside development,
outlying hamlets) is **asymmetric by design**: it concentrates on the one or
two most attractive approaches instead of ringing the walls evenly. The four
optional per-road fields below decide which approaches win in the city engine.
Village routing retains these hints but uses its own housing-driven street network. They map
directly onto data FMG already extracts per approach (route group, whether
the route continues past the burg, corridor relief, whether the road follows
a river):

| Field | Values | Effect on growth along that road |
|---|---|---|
| `group` | `'roads'` \| `'trails'` | Trails attract almost none (weight ×0.15). Absent = treated as a road. |
| `through` | boolean | A route that continues past the burg attracts more (×1.5) than one that dead-ends there. |
| `relief` | `'flat'`/`'valley'`/`'descent'`/`'ascent'`/`'ridge'` | Easy ground is neutral; `ascent` halves growth (×0.5); `ridge` quarters it (×0.25). |
| `followsRiver` | boolean | A valley road along a river attracts slightly more (×1.2). This hint does not create a river; send its filled water polygon in `coastlineGeometry` to render one. |

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

**Only `harbourSize` is gated on `port`.** `oceanBearing` and
`coastlineGeometry` are honoured for any burg that sends them, port or not: a
burg on a harbour cell with no docks is a beach settlement, and it genuinely
has a coastline and an ocean direction. What it lacks is harbour
*infrastructure*, so `harbourSize` is the only field that requires
`port: true`. No docks is not no sea.

> **Changed 2026-09-08, and this reverses the previous rule.** All three
> fields used to be dropped when `port` was `false`, so a coastal-but-portless
> burg rendered as a plain inland town. Villages sit on harbour cells
> constantly, so that suppressed the sea for a large fraction of a typical
> map.
>
> Note the shape this creates: FMG never omits `harbourSize` for a coastal
> burg — its `readHydrology` sets it from `isPort || cellsHarbor[center] > 0`,
> so a portless harbour-adjacent burg already arrives carrying `"small"`.
> "Coastline present, `harbourSize` absent" is therefore produced by this gate
> rather than by FMG, and it is now the normal shape for every coastal
> non-port burg. **Nothing downstream may infer that a burg is coastal from
> `harbourSize` being present.**
>
> A boathouse and its jetty are dock infrastructure and follow `port`, not
> water: a portless coastal village gets a shoreline and nothing built out
> over it.

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
below — it has no equivalent for `coastlineGeometry`.

**Do not omit `roads=` on a village.** The village engine builds its road
network inward from the bearings on its contract circle, so a burg of 1,000
or under with no approach roads has no main roads at all and nothing reaching
its own boundary — an island, with no way to join it to the map around it.
Supply every actual approach explicitly. Approaches retain their incoming
classes outside the village; internal streets normally use town/local/footpath.

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
| `roads` | string | (unset) | approach roads: comma-separated `bearing[:class[:through]]` — see below |
| `biome` | string | (unset) | data, not presentation: also picks the village dwelling/field/canopy decks. Azgaar's own biome names are accepted and normalised — see §Villages |
| `urbanDensity` | number | (unset) | only kept if `> 0`; when unset, the generator falls back to a population-scaled default curve — see §6 |
| `coreCapacity` | number | `10000` | only kept if `> 0`; people the walled core may hold — see §6 |

That's all 16 flat data params (`src/url/params.ts`'s `FLAT_DATA_PARAMS`).

**Boolean convention:** a boolean param is `true` only for the literal
values `1` or `true`; anything else (including absence) is `false`.

**Precedence rule:** if `i=` is present in the query string, every flat data
param above is ignored entirely — `i=` wins outright, it is not merged with
the flat tier.

### `roads=<bearing[:class[:through]]>,...`

The flat-tier equivalent of `roadBearings`. Each entry is a compass bearing
(0 = north, clockwise), optionally a route class, optionally the word
`through`:

```
roads=45,170,290                  three terminating main roads
roads=45:trail,170:royal          explicit classes
roads=20:main:through,207:main:through,140:trail   two measured sides plus a trail
```

Classes, highest to lowest: `royal`, `main`, `market`, `town`, `local`,
`trail`, `footpath`. Omitting the class gives `main`; omitting the third
field omits the continuation hint. Every actual approach must still be
listed explicitly; `through` never adds a bearing. Use `i=` to attach shared
route IDs, which the flat tier cannot express.

Bearings are normalised into 0–359, so `-90` and `450` are both legal. An
unrecognised class, a non-numeric bearing, or a third field that isn't
`through` is a **hard error** (`UrlCodecError`, `reason: 'roads'`) naming the
legal set — a silent fall back to `main` would be indistinguishable from a
typo quietly working.

`roads=` counts as a data parameter, so a URL carrying only `roads=` builds a
real burg rather than the random demo one. `i=` still wins over it, as over
every flat parameter.

## 5. Presentation parameters

Three additional params control appearance only. They apply identically in
both the `i=` tier and the flat tier, and **never affect geometry** — the
same burg with different `theme=`/`style=`/`villageTheme=` values produces
the same street plan, walls, and building placement, only different
colors/strokes.

`theme=` and `style=` dress the settlement engine; `villageTheme=` dresses
the village engine. All three are parsed whichever engine ends up running,
so a caller never has to know the population boundary in advance — the one
that does not apply is simply ignored.

### `theme=<preset>`

Selects a named built-in palette. Valid values (from `src/output/palette.ts`
`PALETTES`):

```
default, classic, parchment, blueprint, bw, ink, night, ancient, colour, simple
```

(`default` and `parchment` are the same palette; `default` is the
alias used when `theme=` is omitted entirely.) An unrecognized `theme=`
value renders a visible error card rather than silently falling back.

### `villageTheme=<biome>`

Village branch only. Names the village look explicitly:

```
temperate, desert, tundra, tropical, coastal
```

Distinct from `biome=` on purpose. `biome=` is a **data** parameter: it also
selects which dwellings, fields, canopies and plot edges get built, so using
it to restyle a village rebuilds it out of different houses. `villageTheme=`
changes only ground, water, shadow and the glyph material tokens. It is also
distinct from `theme=`, which names a *city* palette and has no effect on a
village.

Omit it and the village is themed from its `biome=`, which is the normal
path.

An unrecognized value is a **hard error**: `parseSettlementUrl` throws
`UrlCodecError` with `reason: 'villageTheme'` and a message naming the legal
set. It does not fall back to temperate — a silent fallback would be
byte-identical to omitting the parameter, so a typo would look like "the
feature does nothing". Validation lives in the library rather than in each
consumer so that a caller which has not migrated still cannot miss it. This
is checked whichever engine ends up running, so the same URL behaves the same
way either side of the population boundary.

Biome artwork continues to evolve. The 2.4.0 gallery includes desert and
tundra examples; tundra dwellings now resolve to native snowy house, hut and
longhouse families. A presentation-only `villageTheme=tundra` does not select
snowy building artwork: send `burg.biome: "tundra"` (or a supported FMG biome
name) to select the tundra asset set.

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
display. The `#symbols`/`#marks` and `SvgOptions.symbols` contract belongs to the city
renderer. Native villages use their own SVG bands and inline dwelling glyphs;
they do not provide the city renderer's rectangle-fallback switch. No URL
parameter controls individual symbol visibility.

## 5b. Villages

Since 2.0.0 the renderer runs **two** engines and picks by population:

| Population | Engine | `kind` |
|---|---|---|
| ≤ 1,000 | village (roads synthesised first, buildings line them) | `village` |
| > 1,000 | settlement (the ward-partition city pipeline) | `settlement` |

The boundary is **inclusive**: 1,000 is a village, 1,001 is a settlement.
Verified as tested behaviour, not intent.

Both engines emit an SVG and a GeoJSON carrying the same `schema_version`
and `settlemaker_version` metadata, so a consumer can treat the two
uniformly. A village SVG is standalone and self-contained: one root `<svg>`
with `viewBox`, every glyph defined inline in a single `<defs>`, no external
asset references and no `preserveAspectRatio` (set your own). It also
carries `data-contract-radius`, `data-origin-x`, `data-origin-y` and
`data-px-per-metre`.

`data-contract-radius` is an **alignment** contract, not a drawing limit:
every approach road reaches the circle at its exact bearing, so a consumer
holding `contractRadiusM` can line our tile up against its own route lines.
It is not where our drawing stops — village roads are drawn past the circle
all the way to the edge of the tile, where they are cut off.

### Biome names

`biome=` accepts **Azgaar's own biome vocabulary** and normalises it onto the
five the village tables are keyed by:

| Azgaar biome | village biome |
|---|---|
| `marine`, `wetland` | coastal |
| `hot desert`, `cold desert` | desert |
| `savanna`, `tropical seasonal forest`, `tropical rainforest` | tropical |
| `grassland`, `temperate deciduous forest`, `temperate rainforest` | temperate |
| `taiga`, `tundra`, `glacier` | tundra |

Matching is case- and whitespace-insensitive, and the five village names are
themselves accepted unchanged. Anything unrecognised falls back to temperate.

This normalisation exists because the lookup is exact-match: before 2.0.1,
twelve of Azgaar's thirteen biome names fell through to temperate, so
`biome=hot+desert` drew a green temperate village while the desert ground,
desert dwellings and irrigated fields sat unreachable. If you pinned
appearance against the older behaviour, villages will now look different —
correctly so.

`biome=` drives geometry as well as colour (dwelling, field and canopy
decks). To change only the look, use `villageTheme=`.

## 6. Guarantees

- **Determinism.** This guarantee applies to any URL carrying at least one
  data param (`i=` or any flat data param from §4, with or without
  `theme=`/`style=`): the same URL renders byte-identical SVG within the same generator version.
  Layouts and generated IDs can change between releases; include the generator
  version or pinned revision in downstream cache keys.
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
- **Route fidelity.** Supply every measured land approach independently. Village
  approaches retain the supplied bearing and class at the contract circle;
  closely spaced approaches can join outside the built area and share internal
  streets. Street counts therefore need not equal input-record counts. Village
  street features carry `route_ids`; city gate features carry
  `matched_route_id`/`matched_route_ids`. City kinds use the legacy road/foot/sea
  mapping. Sea routes do not become village land streets.

  `roadBearings: []` explicitly means no external roads. In villages, an
  omitted `roadBearings` also produces no external approaches; the city engine
  retains its legacy random-gate fallback when the field is omitted. Send `[]`
  when the absence of routes is known. `through` never invents an opposite
  approach. Water constrains the path between arrivals and the internal network;
  supply land arrivals, not bearings that lead into open sea.
- **Water fidelity.** When `coastlineGeometry` is supplied, the rendered
  water outline follows that geometry (clipped to the local frame) rather
  than Voronoi patch shapes — open sea/rivers reach the frame edge, matching
  the world map's orientation. Village buildings and ordinary road surfaces
  stay off water; short crossings receive separate bridge decks. Port jetties
  are a separate infrastructure exception. Wide-river bridge design is not
  provided by this release.
  `oceanBearing` remains a fallback heuristic when vector coastlines aren't
  available. Both are honoured for any burg that sends them, whether or not
  it is a port; only `harbourSize` requires `port: true`, and a boathouse or
  jetty requires it too. See §3.
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
