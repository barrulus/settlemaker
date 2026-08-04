# Netlify Pivot: Browser-Hosted URL-API Settlement Service

**Date:** 2026-08-04
**Status:** Approved design, pre-implementation

## Goal

Turn settlemaker from a Node library into a browser-hosted, client-side-only,
URL-parameter-driven settlement renderer on Netlify, embeddable as an iframe in
Azgaar's Fantasy Map Generator (AFMG). AFMG integrates via one adapter function
that builds a URL; AFMG owns all surrounding UI. This replaces/parallels AFMG's
existing MFCG integration, per direct agreement with Azgaar (Discord,
2026-08-04).

## Context and constraints

- Azgaar wants a non-clone divergent evolution of MFCG with close FMG
  integration. His wishlist: non-circular layouts, population-proportional
  size, feature buildings (walls, port/pier, palace, citadel, market,
  cathedral, shanty town), water-body orientation, roads, fields, biome-driven
  visuals, style/color schemes.
- `src/` already has zero Node-only imports (`pg`/`sharp` are devDeps used
  only by out-of-tree scripts) — the pipeline is browser-ready.
- A cross-origin iframe's DOM cannot be styled from the host page, so **all
  presentation must travel in the URL**.
- Long-term direction (explicitly kept in mind, not built now): asset sets may
  eventually live in AFMG as part of an AFMG theme, with settlemaker returning
  scene *data* and AFMG doing the assembly. Every v1 boundary is drawn so that
  future mode is "relocate the assembler", not a rewrite.

## Architecture overview

Three cleanly separated parts:

1. **Scene data** — the generator's semantic output: typed features with
   meaning, not looks. "building kind=hut roof=thatch footprint=P",
   "vegetation kind=palm at=X", "field crop=wheat", coastline, river, road.
   This is the existing GeoJSON output evolved into a versioned public schema;
   biome/culture/trade live here as data. This schema is the long-term AFMG
   contract.
2. **Asset sets** — a theme: a mapping from semantic types to SVG symbols and
   palette (`hut → <symbol>`, `tree.palm → <symbol>`, `field.wheat →
   pattern`). Defined as SVG symbols plus a small JSON manifest so community
   artists can create sets without touching generator code. Biome selects the
   default set.
3. **Assembler (renderer)** — walks the scene, resolves semantic types against
   the active asset set, emits SVG using `<defs>`/`<use>` and the group/style
   contract below. v1 assembler runs in the settlemaker page; a future
   AFMG-side assembler consumes the same scene format.

**Hard rule:** the SVG builder renders *from the scene*, never from model
internals.

## Web app and hosting

- `web/` directory in this repo: Vite + vanilla TypeScript (no framework),
  importing library source via `../src`. Own `tsconfig` with DOM libs; the
  library's `tsc` build and tests are untouched.
- `netlify.toml` at repo root; build publishes `web/dist`. Fully static,
  client-side only, no functions.

## URL API

Data parameters and presentation parameters are separate tiers:

- **Rich payload (primary FMG channel):** `?i=<base64url(deflate(JSON))>`
  carrying a versioned envelope `{v: 1, burg: AzgaarBurgInput}` — including
  coastline polygons, road bearings with route IDs, biome, trade. Compression
  via browser-native `CompressionStream('deflate-raw')` (also in Node 18+),
  zero dependencies. When `i` is present it wins over flat params.
- **Flat params (human tier):** `?name=&pop=&seed=&port=1&walls=1&plaza=1&`
  `temple=1&shanty=0&citadel=0&capital=0&oceanBearing=135&harbourSize=large`.
- **Presentation params (outside the payload in both tiers):**
  - `theme=<preset>` selects a named asset set / palette.
  - `style=<base64url(deflate(JSON))>` — group→properties overrides
    (`{"water": {"fill": "#7aa"}}`) merged over the preset via the existing
    `themeFrom` override mechanism. AFMG's adapter translates its style
    settings into this mechanically.
- **No params** → random seed with sensible defaults (self-demoing bare URL).
- Envelope `v` field is the evolution mechanism for future fields.

## Page behavior (v1)

Chrome-free bare renderer: parse URL → build `AzgaarBurgInput` → generate →
SVG fills the viewport. No toolbar, no controls — AFMG owns all UI. A
malformed `i`/`style` payload renders a visible error card with the decode
reason, never a blank iframe. Same URL → identical image (existing
determinism guarantee).

## SVG style contract (FMG-aligned)

- Every paint pass gets a stable named group: `#fields`, `#greens`, `#water`,
  `#roads`, `#shadows`, `#buildings`, `#landmarks`, `#walls`. The
  `data-bg="paper"` rect keeps its attribute (contract with
  settlement-tiler's `cropSvgToTile`).
- Theme values move from inline per-element attributes into a `<style>` block
  with rules keyed to those groups — mirroring AFMG's "styles apply rules to
  groups" model. Geometry stays geometry; downloaded SVGs are restylable by
  hand.
- Scene GeoJSON uses the same group vocabulary, so the future data-mode
  integration inherits the contract unchanged.

## Biome and trade (v1 scope)

`AzgaarBurgInput` grows `biome` and `trade` fields, carried in the `i`
payload (data, not presentation). v1 behavior: biome selects the default
asset set and vegetation density (overridable via `style=`); trade guarantees
a market/plaza ward. Deeper biome-driven generation (house shapes, culture
styles) is v2.

## Assets (v1 scope)

Architecture plus a starter set: the full scene→asset-set→assembler pipeline
ships, with one deliberately simple built-in asset set — current flat-polygon
buildings become symbols, plus a handful of basic motifs (generic tree, field
pattern, water). This proves symbol resolution end-to-end; a designer can
replace or add sets without code changes. Real per-biome art is farmed to a
community artist later (Azgaar to help recruit).

### Visual reference (watabou examples, 2026-08-04)

Reference screenshots from watabou's Village and City generators establish
the target vocabulary and confirm two **style families**, both expressible as
asset sets over the same scene schema:

- **Pictorial (village scale):** individual tree/canopy symbols with
  scale/rotation jitter, plowed-field furrow patterns inside bordered plots,
  water depth banding (concentric coastline offsets) plus a shore/sand
  strip, piers, building drop shadows and roof ridge lines, biome palettes
  (tropical sand vs temperate green vs somber).
- **Schematic (city scale):** flat block-fill buildings, hatched out-of-wall
  field plots, dark landmark silhouettes (castle), wall lines with towers,
  district/street labels set along curved paths.

The paired same-village/two-themes examples confirm the core contract: theme
swap changes only the asset set/palette, never the scene. The v1 starter set
is schematic (closest to current output); the pictorial village set is the
first community-art target. The scene schema must carry enough semantics
(vegetation instances, field plots with crop, shore, piers, landmarks,
labels) to support both families without schema changes; scale-adaptive
treatment (pictorial for small settlements, schematic for metropolises) is a
property of asset-set selection, not the schema.

## Testing

- Vitest round-trip tests for `i=` and `style=` encode/decode and flat-param
  parsing (run in Node via its native `CompressionStream`).
- Regression test: grouped, scene-driven SVG output remains deterministic for
  a fixed seed.
- Existing test suite (287 tests) stays green.
- Netlify build acts as the web-bundle smoke check.

## Out of scope for v1

Pan/zoom, in-page param editing or toolbar, postMessage channel, real
per-biome art, culture-derived house shapes, AFMG-side adapter code (the
deliverable there is `docs/url-api.md` documenting the contract), AFMG-side
assembly mode (kept possible by the scene schema, not built).

## Deliverables

1. `web/` Vite app + `netlify.toml`, deployed on Netlify.
2. Versioned scene schema (evolved GeoJSON) + scene-driven SVG assembler.
3. Starter asset set (symbols + manifest) with biome-based default selection.
4. URL codec (`i=`, `style=`) shared shape for the AFMG adapter.
5. `docs/url-api.md` — the integration contract for Azgaar.
