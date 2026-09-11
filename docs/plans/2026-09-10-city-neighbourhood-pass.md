# City neighbourhood pass

Worktree `.worktrees/city-glyphs`, branch `feat/city-glyphs`. Continues the
refined-village-glyph migration and its corrected, viewport-independent renderer.
No new artwork or production release.

Continued by the [street-led block and capacity pass](2026-09-10-city-block-layout-pass.md).
The measurements below describe the neighbourhood pass before that layout change.

## Changes

**Architecture is selected before fitting.** A deterministic city-level choice
sets one ordinary house style for craftsmen, merchants, gate areas, farms and
temple annexes. Poor, wealthy and military/harbour buildings each have a fixed
role-appropriate family. The fitter cannot choose a different glyph merely
because it would occupy more area. Native biome variants remain preferred.

**One temple is reserved in its ward.** A principal building is fitted inside
the temple ward's buildable block, checked against water, and given one religious
glyph. Overlapping old fragments are removed; clear annexes remain and receive
ordinary houses. The cathedral POI adopts that exact principal footprint.
Wealthy wards no longer generate additional temple POIs. The existing cathedral
POI kind is retained for compatibility; it identifies the city's temple.
Castle artwork is likewise limited to one designated keep; other castle
buildings use the military family.

**Frontage comes from existing access geometry.** Positive-width cuts made by
`createAlleys` now retain their centre lines and widths. Zero-width party-wall
splits do not become roads. Recording cuts changes neither subdivision geometry
nor the RNG sequence. Lanes are rebuilt when a ward is refined and clipped to
dry intervals after final geometry rejection, with even-odd water rings respected.

The placer considers actual alley cuts and the street corridors already reserved
along ward edges, excluding walls and water-facing edges. A bounded ward-local
search rejects frontage connections blocked by other buildings or water. The
glyph's front faces the selected access line and its width axis follows that
line. It never switches to an arbitrary perpendicular orientation just to fit.
The existing road/approach skeleton, bearings and gate assignments are retained.
This pass does not synthesize a new boulevard or approach network.
Farm boundaries are not treated as streets: farm glyphs require a real approach
road reachable within their own patch. Isolated farmhouses retain their polygons.

House proportions adapt within a bounded family: the nominal width is multiplied
by one of 0.67, 0.8, 1, 1.25 or 1.5, with the inverse applied to depth before
fitting. This reuses the same village art with varying frontage proportions;
it does not add a terrace asset or represent extra households. The guarded
paint box must remain inside the footprint, and ordinary replacements still
require at least 50% estimated paint coverage. Difficult corners retain polygons.

**Parks are laid out, rather than scattered.** City parks use a lawn, connected
entrances and a walk through a central clearing. Planting follows rows aligned
with that walk, using at most two matching native species. Full canopy boxes
stay clear of paths and boundaries. Concave sites use boundary-intersection
checks for path containment; fixed-step sampling cannot skip a narrow notch.
The village engine and its renderer are unchanged.

## Output contract

- `Ward.lanes` stores accepted alley segments. `principalBuilding` and
  `principalSymbol` hold the reserved landmark association.
- `PlacedSymbol.frontage` records the selected access segment and connection
  target for diagnostics; it is model-only and contains no presentation markup.
- Scene roads gain `kind: 'alley'` and optional local-unit `width`.
- Scene greens gain optional `paths` and `pathWidth` for park walks.
- GeoJSON streets gain `streetType: 'alley'` and `'park'`, with local-unit widths.
  Existing artery/approach street IDs retain their allocation order; new paths
  are appended. Scene remains v2 and GeoJSON v4; consumers should recognise the
  additional street types. Replanning a temple/park can change subsequent
  building IDs, which remain deterministic for the same input and implementation.

## Review evidence

The before renderer is a saved bundle of the previous accepted zoom-fix pass,
retained at `output/city-review/neighbourhood-baseline.mjs`. Both sides use
their own renderer. The galleries include whole maps, matched core crops,
matched park details, roads/land-only SVGs, and footprint/access overlays.
Pink overlay lines connect building centres to their selected access segment;
they are diagnostic connections, not claims of exact doorway coordinates.
All overlay coordinates include the output origin shift.

Final panel results, including water clipping and real-road farm frontage:

| Fixed seed 2 | Ordinary buildings | Before / after glyphs | Before / after estimated paint retained |
| --- | ---: | ---: | ---: |
| 2,500 | 312 | 215 / 198 | 79.3% / 80.5% |
| 10,000 | 953 | 590 / 609 | 77.8% / 78.8% |
| 250,000 | 7,777 | 5,475 / 5,363 | 75.9% / 77.7% |

All 38 city comparisons in the fixed and held-out panels retained their ordinary
building counts and had exactly one religious glyph. Each panel also verifies
a byte-identical population-1,000 village SVG. Detailed final measurements,
including timing, SVG/gzip size, architecture, alleys and park planting, are in
the galleries' `metrics.json` files. Timings are individual local runs, not
statistical guarantees, and exclude browser paint/pan/zoom.

The existing 250k housing-budget shortfall remains: 7,777 ordinary buildings
against a 20,833 budget at fixed seed 2. No occupancy was inflated. Ordinary
building counts cannot by themselves certify housed population. Some awkward
lots still fall back to polygons, and street-facing glyphs do not establish
that every pre-existing city building has access or that old river crossings
are correct. The new traced alleys do not invent bridges across water.

## Reproduction

Final validation: all 1,336 tests in 127 files pass. TypeScript compilation,
script type checking, browser bundle build and `git diff --check` also pass.

```sh
npm run review:cities -- --baseline-module output/city-review/neighbourhood-baseline.mjs --out output/city-review/neighbourhoods
npm run review:cities -- --baseline-module output/city-review/neighbourhood-baseline.mjs --held-out --out output/city-review/neighbourhoods-held-out
npm run build
npm run typecheck:scripts
npm run build:lib
npm test -- --maxWorkers=2
```

Open `output/city-review/neighbourhoods/index.html`, or the held-out equivalent.
The baseline bundle and generated galleries are local, Git-ignored review assets.
New regressions cover one home family/temple across all five biomes and six seeds,
temple POI identity, no unsolicited temples, unchanged cut geometry/RNG, unblocked
frontage orientation, park connectivity/clearance, concave park paths and thin
river clipping, plus rejection of field boundaries as farm access. Existing
glyph-envelope, zoom, density, origin and output tests remain in the suite.
