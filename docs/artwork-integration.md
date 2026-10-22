# Integrated settlement artwork

In 3.1, `generateSettlement` uses the reviewed city, village, landscape and shared
infrastructure libraries by default. The village/city population routing remains
unchanged. No feature flag or asset download is required.

See the [current gallery](gallery.md) for output from both planners, the
[collection catalogue](current-symbol-library.md) for source drawings, and the
[skin guide](skins.md) for replacing their appearance in your own setting. This
page describes placement behaviour; it is not a requirement to edit generator
code when creating a skin.

## Runtime contract

- Villages retain their dwelling decks, detached forms, landmark sites and
  per-building identities. Updated rural SVGs replace the old bodies under the
  same IDs. Placement, collision and exported building bounds use freshly
  measured roof and porch extents rather than generic house/hut ratios.
- Cities fit native urban buildings to existing surveyed lots. The fitter uses
  guarded ink measurements and preserves the building polygon/GeoJSON identity.
  When a centred fit fails, a bounded geometric search can move the artwork
  within the footprint, keeping its scale, coverage and street-access checks.
  It uses the same contained-rectangle helper as corner-site planning; it never
  expands across a concave boundary or stretches artwork to match a wedge.
  Temperate row houses, shop houses and tenements have eight saved artwork
  variations per slot: staggered clay-tile, shingle and slate detail, tapered
  eaves, offset ridges, small dormers and stepped rear additions. Their shadows
  follow the same contours. The shared fitting envelope covers every variation;
  custom skin overrides replace the entire slot without inheriting these shapes.
  Central housing mixes row houses with substantial tenements;
  selected wealthy blocks reserve full-sized courtyard compounds.
  The physical planner reserves wider tenement sites among narrow attached street
  houses, keeping real frontage access and the same capacity per building.
  Ordinary dense houses retain their surveyed footprints with reserved rear
  yards; wider tenement sites retain their deeper footprints. The artwork
  varies eaves and ridges inside each placement envelope. Most
  dense rear yards are paved courts, with a small seeded share retained as
  gardens. Dense districts have an underlying paved surface, while parks and
  suburban gardens retain their planting. Inner-city streets and alleys use
  their full reserved surface width without outlines; their lighter surface
  distinguishes them from the surrounding paving. Dense
  art is never shrunk to a tiny cluster to fit a cottage plot: tenements require
  a nominal canvas of at least 10.4 metres (about eight metres of painted frontage),
  while compound wings are sized to the surrounding house frontage. A corner house needs an actual street corner;
  unsuitable forms fall back to the city's row-house family before plain polygons.
  Five restrained biome roof tones preserve a coherent neighbourhood.
  Demand favours the centre; outer roofs sit in progressively larger gardens
  and mix detached rural houses with urban forms. Parks scale with neighbourhood
  count. Gardens are also exported as `layer: green`, `kind: garden` polygons. Actual POI assignments select
  inns, shops, workshops, bathhouses, guildhalls and warehouses. The principal
  religious form varies independently of biome. Castle keeps/barracks and capital
  administrative halls/wings use the dedicated kits. Court-bearing forms scale
  uniformly and their holes stay transparent. Unsuitable lots retain their real
  polygon, coloured to match the city's roof palette.
- City markets reserve compact paved courts with occupied commercial street
  frontages. They do not consume an entire neighbourhood for a solitary ornament.
  Concave wall-edge blocks retain street rows clipped to their actual boundary;
  a small boundary notch does not switch the whole district to sparse estates.
  Acute corner parcels can reserve a rectangular house and explicit remaining
  yard before the census runs. Physical replacements must retain at least
  40% of the parcel, 16 square metres of footprint and a three-metre short side,
  with clear access. Regular footprints remain unchanged. Residential and civic
  yards appear consistently in the scene and GeoJSON.
- A rare merchant inn or patrician courtyard reserves a larger site before
  ordinary rows are subdivided. Its five or three wings are real building
  footprints with individual identities and normal per-building capacity.
  Courtyard space and connecting access remain open. One compound illustration
  covers the complete group at its planned scale. If later trimming removes a
  wing, surviving wings receive individual artwork instead. An ordinary inn on
  a small plot uses a street-house form; it never miniaturizes the compound.
  Aggregate terrace presets remain available in the catalogue.
- City wells use the reviewed artwork's metre dimensions after the complete
  city scale is known. Their painted diameter is about 2.3 metres on a suitable
  site, rather than interpreting the nominal size as legacy mesh units. Their
  complete painted bounds must fit within the reserved well courtyard.
- Vegetation uses native seeded variants, with separate metre footprints for
  trees, shrubs and low plants. Tundra defaults to low vegetation, including snow
  variants; treeline trees are not scattered across open tundra. Wet-margin
  options require nearby water. Mangroves and geographically restricted cacti
  remain explicit library options rather than indiscriminate default scatter.
  Flora casts no ground shadows, and village clearance accounts for crown size.
  Broad crown highlights have no internal outlines; conifer tiers share a light
  outer contour. Seeded stands group dominant species over roughly 48 metres,
  with local understory and individual saved variants in both engines.
- Both engines fill their **actual field polygons** with native seamless tiles;
  no rectangular preset is stretched across a planner's parcel. Texture pitch
  is independent of parcel dimensions and crop angle lives on the pattern.
  Cultivated parcels gain headlands and access strips. Desert irrigation uses
  a local well/cistern and narrow channels. Tropical paddies use muted shallow
  flooded beds with earth bunds, and are selected only when a river is supplied;
  coastlines alone do not enable them. Other tropical crops use dry ground.
  This is not a groundwater-yield or hydraulic simulation. Tundra ground remains
  natural grazing/lichen/sedge, with no default arable fields or fringe gardens.
- City walls follow existing arbitrary polylines, with actual gate gaps and
  native towers. Walled villages enclose measured roof/porch extents with a
  3.5-metre rear clearance, including intersecting reserved henge clearings.
  Gates are cut where roads cross that enclosure. Wet wall segments are omitted.
  Village walls and gates are included in GeoJSON.
- Greens use biome-specific turf, sand or moss colours, a single soft earth
  edge and quiet ground without repeated curved texture marks. Village shapes and junction outlines keep
  their surveyed geometry; city gardens and parks use actual parcel boundaries.
  The 60 standalone variants are in `symbols/greens/`.
- City parks plant small groves of biome-appropriate shade trees at their final
  metre scale, with open central lawns and clear paths. Managed parks use a
  tree-only mix, separate from wilderness scrub; complete canopy extents clear
  buildings, streets, water and fortifications. Private garden ground remains
  separate from public park planting.
- Bridges use planned river crossings. Village decks follow the existing
  surveyed centreline and width. City scenes publish additive `layers.bridges`
  records for bounded wet road runs between two dry banks; roads terminating in
  open water do not produce a bridge. Ordinary city roads are masked off water.
  Deck width remains independent of span; very short sections crop the detail.
- The existing stone-circle POI now selects a biome-native henge form and saved
  variation, preserving the POI kind and its placement clearances.

Older version-2 scenes remain readable: field `glyph`, wall `material` and
`layers.bridges` and symbol `materialVariant` are additive optional properties. The original `REFINED_SET`
and `SCHEMATIC_SET` remain explicit rendering alternatives. The default is
`SETTLEMENT_SET`. `symbols: false` still exposes real city building polygons.

## Source and regeneration

`src/assets/artwork.ts` is the shared registry. `scripts/build-runtime-art.mjs`
compiles reviewed source drawings, metadata and measured bounds. Authored village
and city building SVGs are embedded; procedural flora, fields and henges are
generated and cached only when requested, using the same pure functions as the
review galleries. The generated modules have no filesystem, DOM or Node dependency.

```sh
# Regenerate the landscape and green sources:
node scripts/build-landscape-symbols.mjs
node scripts/build-green-symbols.mjs

# Compile reviewed drawings into the runtime:
npm run build:art
npm run build
npm run build:lib

# Public-API outputs: five biomes, large cities, river crossings and paddies:
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

## Medieval housing review

The first housing pass updates the four ordinary temperate city slots; other
biomes and landmark drawing styles retain their existing artwork. Variations
are authored in `scripts/art/medieval-housing.mjs`, saved with the city collection
as `housing-variants.json`, and compiled into browser-safe runtime data. They
reuse existing skin slots rather than extending the skin catalogue.

Housing roof planes are lit opposite the theme's `shadowOffset`, accounting for
each placement's rotation and ridge axis. Inherited SVG paints keep the detailed
glyph shared across rotations and work in raster exports; ground shadows retain
their existing displacement. Custom replacement glyphs keep their own artwork.

```sh
node scripts/build-city-symbols.mjs
npm run build:art
npm run build
node scripts/review-medieval-housing.mjs after
```

The review writes a full city and a fixed 120-metre residential view under
`output/medieval-housing/`. Run the same script with `before` on the previous
build to preserve a comparison. Both maps use population 10,000 and seed 2.
