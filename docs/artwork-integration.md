# Integrated settlement artwork

`generateSettlement` now uses the reviewed city, village, landscape and shared
infrastructure libraries by default. The village/city population routing remains
unchanged. No feature flag or asset download is required.

## Runtime contract

- Villages retain their dwelling decks, detached forms, landmark sites and
  per-building identities. Updated rural SVGs replace the old bodies under the
  same IDs. Placement, collision and exported building bounds use freshly
  measured roof and porch extents rather than generic house/hut ratios.
- Cities fit native urban buildings to existing surveyed lots. The fitter uses
  guarded ink measurements and preserves the building polygon/GeoJSON identity.
  Ordinary housing has one seeded row-house family. Actual POI assignments select
  inns, shops, workshops, bathhouses, guildhalls and warehouses. The principal
  religious form varies independently of biome. Castle keeps/barracks and capital
  administrative halls/wings use the dedicated kits. Court-bearing forms scale
  uniformly and their holes stay transparent. Unsuitable lots retain their real
  polygon, coloured to match the city's roof palette.
- Multi-building terrace and complete compound presets are available in the
  artwork registry/catalogue but are not substituted for individual household
  lots. Compound planning must retain constituent identities and real capacities;
  this integration does not invent households to fill an aggregate illustration.
- Vegetation uses native seeded variants, with separate metre footprints for
  trees, shrubs and low plants. Tundra defaults to low vegetation, including snow
  variants; treeline trees are not scattered across open tundra. Wet-margin
  options require nearby water. Mangroves and geographically restricted cacti
  remain explicit library options rather than indiscriminate default scatter.
  Flora casts no ground shadows, and village clearance accounts for crown size.
- Both engines fill their **actual field polygons** with native seamless tiles;
  no rectangular preset is stretched across a planner's parcel. Texture pitch
  is independent of parcel dimensions and crop angle lives on the pattern.
  Cultivated parcels gain headlands and access strips. Irrigated plots show a
  supply head and channels; desert irrigation uses a local well/cistern abstraction.
  This is not a groundwater-yield or hydraulic simulation. Tundra ground remains
  natural grazing/lichen/sedge, with no default arable fields or fringe gardens.
- City walls follow existing arbitrary polylines, with actual gate gaps and
  native towers. Walled villages use the planner's irregular inner farmland
  boundary and cut gates where roads cross it. Wet wall segments are omitted.
  Village walls and gates are included in GeoJSON.
- Bridges use planned river crossings. Village decks follow the existing
  surveyed centreline and width. City scenes publish additive `layers.bridges`
  records for bounded wet road runs between two dry banks; roads terminating in
  open water do not produce a bridge. Ordinary city roads are masked off water.
  Deck width remains independent of span; very short sections crop the detail.
- The existing stone-circle POI now selects a biome-native henge form and saved
  variation, preserving the POI kind and its placement clearances.

Older version-2 scenes remain readable: field `glyph`, wall `material` and
`layers.bridges` are additive optional properties. The original `REFINED_SET`
and `SCHEMATIC_SET` remain explicit rendering alternatives. The default is
`SETTLEMENT_SET`. `symbols: false` still exposes real city building polygons.

## Source and regeneration

`src/assets/artwork.ts` is the shared registry. `scripts/build-runtime-art.mjs`
compiles reviewed source drawings, metadata and measured bounds. Authored village
and city building SVGs are embedded; procedural flora, fields and henges are
generated and cached only when requested, using the same pure functions as the
review galleries. The generated modules have no filesystem, DOM or Node dependency.

```sh
# After updating/regenerating the authored SVG libraries:
npm run build:art
npm run build
npm run build:lib

# Real public-API outputs, all five biomes plus a river crossing:
npm run review:art
```

The review writes SVGs, PNGs, GeoJSON, generation counts and a local gallery to
`output/art-integration/`. It calls the public generator; it does not assemble
separate demonstration scenes.

The artwork integration tests cover native lookup, scale differences, POI
coherence, seams/footprints through the existing asset checks, a closing-vertex
wall gate, village wall exports, bounded river crossings and henge selection.
Existing population, street, collision, deterministic scene and GeoJSON tests
remain part of the regression suite.
