# Measured ocean and lake placement — investigation and proposed contract

Status: investigation complete. The proposal below is retained as investigation
history; [Water context v1](../water-context-v1.md) now defines the implementation
target, including coverage, precedence, units and the city rollout restriction.
Neither the new behavior nor its API is implemented or deployed yet.

## Direct reference: Tarrimas-Ha

Source: the owner's `Borteland 2026-09-10-22-53.map`, saved September 10, 2026.
Read the CRLF-separated save records, the burg record and the saved SVG shoreline.
Measured shortest point-to-curve distance against the coastline feature paths,
subdividing cubic/quadratic curve segments into 16 chords. These numbers describe
the saved, displayed shoreline, not a reconstruction of packed cell vertices.
The saved path coordinates are rounded, so the reported physical distances are
approximate; the future adapter must use the same displayed/saved boundary for distance
and polygon export, with adaptive metric error bounds. Raw unrounded packed
vertices are not an interchangeable source.

| Measurement | Value |
| --- | --- |
| Map seed | `804177376` |
| Burg ID / cell | `706` / `3741` |
| Burg position | `(290, 482.9)` |
| Population | raw `0.01`, displayed `10` |
| Port | absent / false |
| Map distance unit / scale | `mi` / `3` miles per map unit |
| Nearest displayed shore | approximately `(292.3, 483.0)`, feature `5` |
| Distance | `2.302` map units = **6.907 miles / 11.115 km** |
| Bearing to that shore | approximately `92.49°` |
| Nearest displayed lake | approximately `328.8 miles / 529.1 km` away |
| Nominal grid spacing | `9.49` map units = `28.47 miles` |

The village-scale result should be inland, with no ocean or lake in its frame.
Neither the settlement nor the coast should be shifted to make water visible.

Local evidence artifacts:

- `output/water-distance-review/tarrimas-ha-distance.svg`
- `output/water-distance-review/tarrimas-ha-measurements.json`

## Why the preview puts it on the shore

1. **Settlemaker receives direction without distance.**
   `src/village/site.ts`, `oceanBearingFallback`, sets shore standoff to
   `4.6 * sqrt(population)`, independently of actual geography. At population 10
   the baseline is **14.55 m**, before bay shape variation. An ocean bearing is
   effectively being interpreted as a request for a waterfront settlement.
2. **FMG's coastal-cell label is too coarse for a village map.** In the inspected
   local FMG source, `src/generators/burg-context.ts:215`, `coastal` is based on
   `isPort || cellsHarbor[center] > 0`. The bearing uses the cell centre and haven
   cell centre, not the burg position and its nearest shoreline point. A cell
   touching water can contain a burg several miles inland.
3. **Lake proximity is also coarse and water types can be conflated.**
   `readHydrology` calls a burg lakeside if any cell in its surrounding window is
   a lake. The haven-based `oceanBearingDeg` calculation does not test whether the
   haven's water feature is ocean or lake. The local Settlemaker adapter forwards
   that bearing but supplies neither shore distance nor typed lake geometry.
4. **Metric conversion needs the selected distance unit.** The map is in miles.
   The local context helpers assume `distanceScale` means kilometres per map unit.
   FMG already has unit factors in `src/utils/unitUtils.ts`; use those rather than
   treating a scale of `3` as `3 km` on this save. One map unit here is 4,828.032 m.

This traces the code path consistent with the reported preview. The map save
contains no captured Settlemaker URL, so it does not prove the exact live payload
or that the local FMG checkout is byte-identical to the running adapter.

## Proposed responsibilities and behavior

**FMG measures; Settlemaker composes at the measured location.**

- Measure from the actual burg `(x, y)` to the closest shoreline segment. Do not
  use water-cell centres, haven centres or graph-hop distances as shore distance.
- Convert coordinates and distances with the same map-unit-to-metres factor:
  `metresPerMapUnit = distanceScale * kilometresPerSelectedUnit * 1000`.
  Custom units need an explicit conversion, rather than silently assuming km.
- Send water kind, physical distance and bearing, and local water polygons when
  available. Ocean and lake must stay distinct. Preserve actual lake extent;
  a lake bearing is insufficient to invent either a tiny pond or an infinite sea.
- Derive the settlement frame from its buildings, streets, fields and landscape.
  Draw water only where its measured geometry intersects that frame. Never enlarge
  the frame or pull the shore inward merely to display a distant water body.
- Shape approximate coasts around the measured distance. Population can influence
  the settlement's size and level of shoreline detail, but cannot determine where
  the coast is. Preserve explicit, detailed polygons.
- `port` controls infrastructure. It must not be used as the visibility test:
  a nearby beach can have no port, and a broad map-cell classification is not proof
  of a dock at the burg itself. Flag inconsistent port/distance data explicitly.

### Minimal additive proposal

Keep `coastlineGeometry` and `rivers`. Add authoritative measurement metadata:

```json
"waterContext": {
  "surveyRadiusM": 12000,
  "bodies": [{
    "kind": "ocean",
    "distanceM": 11115,
    "bearingDeg": 92.49
  }]
}
```

The example distance/bearing are from the saved shoreline. An optional
`featureId` should identify the actual water body, not its neighbouring land
feature; FMG can obtain that ID from its feature topology.

- `waterContext` absent: legacy input with unknown distance; retain documented
  legacy fallback for compatibility until callers migrate.
- Present, `bodies: []`: FMG surveyed the stated radius and found no relevant
  ocean/lake. Suppress the legacy bearing-only fallback within that survey.
- Present with measured bodies: actual location controls visibility. A body
  11 km away stays off the village map even if `oceanBearing` is also supplied.
- `surveyRadiusM` must cover the requested local extent plus a margin. It is a
  survey coverage statement, not a command to zoom out to that radius.
- For nearby lakes or complex coasts, supply their filled polygons in
  `coastlineGeometry`, in local metres. Send only geometry relevant to the local
  map, clipped with enough surrounding coverage to avoid false closing shores.
- Reuse the coordinate conversion for lengths measured in map units. FMG's
  kilometre-valued `River.width` is mouth width: convert it with `* 1000`, not the
  coordinate factor, and do not assume it is the local upstream width. Avoid a
  second village-specific coordinate scale. The finalized contract defers measured
  city support until Settlemaker defines its physical engine scale; FMG must not
  guess that conversion.

## Acceptance cases for the implementation

1. Tarrimas-Ha: 10 people, measured shore 11,115 m away → inland village, no sea.
2. Same village with the shore 40 m away → genuinely shore-adjacent composition.
3. Portless beach settlement → visible nearby shore, no invented docks.
4. Nearby lake with a known polygon → correct shoreline and finite lake extent.
5. Distant lake in the FMG neighbourhood → no invented local lake or ocean.
6. Maps expressed in miles, km and nautical miles → equivalent physical layouts
   after conversion; custom units without a conversion are explicitly unknown.
7. Empty authoritative survey plus a legacy ocean bearing → no fallback sea.
8. Missing measurement metadata → existing documented compatibility behavior.
9. Measured water never enlarges the village frame just to bring itself into view.

This should be implemented jointly with the FMG adapter, rather than tuning
Settlemaker's population-based coast offset again. The missing physical distance
is what allows an approximately 11 km inland burg to become a waterfront hamlet.
