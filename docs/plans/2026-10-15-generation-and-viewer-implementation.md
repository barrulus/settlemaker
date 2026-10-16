# Generation and viewer implementation review

Implementation of the [approved design](2026-10-15-generation-and-viewer-design.md), 15 October 2026. This is a local paired engine/client change, not a published release. Physical planning remains an explicit preview; existing URLs keep their legacy generation mode.

## Implemented behaviour

Physical city outskirts retain normal building dimensions. Deterministic terrace, workshop, garden and croft neighbourhoods vary arrangements and spacing. Commons are reserved before housing, targeting 4% of eligible suburban area with bounded whole-district overshoot. Selection favours underserved land and approach access; its distance measure is a district-centre proxy, not a pedestrian-network calculation. Natural and public green areas remain distinguishable from private gardens.

`development.ruralPopulation` is an optional count within the requested total, defaults to zero and cannot borrow from `corePopulation`. Existing farms are adopted before new rural housing is allocated. Rural clusters reuse frontage, artwork fitting, collision and access helpers. Final landscape road extension respects occupied land, water at the full road width, protected greens, piers and walls. Residents and district roles survive export; urban/rural and inside/outside-wall accounts are separate.

The engine owns `createSettlementSession`: one retained model, metadata, reusable spatial index, viewport rendering, full SVG and on-demand GeoJSON. Legacy city generation now has one model-only helper shared with its existing public entry point. Legacy village rendering retains its full-vector fallback. Session metadata declares coordinate units, planner, seed, diagnostics and source identity. Custom artwork without measured bounds takes a conservative rendering path.

The client owns one viewer runtime used by the builder and `/fmg`: a persistent generation worker, latest-request scheduling, atomic map/export acceptance, cancellation/retry, and an explicit synchronous fallback. A source digest and protocol handshake check the actual separately loaded engine bundle. Appearance changes reuse generation. Both entry points share planner parsing and appearance validation, and derive their wire types from engine exports.

The camera updates CSS transforms once per animation frame. Filtered SVG artwork becomes guttered raster tiles over an overview, with a 32 or 64 MiB decoded-raster cache budget. All visible tiles fit the chosen resolution and swap together; optional prefetch does not delay visible readiness. Old accepted artwork remains usable during generation. Uncached detail pauses while the single worker is generating. Repeated zoom-button clicks no longer bubble into background double-click zoom.

Exports retain full artwork independently of the camera. Chromium prepares the export document lazily and creates full-resolution native-print content on demand; other browsers retain the established preload path. Complete water/wall structures and legacy villages use conservative fallbacks rather than incomplete viewport output.

## Shared ownership

- `src/output/legacy-model.ts`: common legacy model preparation, including coastal retries.
- `src/scene/spatial-index.ts`: shared painted-bounds rules for indexed and linear filtering; full-frame one-shot rendering avoids unnecessary index construction.
- `src/geom/bounds.ts` and `src/geom/road-corridor.ts`: shared bounds and physical road-clearance geometry.
- Existing frontage, ward, artwork, resident and SVG helpers remain authoritative. Mutable placement grids and immutable display indexes retain different lifecycles.
- `src/settlement/quality.ts`: one offline ground classifier used by both generation benchmark and visual-review scripts.
- Client `site/src/viewer`, `planner.ts` and `appearance.ts`: shared lifecycle, rendering, camera and input helpers for both pages.

## Reproducible checks

Engine baseline: `89859eab47100cdd42c484820338c9a22d5efc36`. Client baseline: `5fc1e990988ee9260eb58b8917025b7f405be118`; its previous engine pin was `5160d59ba5b2475f97ccbe7b1eebbd0e51912052` (2.6.0). These are different baselines: the original legacy browser probe does not measure physical-planner generation.

```sh
npm test -- --maxWorkers=4
npm run docs:check
npm run typecheck:scripts
npm run benchmark:generation -- --output output/generation-benchmark.json
```

`scripts/benchmark-generation.mjs --engine /path/to/baseline.mjs` runs exactly the same physical fixture matrix against a separately built baseline. Results record runtime, machine, source/artifact identity, fixed inputs and seed, stage timings, resident accounting and footprint/ground measures. Each fixture is a single run, not a latency percentile; keep other CPU-intensive work stopped during comparisons.

In the client checkout, build the engine library, build `site`, run `npm run merge`, then:

```sh
node scripts/review-browser.mjs --playwright /path/to/playwright/index.mjs --executable /path/to/chromium
node scripts/review-browser.mjs --playwright /path/to/playwright/index.mjs --executable /path/to/chromium --dpr 2 --quick --output output/browser-review-dpr2
```

The production browser harness checks the actual worker/library path, builder and `/fmg`, legacy and physical layouts, rural demand, cache bounds, coherent detail completion, gesture frames, cold print preparation, and tile parity including large custom shadows. It records detail latency separately from acceptance and gesture timing. Print checks exercise `beforeprint` resources and the full-resolution canvas; they do not automate a system print dialog.

## Interpretation and remaining calibration

The clean engine suite passed **143 files / 1,532 tests** with four Vitest workers. An unrestricted-concurrency run passed its tests but reported two runner RPC timeouts; it was repeated successfully. Documentation checks passed 20 public pages, 186 local links/anchors, 12 gallery fixtures and executable Node/browser/TypeScript examples. Script type checking passed.

The final engine matrix contains 20 cases (seeds 2 and 7), including a 1,000-person village, 300–250,000-person cities and constrained coastal cities. Every case conserved demand with zero unassigned residents. Selected seed-2 timings on Linux 6.18.55, Node 24.21.0, Intel Core Ultra 9 275HX, source bundle `source-0cc40854d21c050fa3ba8996`:

| Physical city population | Baseline generation | Candidate generation | Baseline full SVG | Candidate full SVG | Candidate first crop / reused crop |
| --- | ---: | ---: | ---: | ---: | ---: |
| 2,000 | 81 ms | 76 ms | 18 ms | 19 ms | 73 / 5 ms |
| 10,000 | 306 ms | 226 ms | 48 ms | 41 ms | 105 / 7 ms |
| 50,000 | 940 ms | 701 ms | 171 ms | 129 ms | 264 / 10 ms |
| 200,000 | 3,311 ms | 2,847 ms | 762 ms | 489 ms | 973 / 8 ms |
| 250,000 | 4,229 ms | 3,447 ms | 742 ms | 485 ms | 1,132 / 8 ms |

The first crop includes index construction. A retained session pays this cost at creation; subsequent crops reuse it. Full-frame one-shot rendering avoids that index cost. These are sequential individual runs with different generated layouts, not a statistically established speedup. Offline area analysis is reported separately and does not run during interactive generation. Local raw evidence is under `output/generation-viewer-review/` (ignored); both harnesses are committed for reproduction.

The client passed **19 files / 140 tests** and its production build. A real Chromium development-mode smoke test accepted a physical 2,000-person city with one worker, eight visible tiles, no fallback and no failed local requests. It exposed a Vite source-import query failure which was fixed; production retains its revision query and handshake.

Final production Chromium 155.0.8059.39 measurements, 1600 × 1000, DPR 1:

| Fixture | Accepted overview | Gesture p95 | Sharp refresh after zoom | Retained raster cache |
| --- | ---: | ---: | ---: | ---: |
| Legacy village 800 | 1,502 ms | 16.7 ms | Full SVG | Vector fallback |
| Legacy city 100k | 922 ms | 16.7 ms | 2,308 ms | 52.9 MiB |
| Physical city 2k | 688 ms | 16.8 ms | 843 ms | 42.4 MiB |
| Physical city 200k | 4,907 ms | 16.8 ms | 1,427 ms | 43.0 MiB |
| Physical 10k, rural 1k | 771 ms | 16.7 ms | 1,206 ms | 40.0 MiB |

The visible-region readiness check waits for every visible tile, not an arbitrary screenshot delay. Retaining canvas tiles directly removed PNG encoding and re-decoding, reducing refresh from the previous 1,007 / 1,548 / 1,579 ms physical runs (2k / 200k / rural) to the table values. This still **misses the proposed 250 ms desktop sharp-refresh target**. Smooth camera gestures are achieved; instant sharp detail is not. A later renderer experiment should compare SVG decode/raster cost against a shared glyph atlas on these same scenes rather than claim the target already met.

Every production case started its worker, rendered detail without fallback (except the intentional legacy village vector path), stayed within its raster budget and prepared a nonblank 4096-pixel print canvas. Tile/reference comparison found materially different pixels below 0.002%, including large offset shadows. Full-image print preparation remains costly: the 200k case recorded a roughly 7.1-second print-time main-thread task. Before-print long tasks reached 518 ms on that case, so the 100 ms responsiveness target is not an established all-phases guarantee. Native print dialogs, Firefox, Safari and real mobile devices remain untested here.

The DPR 2 physical-2k production smoke also passed: 675 ms accepted overview, 16.7 ms gesture p95, 1,595 ms sharp refresh, 40 visible tiles and 63.4 MiB retained rasters, below the 64 MiB budget. It exercises the actual quantized-grid capacity calculation that prevents missing edge tiles at higher resolution.

Ground areas and residual components are deterministic sampling estimates with explicit sample count and spacing. Narrow features can be missed. Failed-placement area is `null` because rejected candidate geometry is not retained. Residual ground is not relabelled as park or assumed suitable for infill. The reviewed seed-2 core estimates were 65.5% footprint / 11.1% residual at 2,000 residents and 70.0% / 9.3% at 20,000. These are individual fixtures, not universal thresholds.

The existing core population cap and explicit core requests remain. This implementation does not claim a new globally optimised enclosure/infill solver, walking-network green accessibility, or a complete forestry simulation. The design's possible Canvas atlas/WebGL replacement remains conditional on measured need.

Browser timing is headless desktop Chromium on the recorded machine, without CPU throttling. Firefox, Safari and a constrained real device still need direct validation before changing compatibility defaults or claiming those performance budgets. The 250 ms sharp-refresh target is a target, distinct from smooth gesture animation. Cache accounting bounds decoded viewer rasters; it is not a measurement of the browser's total memory, worker model or retained export string.

## Follow-up: inhabited cores and countryside

The reported Aldford URL (population 3,400, seed 60891, three specified approaches) exposed geometry and artwork-selection defects, not viewer level-of-detail suppression. The legacy patriciate ward attempted corner artwork on every lot, concave blocks could fall back to sparse estates, and markets reserved entire districts. Markets now share the physical planner's compact court and occupied frontage helper, with paved courts represented in scene and GeoJSON output. The affected concave block increases from four to eighteen buildings. Aldford now uses 28 tenements, previously zero, while its residential budget stays 417/417. Narrow irregular endcaps can still use polygon roofs.

Physical cores now mix narrow attached houses with wider tenement sites. Dense artwork must fit its measured footprint at a substantial physical size; aggregate terrace artwork is not substituted for a single census building. Resident capacity and IDs retain their existing semantics. The reported physical 10,000-person fixture now contains 76 dense glyphs, previously zero.

Rural placement and landscape subdivision share one cultivation plan in `src/settlement/countryside.ts`. Farmsteads and compact hamlets branch from approaches within that region on short connected tracks. Homes and full-width tracks reserve ground before fields are accepted. The cultivated boundary has irregular lobes and indentations, rather than the previous coarse convex perimeter. Existing bounds, frontage, road-corridor, collision, field subdivision and artwork-fitting helpers are reused.

Large coarse field parcels receive bounded local subdivision only where farm homes or tracks intersect them. This avoids clearing broad lawns around the rural network; distant parcels keep their geometry, IDs, crop and furrow direction. The 200,000-person cases with 20,000 and 40,000 rural residents conserve their full demand and place 95% of new farm homes within approximately 25 and 26 metres of a field respectively. The smaller reported fixture places 95% within approximately 21 metres, compared with roughly 1.4 kilometres before correction. Regression checks cover complete building and track clearance, connected short tracks, coastal water, distribution across the cultivated region and unchanged distant parcels. An independent twelve-seed audit found no improper rural road crossings or house–field overlaps.

The reproducible visual check is `npm run review:generation-regressions -- --png`. Its `--engine` option accepts a baseline bundle; `--frames` reuses saved geographic bounds for honest comparisons. A separately labelled current-farm crop follows relocated farms at a fixed 440-metre width. SVG and JSON output do not require rasterisation. The physical generator revision is now `physical-layout-3`; the performance tables above describe the earlier implementation and are not timings for this correction.

The correction bundle is `source-08c377776a1c045bb0a72ec9`. All **145 engine files / 1,545 tests** passed cleanly with two workers. The four-worker run passed its assertions but reported a runner task-update RPC timeout, so it was repeated at lower concurrency. Script type checking, documentation checks, **19 client files / 140 tests**, and the actual client's production build passed. Local before/after artifacts and exact-input metrics are saved under `output/generation-correction-review/` (ignored).

## Follow-up: remaining plain city footprints

The population-1,200 Aldford report (seed 353956, local approaches 316/146 and
footpath 282) exposed further failures to fit usable tapered plots. A shared
contained-rectangle solver now allows a bounded translation after existing
centred artwork candidates fail. It preserves painted coverage and useful-size
limits, and checks the actual doorway route against neighbouring buildings,
water and the ward boundary. The same helper plans rectangular houses inside
acute end parcels before census allocation, with the remaining ground exported
as private yards. Regular parcels retain their footprints.

Physical narrow houses now retain ordinary depth and rear gardens while wide
tenement sites retain their deeper footprints. Physical corner replacements
require at least 16 square metres and a three-metre short side. Noncapital
administration blocks now receive the same row-house fallback as other blocks
that select residential architecture; named civic buildings and palaces retain
their dedicated forms. Geometry and fitting stay in the shared engine.

Fixed-frame full-detail comparisons show:

| Fixture | Plain footprints before | After | Total buildings after |
| --- | ---: | ---: | ---: |
| Aldford 1,200, seed 353956 | 46 | 7 | 216 |
| Aldford 3,400, seed 60891 | 67 | 18 | 449 |
| Physical 10,000, seed 2, core 5,000/rural 1,000 | 360 | 153 | 2,285 |

The physical central crop drops from 48 to 12 plain footprints. Plain footprint
area decreases approximately 84%, 75% and 71% respectively. Some unsuitable
footprints still retain polygon roofs. Both legacy cases preserve their exact
patch, ward and road topology and their residential budgets (203 and 417).
The physical case retains all 10,000 residents and the requested core/rural
split; available capacity falls from 13,112 to 13,104. Total roof footprint
area decreases approximately 2.4%, 1.1% and 5.0%, with explicit yard ground.
The physical generator revision is `physical-layout-4`.

Seven alternating warm session measurements during this correction measured
roughly 25→31 ms, 35→42 ms and 355→394 ms for these fixtures. These are local
generation timings, not browser interaction measurements; the physical timing
preceded the final administration artwork-only fallback. The extra geometric
work is bounded and leaves successful centred fits unchanged. The durable
review runner now includes the exact 1,200-person case, plain areas by ward and
a fixed crop around the largest concentration of plain footprints.

Validation: all **147 engine files / 1,556 tests** passed across a clean
145-file run and nine individually selected tests from the two longest village
files. The initial aggregate run exposed an outdated residential-only garden
assertion (now checks all wards and scene/export parity) and a Vitest task-update
RPC timeout. Splitting the long files avoided that runner error without changing
assertions or timeout settings. TypeScript, script typing, documentation checks,
**20 client files / 145 tests** and the production build passed. Chromium on the
actual port-5199 preview confirmed 7, 18 and 153 plain footprints, with no page
errors, diagnostic strip or rendering fallback. Vite was restarted to clear
retained engine modules. Final browser bundle: `source-7b24fd0b46b8dac5ac748a44`.
Local fixed-frame comparisons and browser evidence are in
`output/city-filler-review/` (ignored).


## Follow-up: wells and full-sized compound wings

City wells now convert their artwork dimensions using the completed city scale.
Their painted diameter in both Aldford cases is approximately 2.29 metres,
previously 7.2–7.4 metres. The existing courtyard reservation stays in place;
containment checks prevent a well from crossing its lot.

Inns and U-shaped houses now reserve a street-facing compound before ordinary
plots are subdivided. Their five or three wings are actual building footprints,
each with normal census capacity, access and identity. In the reported legacy
cities the wings are approximately seven metres wide, instead of fitting an
entire compound into a single-house plot with roughly 2.3-metre wings. Sites
that cannot accommodate the compound retain ordinary houses. If census trimming
removes a wing, the remaining buildings receive individual artwork.

The shared scene supports one symbol linked to several building IDs. SVG,
viewport queries, shadows and GeoJSON use those links; hiding compound artwork
restores all its underlying footprints. Authored compound vectors use the shared
roof helper with finer outlines, hatching and chimney details at this larger
scale. Other artwork is unchanged. Private paved courts are explicit ground,
and undersized remainder strips become yards rather than miniature houses.
The physical generator revision is `physical-layout-5`.


The final fixed-frame review retains exact legacy residential budgets of
203 and 417, and the physical case retains all 10,000 residents with core
5,000/rural 1,000. Full-detail plain footprint counts are 6, 18 and 153 for
Aldford 1,200, Aldford 3,400 and physical 10,000 respectively. Courtyard access
has explicit connected junctions; optional physical compounds are rejected
when they cannot preserve their district's housing request. This prevents
whole-city expansion merely to make room for a constrained courtyard. Wells
also receive a size-bounded shadow offset so their smaller shadow stays attached.

The reproducible review includes component-to-neighbour width ratios,
separate glyph-instance and represented-building counts, and fixed comparison
frames. Final bundle: `source-08b0d4f291576f7db8888b3a`. Local images and metrics
are saved under `output/city-scale-review/` (ignored).


## Follow-up: occupied land in the desert capital

The 5,000-person Aldford report (seed 271401, desert/ancient, capital, temple,
shanty, walls, and approaches 330/117/192/278) had a complete 556-building
ordinary budget but only 38.73% building-footprint coverage inside its walls.
The legacy radial character field still treated enclosed edge districts as
suburbs, shrinking roofs and using detached spacing. Enclosed city wards now
use the shared urban character value; areas outside the wall retain their
gradient. The quota coalescer also rejects merges with frontage-oriented aspect
ratios above 2.5, preventing shallow rows becoming oversized strip buildings.

Legacy temple and military wards now reuse the civic block planner: occupied
frontages surround a connected court, with larger sites for barracks. Temple
annexes use the existing residential artwork fallback while the principal
retains its dedicated form and physical size limits. Temple entrances must
reach beyond the painted front edge rather than point sideways along a tangent
alley. Civic geometry retains its existing census semantics.

On the exact reported map, enclosed building footprints rise to 53.75% of land;
ordinary district footprints rise from 45.55% to 64.75%. The two public parks
remain, covering 13.22% of enclosed land after street setbacks. The temple's
54 buildings and military district's 21 buildings all receive artwork. The
ordinary budget remains 556/556 (459 core and 97 outer), with median ordinary
footprint approximately 87 square metres. These are legacy scale estimates,
not a surveyed physical settlement.

The reproducible review now includes the exact capital URL and its ancient
palette, with `--fixture aldford-capital` for a focused run. Wall-clipped polygon
unions measure footprints and distinguish overlapping land claims from a
disjoint partition of buildings, streets, gardens, parks, paving and unclassified
ground. Artwork coverage is explicitly a roof-envelope proxy, not a raster ink
measurement. Boolean precision retries are reported rather than silently
omitting features. The shared physical generator revision is `physical-layout-6`.


A newly exposed farmhouse/street collision is checked against cached full-width
road corridors using the shared corridor helper. An obstructed house can try
four short translations within its original field, retaining its footprint and
random draws; moved houses must also clear complete claimed-site disks. This
preserves real housing supply without expanding the settlement merely to replace
a house that can safely move within its field.

Validation: the broad run passed 1,566 checks and exposed one physical
800-person density regression; the local farmhouse correction resolved it.
The affected city, physical, scene and rendering suites then passed 105 checks,
with four focused clearance/density checks and all nine fidelity checks passing
against the final source. TypeScript, script typing and documentation examples
also passed. Final source bundle: `source-7da7949f22b1f55b791bb108`.

### Managed park groves (16 October)

Removed the repeated curved ground marks from the shared green artwork and
regenerated all 60 standalone variants. City parks now plant biome-appropriate
shade trees after final geometry and metre scale are known. Public groves keep
open walks and central lawns; private garden ground and wilderness selection
remain separate. Shared measured-artwork bounds and fortification dimensions
keep complete crowns clear of roads, buildings, water, walls and towers.

Fixed-frame reviews of the reported desert capital, temperate 1200-person town
and physical 10000-person settlement preserve building census, resident totals,
park boundaries and paths exactly. Capital parks contain 176 and 162 trees,
with guarded canopy-envelope coverage of 38–42%; the temperate park has 19
trees and 32%. These are artwork-envelope proxies, not opaque leaf coverage.
No measured canopy envelopes cross park paths. The physical revision is now
`physical-layout-7`; final source bundle is `source-e161e035ae15c4526dc07918`.

Validation includes the park and neighbourhood checks, artwork/rendering and
shared appearance checks, physical population planning, all nine fidelity checks,
TypeScript and script typing, and documentation examples. The reviewed city SVG
pin changes; the legacy 800-person pin remains unchanged. Visual evidence lives
in the ignored `output/city-park-review/` review directory.

### Zoom sharpening work (16 October)

The reported slow zoom exposed serial SVG loading and rasterisation across the
entire visible tile grid. The web viewer now decodes adjacent missing tiles in
bounded 2×2 batches, retaining independent 512-pixel canvases. It uses one 60 ms
settling deadline and retains completed tiles still useful to a new camera
position without committing an obsolete view. The retained cache reserves
6 MiB for one decoded atlas and a pending crop within its existing allocation.

Shared viewport rendering omits offscreen wall decorations and towers while
keeping original wall paths, gate intervals and decorative spacing. Full SVG
exports remain unchanged. The reported desert capital's central tile drops
from 157 KB to 55 KB; 37 raster comparisons cover wall materials, gates, corners,
towers, shadows and adjacent crops without changing pixels.

Fixed Aldford browser samples at 1440×1000 CSS pixels retain the same tile counts
and backing resolution. Three standard-DPI zooms sharpen in 310/421/97 ms,
previously 667/650/240 ms; high-DPI samples take 565/553/180 ms, previously
1133/1238/670 ms. These are local Chromium measurements, not device-independent
latency guarantees. The web repository's `scripts/review-zoom-latency.mjs`
reproduces the inputs and records worker, SVG-load and canvas timings. The web
suite passes 155 checks, including stale work, pause/resume, atlas cleanup and
high-DPI memory allocation.
