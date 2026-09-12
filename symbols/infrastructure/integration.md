# Walls, bridges and henges

Shared artwork for cities and villages, in the same ink and material style as
the new building libraries. Both generators now consume these drawing functions
on their planned geometry; see [runtime integration](../../docs/artwork-integration.md).

Open `index.html` directly in a browser. Its live controls use the same drawing
functions as the exported assets: bend a wall, change bridge span, or vary a
henge seed, then download that exact drawing. No server is required.

## Contents

| Family | Saved drawings | Review |
| --- | --- | --- |
| Walls | 3 materials × 3 path presets × 5 biomes = 45 | `walls.svg`, `examples/` |
| Bridges | 6 forms × 5 biomes = 30 | `bridges.svg` |
| Henges | 6 arrangements × 3 seeds × 5 biomes = 90 | `henges.svg`, `henge-variations.svg` |

Each of the 165 drawings has a matching silhouette in `individual/`. The hidden
`symbols.svg` sprite contains all 330 definitions; `symbols.json` holds their
placement contracts and conservative measured paint bounds. The original city,
village, vegetation and field sprites are unchanged.

## Walls without square sites

The boundary determines the wall, not a corner stamp. `wall(points, options)`
draws a continuous, constant-width strip along a supplied polyline. Dense curve
samples support smooth bends; widely separated vertices support angular
boundaries. There is no cardinal snapping. The current city scene already has
wall polylines, so this is the appropriate drawing seam for eventual integration.

Stone courses, crenellation blocks or palisade posts are spaced by distance along
the path and oriented to its local tangent. Round joins avoid long miter spikes.
Details are omitted near sharp corners and gate cuts where they would collide.
Towers are optional pieces placed at suitable sites; they do not dictate the
outline. At the closure of an enclosure, the wall joins continuously.

Three material profiles are available in every biome: dressed curtain wall,
rough stone, and timber palisade. The straight, bend and S-curve glyphs are
examples and palette pieces. Use the drawing function for an actual arbitrary
boundary rather than repeatedly stretching or overlapping curved stamps.

```js
import {wall, svg} from './scripts/art/infrastructure.mjs';

const drawing = wall([[10,20], [90,31], [135,77], [179,58]], {
  kind: 'curtain', biome: 'temperate', width: 12,
  gates: [{at: 55, width: 22}], // distance along the centreline, in art units
});
const standalone = svg(drawing);
```

`gateAnchors` gives each gate's position and tangent. The specified interval is
removed from both body and silhouette, with butt caps: painting a road over an
uncut wall would leave an incorrect shadow across the entrance. Gatehouse
openings face perpendicular to the wall tangent. Match an existing city
gatehouse's 14-unit passage to the desired opening by scaling the entire
gatehouse uniformly, and account for its tower footprint. Keep the passage
clear when adding the gatehouse shadow.

Widths and ornament spacing are art units. A planner still needs to validate
tight curves, self-intersections, gate access and tower footprints against its
actual site. The library does not make an invalid boundary valid by smoothing
it or moving its vertices.

## Bridges that fit the crossing

The six forms are stone footbridge, stone road bridge, stone multispan, timber
footbridge, timber trestle and covered bridge. They are drawn in top view:
deck, parapets/rails, bank seats and visible pier/cutwater projections. No
underside arches are painted across the roadway. Water and banks are not
embedded in the glyph.

```js
import {bridge, svg} from './scripts/art/infrastructure.mjs';
const drawing = bridge('stone-multispan', {
  biome: 'coastal', length: 112, width: 18,
});
```

`length` rebuilds the drawing: deck width, parapet thickness and detail pitch
stay fixed while the number of courses/planks and intermediate piers changes.
Do not stretch a fixed bridge SVG along x. The gallery offers spans of 32–160
art units; the drawing function accepts 28–256. These are artwork dimensions,
not a structural or real-world span rating.

The travel axis is local +x, with bank anchors at `[16,32]` and
`[16+length,32]`. Place those anchors on the crossing's landward seats and
rotate the whole bridge to the crossing direction. `deckBounds`,
`clearTravelWidth`, `pierPositions`, and `piersInWater` describe the drawing.
For a covered bridge the travel route is below its roof, not a transparent
stripe cut through the roof image.

The placer must check the full deck against water geometry and seat both ends
on suitable land. Intermediate piers require explicit sites in the water; the
asset does not establish navigation clearance. Render water first, then bridge
shadows, then the bridge. Preserve connection to the existing road endpoints.
Both generators now use these bridge drawings on surveyed crossings. City roads
need two dry banks; village decks follow their planned centreline and width.
See [runtime integration](../../docs/artwork-integration.md) for wall, gate and
henge selection too.

## Henges with reproducible variation

The six arrangements are a lintelled ring, broken ring, double ring, horseshoe
of trilithons, oval ring and heavily ruined ring. Each has three saved variants
(A/B/C, seeds 11/42/74) in all five biomes. Use a stable feature seed to create
additional versions:

```js
import {henge, svg} from './scripts/art/infrastructure.mjs';
const drawing = henge('broken-ring', {biome: 'tundra', seed: 147});
```

Seeds change stone sizes, spacing, orientation, chipped outlines, lintels and
collapsed sections. Fallen slabs and small fragments distinguish the ruins.
The same unsigned 32-bit seed and options always reproduce identical markup;
do not use clock time or unseeded randomness in map generation.

The viewBox is 96×96 with anchor `[48,48]`. An entrance opens towards local
south `[48,88]`; the central clear area is centred on `[48,46]`, and the
manifest gives an access polyline. Rotate the complete layout towards its
approach route. Unlike the old invariant stone-circle mark, these monuments
have a meaningful entrance direction.

Weathered stone has individual top faces and fine cracks. Tundra snow covers
standing stone tops and lintels. The centre and gaps are transparent in both
body and silhouette. This is the stone-monument layer: an optional earthen
bank/ditch belongs in a separate ground layer and can be authored with the
user's ground work. No new flora, fields or permanent ground plate is included.

## SVG placement and shadows

These assets do **not** all use a 64×64 box. Read `viewBox` and `anchor` from the
manifest; give sprite `<use>` elements explicit matching dimensions. Wall
presets are 128×96, henges 96×96, and bridge width depends on span.

Every glyph has explicit ink/material fallbacks. Shared tokens are `--sm-ink`
and `--sm-snow`; materials use `--sm-infra-{biome}-{stone,light,dark,wood,
woodLight,roof}`. No raster imagery, external links or fonts are embedded in
individual drawings.

Draw all shadows before all structure bodies. Silhouettes use `currentColor`;
set colour `#46303c`, opacity `0.2`, and offset `[2.6,3.6]` outside each glyph's
rotation. The individual downloads omit cast shadows; examples/review sheets
include them. The live download also omits its preview shadow, allowing the
map to apply a common world-space lighting direction.

## Regeneration and checks

From the city-glyphs worktree:

```sh
node scripts/build-infrastructure-symbols.mjs
node scripts/check-infrastructure-symbols.mjs
node scripts/render-symbol-previews.mjs
```

`scripts/art/infrastructure.mjs` contains the pure drawing functions. The
builder bundles that same module into the gallery, avoiding a separate preview
implementation. The checks rasterise saved drawings and additional henge seeds
and bridge spans, checking silhouette coverage, clipping, clear henge centres
and entrances, constant bridge width and angled wall gate openings.
