# City glyph starter pass

Branch: `feat/city-glyphs`, based on handoff `0dd7363` (v2.4.0).
Worktree: `.worktrees/city-glyphs`. This is an implementation for review, not a release or a completed city acceptance gate.

Continued by the [neighbourhood pass](2026-09-10-city-neighbourhood-pass.md):
consistent architecture, one temple, explicit street/alley frontage and planned parks.

## Correction: zoom-dependent artwork

The first gallery had a rendering defect: the inherited city `<symbol>`
definitions let `<use>` sizing depend on the surrounding SVG viewport. Width
and height on the definition did not prevent this in the raster renderer.
Consequently ordinary glyphs looked oversized in overview images, and changing
the viewBox for a detail image changed their size relative to the city.
The initial visual assessment did not catch this; it must not be treated as
validation that the overview artwork fitted its geometry.

City glyph definitions now use plain `<g>` elements, exactly as the village
renderer does. Placement transforms alone set their size. The gallery also
creates detail crops with an outer SVG viewport, preserving the unmodified
inner document; this makes the historical baseline's detail image agree with
its overview too, without modifying its old renderer.

Two raster regressions compare a pixel crop from the overview with a separately
rendered detail at the same physical scale. The production-viewBox check failed
before the fix and passes after it; the second covers historical baseline crops.
Both galleries have been regenerated. Placement, building counts and model-space
paint estimates are unchanged; SVG byte sizes/hashes and render timings in the
first-run table below are historical, with refreshed measurements in the galleries.

## Owner's artwork decision

Use the accepted village/refined glyph library. Discard phase 1 city artwork;
do not preserve it as fallback or author a new city kit yet. This supersedes
the previous handoff's suggestion to preserve city-only glyphs.

The default city asset set now contains exactly the 91 refined village assets.
The batch001 artwork is no longer imported by the runtime asset module.
Phase 1-only mill/cross/church-mark art is omitted. Existing semantic POI sites
and their output identities remain; unsupported artwork is not substituted with
an unrelated building. Roads, walls, piers and parcels remain geometric.

## Implemented

- Shared the village material/stroke stylesheet without changing its output.
  The population-1,000 village SVG is byte-identical to the baseline for both
  seed 2 and held-out seed 102.
- Measured refined structure artwork at eight samples per art unit, including
  body, silhouette, stroke and doorway extents, with a 0.5-unit guard. The
  generated `refined-ink.ts` records conservative paint boxes and approximate
  painted areas; it does not reuse the village house/hut approximation for
  civic buildings.
- Added a final city placement pass after refinement, water rejection and budget
  trimming. Existing building polygons and the generation RNG are unchanged.
  Candidates use the village manifest's width/depth aspect, scaled together,
  and align to the existing footprint's dominant axis. Fit tests constrain the
  entire guarded paint box to inward polygon half-planes. Native biome homes
  are preferred; city-specific shop/terrace/warehouse drawings are deferred.
- Require at least 50% estimated footprint paint coverage to replace a polygon.
  Failed fits keep their existing geometry. This is a conservative starter
  policy, not a claim that the remaining polygons meet the final glyph goal.
- Linked each replacement to its actual model footprint, shared its deterministic
  ID with scene and GeoJSON, and exposed `data-building-id` on SVG buildings and
  shadows. Missing, too-small, unlinked, or overlay-only symbols cannot hide a
  footprint. `symbols: false` restores all building polygons.
- Added optional scene `metersPerUnit`, symbol `scaleY`/`buildingId`, and building
  `id`. The metre conversion uses the existing city tiling estimate and canonical
  default frame padding. Scene stays v2 and GeoJSON stays v4; no occupancy or
  physical-coordinate contract changed.
- Added fixed and held-out review panels, whole-map and matched 60×60 local-unit
  core crops, roads/land-only SVGs, a gallery, and a machine-readable report.

## Measured results

All 36 city comparisons (18 fixed, 18 held-out) retained the baseline ordinary
building count. Each panel also includes a population-1,000 village control.
These are synthetic fixtures. Timings are individual sequential local runs,
not statistical performance guarantees, and exclude browser layout/paint.

Fixed temperate cases use the handoff's name, flags and approaches, seed 2:

| Population | Budget | Ordinary buildings | With glyphs | Estimated paint retained¹ | Before / after ms | SVG / gzip KiB |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1,001 | 182 | 182 | 119 | 77.5% | 42 / 45 | 73 / 12 |
| 2,500 | 334 | 312 | 215 | 79.3% | 23 / 25 | 125 / 25 |
| 10,000 | 953 | 953 | 590 | 77.8% | 58 / 64 | 312 / 62 |
| 50,000 | 4,167 | 3,902 | 2,684 | 76.9% | 222 / 246 | 1,293 / 258 |
| 250,000 | 20,833 | 7,777 | 5,475 | 75.9% | 1,706 / 1,738 | 2,529 / 499 |

¹ Approximate glyph body/silhouette area plus retained fallback polygons,
divided by original ordinary-building polygon area. Excludes shadows. This is
an artwork-density diagnostic, not a roof-area survey or residential census.

Fixed-panel glyph coverage is 60.0–70.4% by ordinary-building count; held-out
coverage is 59.2–69.4%. The held-out 250k case has 7,505 ordinary buildings and
5,196 glyph replacements, taking 1,561 ms versus 1,544 ms baseline. The fixed
250k SVG has 17,515 elements, versus 17,477 baseline: artwork definitions are
shared once per glyph, with body/silhouette `<use>` instances.

The 250k budget shortfall is still **13,056 ordinary buildings** for seed 2,
and 13,328 for seed 102. No occupancy was increased to conceal this. These
counts cannot establish housed population, particularly in mixed-use wards.

## Visual verdict and remaining work

The inspected temperate and tundra core crops show recognisable roofs and
native snow detailing. They also show a conspicuous mix of detailed buildings
and large plain polygons. The glyph fit reduces apparent building coverage by
roughly one fifth to one quarter in the main temperate cases. This is not yet
an accepted dense-city result.

The next iteration must address irregular lots/corners and true street-facing
orientation while preserving frontage and capacity, using the current village
art until the owner starts the city-variation kit. Current alignment follows
lot geometry, not a verified road/alley frontage. There is no claim that all
access, water crossings or overlaps in the pre-existing city model are solved.
The new glyph envelope does not extend outside its existing building footprint.

Not covered here: curved-river/bridge acceptance, captured FMG inputs, constrained
land matrix, rendered collision overlays, stage-by-stage generation profiling,
browser first paint/pan/zoom, or a new residential capacity policy. Current heap
numbers are unforced-GC deltas and should not be interpreted as peak heap.

## Verification and reproduction

Passed: 125 test files / 1,317 tests with two workers, TypeScript build, script
typecheck, browser-library build, and `git diff --check`. Updated the two legacy
SVG snapshots after verifying deterministic output and byte-identical GeoJSON
against `0dd7363` with a fixed timestamp. One is a direct `generateFromBurg(800)`
fixture, not the accepted `generateSettlement` village engine.

```sh
npm run measure:city-glyphs
npm run build
npm run typecheck:scripts
npm run build:lib
npm test -- --maxWorkers=2
```

To reproduce comparisons, build the baseline with its own source and renderer:

```sh
git worktree add --detach /tmp/settlemaker-city-baseline 0dd7363
node_modules/.bin/esbuild /tmp/settlemaker-city-baseline/src/index.ts --bundle --platform=node --format=esm --outfile=/tmp/city-glyphs-baseline.mjs
npm run review:cities -- --baseline-module /tmp/city-glyphs-baseline.mjs
npm run review:cities -- --baseline-module /tmp/city-glyphs-baseline.mjs --held-out --out output/city-review/held-out
```

Open `output/city-review/current/index.html` or
`output/city-review/held-out/index.html`. Numerical reports are beside each
gallery in `metrics.json`. Outputs and the local dependency symlink are ignored
by Git. The runner requires permission to read Git provenance from a child
process in sandboxed environments.
