# Village henges and surrounding flora

Implemented on `improve/village-henges-and-flora`, following the owner's
September 10 woodland references and explicit FMG Temple → henge instruction.

## Behavior

- `temple: true` reserves one 30 m stone circle on dry, accessible ground before
  fields and flora. Candidates favor the village centre and must clear occupied
  plots, gardens and roads. A short footpath joins its clearing to an existing
  lane. Trees and fields respect the reservation. Impossible sites produce a
  diagnostic; incidental unrequested circles retain their existing 8% roll.
- Preserve all seven FMG feature flags in the village site. `shanty` is the
  payload name for Shanty Town. The URL contract explains current village
  behavior and avoids implying that retained flags already create structures.
- Replace isolated outer woodland patches with a jittered grid under smooth
  seeded canopy cover. Woodland now occupies unused ground between the built
  edge and farmland edge, as well as the outer fringe. Temperate/tropical cover
  is fuller; desert/coastal/tundra cover is more open. Existing biome glyphs and
  interior groves remain in use. No new bitmap assets or FMG fields are needed.
- Index occupied geometry for flora rejection, with clearance for crops, gardens,
  roads and the henge. Water remains excluded. The outer fringe stays bounded by
  the measured farmland extent plus 70 m, with cover thinning toward its edge.

## Review and validation

Local gallery: `output/landscape-review/index.html`. Fourteen generated maps pair
Temple off/on for a hamlet, temperate village, tundra, desert, headland, estuary
and brook. These are synthetic inputs inspired by the supplied references,
not reconstructions of their unavailable FMG payloads.

Rebuild it:

```sh
npx esbuild scripts/review-village-landscape.ts --bundle --platform=node --format=cjs --outfile=/tmp/review-landscape.cjs
node /tmp/review-landscape.cjs
```

- Explicit Temple audit: all 112 road-review village/seed combinations placed
  exactly one henge.
- Road gallery: `output/road-review/henges-flora/index.html`, compared with
  `output/road-review/coast-fix`. All 56 villages house at least the requested
  population, with zero access failures and unchanged building counts. The
  population-1001 city SVG is byte-identical to the control.
- Full regression run: 125 files passed; its one failure was a newly written
  test incorrectly treating the westward continuation of an eastbound road as
  occupied road. Corrected that assertion to use the actual lane corridor.
  The final focused rerun passed all 28 henge/vegetation tests, including dry
  clearings, access joins, occupied-ground exclusions, field-gap planting,
  biome density, determinism and an impossible all-water site.
- TypeScript build, script typecheck and browser bundle passed.

This branch includes the preceding local coastline/bridge fix (`e2ce8dd`).
It has not been released or deployed; the production pin remains unchanged.
