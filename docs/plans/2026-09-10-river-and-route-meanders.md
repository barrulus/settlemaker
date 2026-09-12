# River and route meanders

The reported Brook, population 300, seed 3 image exposed two independent causes:
the review fixture supplied a straight four-vertex water polygon, and straight
approach roads continued their final heading to the frame. Centreline-only water
avoidance also allowed a wide road surface to touch or overlap a bank.

## Implemented

- Optional village `rivers` input supplies a centreline and width in local metres.
  A derived seed generates broad bends before road and housing placement. Survey
  endpoints and the station nearest the burg anchor the displacement. Banks are
  offset from the sampled channel. `meander: false` retains the supplied survey.
- Preserve detailed `coastlineGeometry` exactly. Rivers add to it and to any
  generated ocean fallback. The URL contract includes an FMG payload example and
  explains that cities continue using filled water polygons. No payload version
  bump or new flat-query parameter is required.
- Approach roads acquire gentle, deterministic bends outside their exact FMG
  entries. Their first heading remains continuous with the arriving road.
- Move generated bank-side junctions jointly with their connected roads. Clear
  road paths inland using visible half-width plus a target 3 m verge; repair long
  oblique crossings locally. Apply this before housing and crossing resolution.
- Require a minimum 1.5 m verge for new or adjusted residential roads, excluding
  short bridge approaches. Keep the existing explicit handling of FMG entries
  already in the sea, without inserting additional wet road samples.
- Brook's review input now uses a coarse river survey instead of its old straight
  polygon. This is an intentional input change; the old and new Brook renders
  are not a matched-input geometry comparison.

## Validation

- `output/landscape-review/brook-temple.svg` and the adjacent `index.html` provide
  the updated view. Inspected the full map after the final housing/clearance pass.
- New tests check seeded river bends, endpoint/width preservation, unchanged
  authored polygons, explicit straight surveys, approach bends, and broad road
  surfaces clearing banks. Brook seeds 3 and 103 retain full housing and short
  bridge spans, with a visible verge outside bridge approaches.
- Main and held-out road galleries: 112 villages, all housing their requested
  population, zero access failures and zero long water crossings. The city
  control SVG remains byte-identical. Artifacts are in
  `output/road-review/meanders` and `output/road-review/meanders-held-out`.
- Full suite: 126 files / 1316 tests passed; one test exposed densification of the
  exceptional wet lead from an FMG entry already at sea. Fixed that case and
  reran all five affected coastal, apron, bridge and river test files: 57 passed.
- TypeScript build, script typecheck and browser build passed.

The change is local on `improve/village-henges-and-flora`; no release or production
pin change has been made. FMG must use the new `rivers` field for generated bends,
or provide already-curved water polygons for exact geometry.
