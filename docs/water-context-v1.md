# Water context v1 — implementation contract

Supported by both physical development presets through direct generation and
compressed URL input. This is the contract for coverage, precision, precedence
and diagnostics. All input and output geometry uses local metres.

The hosted renderer is a separate deployment. A host must display the library's
errors and warnings and verify the deployed version before enabling measured
inputs. See the [URL adapter contract](url-api.md) and [library API](api.md).

## Scope and wire format

The shared site reader serves village and city layouts. Supply sufficient survey
coverage for the planning area. Add `waterContext` to `AzgaarBurgInput` in a direct
library call or compressed `i=` payload. URL envelope version 1 is independent of
the water object's version discriminator. Older releases supported this contract
only for villages; verify the deployed generator when sharing measured inputs.

```ts
type WaterContextV1 =
  | {
      version: 1;
      status: 'measured';
      coordinateSpace: 'burg-local-metres';
      surveyRadiusM: number;
      geometryErrorM: number; // map geometry approximation error, <= 0.5 m; not modelled river-width accuracy
      omittedRivers?: Array<{ riverId?: string; reason: 'local-width-unavailable' }>;
      bodies: Array<{
        featureId?: string; // actual water feature, not the adjacent land feature
        kind: 'ocean' | 'lake';
        distanceM: number;
        bearingDeg: number;
        polygonIndices?: number[]; // indices into coastlineGeometry for this body
        coastApproximation?: 'simple-local-coast'; // explicit opt-in; ocean only
      }>;
    }
  | {
      version: 1;
      status: 'unknown-units';
      sourceUnit: string;
    };
```

Origin is the **burg's actual position**, not its containing cell centre.
Positive x is east, positive y is south; bearings are clockwise from north.
`distanceM` is the shortest horizontal distance to a real shoreline segment;
`bearingDeg` points from the burg to that same closest shoreline point.
At exactly zero distance, use the local seaward/waterward normal as the bearing.
Distances must be finite and nonnegative; bearings must be finite in `[0, 360)`;
the measured survey radius must be finite and at least 3000 m. Unknown versions,
malformed objects and unsupported coordinate spaces are errors, not legacy input.
`geometryErrorM` must be finite, nonnegative and no greater than 0.5 m. It describes
approximation of the authoritative map boundary, not the real-world survey
accuracy of that boundary. `coastApproximation` is invalid for a lake.
For rivers with `widthSource: 'fmg-local-width-model'`, this budget applies to
the exported FMG source course (polyline for older payloads, or the declared
interpolated course for newer payloads),
not agreement with the painted river boundary, its visual midline, or the
accuracy of the estimated widths and resulting banks.
Such inputs produce an `approximate` result and a
`water-river-width-modelled` warning even when their ocean/lake boundaries are measured.

When polygons are supplied, `polygonIndices` associates a body's summary with
its own polygons. This avoids comparing an ocean distance with a nearby river
bank. Indices must be distinct nonnegative integers within the polygon array;
one polygon index belongs to at most one ocean/lake body. Include references
for each reported body intersecting the surveyed disc; a missing reference is a
`water-context-conflict`. Farther bodies can omit references. Unreferenced water
polygons remain authoritative geometry (for example, a legacy river polygon),
but must not be used to validate an unrelated ocean/lake summary.

Feature summaries do not claim to describe a whole lake shape. Existing
`coastlineGeometry` supplies filled polygons; `rivers` supplies river courses and
widths. Both layouts consume these in burg-local metres.

## 1. Coverage without knowing the final frame

**The minimum survey radius is 3000 metres**, centred on the burg. The updated
FMG sender starts with 3000 metres for villages and 4000 metres for cities.
These defaults are not a guarantee of coverage for every seed or layout. A caller
may explicitly request a larger radius; the consumer reports required coverage.

FMG must identify every ocean/lake water area intersecting that disc, including
any body containing the burg. `bodies: []` means none intersects it. Distance to
a water-cell centre is not a valid inclusion/exclusion test. Use actual feature
boundaries/intersection tests. If the burg itself is in water, explicit water polygons are required; a
land-origin distance/bearing approximation is not sufficient. Bodies farther
away may be listed as additional context, but their presence does not enlarge the survey or the rendered frame.

### Authoritative geometry and precision

FMG must derive inclusion, distance, bearing and exported polygons from **the
same authoritative shoreline representation used to display/save the map**.
That representation includes coastline smoothing, seeded detail and rounding;
it is not interchangeable with raw packed-cell/Voronoi edges. Hidden layers
still have geographic geometry. Use a shared geometry service, not the presence
of currently visible SVG elements, as the source for both display and export.

For a loaded map, retain the saved displayed boundary as authoritative until an
explicit geometry edit/regeneration replaces it. Do not silently regenerate a
different shore just to export a burg. If unrounded curves become authoritative
in a later FMG change, display, save and export must all adopt them together.

Flatten curves adaptively with a physical error bound in metres. Allocate the
reported `geometryErrorM` budget across flattening, simplification, Boolean
operations and final coordinate rounding; the combined maximum boundary deviation
within coverage must remain <= 0.5 m and preserve topology. Fixed subdivisions
per curve are not an error bound. Perform survey intersection tests on the curves
or conservatively against their bounded approximation: an arc can enter the survey
disc even when its endpoints and control-cell centres are outside it.

Calculate scalar summaries from the **final serialized geometry's true shoreline**
where supplied, using its same body associations. For summaries whose real shore
lies outside the exported coverage, measure the same canonical full boundary;
do not compare that value against an artificial crop edge. The 1 m conflict
tolerance is only an internal payload-consistency check. It does not claim that
FMG's underlying fantasy-map coast is positioned to metre accuracy. For Borteland,
a 0.1-map-unit coordinate rounding step corresponds to 482.8 m; mixing rounded
and unrounded sources cannot be repaired by treating the difference as noise.

Use stable feature/polygon ordering. Cache the shared boundary and its spatial
index, invalidating them on map load, coastline edits, coastline-generation
settings changes and relevant geometry changes. Do not rescan every world feature
independently for every burg export.

### Filled water versus real shores

For a geometry-backed survey, FMG supplies the complete union of ocean/lake water
inside the survey disc in `coastlineGeometry`. It may include full feature rings
or clip them against the surrounding square `[-R, R] × [-R, R]`, where
`R = surveyRadiusM`. That square encloses the disc. Preserve islands/land when
constructing the water union; do not encode holes as additional filled water
rings. The existing polygon format does not interpret rings as holes. Decompose
water around land holes into simple filled pieces when needed.

Settlemaker must preserve the **filled union** for water classification and use
its **exposed real shoreline** for shoreline strokes, nearest-bank/distance
queries, road setbacks, bridge landfalls, shore walks and dock placement. Filling
each simple piece is permitted only if the raster result has no gaps; stroking
each piece separately is not. Dissolve shared/overlapping internal boundaries
or preserve equivalent boundary provenance through geometry operations. Retain
land islands as holes in the resulting union. Body-specific summary checks use
exposed boundary segments attributable to that body's `polygonIndices`; internal
piece edges and edges hidden under other water are not shores. Do not match a
body summary to an unrelated river bank.

The declared survey-square closure is artificial even where it is exposed in
the clipped union. Exclude it from every real-bank query; do not just hide its
stroke. FMG must clip at the declared square when using this cropping convention,
not at arbitrary unmarked interior edges. A body covering the entire survey can
have no real shoreline within coverage. It still fills the region with water;
its crop must not become an apparent nearby coast, and the burg origin must not
be moved to manufacture a land site. A burg strictly inside water fails with
`water-context-conflict`; a burg exactly on a real shore is permitted.

These rules apply also where river-mouth polygons overlap ocean polygons. All
water must be combined consistently for physical bank queries; a seam between
water sources must not become a bridge endpoint or a road setback obstacle.

Settlemaker's responsibilities in measured mode:

1. Bound water-dependent planning to the surveyed disc, including any detour or
   apron search. Do not infer dry ground outside it from absent polygons.
2. Keep every final frame corner within `surveyRadiusM - 1000` metres of the
   original burg origin. This leaves a 1 km planning/geometry margin; it does not
   set a minimum frame size or pull distant water into view. Artificial polygon
   closure along the survey square stays outside the frame and margin.
3. Validate the actual frame and planning bounds at runtime. If they cannot fit,
   return `water-coverage-exceeded` with `requiredSurveyRadiusM`, rounded up to
   the next 1000 m and sufficient for the larger planning bound and frame margin.
   Do not silently crop occupied buildings, treat unsurveyed ground as land, or
   retry with a population-based coastline. Show the coverage error and required
   radius inside Settlemaker. A library caller or an explicit manual workflow can
   supply a larger survey and rebuild the URL. **FMG does not automatically
   resurvey in v1**; no preflight, iframe result transport or new endpoint is
   provided. See section 4 for the actual URL consumer's error behavior.

The current 112-case village review has a largest frame-corner radius of about
601 m. This supports a generous 3 km initial survey; it is not a proof that every
possible input fits. The runtime check is the guarantee.

`surveyRadiusM` describes coverage, never zoom level. A measured shoreline 11 km
away must remain off a normal hamlet tile.

## 2. Input precedence

Validate the mode first. Invalid/unknown-version contexts must not quietly fall
through to legacy behavior.

| Input | Required interpretation |
| --- | --- |
| `waterContext` absent | Existing contract unchanged: valid nonempty `coastlineGeometry`, otherwise legacy `oceanBearing` fallback. Existing `rivers` remain additive. |
| `status: 'unknown-units'` | Suppress geographic ocean/lake fallback and report `water-units-unknown`. Do not pretend a physical survey occurred. Reject simultaneous metre-valued `coastlineGeometry` or `rivers` in this mode; a sender with a real conversion must use `measured`. |
| Measured context **and `coastlineGeometry` property present** | Those polygons are authoritative ocean/lake geometry for the survey. `[]` explicitly means no ocean/lake water in the surveyed disc. Never generate additional shores from body summaries or legacy bearings. |
| Measured context, polygon property omitted, `bodies: []` | Authoritatively no ocean/lake within the surveyed disc. Suppress `oceanBearing`; do not invent water outside the survey. |
| Measured context, polygon property omitted, one relevant ocean summary explicitly declaring `coastApproximation: "simple-local-coast"` and satisfying the eligibility rules below | Generate an approximate shoreline anchored at its measured nearest point/distance. No population-derived shore standoff. Mark the result `approximate`. |
| Measured context, polygon property omitted, any relevant lake, multiple bodies, complex coast, or ocean without the explicit eligible approximation declaration | Return `water-geometry-required`. Feature count alone cannot determine local shoreline topology. |

**Simple-coast eligibility is geometric, not a feature count.** FMG may declare
`simple-local-coast` only after inspecting the canonical coast across the survey:
there must be one simple open shoreline section, with the burg on land, one
landward side and one waterward side, and no nearby opposite shoreline. Islands,
peninsulas, multiple nearby shoreline sections, enclosed bays with opposing banks,
and other complex coast configurations require polygons even if they all belong
to one connected ocean feature. If FMG cannot establish eligibility, it sends
polygons; omission of the opt-in never authorizes guessing. Settlemaker validates
its structural prerequisites and relies on FMG's explicit geographic declaration.

For an accepted approximate coast, the global minimum distance to the **whole
generated shoreline**, including the interior of curved segments, must not be
less than the reported distance (apart from numerical tolerance <= 1 m). Checking
only the nearest-point anchor or sampled control vertices is insufficient. Seeded
detail must remain waterward of that constraint. Approximation can change the
shape of a simple coast, but cannot move water toward the burg.

A body whose nearest water is outside the bounded local planning area does not
need a generated shoreline. Omit its off-map geometry without changing the frame.

**Geometry beats scalar summaries.** If a polygon disagrees with its summary,
use the polygon without translation, scaling or a second generated shoreline,
and report `water-context-conflict`. Recompute visible-water and proximity facts
from the polygon. Differences within 1 m may be treated as numerical tolerance;
larger differences must be reported. A missing geometric feature in a purported
complete polygon survey is also a conflict, not permission to invent it.

`rivers` remain additive and are not erased by an empty **ocean/lake** survey.
Do not send a river twice through `rivers` and `coastlineGeometry`; include river
polygons in the latter only when that river is not also supplied as a survey.
`port` and `harbourSize` control infrastructure, never water visibility or distance.
A port without an accessible nearby real shoreline produces a nonfatal
`water-harbour-unavailable` and no dock/jetty placement. Keep water at its supplied
location; do not pull a coast inward to satisfy `port`. The explicit river-port
placement rule below may move the generated town within this coordinate frame.

Without measured context or supplied polygons, a direction-only city coast is
illustrative. Its generated shape is aligned with the physical city enclosure so
the waterfront is accessible at city housing density. For a large port, generated
headlands shelter about the inner half of the basin, forming a local inlet around
the working quay. The city is then laid out against that shoreline, including
its walls, access and buildings.
This adjustment never moves supplied polygons, measured shores or independent
rivers. Direction alone cannot reproduce FMG's displayed coastline.

### Harbour infrastructure

Physical cities reserve a harbour before neighbouring buildings and streets are
generated. `harbourWaterKind?: 'ocean' | 'lake' | 'river'` identifies the port's
adjacent water body; it does not add water or move the shoreline. FMG obtains
this from the haven's feature, falling back to the local river where applicable.
For river ports FMG also sends `harbourRiverId`, matching `rivers[].id`, from the
burg cell's river association. A downstream lake used as the port's navigation
feature does not replace that local river association.

### Riverfront town placement

FMG's coarse cell relationships can be supplied independently of port status:
`waterfront: { riverId?, shoreKind?: 'ocean' | 'lake', shoreFeatureId? }`.
A river in the burg cell or an adjacent cell means a waterfront settlement;
a coastal cell means housing belongs beside that shore. When both are supplied,
the local plan connects its associated river to its shore. This applies to both
physical layouts, including non-port villages. `port` still requests working
harbour infrastructure rather than controlling waterfront geography.

This is an explicit inference contract. The generator brings the selected
shore and river close to the local settlement origin, retaining source identity
and the upstream width profile. Regional river courses may receive local bends
at settlement scale. A coastal river may be rotated toward its mouth, extended
to the shore, and widened into a smooth estuary. These inferred banks become
physical water before roads, harbours and buildings are planned. Where a curved
coast needs different joins on each bank, local bank polygons round the mouth;
these derived polygons stay internal and do not change the transport format.
It does not claim that the cartographic marker's kilometre-scale offset is a
precise settlement location. Source inputs are not mutated;
`waterContextResult.status` is `approximate`, with `water-frontage-inferred` and
`adjustments` recording source IDs, translations and optional rotations.
River adjustments also report `courseRefined` and `mouthFlared` when local
shaping goes beyond that translation and rotation.
Coast translation conservatively reduces available survey coverage, so FMG
exports extra coverage and an independently centred associated river reach.
Inputs without `waterfront` retain their exact-water behaviour below.

A physical city explicitly marked `port: true` and `harbourWaterKind: 'river'`
can move its generated centre toward its associated river bank. This corrects
cartographic burg-marker offsets: FMG nudges river burgs by up to 0.6 map units,
which can represent hundreds of metres at the selected map scale.

The planner uses `harbourRiverId` to choose the intended river. A single
unambiguous river can serve legacy callers without that identifier. A missing
named river or multiple ambiguous rivers must not cause attachment to a
different channel. The centre approaches an exposed bank on the original dry
side, with centre-to-bank spacing derived from the physical city enclosure.
Already-close towns keep their position; relocation must not cross other water.

The source burg remains `(0, 0)`. River courses, widths, water polygons and survey
coverage remain in that original frame. Only the generated town centre changes;
buildings, streets, harbour, rural housing and farmland are planned together at
the new location. Final survey coverage still checks distance from the original
burg, including the displaced landscape and navigation clearance.

`SettlementModel.placement`, session metadata and physical GeoJSON metadata
record `{ kind: 'riverfront', riverId?, offsetM: { x, y },
originalBankDistanceM, targetBankDistanceM }`. These are planning decisions,
not corrections to the supplied geographic measurements. A diagnostic reports
the displacement. Ordinary inland settlements and lake/ocean ports do not use
this riverfront relocation rule.

For a city with an associated river and an outer residential budget, the planner can reserve
a connected neighbourhood on the opposite bank before houses are placed.
Its road starts at an existing town gate, crosses one bounded river span with
dry landings, and continues into the reserved neighbourhood. The bridge span
uses a short crossing between the banks; dry approaches bend to meet it rather
than forcing the bridge to follow a diagonal mesh edge. Harbour working ground
and navigation space remain protected. Up to 70% of the outer district budget
and housing demand is reserved for this neighbourhood, subject to available
land. The bridge also carries urban access into its density calculation, so
the opposite bank can develop streets and a denser interior. Residents come
from the existing outer population allocation rather than being added to the
census, and explicit walled population targets are preserved. Crossing capacity
scales with population from 80 to 400 metres. Longer crossings still require
verified banks, dry approaches and a connected road; unsupported crossings do
not receive a decorative bridge or an invented ferry.

Farmland and rural houses share a dry-ground connectivity check. Water divides
the bounded countryside into components; only components connected to the town
by dry ground or an actual road bridge are accessible. A detached bridge symbol
does not establish access. Inaccessible existing farm buildings are excluded
before resident allocation, and new farmsteads and fields use the same rule.
Where no crossing fits, the opposite bank remains uncultivated.

Ocean and lake banks also attract connected residential growth along the
waterfront. Fishing and shore trade reduce the illustrated crop hinterland
without changing the census or building capacities. The remaining farm depth
favours the inland side, and a narrow shore strip stays clear of farm plots.
This is a landscape allocation rule, not a simulated food-production balance;
unclassified legacy water polygons do not imply a fishing economy.

### Quays and navigation

The planner fits a dry working quay, warehouse lots and connected cart access to
the available shoreline. A shoreline district outside the compact historic
core can host the harbour when a dry cart road connects it to an existing gate.
Failure to place that infrastructure produces `water-harbour-unavailable`, not
a claim that surveyed geography conflicts. A large open-water port receives a compact basin,
shore-connected enclosing arms, an offset entrance and a clear approach where
space permits. Basin depth follows berth and manoeuvring clearance; additional
empty water area is not a reason to extend the walls farther offshore.
An existing inlet can supply shelter. Lakes omit ocean breakwaters, and river
approaches follow the channel. Narrow sites can fall back to a landing with a
diagnostic instead of claiming a basin that does not fit. These are geometric
navigation checks; FMG does not supply water depth, wave exposure or tides.

The natural water polygons remain unchanged. Quays, breakwaters and short berths
are separate built structures. Roofed warehouse artwork, planking, masonry,
bollards, cranes and beacons distinguish their uses. The scene's optional
`layers.harbours` and physical GeoJSON expose the basin, entrance, approach,
structures and fixtures; piers link back through `harbour_id`.

Run `npm run build && node scripts/review-harbours.mjs` to regenerate close-up,
city and landscape SVG/PNG views plus physical GeoJSON in `output/harbour-review/`.
The fixtures include the original Tetlapan link and a measured coastal city whose
supplied geometry deliberately contradicts its legacy ocean bearing.

## 3. Physical units and cities

FMG performs exactly one world-to-metre conversion:

```text
metresPerMapUnit = distanceScale × kilometresPerSelectedUnit × 1000
localX = (worldX - burg.x) × metresPerMapUnit
localY = (worldY - burg.y) × metresPerMapUnit
```

Use the selected unit, not an assumed kilometre scale. For the supplied Borteland
save: `3 × 1.609344 × 1000 = 4828.032` metres per map unit. Apply this same factor
to coordinates and lengths actually measured in map units, including shore
distances, polygon coordinates and coordinate-derived local river-bank spacing.
Do not apply it to values already stored in physical units.

**FMG `River.width` is mouth width in kilometres.** Convert that scalar with
`widthM = River.width * 1000`, independent of the selected map distance unit or
scale. `RiverReading.widthKm` has the same physical-unit meaning. Neither value
establishes the river width beside an upstream burg. Prefer local bank geometry
from the authoritative river representation, transformed consistently into
metres. Changing the display unit must not rescale an already kilometre-valued
river width.

Do not substitute mouth width for a missing local width silently. A `rivers`
entry contains `centreline`, a positive `widthM` fallback and optional positive
`widthsM` values, one per centreline vertex. Widths interpolate between vertices;
use `meander: false` to preserve an already shaped source course. Variable-width
courses do not need to be split into separate channels. Alternatively supply
explicit filled river polygons, without duplicating the same river as a course.

FMG may evaluate its local flow-width model along the complete source course,
retaining cumulative flux and original point indices before clipping to the
survey. Export these estimates with `widthSource: 'fmg-local-width-model'`,
`meander: false`, and optionally an `id` identifying the source river. The model's
kilometre-valued result converts to metres independently of map distance units.
This does not turn the stylized width of FMG's drawn river into a measured bank
survey. Settlemaker reports `water-river-width-modelled` and marks the result
`approximate`; supplied coast geometry still retains its own precision contract.

`courseSource: 'fmg-catmull-rom-0.1'` identifies a course interpolated through
the complete edited/meandered source anchors using FMG's Catmull–Rom family
with alpha 0.1. The exporter constructs the curves before clipping so the survey
edge does not change their tangents. It adaptively flattens relevant curves in
metres and rounds coordinates within the declared geometry error budget.
Local widths interpolate between the original anchor stations. The consumer
preserves this already shaped course rather than introducing new random bends.
FMG's painted bank outlines are separately offset and rounded; this provenance
does not claim their stylized thickness as physical river width.

If only mouth width is available, omit the unsupported local survey and
show a nonfatal `water-river-local-width-unavailable` warning inside Settlemaker.
FMG communicates that omission through optional `waterContext.omittedRivers`,
an array of `{ riverId?: string, reason: 'local-width-unavailable' }`. This is
not a declaration that the surrounding region has no river. Mouth-width-only
rendering, if introduced later, needs an explicit approximation contract.

For a custom unit, FMG must have a positive, explicit metres-per-unit conversion.
If none exists, send `status: 'unknown-units'` with its label. Omit metric geometry
and distance assertions. This is neither a zero-distance shore nor an empty
measured survey. Settlemaker must display the units diagnostic itself so the
iframe user can see why geographic water is unavailable. Do not silently assume custom units
are kilometres. Audit each measurement by its source unit; kilometre-valued
context windows and corridor distances also need the selected-unit conversion
when their underlying measurements were made in map coordinates.

**City scaling is owned by Settlemaker, not guessed by FMG.** Both physical
layouts accept metre-valued water context. The block layout uses a fixed
3 metres per mesh unit internally, then returns water, buildings, roads and
frame in metres. A viewBox, SVG pixel scale, Voronoi radius or `urbanDensity`
is not that conversion. Both layouts remain subject to survey coverage checks.

The updated FMG exporter permits measured villages and cities through an opted-in
renderer URL. Deploy the supporting consumer before enabling that sender; a
direction-only city URL does not gain geographic accuracy merely because the
consumer now supports measured cities. Existing shared URLs keep their original
payload and need regeneration in FMG to carry actual coastal geometry.

## 4. Output, transport and rollout requirements

**V1 remains URL-only. There is no automatic FMG resurvey or recovery.** FMG
cannot read a cross-origin iframe's library result. Do not depend on iframe DOM
access, polling its JavaScript, or a result listener that has not been specified.
No `postMessage` protocol is introduced by this contract.

Settlemaker must display errors and nonfatal warnings visibly **inside both the
embedded preview and the external-open page**. Errors replace the failed map;
nonfatal warnings accompany the rendered map. They must be readable on initial
load without hover, clicking or other iframe interaction: FMG's preview can have
pointer events disabled. Coverage errors include the required survey radius in
the visible explanation. Unknown units and omitted local river widths must be
identified as unavailable data, not presented as a verified dry landscape.

Also expose a machine-readable `waterContextResult` through the library generation
result for direct consumers and Settlemaker's own UI:

```ts
interface WaterContextResult {
  version: 1;
  status: 'measured' | 'approximate' | 'unknown-units' | 'error';
  issues: Array<{
    code: 'water-coverage-exceeded' | 'water-geometry-required'
      | 'water-context-conflict' | 'water-units-unknown'
      | 'water-context-unsupported-engine' | 'water-context-invalid'
      | 'water-river-local-width-unavailable';
    requiredSurveyRadiusM?: number;
  }>;
}
```

`approximate` identifies a measured-distance ocean without explicit bank polygons.
A geometry conflict is an issue on a geometry-backed result, not permission to
switch modes. Coverage, required-geometry and invalid-context
errors do not return a falsely complete rendered map. Legacy input omits this
new result entirely. Fatal errors throw `WaterContextError`, carrying this result on
`error.waterContextResult`. Successful `generateSettlement` calls expose it as
`result.model.waterContextResult`. It does
not introduce an iframe message protocol or an HTTP API.

The host must preserve `waterContext` when building links. If compression is
unavailable or the encoded payload exceeds the URL budget, do **not** fall back
to a flat URL that drops measured/unknown state and restores `oceanBearing`.
Simplify polygons within the declared physical error budget without changing
local water topology or closing narrow channels, recompute summaries from the
final serialized boundary, and revalidate coverage/precision/URL size; otherwise report
that the measured preview cannot be encoded. The existing flat tier has no
representation for this mode.

Roll out in this order:

1. Implement and test the Settlemaker decoder, water preparation, bounded planning,
   precedence, canonical/union-boundary queries, precision, visible diagnostics
   and output semantics described here.
2. Publish/pin a release explicitly supporting **water-context v1 for both physical layouts**.
3. Enable FMG's measured payload against that release. Verify both preview
   and external-open URLs for city and village layouts.

Older decoders ignore unrecognized fields; therefore merely adding this object
to an older deployed renderer's URL is **not** a compatibility check. Do not enable the FMG
sender before the supporting renderer is deployed.

## 5. Shared acceptance fixtures

Both implementations must test:

- Tarrimas-Ha: approximately 11,115 m to sea → no sea in the hamlet frame, with
  either an empty complete 3 km survey or that distant body listed additionally.
- Same burg with a 40 m shore → visible water at that physical location.
- A nearby portless beach → water without invented harbour infrastructure.
- Nearby finite lake geometry versus a distant lake in the FMG neighbourhood.
- Equivalent maps in km, miles and nautical miles; custom units with and without
  an explicit conversion.
- Measured empty survey plus legacy bearing → no generated sea.
- Explicit polygon, omitted polygons and explicit `[]` as separate cases; polygon
  versus summary conflict → polygon retained with a conflict issue.
- Ocean/lake emptiness does not erase an independently supplied river.
- Survey too small for the protocol, and a valid survey exceeded by actual layout
  or planning → explicit errors, never a falsely dry region.
- Measured lake without sufficient geometry → `water-geometry-required`.
- Measured context on both layouts → metre-based geometry and shared coverage checks.
- URL-budget/compression fallback cannot discard measured or unknown state.
- No-context URLs retain existing compatibility behavior.
- Real iframe and external-open flows for coverage errors, unknown units, geometry
  conflicts and missing local river width: diagnostics visible without pointer
  interaction; no implicit automatic resurvey. Library-only tests do not satisfy
  this acceptance case.
- A curve with endpoints outside the survey but an interior arc entering it;
  hidden coastlines, coastline edits/settings changes and an old loaded save.
  Measurement and polygon export use the same displayed/saved geometry, within
  the declared approximation budget after final serialization.
- An island surrounded by one ocean decomposed into filled pieces, a lake with an
  island, overlapping river-mouth/ocean polygons, and water covering the entire
  survey: no filled land island, internal stroke, crop-edge bank, false bridge
  landfall or relocation of the burg origin.
- Peninsula and island cases with one ocean feature but multiple local shores
  require polygons. Missing simple-coast opt-in fails; an eligible approximation
  satisfies its minimum-distance bound along the whole generated curve.
- An upstream burg with a much wider river mouth: local geometry controls local
  width. Converting kilometre-valued mouth width uses only `* 1000`; changing
  display units does not change the value. Unavailable local width is reported.
- `port` with no accessible nearby shore: nonfatal conflict, no invented docks.
- Automatic population 1000 versus 1001, explicitly selected larger villages and
  smaller cities, malformed body/polygon references, and a URL
  simplification attempt that would close a narrow land neck or water channel.
