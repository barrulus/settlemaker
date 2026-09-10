# Water context v1 — implementation contract

**Status: specified for coordinated implementation; not implemented or deployed.**
This document resolves the survey, precedence and units questions raised during
review of [the Tarrimas-Ha investigation](plans/2026-09-10-water-distance-contract.md).
It is the normative target for that follow-up, not a claim that release 2.4.0
accepts these semantics. No generator behavior changes in this documentation PR.

## Scope and wire format

The first implementation serves **villages, population 1–1000**. Add `waterContext`
to `AzgaarBurgInput` in the compressed `i=` payload. The enclosing URL payload
version remains `1`; the new object has its own version discriminator.

```ts
type WaterContextV1 =
  | {
      version: 1;
      status: 'measured';
      coordinateSpace: 'burg-local-metres';
      surveyRadiusM: number;
      bodies: Array<{
        featureId?: string; // actual water feature, not the adjacent land feature
        kind: 'ocean' | 'lake';
        distanceM: number;
        bearingDeg: number;
        polygonIndices?: number[]; // indices into coastlineGeometry for this body
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

When polygons are supplied, `polygonIndices` associates a body's summary with
its own polygons. This avoids comparing an ocean distance with a nearby river
bank. Indices must be distinct nonnegative integers within the polygon array;
one polygon index belongs to at most one ocean/lake body. Include references
for each reported body intersecting the surveyed disc; a missing reference is a
`water-context-conflict`. Farther bodies can omit references. Unreferenced water
polygons remain authoritative geometry (for example, a legacy river polygon),
but must not be used to validate an unrelated ocean/lake summary.

Feature summaries do not claim to describe a whole lake shape. Existing
`coastlineGeometry` supplies filled polygons; existing `rivers` supplies village
river surveys. In measured village mode both remain burg-local metres.

## 1. Coverage without knowing the final frame

**FMG's default survey radius is 3000 metres**, centred on the burg. This is an
explicit protocol requirement, independent of population-based layout heuristics,
seed, harbour cells and FMG's grid spacing. A caller may survey a larger radius.

FMG must identify every ocean/lake water area intersecting that disc, including
any body containing the burg. `bodies: []` means none intersects it. Distance to
a water-cell centre is not a valid inclusion/exclusion test. Use actual feature
boundaries/intersection tests. If the burg itself is in water, explicit water polygons are required; a
land-origin distance/bearing approximation is not sufficient. Bodies farther
away may be listed as additional context, but their presence does not enlarge the survey or the rendered frame.

For a geometry-backed survey, FMG supplies the complete union of ocean/lake water
inside the survey disc in `coastlineGeometry`. It may include full feature rings
or clip them against the surrounding square `[-R, R] × [-R, R]`, where
`R = surveyRadiusM`. That square encloses the disc. Preserve islands/land when
constructing the water union; do not encode holes as additional filled water
rings. The existing polygon format does not interpret rings as holes.

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
   retry with a population-based coastline. The host can resurvey and rebuild the
   URL; no preflight request or new network endpoint is required.

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
| Measured context, polygon property omitted, one relevant ocean summary | Generate an approximate shoreline anchored at its measured nearest point/distance. Seeded detail must not bring water closer than that distance. No population-derived shore standoff. |
| Measured context, polygon property omitted, a lake or multiple bodies potentially relevant to the frame/planning margin | Return `water-geometry-required`. A direction and distance do not determine lake extent, opposite banks, or multiple overlapping shores. |

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
Conflicting port/shore facts are reported rather than relocating the coast.

## 3. Physical units and cities

FMG performs exactly one world-to-metre conversion:

```text
metresPerMapUnit = distanceScale × kilometresPerSelectedUnit × 1000
localX = (worldX - burg.x) × metresPerMapUnit
localY = (worldY - burg.y) × metresPerMapUnit
```

Use the selected unit, not an assumed kilometre scale. For the supplied Borteland
save: `3 × 1.609344 × 1000 = 4828.032` metres per map unit. Apply this same factor
to shore distances, polygon coordinates, survey coverage and river widths.

For a custom unit, FMG must have a positive, explicit metres-per-unit conversion.
If none exists, send `status: 'unknown-units'` with its label. Omit metric geometry
and distance assertions. This is neither a zero-distance shore nor an empty
measured survey. The output must carry the units diagnostic so the host can
explain why geographic water is unavailable. Do not silently assume custom units
are kilometres. Other inputs which claim metres must use the same conversion.

**City scaling is owned by Settlemaker, not guessed by FMG.** FMG's future measured
city payload must also use metres. A city implementation must establish and
publish its physical `metresPerMeshUnit`, use it consistently for water, buildings,
roads, frame and output, and define its own survey envelope. A viewBox, SVG pixel
scale, Voronoi radius or `urbanDensity` is not that conversion.

Until that work exists, `waterContext` on population >1000 returns
`water-context-unsupported-engine`; it must never reinterpret metres as mesh
units. FMG does not enable this new mode for cities yet. Legacy city URLs keep
their existing contract and do not gain a geographic-accuracy guarantee from this
village rollout. This restriction is deliberate and visible, not a silent no-op.

## 4. Output, transport and rollout requirements

The implementation must expose a machine-readable `waterContextResult` through
its generation result (and make it available to the existing web error/reporting
path):

```ts
interface WaterContextResult {
  version: 1;
  status: 'measured' | 'approximate' | 'unknown-units' | 'error';
  issues: Array<{
    code: 'water-coverage-exceeded' | 'water-geometry-required'
      | 'water-context-conflict' | 'water-units-unknown'
      | 'water-context-unsupported-engine' | 'water-context-invalid';
    requiredSurveyRadiusM?: number;
  }>;
}
```

`approximate` identifies a measured-distance ocean without explicit bank polygons.
A geometry conflict is an issue on a geometry-backed result, not permission to
switch modes. Coverage, required-geometry, unsupported-engine and invalid-context
errors do not return a falsely complete rendered map. Legacy input omits this
new result entirely. This specifies an implementation result contract; it does
not introduce an iframe message protocol or an HTTP API.

The host must preserve `waterContext` when building links. If compression is
unavailable or the encoded payload exceeds the URL budget, do **not** fall back
to a flat URL that drops measured/unknown state and restores `oceanBearing`.
Simplify polygons conservatively without changing local water topology, or report
that the measured preview cannot be encoded. The existing flat tier has no
representation for this mode.

Roll out in this order:

1. Implement and test the Settlemaker decoder, water preparation, bounded planning,
   precedence, diagnostics and output semantics described here.
2. Publish/pin a release explicitly supporting **water-context v1 for villages**.
3. Enable FMG's measured village payload against that release. Verify both preview
   and external-open URLs. Keep city and legacy paths separate during rollout.

Older decoders ignore unrecognized fields; therefore merely adding this object
to today's production URL is **not** a compatibility check. Do not enable the FMG
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
- New context on a city → unsupported-engine error; legacy city output unchanged.
- URL-budget/compression fallback cannot discard measured or unknown state.
- No-context URLs retain existing compatibility behavior.
