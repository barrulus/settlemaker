# Village building redraw

49 new building and fortification drawings, each paired with a silhouette.
This is an alternative artwork series to `../refined`, using the same IDs and
the city kit's pen style, with freestanding rural forms and materials.

Scope is buildings only: houses, tiled homes, longhouses, huts, inns, chapels,
the original cathedral and temple, boathouse, walls, gates, towers and keep.
Flora, fields, greens, field boundaries, wells and the stone circle are not
copied into this building library. The generator now uses these buildings with
the separate landscape and infrastructure kits; see
[runtime integration](../../docs/artwork-integration.md).

## Review and files

Open `index.html` directly in a browser. Select a biome and building group;
toggle the original comparison and shadows; download any drawing individually.
`temperate.svg`, `desert.svg`, `tundra.svg`, `tropical.svg`, and `coastal.svg`
show old/new pairs at the same scale. `scenes.svg` shows the new buildings in
rural groups without adding any new flora or field artwork. PNG previews are
provided for these sheets too.

`symbols.svg` contains all 98 definitions. `individual/` holds the same 49
drawings and 49 silhouettes as standalone SVGs. All are editable vector shapes,
with no embedded raster images or external references.

Regenerate with `node scripts/build-village-symbols.mjs`. Drawing functions and
palettes live in `scripts/art/village-buildings.mjs`; the builder creates the
sprites, manifest, gallery and sheets. This document is maintained by hand.
Refresh PNGs with `node scripts/render-symbol-previews.mjs` from the worktree.
PNG rendering uses default colour-token fallbacks; SVGs retain their CSS tokens.

## Rural character and materials

Buildings retain their own front wall and projecting porch. Inns have an open
stable yard; they are not urban perimeter blocks. Roof edges are slightly
irregular and thatch has restrained fine hatching. Side sheds, exposed wall
bands and timber supports give freestanding buildings detail at close zoom.

| Biome | Rural construction |
| --- | --- |
| Temperate | Thatch, timber, warm plaster; tile and slate for wealthier or civic buildings |
| Desert | Earthen roof terraces and parapets, rounded adobe huts, sheltered entries |
| Tundra | Compact timber homes, snow-covered planes, eave remnants, sheltered porches |
| Tropical | Broad palm-thatch hips, timber floor supports, verandas, tiered sanctuary roofs |
| Coastal | Weathered shingles, pale walls, thatched huts, a sheltered boathouse mouth |

The source library's building identities and its existing biome-specific chapel
forms are retained. This is not a new rule tying religion to climate. Faith/culture
selection belongs to the application, independently of material/biome selection.

Snow covers roof hatching underneath, follows a slope or the lower eaves, and
wraps chimney bases. It has no dark outline of its own. Porches can be fully
snowed over while an adjoining main roof has partially melted.

Ink uses `--sm-ink`, with shared `--sm-snow` and `--sm-void`. Rural materials use
`--sm-village-{biome}-{roof,light,wall,accent,wood}`. Special temperate tile,
slate, mud and reed materials and coastal thatch have their own named fallback
tokens in the drawing. Old global timber/stone tokens cannot accidentally
flatten the different materials back into one colour. Explicit strokes inside
each glyph preserve its style when extracting the inner group.

## Placement and integration

ViewBox `[0,0,64,64]`, anchor `[32,32]`, silhouettes `id + '-sil'`. Keep the
source's nominal metre footprints, orientation and 64-unit wall pitch. Those
footprints are not exact paint bounds. `symbols.json` preserves the source
placement metadata, with fresh measured `inkBounds` in **art units**, including
porches and wall overhangs. These bounds are conservatively measured at 4× with
a padded viewport, using the union of body and silhouette.

Use an explicit 64×64 size on every `<use>`, or extract bodies into `<g>`
definitions as the existing renderer does. Draw all structure shadows before
any structure ink. Use colour `#46303c`, opacity `0.2`, and offset `[2.6,3.6]`
outside each building's rotation. The inn's yard stays transparent in body and
silhouette. Palisades use a solid silhouette, following the original library's
wall-shadow convention.

This alternative library deliberately shares source IDs. Do not inline the
old and new sprites into the same SVG without renaming one set. The review
gallery embeds their drawing bodies independently to avoid duplicate IDs.

The shared runtime registry now embeds these bodies and refreshes measured
geometry with `npm run build:art`. Rural fitting and collision use the measured
roof and porch extents. Rerun placement tests after changing the artwork.

## Shared walls, bridges and henges

See [the infrastructure kit](../infrastructure/integration.md) for arbitrary
wall boundaries, bridges and seeded stone monuments. The old rectangular wall
pieces remain available; the new path renderer provides curves and arbitrary
angles without making the settlement follow a square grid.
