# City architecture library

An artwork-first city kit derived from the refined library's top-down pen style.
170 building glyphs: 34 forms in each of temperate, desert, tundra, tropical and
coastal, plus 170 matching silhouette files. The generator now selects this
library by default; see [runtime integration](../../docs/artwork-integration.md).
The original refined source sprites remain available.

Open `index.html` directly in a browser. It has a biome selector, shadow and
ground controls, and individual downloads. `catalogue.svg` compares every form;
`assemblies.svg` demonstrates joined rows, back-to-back housing, four corner
wings around a court, perimeter housing, inns and larger city buildings.

## Files and regeneration

- `symbols.svg`: all 340 definitions in a hidden SVG sprite.
- `individual/*.svg`: standalone editable drawings and silhouettes, 64×64.
- `symbols.json`: city-specific placement metadata, palettes and shadow rule.
- `index.html`, `catalogue.svg`, `assemblies.svg`: local review.
- `religious.svg`, `palace-kit.svg`, `castle-kit.svg`: focused component sheets.
- `compounds.svg`: three compound layouts in each of five biomes.
- `compounds/*.svg`: 15 complete compound drawings and their silhouette twins.
- `compounds.json`: editable component positions, rotations, scale and access recipes.

Run `node scripts/build-city-symbols.mjs` from the city-glyphs worktree. Geometry,
palette and catalogue composition are authored there and in `scripts/art/`; regenerating overwrites
the SVGs, HTML and JSON. This document is maintained by hand. No raster imagery,
embedded fonts, network references or image generation are used in the glyphs.
Refresh PNG exports with `node scripts/render-symbol-previews.mjs`.

## Style and biome construction

The outline uses the refined ink `--sm-ink` / `#33262e`, 2.2-unit structure lines,
1.2-unit ridges and roughly 0.55-unit hatching, with round joins and caps. Fine
strokes vary slightly; the joining edges remain straight. Entrances and shop
awnings sit inside the building envelope, without a projecting village porch.

| Biome | Construction |
| --- | --- |
| Temperate | Slate, pale masonry, chimney stacks, muted red shop awnings |
| Desert | Pale roof terraces, parapets, access hatches, cistern marks and shade strips |
| Tundra | Blue slate, snow-covered planes or full roofs, lower-eave remnants, snow caught around chimneys and roof lights |
| Tropical | Hipped tile roofs, raised ventilating ridge caps, sheltered shopfronts |
| Coastal | Green-grey shingles, staggered course marks, roof lights |

City fill tokens use `--sm-city-{biome}-{roof,light,wall,accent}` so the current
village material stylesheet cannot accidentally recolour every city roof as
timber. Each SVG has colour fallbacks and explicit strokes; extracting its inner
group does not lose inherited styling. `--sm-ink`, `--sm-void` and `--sm-snow`
remain shared. Roof light/dark planes describe materials, not a directional cast
shadow. The cast shadow always uses the world-space offset below.

Tundra snow follows the roof slopes: continuous, irregular remnants along the
lower eaves; broad coverage of a roof plane; or a fully covered roof with a faint
ridge. Small accumulations wrap chimney bases and roof lights, leaving their
openings visible. Snow covers the tile hatching beneath it and has no dark
outline of its own. It does not form detached crescent shapes at roof corners.

## Placement contract

All geometry and `inkBounds` values are **SVG art units**, not metres. The
manifest deliberately uses a city-specific format; do not feed it directly into
the current refined-manifest extractor, which expects nominal metre footprints.

Every viewBox is `[0,0,64,64]`, with anchor `[32,32]`. Place with:

```svg
<g transform="translate(x,y) rotate(bearing) scale(k) translate(-32,-32)">
  <use href="#sm-city-row-house-a" width="64" height="64"/>
</g>
```

The containing document must have the sprite inline. Explicit `width` and
`height` on every `<use>` prevent viewport-dependent resizing. A renderer can
instead extract the body into `<g id="...">` definitions, matching the existing
city rendering approach. Prefer uniform scale; do not warp a courtyard to fill
an arbitrary parcel.

`inkBounds` includes the outline; there are no projecting entrances, chimneys
or eaves outside it. `footprintPolygons` is the conservative union of rectangular
roof panels, also including ink. Use that union for occupied area, not the full
bounding rectangle of an L or courtyard. Rounded corners occupy slightly less
than these conservative rectangles. The courtyard centre and ground-level
passage must remain available for access and ground rendering.

`frontVector: [0,1]` means the street faces local south. `frontageEdge` describes
the site's street-facing span, including any central passage; it is not a claim
that every point on that span is wall. `courtyardVoids` lists the explicit court
and passage rectangles for the U, perimeter court and inn. The L shape's empty
quadrant is also absent from its footprint polygons.

### Joining and courts

Row houses A/B and shop houses share exact `[16,8,48,56]` paint bounds. Their
horizontal centre pitch is **32 × k**, not 64 × k. At that pitch party-wall ink
touches and there is no transparent margin between buildings. Back-to-back
rows have **48 × k** depth pitch; rotate the opposing row 180°. The catalogue
demonstrates both. `repeatPitch` records horizontal joining for other rectangular
forms and vertical joining for palace wings and barracks. Align their south paint bounds to the street when mixing depths.

L wings have a 48-unit overall pitch. Four quarter-turn copies form an enclosed
court. A usable generated block additionally needs a ground-floor passage or
an open side: the assembly sheet demonstrates roof joins, not a validated access
plan. The U court is open to the south. The perimeter court and coaching inn
have a **10-unit-wide, unroofed south passage** that remains transparent in their
silhouettes too. Render paving, planting and furniture independently underneath.

### Shadows

Use `id + '-sil'`, colour `#46303c`, opacity `0.2`, offset `[2.6,3.6]`.
Draw all shadows before any building ink. Apply the offset outside the building
rotation; scale it with the map's chosen common art-to-world scale. Court holes
are not filled by the silhouette. Do not add an opaque rectangle beneath a
courtyard just to simplify collision or shadows.

## Generator integration boundary

Resolve `sm-city-{family}` in temperate and append `--{biome}` otherwise. Every
family exists natively in all five biomes, so no village fallback is needed for
these forms. Religious and defensive buildings now have dedicated city forms. Vegetation
comes from the expanded landscape library. Faith forms are architectural
choices, independent of biome: every religious form exists in every biome.

The city fitter uses freshly measured native ink bounds and preserves one
placement per building and its scene/GeoJSON identity. Panel-union and court
forms scale uniformly; court holes remain transparent. Multi-building compounds
and joined terraces still need dedicated site planning before automatic use.
The runtime does not relabel individual houses as aggregate courtyards.

`storeys` ranges are artistic intent, not a population formula. A tenement is
one structure with multiple households. A terrace represents three buildings;
a perimeter court marked `aggregate` has no predetermined constituent count.
The planner must assign real identities, uses and capacity before placement.
Markets, inns, warehouses and civic buildings must not count as ordinary houses
merely because they occupy roof area. Runtime selection follows actual POI
assignments and retains the planner's population and building budgets.

## Religious buildings and compounds

The six religious forms are a neighbourhood chapel, parish church, cathedral,
columned temple, courtyard sanctuary, and church with cloister. The cathedral
is one complete glyph. The roof plan identifies it; symbols of a specific
religion are not automatically added based on climate.

Palaces use a state hall, residential wings, corner pavilions, covered galleries,
a gatehouse and private chapel. Castles use a keep, great hall, barracks, round
and square towers, a twin-tower gatehouse, curtain walls and chapel. Gatehouses
have a 14-art-unit open passage, with no roof or shadow painted across it.

The three sample compounds are an enclosed palace court, an open palace
forecourt, and a keep with bailey. Each exists in all five biomes. They are
transparent 256×256 SVGs built with references to the same component artwork,
plus a shadow at the shared world-direction offset. The site's ground remains
transparent. Each `-sil` file is unoffset and uncoloured for a consuming renderer
to shadow independently. The complete compound drawing already includes its
shadow: do not add that shadow a second time.

`compounds.json` supplies stable piece instance IDs and local placement recipes,
not population or construction decisions. Roof intersections where wings meet
halls, pavilions, galleries or towers meet walls are deliberate joints. Access
polylines run from the south boundary through clear gates/forecourts. Marked
courtyard rectangles remain roof-free. A planner must reserve the whole site,
fit all parts together, preserve per-building identity, and establish physical
scale and capacity before using a recipe in generated settlements.

## Shared walls, bridges and henges

See [the infrastructure kit](../infrastructure/integration.md) for arbitrary
wall boundaries, bridges and seeded stone monuments. The old rectangular wall
pieces remain available; the new path renderer provides curves and arbitrary
angles without making the settlement follow a square grid.
