# Street-led city blocks and explicit capacity

Continues the accepted neighbourhood pass in `.worktrees/city-glyphs`, branch
`feat/city-glyphs`. The baseline is the previous accepted implementation, saved
before this pass as `output/city-review/block-baseline.mjs`. No release or new
artwork; cities still use the refined village glyphs.

## Layout

Common urban wards now allocate their building demand before subdividing land.
The longest available street establishes a district axis. Deep sites split into
smaller blocks with positive-width service lanes; each new lane connects to an
existing street or an earlier accepted lane. Wall edges cannot invent frontage.

Rows run along the actual street and service-lane boundaries. Long fronts own
their corners; shorter returns stop behind them. Frontage slots use consistent
setbacks and small party-wall seams. Block interiors retain the space left
behind the rows as courtyards. There is no random empty-lot thinning in planned
rows. Concave/unserviceable sites retain the existing subdivision fallback.

The planner evaluates at most six local grain candidates without mutating the
ward or consuming RNG state. It chooses a candidate that meets demand where
possible, then joins adjacent lots on the same street to reduce excess count.
Joining uses a robust monotone-chain hull, verifies retained area, and cannot
bridge a missing lot, courtyard or alley. Remaining budget trimming keeps
contiguous runs rather than removing the outermost houses across a block.

Ordinary grain cannot go below 45% of the calibrated mean building area (scaled
by the existing internal texture override), and alleys retain their existing
width floor. Houses are not shrunk without bound to satisfy a population label.
Final glyph placement retains the guarded ink-envelope and minimum-coverage
checks. Difficult corners can still use plain polygon presentation.

## Capacity and output

Fixed ordinary buildings are generated first and deducted from urban demand.
Land-area shares assign the remainder to common wards. Small cities retain
their core share; beyond 10,000 population the core's calibrated per-ward grain
caps its request. Additional demand belongs to outer wards. Existing walls,
arterial approaches, gate assignments, `MAX_PATCHES` and `urbanDensity`
semantics are retained. This does not add a new approach-road network.

`Model.getBuildingCapacity()` reports final ordinary-building accounting:

- `basis: 'ordinary-building-budget'`
- `target`, `placed`, `shortfall`
- `corePlaced`, `outerPlaced`
- `status: 'met' | 'shortfall'`

Cities expose the same object as optional `Scene.buildingCapacity` and GeoJSON
`metadata.building_capacity`. The target is the existing population/density
building budget. It is **not a certified housed-population count**; commercial
and other ordinary buildings remain in the existing accounting category.
Occupancy is not increased. Water-constrained land, absent approaches, and the
bounded lot grain can leave explicit shortfalls. In particular, a metropolis
without supplied approaches has much less outer-city supply than the routed
review fixture and must not be advertised as fully represented.

Scene stays v2 and GeoJSON v4: these fields are additive. Building/POI identities
are generated from the final accepted geometry and remain deterministic within
this implementation. Layout changes legitimately change IDs across versions.
Village output does not gain these city-only metadata fields.

## Geometry and performance

The full building footprint is checked against even-odd water geometry, including
thin strips crossing edges and ponds enclosed by an otherwise dry footprint.
Island interiors remain available. Planned fronts still pass the final access
check; a finite road segment cannot serve lots beyond its endpoint. Temple
annexes cannot block the reserved temple approach. New alley lines are clipped
to dry intervals; this pass does not establish correctness of all older city
river crossings.

POI selection previously gathered and sorted the entire candidate city again for
every adopted POI. It now scores once per selection call and skips used buildings
in that stable order. An old/new comparison on the same accepted 10k model
produced identical POI features; existing POI tests remain in the full suite.
This removes a major cost as the visible building count grows. Harbour scoring
still uses its own pier reference.

Local timings cover generation, SVG and GeoJSON. They exclude browser initial
paint and pan/zoom. SVG continues to reuse glyph definitions with `<use>`;
additional buildings still increase instance count and browser workload.

## Review and validation

Final validation: **1,345 tests pass in 128 files**. TypeScript compilation,
script type checking, browser bundle build, and `git diff --check` pass.
The final full suite ran after the merged-lot correction and metadata-contract
test update; the browser bundle is 419.7 KiB.

The fixed and held-out galleries include the 1,000 village control, cities from
1,001 through 250,000, biome variants, walls/citadel/port variants, absent routes
and park detail. Each side uses its own renderer with matching crops. Numerical
reports include capacity, core/outer counts, glyph coverage, geometric and painted
neighbourhood coverage, alley and street-run counts, timing, SVG and gzip sizes.
Core/outer counts use `patch.zone === 'core'`; `withinCity` also includes built
outer wards and is not a valid core classifier.

Fixed seed 2, with the three supplied review approaches:

| Population | Before buildings | After buildings | Building target | Before / after glyphs |
| ---: | ---: | ---: | ---: | ---: |
| 2,500 | 312 | 334 | 334 | 198 / 244 |
| 10,000 | 953 | 953 | 953 | 609 / 760 |
| 50,000 | 3,902 | 4,167 | 4,167 | 2,630 / 3,277 |
| 250,000 | 7,777 | 18,335 | 20,833 | 5,363 / 15,802 |

All 38 city cases retain or increase their ordinary-building counts, with one
ordinary house family and one temple. Both 1,000-population village controls are
byte-identical. Estimated neighbourhood paint coverage improves in 36 of 38:
fixed 10k rises from 53.2% to 59.5%, and fixed 250k from 51.8% to 64.4%.
The two exceptions are held-out seed 102 at 1,001 (56.0% to 53.4%) and 1,200
(58.0% to 52.9%): they gain buildings and meet their count targets, but retain
less painted mass. Their images remain in the review panel.

The 250k shortfall is 2,498 buildings at fixed seed 2; the held-out seed 102
produces 16,677 against 20,833, short by 4,156. The generator reports both rather
than claiming full housing. At fixed seed 2, core/outer counts change from
1,596 / 6,181 to 839 / 17,496: the capped core no longer absorbs the excess
density request. The final local review measured about 2,149 ms before and
688 ms after; held-out measured 1,974 ms and 568 ms. These are individual runs,
not statistical or browser performance guarantees.

SVG size grows with the represented city: the fixed
250k output is about 6,148 KiB (752 KiB gzip), versus 2,703 KiB (501 KiB gzip)
before. The held-out output is about 5,618 KiB (699 KiB gzip).

```sh
npm run review:cities -- --baseline-module output/city-review/block-baseline.mjs --out output/city-review/blocks
npm run review:cities -- --baseline-module output/city-review/block-baseline.mjs --held-out --out output/city-review/blocks-held-out
npm run build
npm run typecheck:scripts
npm run build:lib
npm test -- --maxWorkers=2
```

Generated galleries and the baseline bundle are local, Git-ignored review assets.
New tests cover disjoint/contained lots, actual frontage, connected service lanes,
quota merging with retained area, contiguous runs, water strips/ponds/islands,
shared capacity metadata and routed versus route-constrained metropolis supply.
Existing envelope, zoom, capacity, core texture, POI and village checks remain.
