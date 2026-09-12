# Current symbol library

The downloadable library contains 852 drawings in six collections:

| Collection | Drawings | Manifest |
| --- | ---: | --- |
| Village | 49 | `symbols/village/symbols.json` |
| City | 170 | `symbols/city/symbols.json` |
| Infrastructure | 165 | `symbols/infrastructure/symbols.json` |
| Landscape | 372 | `symbols/landscape/symbols.json` |
| Greens | 60 | `symbols/greens/symbols.json` |
| Markers | 36 | `symbols/markers/markers.json` |

Counts exclude structure silhouettes and combined sprites. Every declared drawing
has a standalone SVG. Markers live directly in their collection directory; the
other collections use `individual/`. View boxes vary: consumers must preserve
aspect ratio rather than assume every drawing is a 64-unit square.

The `symbols/batch001` and `symbols/refined` directories and their source extraction
scripts have been retired. Village authoring now reads independent placement
metadata from `scripts/art/village-footprints.json`; it no longer needs an older
sprite collection to build. Village review sheets and their PNGs show only current
art. Greens have a combined `catalogue.svg` review sheet.

The existing embedded compatibility exports in `src/assets` remain available to
API consumers and supply shared placement metadata and remaining common map
primitives. They are not a downloadable collection or a source for the web gallery.
Current runtime art continues to come from `scripts/build-runtime-art.mjs` and the
procedural authoring modules. This change does not remove public rendering APIs.

Settlemaker-web builds its catalogue from the six manifests in its pinned checkout.
Its Vite plugin emits only allowlisted current drawings, silhouettes, sprites,
manifests, review sheets and licence files; it does not maintain a copied library.
No legacy comparison plates are published. Library and website licences remain
separate from the generator's GPL licence.

## Validation

- Generator suite: 1,414 tests passed after retiring source extraction tests and
  adding current-collection/placement checks.
- TypeScript build, script typecheck and browser library bundle passed.
- Marker check: all 36 original types and pin metadata retained; 38 SVG documents
  parsed, matching standalone/sprite raster output, 144 small-size renders,
  centred unclipped bounds, working gallery links and byte-checked ZIP contents.
