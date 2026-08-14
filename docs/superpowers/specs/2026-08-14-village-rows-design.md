# Village rows — housing glyphs as rural fabric (design)

**Date:** 2026-08-14
**Status:** approved by owner (brainstorm session); awaiting implementation plan
**Depends on:** generator-native symbols, shipped as 1.1.0 (glyph rendering
machinery: defs with explicit width/height, sil shadows, minScale gate,
claimed sites, `model.symbols`).

## Goal

Villages and small rural hamlets render their dwellings as rows of neatly
aligned little house glyphs along the roads — tightly packed and census-true
("full of people"). Densely populated settlements (the `rowHousing`
regime: towns and cities) keep today's generated packed fabric unchanged.

This deliberately amends the symbol spec's generator/asset boundary for the
village regime: dwellings there are now authored art placed by the
generator, not subdivided footprints. The owner owns that contract and made
the call. The boundary stands everywhere else — towns/cities, landmarks,
walls, fields, roads remain generated geometry.

## Decisions (owner, brainstorm 2026-08-14)

1. **Scope:** villages and rural hamlets only — `!rowHousing(population)`.
   Towns/cities must not move a pixel.
2. **Mechanism:** frontage stamping along the road network (road-major),
   PLUS farm wards keep their generated barns, subplots, furrows, and
   windmills — only their roadside frontage gains dwelling rows.
3. **Approach:** A — a generation-side stamping pass; stamped houses are
   real model buildings (footprint rects in ward geometry) paired with
   house-glyph instances; the glyph is the render, the rect is the truth.

## Architecture

### Module and pipeline position

New `src/generator/village-rows.ts` exposing `stampVillageRows(model)`.
`Model.buildGeometry` changes for `!rowHousing` settlements only:

- Ordinary residential wards (Craftsmen, Merchant, Patriciate, Slum,
  GateWard) skip dwelling subdivision entirely — `createGeometry` yields no
  dwellings there. (Cathedral is not a CommonWard and keeps its generated
  building; Farm keeps everything except roadside dwellings.)
- `refineDensity` is skipped for the village regime — its premise
  (subdivision yield) no longer applies when dwellings are stamped.
- The stamper runs LAST, after `removeDrownedGeometry`, the census counts,
  and `applyBuildingBudget`, with allowance
  `buildingBudget(population, urbanDensity) − surviving generated ordinary
  buildings`. Stamped rects join ward geometry after the trim pass, so no
  trim/glyph coupling machinery exists — the census is exact by
  construction and the budget pass can never orphan a glyph.

### Frontage slots

Road-major walk: arteries first (the main street is prime frontage), then
`streets`, then the inner ends of approach `roads`. For each polyline, both
sides generate slots:

- step along the tangent at `houseWidth + gap`; gap 0.8–1.2 units (seeded);
- perpendicular offset = half road width + half house depth + setback
  jitter ±0.3 units;
- rotation = local tangent ± 4° jitter (the house glyphs are
  rotation-`invariant`, so a semantic bearing is within their contract);
- slot accepted only if its footprint rect lies fully on a built patch of a
  residential or farm ward, avoids water, field subplots, greens, existing
  claimed sites (`intersectsSite`), and previously accepted slots (each
  stamp registers a claimed site, so rows self-space).

Overflow: when the front row exhausts frontage before the allowance is
spent, a second row walks the same roads offset one house-depth deeper,
slots staggered half a pitch so back-row houses peek between front-row
ones; then side lanes. Stamping stops when the allowance hits zero.

### Each stamp produces two coupled artifacts

1. an oriented footprint rectangle pushed into the underlying patch's ward
   geometry — census, POI adoption, id allocation, and GeoJSON see an
   ordinary building;
2. a `PlacedSymbol` on `model.symbols` (structure band, rotation = slot
   angle, `wardType` = the ward under the slot), id per the variety rules.

The model records the rect→glyph pairing for scene marking (below).

### Variety and coherence (all seeded from the generation stream)

- One per-settlement **roof bias** draw: thatch-leaning vs tile-leaning,
  skewing every house/house-tiled pick so the village reads as one place.
- Craftsmen frontage: `sm-house` / `sm-house-tiled` mix (roof-biased).
- Merchant/Patriciate frontage: `sm-house-large-tiled` interspersed with
  ordinary houses.
- Slum frontage and outermost row-ends: `sm-hut-mud` / `sm-hut-round` /
  `sm-hut-straw` mix.
- Farm frontage: vernacular — huts plus occasional `sm-longhouse` (10×5,
  long side to the road).
- Sizing: manifest footprints as-is (6×6, 8×8, 4.5×4.5, 10×5 world units),
  per the calibration accepted at the 1.1.0 gate. Glyph houses are chunkier
  than the old 4×2 generated rects — first thing judged at the render gate;
  fallback is a single village-house scale factor.

### Wells relocate into the row

Village `tryPlaceWell` consumed a generated lot, which village wards no
longer have. The stamper reserves one slot near the village centre —
skipped, claimed — and the existing well placement puts `sm-well` there
(same budget field, same manifest, same glyph). Towns/cities keep the
current lot-consuming behaviour untouched.

## Rendering

- Scene: `BuildingFeature` gains additive `glyphBacked?: true` (Scene stays
  v2 — additive evolution). `buildScene` sets it from the model's pairing.
- Assembler: `glyphBacked` features paint no building path and no rect
  shadow — the glyph and its sil shadow are the house. When
  `AssembleOptions.symbols === false`, the suppression disarms: footprint
  rects paint normally, so a symbols-off render shows a complete village.
- Everything else (defs, zBands, minScale floors, theme tokens,
  blueprint/night) rides the shipped 1.1.0 machinery unchanged.

## Contracts & versioning

- GeoJSON: shape unchanged; stamped houses are ordinary buildings with ids;
  POIs adopt them normally. Positions now form rows.
- Version: **1.2.0**, `SETTLEMAKER_VERSION` bumped (questables' cache key
  rolls automatically; the rucio tile DISK cache manual wipe applies — and
  the 1.1.0 wipe is still owed).
- The two fidelity-round4 sha256 canaries re-pin once (the pop-800 canary
  is a village and changes wholesale), clearly labelled, following the
  file's documented protocol. Town/city pins and outputs must be
  byte-identical.

## Testing (TDD throughout)

- Placement: stamped count === allowance (census exactness) across a seed
  spread; no stamped rect overlaps any building, field subplot, water, or
  claimed site; every stamp's rotation within jitter of its road tangent;
  farm wards byte-identical except roadside dwellings; village well exists
  on its reserved slot; same seed → identical geometry and symbols twice.
- Rendering: glyphBacked suppression on; `symbols: false` restores rect
  painting; back-row stagger appears when the allowance overflows frontage.
- Regression: `rowHousing` fixtures byte-identical — towns and cities do
  not move.

## Render gate (before any merge)

Contact sheet across the village spectrum — pop 60, 150, 300, 600, a
farm-heavy and a coastal village — three themes × symbols on/off, every
cell an isolated data-URI image, screenshot-verified by the controller
before the owner sees it (standing practice from the 1.1.0 gate). Judged
there: house chunkiness (scale factor fallback), spacing/jitter feel, roof
bias coherence, hut/house mix, back-row legibility. Feature branch
`village-rows`; preview via settlemaker-web submodule-bump PR; merge only
on owner approval.
