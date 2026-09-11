# Next-agent brief: glyph-based towns and cities, population 1,001–250,000

Prepared 2026-09-10 against **v2.4.0 / b0a0613**. This is a handoff and proposed
implementation sequence, not an implemented city change. The owner has accepted
the village work and wants its visual quality extended to the city engine.

**Owner clarification:** discard phase 1 city artwork and use the village glyph
set for now. City-specific variations will be authored later. This supersedes
the asset-audit suggestion below to retain city-only phase 1 glyphs. See the
[first implementation report](2026-09-10-city-glyph-first-pass.md) for progress
and limitations.

Latest worktree state: [street-led blocks and explicit capacity](2026-09-10-city-block-layout-pass.md).
Its review compares against the accepted neighbourhood pass; the original
baseline numbers below are historical. Remaining large-city supply gaps are
reported in the model, scene and GeoJSON rather than hidden by occupancy changes.

## Outcome

Make ordinary urban buildings read as houses, terraces, shops, workshops and
larger civic/commercial structures using glyphs. Preserve recognisable city
structure: dense street fronts, alleys, courtyards, neighbourhoods, markets,
walls, gates, docks and development outside the walls. A metropolis should not
look like a larger detached-house village.

Polygons remain essential for parcels, collision, access and GeoJSON. The goal
is to replace plain building-polygon presentation with placed architectural
artwork, not to discard the geometric model or make roads/water into stamps.
At useful close zoom, ordinary buildings must have architectural detail;
painting only a few landmark glyphs does not satisfy the request.

**Protect the accepted village engine (≤1,000).** Keep the 1,000/1,001 routing
boundary, and test its visual continuity. Use a new implementation branch from
the release. This brief does not call for another production release now.

## Start here: what actually exists

| Responsibility | Files and implications |
|---|---|
| Engine selection | [`src/index.ts`](../../src/index.ts): `generateSettlement` selects the village through 1,000; above that it delegates to `generateFromBurg`. |
| City layout and census | [`model.ts`](../../src/generator/model.ts), [`generation-params.ts`](../../src/generator/generation-params.ts), [`azgaar-input.ts`](../../src/input/azgaar-input.ts): wards, core/sprawl split, density refinement, water rejection and budget trimming. `MAX_PATCHES` is 220; default people/building rises to 12. These are coupled scale/performance policies, not spare knobs to increase blindly. |
| Urban building geometry | [`wards/ward.ts`](../../src/wards/ward.ts), [`common-ward.ts`](../../src/wards/common-ward.ts) and its subclasses: lots are often emitted as whole building polygons to preserve dense rows. Centroid stamps will lose that density. |
| Existing glyph infrastructure | [`symbols.ts`](../../src/generator/symbols.ts), [`build-scene.ts`](../../src/scene/build-scene.ts), [`scene.ts`](../../src/scene/scene.ts), [`assemble-svg.ts`](../../src/output/assemble-svg.ts): placed symbols, glyph-backed footprints, separate shadows and overlays already exist. City wells/mills/marks are glyphs; ordinary city buildings are not. |
| Asset mismatch | [`asset-sets.ts`](../../src/assets/asset-sets.ts) returns `BATCH001_SET` for every biome. City assembly reads the old manifest. Villages use [`refined-manifest.ts`](../../src/assets/refined-manifest.ts), [`refined-glyphs.ts`](../../src/assets/refined-glyphs.ts) and [`village/glyphs.ts`](../../src/village/glyphs.ts). Audit IDs, anchors, materials, silhouettes and scale floors before switching sets. Preserve existing city-only symbols that the refined set lacks. |
| Output and identity | [`geojson-builder.ts`](../../src/output/geojson-builder.ts), [`scene-schema.md`](../scene-schema.md), [`settlement-tiler.ts`](../../src/output/settlement-tiler.ts): building IDs, POI references, origin shifts, frame bounds, tile scale and CSS groups are integration contracts. |

A specific rendering hazard: `assembleSvg` filters visible symbols by asset
availability and minimum scale, but `hideBacked` currently checks only that a
glyph collection exists. A replacement needs an explicit building-to-placement
association and may suppress the footprint only when that replacement will
actually render. Test missing assets, filtered symbols and `symbols: false`.

City coordinates are local mesh units; village placement uses metres. Establish
one explicit scale conversion before sharing footprint/clearance functions.
Do not import village metre constants directly into the city mesh.

## Lessons to carry forward

1. **Real frontage and painted dimensions drive placement.** Transparent SVG
   margins caused enormous apparent gaps in villages. Separate art box, painted
   roof/wall extent, collision footprint, road surface, reserved corridor and
   setback. The village `inkExtent` ratios are house/hut approximations, not
   universal measurements suitable for cathedrals or urban compounds.
2. **Choose architectural families before finalising capacity.** Fit coherent
   runs along actual street/alley edges, with bounded variation and shared
   orientation. Preserve party-wall terraces and block corners. Uniformly
   shrinking freestanding houses until they fit is not a dense-city solution.
   Use explicit multi-building/terrace modules or composed roof geometry where
   appropriate; retain identifiable constituent buildings and capacities.
3. **Grow or refine only for useful capacity/access.** Village empty-loop and
   coverage targets created excessive roads. Cities need serviceable blocks and
   secondary alleys, but new routes must earn their space. Retain the city's
   layout hierarchy rather than transplanting village trunk synthesis wholesale.
4. **Reserve landmarks at their actual footprint.** Inns belong on travelled
   frontage, gates or central streets; major religious/civic buildings need
   prominent central sites. Cities can have several neighbourhood centres.
   Keep civic squares and market streets; do not turn every ward into a village
   green. If using green motifs, triangles need three corner approaches, rounds
   terminate routes, and lenses widen a through street along its length.
5. **Water is geometry, not decoration.** Reject building footprints against
   full water geometry; roads cross only at explicit bridge sites. Audit city
   river/bridge support independently: the recent exact crossing/deck work is
   in the village engine. Preserve portless coastlines and legitimate docks.
   Do not claim wide-river city bridges are already solved.
6. **Biome resolution must reach ordinary homes.** Prefer an available native
   family before a temperate fallback. Tundra failed because the selected tiled
   house lacked an exact suffix, despite a snowy house family being available.
   Measure fallback counts across every building, not a single exemplar.
7. **Keep trials isolated and work bounded.** Candidate evaluation must use real
   capacity, collision and access; rejected trials cannot consume accepted RNG
   state or leave stale placements. City wards may regenerate during density
   refinement: retract/rebuild their symbols just as `tryPlaceWell` already does.
   Use deterministic local random streams and spatial indexes, not global
   all-pairs searches or a full-city rebuild for every proposed house.
8. **Compare images honestly.** Same input, seed, physical crop and scale;
   baseline uses its own renderer. Include whole cities, street-level crops,
   roads-only views and glyph/collision overlays. Increasing vertex sampling
   cannot count as smoother roads. Keep difficult and held-out cases visible.

## Upper-end scale: establish a policy, do not hide the shortfall

A small baseline probe on v2.4.0 produced the following. All five cases had zero
glyph-backed ordinary footprints and no degraded flags. This is one synthetic
seed per population, not a general performance or housing guarantee.

| Population | Ordinary-building budget | Ordinary polygons generated | Model symbols | Generation + SVG + GeoJSON, ms | SVG, KiB |
|---:|---:|---:|---:|---:|---:|
| 1,001 | 182 | 182 | 3 | 52 | 41 |
| 2,500 | 334 | 312 | 6 | 21 | 73 |
| 10,000 | 953 | 953 | 8 | 52 | 181 |
| 50,000 | 4,167 | 3,902 | 9 | 234 | 764 |
| 250,000 | 20,833 | 7,777 | 8 | 1,593 | 1,480 |

Reproduce with `generateSettlement`, name `City glyph baseline`, seed 2,
`biome: temperate`, `walls/plaza/temple: true`, all other required flags false,
default density/core capacity, and approaches `(18, main, a)`, `(142, town, b)`,
`(267, local, c)` as `(bearing_deg, kind, route_id)`. Ordinary counts exclude
castle, cathedral, market, harbour and park wards. Timings are sequential local
measurements, with module warm-up differences; they exclude browser layout/paint.

At 250k, do not report the budget as a housed census. Determine whether to seat
more structures, represent more households in suitable multi-storey/compound
buildings, or explicitly report capacity shortfall. Preserve `urbanDensity`
semantics; changing occupancy or using aggregate modules needs documented model
and output semantics. Never inflate occupancy simply to turn a failing check green.

Measure generation stages, heap, SVG/gzip size, element count, initial browser
paint and pan/zoom cost. Define measured budgets before the broad rollout. Reuse
one glyph definition per type with `<use>` instances; repeating full glyph markup
per house will balloon output. Consider deterministic district batching and
simplified roof detail at low zoom, while keeping useful zoomed-in glyph detail
and stable identity. Existing tests reaching 250k do not prove end-to-end quality
or interactive performance there. The village placement search already reached
seconds around population 900: do not scale its exhaustive trials to a metropolis.

## Proposed work sequence

1. **Baseline and asset audit.** Build a city review harness using the village
   runner's comparison approach. Inventory building families needed for dense
   rows, corners, workshops, warehouses, wealthy courts and landmarks. The
   refined manifest has houses/huts/longhouses/inns/faith/fortification pieces;
   it does not establish a complete terrace/shop/warehouse kit. Reuse suitable
   artwork and record gaps; author necessary assets as repository-native SVG.
   Read [`symbols/refined/integration.md`](../../symbols/refined/integration.md).
2. **One end-to-end urban neighbourhood.** At 2,500–10,000, prototype a dense
   craftsmen/merchant block with street-facing glyph placements, valid shared
   boundaries, alley access, one corner condition and coherent shadows. Keep
   parcels/building IDs in the model; render the same placements through scene
   and SVG. Compare real density and apparent spacing before expanding scope.
3. **Capacity and identity.** Make final ward generation, budget trimming,
   symbols, collision geometry and POI links agree. Add an explicit association
   between a building and its glyph/module. Derive scene and GeoJSON from that
   accepted state. Prefer additive metadata; bump scene/schema versions only
   for actual breaking changes. Prove polygon fallback and asset substitution.
4. **Ward/biome breadth.** Extend to slums, wealthy/civic areas, docks, landmarks
   and outer settlements with suitable families and densities. Keep palette
   changes separate from biome-dependent asset selection. Fill genuinely spare
   land with appropriate gardens, yards or vegetation after access is secured.
5. **Scale through 250k.** Validate 25k, 50k, 100k and 250k before declaring the
   architecture finished. Profile placement and browser rendering; solve the
   population-representation decision openly. Check coreCapacity and outer-city
   development rather than allowing the entire population inside enlarged walls.
6. **Review and handoff.** Deliver the fixed/held-out gallery, numerical report,
   limitations and reproduction commands. Update API, scene/output and asset
   documentation. Keep the current village gallery as a regression control.
   Release/version/web-pin work follows an accepted city implementation.

## Acceptance panel and checks

Use fixed seeds 1/2/3 and held-out 101/102/103, with a deliberate scenario matrix
rather than every possible Cartesian combination. Cover populations 1,000,
1,001, 1,200, 2,500, 5k, 10k, 25k, 50k, 100k and 250k. Include walled/unwalled,
core-capacity overrides, citadels, trade/temple flags, all five biome families,
port and portless coasts, curved rivers, constrained land, absent/empty routes,
and three-to-six irregular, close or bent-through approaches. Add captured FMG
payloads when available and label them separately from synthetic fixtures.

Measure glyph coverage by **building count and painted area**, asset/fallback
availability, density/capacity by core and outer city, overlap/containment,
occupied access, route-bearing/provenance preservation, water crossings,
landmark/POI identity, native biome usage and performance. Building count alone
cannot certify housed population; wards may contain businesses and civic uses.
A passed geometry suite alone cannot certify that the city looks good.

Retain meaningful existing tests: `building-budget`, `density-target`,
`core-capacity`, `ward-reachability`, `symbol-placement`, `assemble-symbols`,
`poi-symbol-coherence`, `scene`, `origin-shift`, `entrance-output`,
`geojson-schema-v4`, tiler and degraded-generation tests. Add regressions for
missing/too-small glyphs, regeneration removing stale symbols, exact footprint
fit, duplicate silhouettes and dense-city performance. Do not weaken overlap,
access or capacity checks to accommodate attractive pictures. Run the full
suite with bounded workers (`npm test -- --maxWorkers=2`) and the build/typecheck
commands after integration; use focused tests during each phase.

## FMG boundary and previous evidence

The owner controls the contract; a separate FMG agent implements that side.
Use [`url-api.md`](../url-api.md) and the [2.4.0 handoff](../releases/2.4.0.md).
Keep every actual inbound bearing. `through` is not a request for an invented
+180° exit. FMG land groups/classes are roads/{royal,main,market,town,local} and
trails/{trail,footpath}; sea feeder/coastal, air and trade networks are separate.
The city adapter currently reduces the seven land classes to road/foot legacy
kinds: preserving detailed class/role metadata for urban road widths needs an
explicit extension, not an assumption that village support reaches cities.
The village-only restriction to town/local/footpath interiors is not a blanket
rule for a capital's boulevards, market streets or other major urban routes.

Read the completed village evidence in this order:
[shared approach routing](2026-09-10-village-route-layout.md),
[water and biome fixes](2026-09-10-village-water-roofs.md),
[greens/landmarks/landscape](2026-09-10-village-followup.md), then
[housing-driven road results](2026-09-10-village-road-results.md).
Their early metrics and limitations describe intermediate revisions; v2.4.0 is
the reference for current behaviour. Keep `wireframe.png` (the owner's untracked
file) untouched. There is no city glyph implementation hidden in this brief.
