# Landmark glyphs — design

**Date:** 2026-08-12
**Status:** SUPERSEDED by `2026-08-13-glyph-wiring-design.md` (owner decision
2026-08-13: glyphs shape the town — generator-side placement, approach B).
Never implemented.
**Depends on:** ward-deck starvation fix (cd50b17) — singleton wards (Cathedral,
Military, Administration, Park) now appear reliably, so the landmarks this
feature decorates dependably exist.

## Goal

Render the distinctive, one-per-town landmarks as authored glyphs from the
`/symbols` library (batch001), overlaid on the existing footprint fabric.
Scope is deliberately **landmarks/POIs only**: the fabric (houses, streets,
fields) keeps its current footprint rendering. This is the additive first
step of the staged assets roadmap, not the buildings-as-glyphs pivot.

## Decisions (owner, brainstorm 2026-08-12)

1. **Scope:** landmarks/POIs only — curated tier, not all 16 POI kinds.
2. **Relation to footprints:** glyphs **overlay** the building footprint
   (footprint still draws; glyph renders on top, centred). Pure additive
   layer.
3. **Legibility:** static size-gate at generation using each glyph's
   `minScale` metadata — one SVG, same everywhere, no runtime JS.
4. **Contract:** **default on**, with an off-switch (`SvgOptions.glyphs`,
   and `#glyphs{display:none}` CSS for URL consumers). No new URL param.
5. **Approach:** scene-native glyph layer fed by the existing POI selector
   (approach A below), not contract-first landmark entities and not an SVG
   post-processor.

## Curated set (v1)

| Landmark | Trigger | Glyph | Anchor |
|---|---|---|---|
| Castle | citadel ward (Castle) | `sm-castle` | citadel patch centroid |
| Cathedral | POI `kind: 'cathedral'` | `sm-cathedral` | marked building bbox centre |
| Market cross | POI `kind: 'market'` — **at most one per town**: the market POI on the plaza ward when present, else the first market POI in deterministic selection order | `sm-market-cross` | marked building bbox centre |
| Mill | POI `kind: 'mill'` | `sm-mill-wind` inland / `sm-mill-water` when the burg has a coastline | marked building bbox centre |
| Well | POI `kind: 'well'` (floating) | `sm-well` | POI point |

Everything else (inn, tavern, smithy, temple, …) stays footprint-only in
v1. Expansion = a row in this table + a symbol in the extracted set; no
structural work. `sm-mark-church` and pattern-class glyphs are out of
scope. The mill variant choice is metadata-driven (coastline presence), not
random.

## Rejected approaches

- **B. Contract-first Scene landmark entities** (AFMG-renders-glyphs
  future): designs contract surface for a consumer that doesn't exist;
  approach A upgrades into it later without rework. YAGNI.
- **C. SVG post-process decorator** (inject glyphs into finished SVG using
  the GeoJSON POI layer): string surgery, duplicates coordinate/shift
  logic, every consumer must call it — wrong side of the seam.

## Architecture (approach A)

### Glyph extraction (build-time)

`scripts/extract-glyphs.ts` (committed, like the calibrate harnesses) reads
`web/public/symbols/batch001/symbols.json` + `symbols.svg` and generates
`src/assets/landmark-glyphs.ts`:

- per curated glyph: `{ viewBox, content, silContent, footprint, minScale }`
  (native viewBoxes kept — **no re-authoring to the unit box**; `<use
  width/height>` does the fitting);
- a CC-BY-4.0 attribution header naming the author (Barry Gill), keeping
  the CC-BY/GPL licence split clean with credit intact.

The generated file is committed so the library build stays self-contained
(zero runtime deps; questables unaffected). Regenerating after a library
edit = rerunning the script.

### Scene layer

`buildScene` calls the **same `selectPois`** the GeoJSON builder uses
(currently the only call site is `geojson-builder.ts`; selection is
deterministic and draws no rng), filters to the curated set, adds the
citadel-ward castle, and emits an additive `glyphs` layer:

```
glyphs: Array<{ kind: string; x: number; y: number; w: number; h: number }>
```

post-gate, in output coordinates — so glyph placement is byte-identical in
provenance to the POI layer consumers already see (same buildings, same
ids). Additive field ⇒ `SCENE_VERSION` minor bump, documented in
`docs/scene-schema.md`.

### Placement and sizing

- Building-anchored glyphs centre on the marked building's bbox centre,
  **unrotated** (`rotation: "invariant"` metadata); the fabric under them
  keeps its rotation.
- Rendered width = `clamp(k × bboxShortSide, glyphMin, glyphMax)` world
  units, aspect preserved from the native viewBox; `k` slightly over 1 so
  the glyph reads over the footprint. Castle sizes against the citadel
  patch. Wells (no building) get a fixed world size scaled off the town's
  mean building side.
- Exact `k`, `glyphMin`, `glyphMax` are render-gate judgements, not spec
  commitments.

### Legibility gate (static)

Drop a glyph at scene-build time if `renderedSize / frameWidth <
minScale × G` (one global calibration constant `G`, tuned at the render
gate). Hamlets keep everything; a metropolis frame drops wells and likely
mills but keeps castle/cathedral. Pure arithmetic — **no rng draws
anywhere in this feature**, so the layout stream is untouched and existing
hash pins change only where glyph markup is added.

### Collisions

v1 does nothing: curated landmarks are sparse (≤1 cathedral, ≤1 castle,
≤1 market cross, few mills/wells). If the render gate shows pileups, add
nearest-neighbour suppression then.

### Assembler

- Used glyphs emit `<symbol id="glyph-<name>">` defs (native viewBox)
  alongside the existing `asset-*` defs.
- New `#glyphs` group between `#landmarks` and `#walls` (over the fabric,
  under the wall circuit); one `<use href="#glyph-…" x y width height>` per
  entry.
- **Theming:** the library recolours via CSS custom properties; the
  assembler `<style>` sets those props on `#glyphs` from two new
  `RenderTheme` keys — `glyphStroke`, `glyphFill` — whose defaults derive
  from each palette's existing `buildingStroke`/`landmarkFill` (all current
  palettes work untouched). Both keys join the `sanitizeThemeOverrides`
  whitelist (hex-only).
- **Shadows:** implement the `/symbols` specimen's `-sil` offset shadow
  pass (silhouette `<use>` beneath each glyph, colour from the existing
  shadow theme slot), but the render-gate gallery shows **with and
  without** — keeping it is an eyeball decision, and it is one boolean to
  drop.
- **Off-switch:** `SvgOptions.glyphs?: boolean` (default `true`) for
  library callers; `#glyphs{display:none}` consumer CSS documented in
  `docs/url-api.md`. No new URL param.

## Contract & versioning

- **GeoJSON:** unchanged — the POI layer already carries this data.
- **Scene:** minor bump (additive `glyphs` layer).
- **Release:** minor version (1.1.0). `SETTLEMAKER_VERSION` is hashed into
  the generation version, so questables' cache key rolls automatically;
  the rucio tile **disk** cache still needs its manual wipe (standing
  un-versioned-cache issue).
- The Aldford hash canaries in `tests/fidelity-round4.test.ts` will re-pin
  (the fixture is temple'd — its new cathedral glyph is the point),
  following their documented protocol.

## Testing (TDD throughout)

- **Extraction:** generated module contains exactly the curated glyphs,
  each with a parseable viewBox and non-empty content; attribution header
  present.
- **Scene:** glyph layer deterministic; a temple'd pop-20k city yields
  exactly one cathedral glyph on the same building the POI layer names;
  the gate drops wells at metropolis framing and keeps everything at
  hamlet framing; a landlocked town picks `sm-mill-wind`, a coastal one
  `sm-mill-water`.
- **Assembler:** one `<symbol>` def per used kind; `<use>` count matches
  scene entries; `#glyphs` in correct group order; `SvgOptions.glyphs:
  false` removes group and defs; theme keys pass sanitization, unknown or
  non-hex values rejected.
- Full suite green with canaries re-pinned.

## Render gate (before any merge)

Contact-sheet gallery for the owner's eyes: population ladder ×
{glyphs off, glyphs on, glyphs+shadows}, plus themed variants
(parchment/blueprint/night). Settled there: `k`, `glyphMin`/`glyphMax`,
`G`, and the shadow keep/drop decision.
